import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { APRA_API_URL, APRA_POLL_MS, BAND_COLORS, BAND_LABELS } from './apraFeed.js';

/**
 * Calidad de aire CABA — the APrA monitoring stations with their latest
 * hourly CO / NO2 / PM10 readings (published with ~2 weeks of lag), colored
 * by PM10 band, one card per station.
 */

export const AIRE_OVERLAY_SOURCE_ID = 'aire-caba';
const OUTLINE = Cesium.Color.fromCssColorString('#0b1116').withAlpha(0.9);
const _colors = new Map();
function bandColor(band) {
  let c = _colors.get(band);
  if (!c) { c = Cesium.Color.fromCssColorString(BAND_COLORS[band] || BAND_COLORS.unknown); _colors.set(band, c); }
  return c;
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

export function stationCardDetails(s) {
  const lines = [];
  const vals = [
    Number.isFinite(s.pm10) ? `PM10 ${Math.round(s.pm10)} µg/m³` : '',
    Number.isFinite(s.no2) ? `NO2 ${Math.round(s.no2)} ppb` : '',
    Number.isFinite(s.co) ? `CO ${s.co.toFixed(2)} ppm` : '',
  ].filter(Boolean);
  if (vals.length) lines.push(vals.join(' · '));
  lines.push(`${BAND_LABELS[s.band] || BAND_LABELS.unknown}${s.inactive ? ' · ESTACIÓN DESACTIVADA' : ''}`);
  if (s.atMs) {
    const d = new Date(s.atMs);
    lines.push(`ÚLTIMA ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`);
  }
  return lines;
}

export function createAireCabaLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiUrl = APRA_API_URL,
} = {}) {
  let _points = null;
  /** @type {Map<string, {point: object, station: object}>} */
  let _byId = new Map();
  let _enabled = false;
  let _lastUpdate = null;
  let _lastError = null;
  let _loading = false;
  let _newestMs = 0;

  function refreshCards() {
    if (!_enabled) return;
    const entries = [];
    for (const { point, station } of _byId.values()) {
      entries.push({
        id: station.id,
        position: point.position,
        variant: 'card',
        title: `AIRE ${station.name}`,
        details: stationCardDetails(station),
        accent: BAND_COLORS[station.band] || BAND_COLORS.unknown,
        priority: station.atMs ? 1000 : 0,
        collisionGroup: 'ambient-label',
        paintLane: 'ambient-label',
        interactive: false,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        gapPx: 12,
        placement: 'above',
        maxDistance: 150_000,
      });
    }
    overlayHost.setEntries(AIRE_OVERLAY_SOURCE_ID, entries, { cohortLimit: 8, collisionCapacity: 8, moving: false });
  }

  function applyStations(stations) {
    if (!_points) return;
    const seen = new Set();
    let newest = 0;
    for (const station of stations) {
      seen.add(station.id);
      if (station.atMs > newest) newest = station.atMs;
      const color = bandColor(station.band);
      const existing = _byId.get(station.id);
      if (existing) { existing.station = station; existing.point.color = color; continue; }
      const point = _points.add({
        position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat, 0),
        pixelSize: 14,
        color,
        outlineColor: OUTLINE,
        outlineWidth: 2,
        scaleByDistance: new Cesium.NearFarScalar(2000, 1.3, 400000, 0.6),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: `apra:${station.id}`,
      });
      _byId.set(station.id, { point, station });
    }
    for (const [id, record] of _byId) {
      if (seen.has(id)) continue;
      _points.remove(record.point);
      _byId.delete(id);
    }
    _newestMs = newest;
    refreshCards();
    governorRequestRender('aire-caba-points');
  }

  const layer = {
    id: 'aire-caba',
    group: 'argentina',
    sourceUrl: 'https://data.buenosaires.gob.ar/dataset/calidad-aire',
    name: 'Calidad de aire CABA',
    icon: '🌫️',
    source: 'APrA',
    updateInterval: APRA_POLL_MS,

    init(viewer) {
      _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
      _points.show = false;
      viewer.scene.primitives.add(_points);
      _byId = new Map();
      _enabled = false;
      overlayHost.setVisible(AIRE_OVERLAY_SOURCE_ID, false);
      console.log('[Data:AireCABA] Initialized');
    },

    enable() {
      _enabled = true;
      if (_points) _points.show = true;
      registerPickOwner('aire-caba', (pickedId) => String(pickedId).startsWith('apra:'));
      overlayHost.setVisible(AIRE_OVERLAY_SOURCE_ID, true);
      refreshCards();
      governorRequestRender('aire-caba-visibility');
    },

    disable() {
      _enabled = false;
      if (_points) _points.show = false;
      unregisterPickOwner('aire-caba');
      overlayHost.clearSource(AIRE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(AIRE_OVERLAY_SOURCE_ID, false);
      governorRequestRender('aire-caba-visibility');
    },

    async update(viewer, { signal } = {}) {
      _loading = _byId.size === 0;
      try {
        const response = await fetchImpl(`${apiUrl}?ts=${Date.now()}`, { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
        if (!response.ok) { _lastError = `APrA HTTP ${response.status}`; return false; }
        const payload = await response.json();
        if (!Array.isArray(payload?.stations)) { _lastError = 'Malformed APrA response'; return false; }
        applyStations(payload.stations);
        _lastUpdate = Date.now();
        _lastError = payload?.stale ? 'Serving cached readings (upstream error)' : null;
        console.log(`[Data:AireCABA] Updated: ${_byId.size} stations`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        console.warn('[Data:AireCABA] Fetch error:', error);
        _lastError = 'APrA network error';
        return false;
      } finally {
        _loading = false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      unregisterPickOwner('aire-caba');
      overlayHost.clearSource(AIRE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(AIRE_OVERLAY_SOURCE_ID, false);
      if (_points) { viewer.scene.primitives.remove(_points); _points = null; }
      _byId = new Map();
    },

    getAnalystRecords(maxCount = 20) {
      if (!_enabled) return [];
      return Array.from(_byId.values()).slice(0, maxCount).map(({ station }) => ({
        id: station.id, name: station.name, lat: station.lat, lon: station.lon, pm10: station.pm10, no2: station.no2, co: station.co, band: station.band, timeMs: station.atMs || null,
      }));
    },

    getStats() {
      const newest = _newestMs ? new Date(_newestMs) : null;
      return {
        count: _byId.size,
        lastUpdate: _lastUpdate,
        loading: _loading,
        loadingLabel: _loading ? 'LOADING AIR QUALITY' : '',
        error: _lastError,
        source: newest ? `APrA · último dato ${String(newest.getDate()).padStart(2, '0')}/${String(newest.getMonth() + 1).padStart(2, '0')}` : 'APrA',
        generatedAt: _newestMs || null,
      };
    },
  };
  return layer;
}

const aireCabaLayer = createAireCabaLayer();

export default aireCabaLayer;
