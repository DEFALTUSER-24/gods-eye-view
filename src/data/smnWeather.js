import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { registerSpriteCollection } from './spriteOrder.js';

/**
 * Clima SMN — current observations from Argentina's national weather service
 * (~120 synoptic stations, hourly). One point per station colored by
 * temperature, plus a label `NAME 12° ↗14` through the shared overlay host.
 *
 * Data: keyless SMN open data (ZIP of Latin-1 text), parsed and joined with
 * station coordinates by the /api/smn/observations proxy.
 */

export const SMN_API_URL = '/api/smn/observations';
export const SMN_POLL_MS = 10 * 60_000;
export const SMN_OVERLAY_SOURCE_ID = 'smn-weather';
export const SMN_LABEL_COHORT_LIMIT = 140;
export const SMN_STALE_AFTER_MS = 3 * 60 * 60_000;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

const POINT_OUTLINE = Cesium.Color.fromCssColorString('#0b1116').withAlpha(0.9);
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

/** Temperature → hue ramp: −10 °C deep blue … 40 °C red. Returns CSS hsl. */
export function temperatureCss(tempC) {
  if (!Number.isFinite(tempC)) return 'hsl(0, 0%, 70%)';
  const t = Math.max(-10, Math.min(40, tempC));
  const hue = 240 - ((t + 10) / 50) * 240; // 240 (blue) → 0 (red)
  return `hsl(${Math.round(hue)}, 85%, 60%)`;
}

/** Wind direction (from) in degrees → arrow pointing where the wind blows to. */
export function windArrow(fromDeg) {
  if (!Number.isFinite(fromDeg)) return '';
  const to = (fromDeg + 180) % 360;
  return ARROWS[Math.round(to / 45) % 8];
}

/** Label text for one station (pure). */
export function stationLabel(station) {
  const temp = Number.isFinite(station.tempC) ? `${Math.round(station.tempC)}°` : '—';
  const wind = Number.isFinite(station.windKmh) && station.windKmh > 0
    ? ` ${windArrow(station.windDirDeg)}${Math.round(station.windKmh)}`
    : '';
  return `${shortName(station.name)} ${temp}${wind}`;
}

/** "EZEIZA AERO" → "Ezeiza"; "BASE BELGRANO II" → "Base Belgrano II". */
export function shortName(name) {
  return String(name || '')
    .replace(/\s+(AERO|AERODROMO|AEROPUERTO|OBSERVATORIO)$/i, '')
    .toLowerCase()
    .replace(/(^|\s)(\S)/g, (m, sp, ch) => sp + ch.toUpperCase())
    .replace(/\b(Ii|Iii|Iv)\b/g, (m) => m.toUpperCase());
}

/** Validate/normalize the proxy payload; returns null when unusable. */
export function normalizeObservationsPayload(payload) {
  if (!payload || !Array.isArray(payload.stations)) return null;
  const stations = [];
  for (const s of payload.stations) {
    const lat = Number(s?.lat); const lon = Number(s?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !s?.id) continue;
    stations.push({
      id: String(s.id),
      name: String(s.name || s.id),
      province: String(s.province || ''),
      lat,
      lon,
      elevM: Number.isFinite(Number(s.elevM)) ? Number(s.elevM) : null,
      icao: String(s.icao || ''),
      observedAt: Number(s.observedAt) || 0,
      sky: String(s.sky || ''),
      visibility: String(s.visibility || ''),
      tempC: Number.isFinite(Number(s.tempC)) ? Number(s.tempC) : null,
      feelsC: Number.isFinite(Number(s.feelsC)) ? Number(s.feelsC) : null,
      humidity: Number.isFinite(Number(s.humidity)) ? Number(s.humidity) : null,
      windDirDeg: Number.isFinite(Number(s.windDirDeg)) ? Number(s.windDirDeg) : null,
      windKmh: Number.isFinite(Number(s.windKmh)) ? Number(s.windKmh) : null,
      windLabel: String(s.windLabel || ''),
      pressureHpa: Number.isFinite(Number(s.pressureHpa)) ? Number(s.pressureHpa) : null,
    });
  }
  return { generatedAt: Number(payload.generatedAt) || Date.now(), stations };
}

export function createSmnWeatherLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiUrl = SMN_API_URL,
} = {}) {
  let _points = null;
  /** @type {Map<string, {point: object, station: object}>} */
  let _byId = new Map();
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _loading = false;
  let _newestObservationMs = 0;

  function refreshLabels() {
    if (!_enabled) return;
    const entries = [];
    for (const { point, station } of _byId.values()) {
      entries.push({
        id: station.id,
        position: point.position,
        variant: 'label',
        title: stationLabel(station),
        accent: temperatureCss(station.tempC),
        priority: Math.round((station.observedAt || 0) / 1000) % 100000 + (station.icao ? 1000 : 0),
        collisionGroup: 'ambient-label',
        paintLane: 'ambient-label',
        interactive: false,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        gapPx: 10,
        verticalOnly: true,
        placement: 'above',
      });
    }
    entries.sort((a, b) => b.priority - a.priority || String(a.id).localeCompare(String(b.id)));
    overlayHost.setEntries(SMN_OVERLAY_SOURCE_ID, entries.slice(0, SMN_LABEL_COHORT_LIMIT), {
      cohortLimit: SMN_LABEL_COHORT_LIMIT,
      collisionCapacity: 80,
      moving: false,
    });
  }

  function applyStations(stations) {
    if (!_points) return;
    const seen = new Set();
    let newest = 0;
    for (const station of stations) {
      seen.add(station.id);
      if (station.observedAt > newest) newest = station.observedAt;
      const position = Cesium.Cartesian3.fromDegrees(station.lon, station.lat, 0);
      const color = Cesium.Color.fromCssColorString(temperatureCss(station.tempC));
      const existing = _byId.get(station.id);
      if (existing) {
        existing.point.position = position;
        existing.point.color = color;
        existing.station = station;
        continue;
      }
      const point = _points.add({
        position,
        pixelSize: 9,
        color,
        outlineColor: POINT_OUTLINE,
        outlineWidth: 1.5,
        scaleByDistance: new Cesium.NearFarScalar(20000, 1.3, 4000000, 0.6),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: `smn:${station.id}`,
      });
      _byId.set(station.id, { point, station });
    }
    for (const [id, record] of _byId) {
      if (seen.has(id)) continue;
      _points.remove(record.point);
      _byId.delete(id);
    }
    _newestObservationMs = newest;
    _count = _byId.size;
    refreshLabels();
    governorRequestRender('smn-weather-points');
  }

  const layer = {
    id: 'smn-weather',
    group: 'argentina',
    name: 'Clima SMN (Argentina)',
    icon: '🌡️',
    source: 'SMN',
    updateInterval: SMN_POLL_MS,

    init(viewer) {
      _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
      _points.show = false;
      viewer.scene.primitives.add(_points);
      registerSpriteCollection('smn-weather', _points);
      _byId = new Map();
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(SMN_OVERLAY_SOURCE_ID, false);
      console.log('[Data:SmnWeather] Initialized');
    },

    enable() {
      _enabled = true;
      if (_points) _points.show = true;
      registerPickOwner('smn-weather', (pickedId) => String(pickedId).startsWith('smn:'));
      overlayHost.setVisible(SMN_OVERLAY_SOURCE_ID, true);
      refreshLabels();
      governorRequestRender('smn-weather-visibility');
    },

    disable() {
      _enabled = false;
      if (_points) _points.show = false;
      unregisterPickOwner('smn-weather');
      overlayHost.clearSource(SMN_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SMN_OVERLAY_SOURCE_ID, false);
      governorRequestRender('smn-weather-visibility');
    },

    async update(viewer, { signal } = {}) {
      _loading = _count === 0;
      try {
        const response = await fetchImpl(`${apiUrl}?ts=${Date.now()}`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal,
        });
        if (!response.ok) {
          _lastError = `SMN HTTP ${response.status}`;
          return false;
        }
        const data = normalizeObservationsPayload(await response.json());
        if (!data || !data.stations.length) {
          _lastError = 'Malformed SMN response';
          return false;
        }
        applyStations(data.stations);
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:SmnWeather] Updated: ${_count} stations`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        console.warn('[Data:SmnWeather] Fetch error:', error);
        _lastError = 'SMN network error';
        return false;
      } finally {
        _loading = false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      unregisterPickOwner('smn-weather');
      overlayHost.clearSource(SMN_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SMN_OVERLAY_SOURCE_ID, false);
      if (_points) {
        viewer.scene.primitives.remove(_points);
        _points = null;
      }
      _byId = new Map();
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    getStation(id) {
      return _byId.get(String(id).replace(/^smn:/, ''))?.station || null;
    },

    getAnalystRecords(maxCount = 500) {
      if (!_enabled || !_byId.size) return [];
      const out = [];
      for (const { station } of _byId.values()) {
        if (out.length >= maxCount) break;
        out.push({
          id: station.id,
          name: station.name,
          province: station.province,
          lat: station.lat,
          lon: station.lon,
          tempC: station.tempC,
          feelsC: station.feelsC,
          humidity: station.humidity,
          windKmh: station.windKmh,
          windDirDeg: station.windDirDeg,
          pressureHpa: station.pressureHpa,
          sky: station.sky,
          timeMs: station.observedAt || null,
        });
      }
      return out;
    },

    getStats() {
      const stale = Boolean(_lastUpdate) && (Date.now() - _lastUpdate) > SMN_STALE_AFTER_MS;
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        loading: _loading,
        loadingLabel: _loading ? 'LOADING STATIONS' : '',
        error: _lastError,
        stale,
        source: 'SMN',
        generatedAt: _newestObservationMs || null,
      };
    },
  };
  return layer;
}

const smnWeatherLayer = createSmnWeatherLayer();

export default smnWeatherLayer;
