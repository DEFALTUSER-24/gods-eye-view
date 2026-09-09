import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { registerSpriteCollection } from './spriteOrder.js';
import {
  BAHIA_COLECTIVOS_API_URL,
  COLECTIVOS_API_URL,
  COLECTIVOS_POLL_MS,
  routeColorHsl,
} from './colectivosFeed.js';

/**
 * Colectivos — live Buenos Aires (AMBA) bus GPS positions.
 *
 * Data: GCBA "API Transporte" (client_id / client_secret, free registration),
 * brokered by the same-origin `/api/ba-colectivos` proxy so the credentials
 * never reach the browser. The proxy returns
 *   { generatedAt, count, vehicles: [{ id, route, routeId, lat, lon, speedMps,
 *     headingDeg, tsMs, agency, agencyId, headsign, tripId }] }
 * and answers 503 { error: 'no_key' } until the credentials are configured.
 *
 * Rendering: one PointPrimitive per vehicle, colored per route (stable hash),
 * plus a bounded cohort of route-number labels through the shared world
 * overlay host so they take part in the global label declutter.
 */

export const COLECTIVOS_OVERLAY_SOURCE_ID = 'colectivos';
export const COLECTIVOS_LABEL_COHORT_LIMIT = 160;
export const COLECTIVOS_LABEL_COLLISION_CAPACITY = 96;
export const COLECTIVOS_LABEL_MAX_DISTANCE_M = 30_000;
export const COLECTIVOS_STALE_AFTER_MS = 3 * 60_000;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

const POINT_OUTLINE = Cesium.Color.fromCssColorString('#0b1116').withAlpha(0.9);
const _routeColorCache = new Map();

/** Stable Cesium color per route (memoized). */
export function routeColor(route) {
  const key = String(route || '');
  let color = _routeColorCache.get(key);
  if (!color) {
    const { h, s, l } = routeColorHsl(key);
    color = Cesium.Color.fromHsl(h / 360, s, l, 1.0);
    _routeColorCache.set(key, color);
  }
  return color;
}

/** Deterministic priority so the label cohort is stable between polls. */
function labelPriority(vehicle) {
  const s = String(vehicle.id || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 100000;
}

/** Build the overlay label entry for one vehicle. */
export function createColectivoOverlayEntry({ id, position, route, accent, priority }) {
  return {
    id: String(id),
    position,
    variant: 'label',
    title: String(route || '·'),
    accent,
    priority,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 10,
    verticalOnly: true,
    placement: 'above',
    maxDistance: COLECTIVOS_LABEL_MAX_DISTANCE_M,
  };
}

/** Keep a bounded, stable cohort of labels (highest priority first). */
export function selectColectivoLabelCohort(entries, limit = COLECTIVOS_LABEL_COHORT_LIMIT) {
  const cap = Math.max(0, Math.min(COLECTIVOS_LABEL_COHORT_LIMIT, Math.floor(Number(limit) || 0)));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/** JSON-safe analyst record for one vehicle (pure). */
export function mapAnalystRecord(v) {
  const num = (x) => (Number.isFinite(x) ? x : null);
  const text = (x) => { const t = String(x ?? '').trim(); return t || null; };
  return {
    id: text(v?.id) || 'BUS-UNKNOWN',
    route: text(v?.route),
    routeId: text(v?.routeId),
    lat: num(v?.lat),
    lon: num(v?.lon),
    speedKmh: Number.isFinite(v?.speedMps) ? Math.round(v.speedMps * 3.6) : null,
    headingDeg: num(v?.headingDeg),
    agency: text(v?.agency),
    headsign: text(v?.headsign),
    timeMs: num(v?.tsMs),
  };
}

export function createColectivosLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiUrl = COLECTIVOS_API_URL,
  bahiaApiUrl = BAHIA_COLECTIVOS_API_URL,
} = {}) {
  let _points = null;
  /** @type {Map<string, {point: object, vehicle: object}>} */
  let _byId = new Map();
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _loading = false;
  let _keyMissing = false;
  let _generatedAtMs = 0;
  let _sourceNote = '';

  function refreshLabels() {
    if (!_enabled) return;
    const entries = [];
    for (const { point, vehicle } of _byId.values()) {
      entries.push(createColectivoOverlayEntry({
        id: vehicle.id,
        position: point.position,
        route: vehicle.route,
        accent: routeColor(vehicle.route).toCssColorString(),
        priority: labelPriority(vehicle),
      }));
    }
    overlayHost.setEntries(
      COLECTIVOS_OVERLAY_SOURCE_ID,
      selectColectivoLabelCohort(entries),
      {
        cohortLimit: COLECTIVOS_LABEL_COHORT_LIMIT,
        collisionCapacity: COLECTIVOS_LABEL_COLLISION_CAPACITY,
        moving: true,
      },
    );
  }

  function applyVehicles(vehicles) {
    if (!_points) return;
    const seen = new Set();
    for (const vehicle of vehicles) {
      seen.add(vehicle.id);
      const position = Cesium.Cartesian3.fromDegrees(vehicle.lon, vehicle.lat, 4);
      const color = routeColor(vehicle.route);
      const existing = _byId.get(vehicle.id);
      if (existing) {
        existing.point.position = position;
        existing.point.color = color;
        existing.vehicle = vehicle;
        continue;
      }
      const point = _points.add({
        position,
        pixelSize: 7,
        color,
        outlineColor: POINT_OUTLINE,
        outlineWidth: 1.5,
        scaleByDistance: new Cesium.NearFarScalar(300, 1.4, 120000, 0.45),
        translucencyByDistance: new Cesium.NearFarScalar(300, 1.0, 220000, 0.2),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: vehicle.id,
      });
      _byId.set(vehicle.id, { point, vehicle });
    }
    for (const [id, record] of _byId) {
      if (seen.has(id)) continue;
      _points.remove(record.point);
      _byId.delete(id);
    }
    _count = _byId.size;
    refreshLabels();
    governorRequestRender('colectivos-points');
  }

  const layer = {
    id: 'colectivos',
    group: 'argentina',
    name: 'Colectivos (AMBA + Bahía Blanca)',
    icon: '🚌',
    source: 'BA Transporte · GPS Bahía',
    updateInterval: COLECTIVOS_POLL_MS,

    init(viewer) {
      _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
      _points.show = false;
      viewer.scene.primitives.add(_points);
      registerSpriteCollection('colectivos', _points);
      _byId = new Map();
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      _loading = false;
      _keyMissing = false;
      overlayHost.setVisible(COLECTIVOS_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Colectivos] Initialized');
    },

    enable() {
      _enabled = true;
      if (_points) _points.show = true;
      registerPickOwner('colectivos', (pickedId) => _byId.has(pickedId));
      overlayHost.setVisible(COLECTIVOS_OVERLAY_SOURCE_ID, true);
      refreshLabels();
      governorRequestRender('colectivos-visibility');
    },

    disable() {
      _enabled = false;
      if (_points) _points.show = false;
      unregisterPickOwner('colectivos');
      overlayHost.clearSource(COLECTIVOS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(COLECTIVOS_OVERLAY_SOURCE_ID, false);
      governorRequestRender('colectivos-visibility');
    },

    async update(viewer, { signal } = {}) {
      _loading = _count === 0;
      const fetchJson = async (url) => {
        const response = await fetchImpl(`${url}?ts=${Date.now()}`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal,
        });
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        return { status: response.status, ok: response.ok, body };
      };
      try {
        // Two sources, one layer: AMBA (API Transporte, needs credentials) and
        // Bahía Blanca (GPS Bahía, keyless). Either may be missing; the layer
        // draws whatever arrived and explains the rest in the row.
        const [amba, bahia] = await Promise.allSettled([fetchJson(apiUrl), fetchJson(bahiaApiUrl)]);
        if (amba.status === 'rejected' && amba.reason?.name === 'AbortError') return false;
        const vehicles = [];
        const notes = [];
        let stale = false;

        if (amba.status === 'fulfilled') {
          const { status, ok, body } = amba.value;
          if (status === 503 && (body?.error === 'no_key' || body?.error === 'invalid_key')) {
            // Keyless is a configuration state, not a feed fault (same contract
            // as FIRMS): keep the layer enabled, read KEY REQUIRED in the row.
            _keyMissing = true;
            notes.push(body.error === 'no_key'
              ? 'AMBA: KEY REQUIRED · POWER UP → BA TRANSPORTE'
              : 'AMBA: KEY REJECTED · check BA TRANSPORTE credentials');
          } else if (!ok || !Array.isArray(body?.vehicles)) {
            notes.push(`AMBA: BA Transporte HTTP ${status}`);
          } else {
            _keyMissing = false;
            vehicles.push(...body.vehicles);
            if (body.stale) stale = true;
          }
        } else {
          notes.push('AMBA: network error');
        }

        if (bahia.status === 'fulfilled') {
          const { ok, body, status } = bahia.value;
          if (ok && Array.isArray(body?.vehicles)) {
            vehicles.push(...body.vehicles);
            if (body.stale) stale = true;
          } else {
            notes.push(`Bahía Blanca: HTTP ${status}`);
          }
        } else if (bahia.reason?.name !== 'AbortError') {
          notes.push('Bahía Blanca: network error');
        }

        if (!vehicles.length) {
          _lastError = notes.join(' · ') || 'No buses reported';
          return _keyMissing ? undefined : false;
        }
        applyVehicles(vehicles);
        _generatedAtMs = Date.now();
        _lastUpdate = Date.now();
        // A missing AMBA key while Bahía Blanca is drawing is a setup note, not
        // a fault: keep the chip nominal and say it in the source line instead.
        _sourceNote = notes.length ? notes.join(' · ') : '';
        _lastError = stale ? 'Serving cached positions (upstream error)' : null;
        console.log(`[Data:Colectivos] Updated: ${_count} buses${notes.length ? ` (${notes.join('; ')})` : ''}`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        console.warn('[Data:Colectivos] Fetch error:', error);
        _lastError = 'Colectivos network error';
        return false;
      } finally {
        _loading = false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      unregisterPickOwner('colectivos');
      overlayHost.clearSource(COLECTIVOS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(COLECTIVOS_OVERLAY_SOURCE_ID, false);
      if (_points) {
        viewer.scene.primitives.remove(_points);
        _points = null;
      }
      _byId = new Map();
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    /** Vehicle by picked primitive id (click-to-inspect seam). */
    getVehicle(id) {
      return _byId.get(String(id))?.vehicle || null;
    },

    /** HUD detection brackets: a bounded, seeded sample of buses in view. */
    getDetectableObjects({ maxCount = 120, seed = 0 } = {}) {
      if (!_enabled || !_byId.size) return [];
      const limit = Math.max(1, Math.min(400, Math.floor(maxCount) || 120));
      const records = Array.from(_byId.values());
      const start = records.length ? Math.abs(Math.floor(seed)) % records.length : 0;
      const out = [];
      for (let i = 0; i < records.length && out.length < limit; i += 1) {
        const { point, vehicle } = records[(start + i) % records.length];
        out.push({
          position: point.position,
          sourceId: vehicle.id,
          id: `BUS-${vehicle.route || '?'}-${vehicle.id}`,
          type: 'VEH',
          skipLabel: false,
        });
      }
      return out;
    },

    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || !_byId.size) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 2000;
      const out = [];
      for (const { vehicle } of _byId.values()) {
        if (out.length >= limit) break;
        out.push(mapAnalystRecord(vehicle));
      }
      return out;
    },

    getStats() {
      const stale = Boolean(_lastUpdate) && (Date.now() - _lastUpdate) > COLECTIVOS_STALE_AFTER_MS;
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        loading: _loading,
        loadingLabel: _keyMissing ? 'KEY REQUIRED' : (_loading ? 'LOADING BUSES' : ''),
        error: _lastError,
        stale,
        source: `BA Transporte · GPS Bahía${_sourceNote ? ` · ${_sourceNote}` : ''}`,
        generatedAt: _generatedAtMs || null,
      };
    },
  };
  return layer;
}

const colectivosLayer = createColectivosLayer();

export default colectivosLayer;
