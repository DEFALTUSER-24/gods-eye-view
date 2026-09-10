import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { governorRequestRender } from '../renderGovernor.js';
import {
  RUTAS_API_URL,
  RUTAS_POLL_MS,
  STATUS_COLORS,
  STATUS_LABELS,
  provinceKey,
  summarizeByRoute,
} from './rutasFeed.js';
import routesUrl from './local_data/vialidad_rutas/vialidad_rutas.geojsonl?url';

/**
 * Estado de rutas — every national route drawn as a ground polyline, colored
 * by the worst live status of its tramos in that province (Vialidad Nacional
 * via rutas.ar): green HABILITADA, blue RESTRINGIDA, yellow CORTE PARCIAL,
 * red CORTE TOTAL, gray no data. Incidents get a card at the route midpoint.
 */

export const RUTAS_OVERLAY_SOURCE_ID = 'rutas-estado';
export const RUTAS_STALE_AFTER_MS = 2 * 60 * 60_000;
const WIDTHS = Object.freeze({ red: 6, yellow: 5, blue: 4, green: 3, gray: 2 });
const _colors = new Map();
function statusColor(color) {
  let c = _colors.get(color);
  if (!c) { c = Cesium.Color.fromCssColorString(STATUS_COLORS[color] || STATUS_COLORS.gray).withAlpha(color === 'green' ? 0.55 : 0.9); _colors.set(color, c); }
  return c;
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/** Midpoint (by vertex index) of a LineString — good enough for a card anchor. */
export function lineMidpoint(coords) {
  if (!Array.isArray(coords) || !coords.length) return null;
  return coords[Math.floor(coords.length / 2)];
}

/** Parse GeoJSONL text into features (pure). */
export function parseGeoJsonl(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip bad line */ }
  }
  return out;
}

export function createRutasEstadoLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiUrl = RUTAS_API_URL,
  geometryUrl = routesUrl,
} = {}) {
  let _dataSource = null;
  /** @type {Map<string, {entities: object[], midpoint: number[], ruta: string, provincia: string}>} key -> route group */
  let _routes = new Map();
  let _summary = new Map();
  let _tramoCount = 0;
  let _incidentCount = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _loading = false;
  let _geometryLoaded = false;
  let _sourceUpdated = '';

  async function ensureGeometry() {
    if (_geometryLoaded || !_dataSource) return;
    const response = await fetchImpl(geometryUrl, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`routes geometry HTTP ${response.status}`);
    const features = parseGeoJsonl(await response.text());
    for (const f of features) {
      const p = f.properties || {};
      const coords = f.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const key = `${p.ruta}|${provinceKey(p.provincia)}`;
      const entity = _dataSource.entities.add({
        id: `rutas:${f.id || key}`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(coords.flat()),
          width: WIDTHS.gray,
          material: statusColor('gray'),
          clampToGround: true,
        },
        properties: { ruta: p.ruta, provincia: p.provincia, pkStart: p.pkStart, pkEnd: p.pkEnd },
      });
      let group = _routes.get(key);
      if (!group) { group = { entities: [], midpoint: lineMidpoint(coords), ruta: p.ruta, provincia: p.provincia }; _routes.set(key, group); }
      group.entities.push(entity);
    }
    _geometryLoaded = true;
    console.log(`[Data:RutasEstado] Geometry: ${features.length} segments, ${_routes.size} route-provinces`);
  }

  function applyStatus(tramos) {
    _summary = summarizeByRoute(tramos);
    let incidents = 0;
    for (const [key, group] of _routes) {
      const s = _summary.get(key);
      const color = s ? s.color : 'gray';
      for (const entity of group.entities) {
        entity.polyline.material = statusColor(color);
        entity.polyline.width = WIDTHS[color] || 2;
      }
      if (s) incidents += s.incidents.length;
    }
    _incidentCount = incidents;
    _tramoCount = tramos.length;
    refreshCards();
    governorRequestRender('rutas-estado-status');
  }

  function refreshCards() {
    if (!_enabled) return;
    const entries = [];
    for (const [key, s] of _summary) {
      if (!s.incidents.length) continue;
      const group = _routes.get(key);
      if (!group?.midpoint) continue;
      const worst = s.incidents.slice().sort((a, b) => (STATUS_LABELS[b.color] ? 1 : 0) - (STATUS_LABELS[a.color] ? 1 : 0))[0];
      const details = s.incidents.slice(0, 3).map((t) => `${STATUS_LABELS[t.color]} · ${t.name}`.slice(0, 64));
      if (worst.notes) details.push(worst.notes.slice(0, 64));
      entries.push({
        id: key,
        position: Cesium.Cartesian3.fromDegrees(group.midpoint[0], group.midpoint[1], 0),
        variant: 'card',
        title: `RN ${group.ruta} · ${group.provincia.toUpperCase()} · ${STATUS_LABELS[s.color]}`,
        details,
        accent: STATUS_COLORS[s.color],
        priority: (s.color === 'red' ? 3000 : s.color === 'yellow' ? 2000 : 1000) + s.incidents.length,
        collisionGroup: 'ambient-label',
        paintLane: 'ambient-label',
        interactive: false,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        gapPx: 12,
        placement: 'above',
      });
    }
    overlayHost.setEntries(RUTAS_OVERLAY_SOURCE_ID, entries, { cohortLimit: 40, collisionCapacity: 24, moving: false });
  }

  const layer = {
    id: 'rutas-estado',
    group: 'argentina',
    sourceUrl: 'https://www.argentina.gob.ar/transporte/vialidad-nacional/estado-de-rutas',
    name: 'Estado de rutas nacionales',
    icon: '🛣️',
    source: 'Vialidad Nacional · rutas.ar',
    updateInterval: RUTAS_POLL_MS,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('rutas-estado');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _routes = new Map();
      _summary = new Map();
      _geometryLoaded = false;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(RUTAS_OVERLAY_SOURCE_ID, false);
      console.log('[Data:RutasEstado] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(RUTAS_OVERLAY_SOURCE_ID, true);
      refreshCards();
      governorRequestRender('rutas-estado-visibility');
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(RUTAS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(RUTAS_OVERLAY_SOURCE_ID, false);
      governorRequestRender('rutas-estado-visibility');
    },

    async update(viewer, { signal } = {}) {
      _loading = !_geometryLoaded;
      try {
        await ensureGeometry();
        const response = await fetchImpl(`${apiUrl}?ts=${Date.now()}`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal,
        });
        if (!response.ok) {
          _lastError = `rutas.ar HTTP ${response.status}`;
          return false;
        }
        const payload = await response.json();
        const tramos = Array.isArray(payload?.tramos) ? payload.tramos : null;
        if (!tramos) {
          _lastError = 'Malformed rutas.ar response';
          return false;
        }
        applyStatus(tramos);
        _sourceUpdated = String(payload.sourceUpdated || '');
        _lastUpdate = Date.now();
        _lastError = payload?.stale ? 'Serving cached status (upstream error)' : null;
        console.log(`[Data:RutasEstado] Updated: ${_tramoCount} tramos, ${_incidentCount} incidents`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        console.warn('[Data:RutasEstado] Fetch error:', error);
        _lastError = 'rutas.ar network error';
        return false;
      } finally {
        _loading = false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      overlayHost.clearSource(RUTAS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(RUTAS_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _routes = new Map();
      _summary = new Map();
      _geometryLoaded = false;
      _lastUpdate = null;
      _lastError = null;
    },

    getAnalystRecords(maxCount = 1000) {
      if (!_enabled || !_summary.size) return [];
      const out = [];
      for (const [key, s] of _summary) {
        if (out.length >= maxCount) break;
        const group = _routes.get(key);
        out.push({
          id: key,
          ruta: group?.ruta || key.split('|')[0],
          provincia: group?.provincia || key.split('|')[1],
          status: STATUS_LABELS[s.color],
          color: s.color,
          tramos: s.total,
          incidents: s.incidents.map((t) => `${STATUS_LABELS[t.color]}: ${t.name}`),
          lat: group?.midpoint?.[1] ?? null,
          lon: group?.midpoint?.[0] ?? null,
        });
      }
      return out;
    },

    getStats() {
      const stale = Boolean(_lastUpdate) && (Date.now() - _lastUpdate) > RUTAS_STALE_AFTER_MS;
      return {
        count: _routes.size,
        lastUpdate: _lastUpdate,
        loading: _loading,
        loadingLabel: _loading ? 'LOADING ROUTES' : '',
        error: _lastError,
        stale,
        source: _tramoCount
          ? `Vialidad · ${_incidentCount} incidentes en ${_tramoCount} tramos${_sourceUpdated ? ` · ${_sourceUpdated.slice(5, 16)}` : ''}`
          : 'Vialidad Nacional · rutas.ar',
      };
    },
  };
  return layer;
}

const rutasEstadoLayer = createRutasEstadoLayer();

export default rutasEstadoLayer;
