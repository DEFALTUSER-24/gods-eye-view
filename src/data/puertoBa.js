import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { registerSpriteCollection } from './spriteOrder.js';
import { AGP_API_URL, AGP_POLL_MS, CALL_STATUS_COLORS, shortDateTime } from './agpFeed.js';

/**
 * Puerto de Buenos Aires — every ship call in the AGP window drawn at its
 * berth (green operating, orange delayed, blue expected) with a card:
 * ship, type, flag, size, ETA/ETD, agency, origin → destination.
 */

export const PUERTO_OVERLAY_SOURCE_ID = 'puerto-ba';
export const PUERTO_STALE_AFTER_MS = 60 * 60_000;
const OUTLINE = Cesium.Color.fromCssColorString('#0b1116').withAlpha(0.9);
const _colors = new Map();
function kindColor(kind) {
  let c = _colors.get(kind);
  if (!c) { c = Cesium.Color.fromCssColorString(CALL_STATUS_COLORS[kind] || CALL_STATUS_COLORS.otro); _colors.set(kind, c); }
  return c;
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

export function callCardDetails(call) {
  const lines = [];
  const size = [call.type, call.loaM ? `${Math.round(call.loaM)} m` : ''].filter(Boolean).join(' · ');
  if (size) lines.push(size.toUpperCase().slice(0, 48));
  lines.push(`${call.status.toUpperCase()} · ETA ${shortDateTime(call.etaMs)}${call.etdMs ? ` · ETD ${shortDateTime(call.etdMs)}` : ''}`);
  const route = [call.origin, call.destination].filter(Boolean).join(' → ');
  if (route) lines.push(route.toUpperCase().slice(0, 48));
  if (call.berth) lines.push(`${call.berth}${call.flag ? ` · ${call.flag}` : ''}`.toUpperCase().slice(0, 48));
  return lines;
}

/** Spread ships sharing a berth by a few metres so they do not stack. */
export function spreadOffsetDeg(index) {
  const step = 0.00035;
  const ring = Math.ceil(index / 6);
  const angle = (index % 6) * (Math.PI / 3);
  return index === 0 ? [0, 0] : [Math.cos(angle) * step * ring, Math.sin(angle) * step * ring];
}

export function createPuertoBaLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiUrl = AGP_API_URL,
} = {}) {
  let _points = null;
  /** @type {Map<string, {point: object, call: object}>} */
  let _byId = new Map();
  let _enabled = false;
  let _lastUpdate = null;
  let _lastError = null;
  let _loading = false;
  let _operating = 0;

  function refreshCards() {
    if (!_enabled) return;
    const entries = [];
    for (const { point, call } of _byId.values()) {
      entries.push({
        id: call.id,
        position: point.position,
        variant: 'card',
        title: call.name,
        details: callCardDetails(call),
        accent: CALL_STATUS_COLORS[call.kind] || CALL_STATUS_COLORS.otro,
        priority: (call.kind === 'operando' ? 3000 : call.kind === 'demorado' ? 2000 : 1000) - Math.round((call.etaMs || 0) / 3600_000) % 1000,
        collisionGroup: 'ambient-label',
        paintLane: 'ambient-label',
        interactive: false,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        gapPx: 12,
        placement: 'above',
        maxDistance: 60_000,
      });
    }
    overlayHost.setEntries(PUERTO_OVERLAY_SOURCE_ID, entries, { cohortLimit: 40, collisionCapacity: 24, moving: false });
  }

  function applyCalls(calls) {
    if (!_points) return;
    const seen = new Set();
    const perBerth = new Map();
    let operating = 0;
    for (const call of calls) {
      seen.add(call.id);
      if (call.kind === 'operando') operating += 1;
      const berthKey = `${call.lat.toFixed(5)},${call.lon.toFixed(5)}`;
      const index = perBerth.get(berthKey) || 0;
      perBerth.set(berthKey, index + 1);
      const [dx, dy] = spreadOffsetDeg(index);
      const position = Cesium.Cartesian3.fromDegrees(call.lon + dx, call.lat + dy, 0);
      const color = kindColor(call.kind);
      const size = call.kind === 'operando' ? 12 : call.kind === 'demorado' ? 11 : 9;
      const existing = _byId.get(call.id);
      if (existing) {
        existing.call = call;
        existing.point.position = position;
        existing.point.color = color;
        existing.point.pixelSize = size;
        continue;
      }
      const point = _points.add({
        position,
        pixelSize: size,
        color,
        outlineColor: OUTLINE,
        outlineWidth: 1.5,
        scaleByDistance: new Cesium.NearFarScalar(1000, 1.4, 120000, 0.5),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: `agp:${call.id}`,
      });
      _byId.set(call.id, { point, call });
    }
    for (const [id, record] of _byId) {
      if (seen.has(id)) continue;
      _points.remove(record.point);
      _byId.delete(id);
    }
    _operating = operating;
    refreshCards();
    governorRequestRender('puerto-ba-points');
  }

  const layer = {
    id: 'puerto-ba',
    group: 'argentina',
    sourceUrl: 'https://www.argentina.gob.ar/puerto-buenos-aires',
    name: 'Puerto de Buenos Aires',
    icon: '🚢',
    source: 'AGP ePuertos',
    updateInterval: AGP_POLL_MS,

    init(viewer) {
      _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
      _points.show = false;
      viewer.scene.primitives.add(_points);
      registerSpriteCollection('puerto-ba', _points);
      _byId = new Map();
      _enabled = false;
      overlayHost.setVisible(PUERTO_OVERLAY_SOURCE_ID, false);
      console.log('[Data:PuertoBA] Initialized');
    },

    enable() {
      _enabled = true;
      if (_points) _points.show = true;
      registerPickOwner('puerto-ba', (pickedId) => String(pickedId).startsWith('agp:'));
      overlayHost.setVisible(PUERTO_OVERLAY_SOURCE_ID, true);
      refreshCards();
      governorRequestRender('puerto-ba-visibility');
    },

    disable() {
      _enabled = false;
      if (_points) _points.show = false;
      unregisterPickOwner('puerto-ba');
      overlayHost.clearSource(PUERTO_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(PUERTO_OVERLAY_SOURCE_ID, false);
      governorRequestRender('puerto-ba-visibility');
    },

    async update(viewer, { signal } = {}) {
      _loading = _byId.size === 0;
      try {
        const response = await fetchImpl(`${apiUrl}?ts=${Date.now()}`, { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
        if (!response.ok) { _lastError = `AGP HTTP ${response.status}`; return false; }
        const payload = await response.json();
        if (!Array.isArray(payload?.calls)) { _lastError = 'Malformed AGP response'; return false; }
        applyCalls(payload.calls);
        _lastUpdate = Date.now();
        _lastError = payload?.stale ? 'Serving cached calls (upstream error)' : null;
        console.log(`[Data:PuertoBA] Updated: ${_byId.size} ship calls, ${_operating} operating`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        console.warn('[Data:PuertoBA] Fetch error:', error);
        _lastError = 'AGP network error';
        return false;
      } finally {
        _loading = false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      unregisterPickOwner('puerto-ba');
      overlayHost.clearSource(PUERTO_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(PUERTO_OVERLAY_SOURCE_ID, false);
      if (_points) { viewer.scene.primitives.remove(_points); _points = null; }
      _byId = new Map();
    },

    getAnalystRecords(maxCount = 200) {
      if (!_enabled || !_byId.size) return [];
      const out = [];
      for (const { call } of _byId.values()) {
        if (out.length >= maxCount) break;
        out.push({ id: call.id, name: call.name, type: call.type, flag: call.flag, loaM: call.loaM, status: call.status, berth: call.berth, terminal: call.terminal, origin: call.origin, destination: call.destination, etaMs: call.etaMs || null, etdMs: call.etdMs || null, lat: call.lat, lon: call.lon });
      }
      return out;
    },

    getStats() {
      const stale = Boolean(_lastUpdate) && (Date.now() - _lastUpdate) > PUERTO_STALE_AFTER_MS;
      return {
        count: _byId.size,
        lastUpdate: _lastUpdate,
        loading: _loading,
        loadingLabel: _loading ? 'LOADING SHIP CALLS' : '',
        error: _lastError,
        stale,
        source: _byId.size ? `AGP ePuertos · ${_operating} operando` : 'AGP ePuertos',
      };
    },
  };
  return layer;
}

const puertoBaLayer = createPuertoBaLayer();

export default puertoBaLayer;
