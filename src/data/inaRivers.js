import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { registerSpriteCollection } from './spriteOrder.js';
import { cameraAltitude, inRectangle, onCameraSettled, viewRectangleDeg } from './viewportGate.js';
import {
  INA_API_URL,
  INA_POLL_MS,
  STATE_COLORS,
  STATE_LABELS,
  formatLevel,
} from './inaFeed.js';

/**
 * Ríos INA — hydrometric gauges with their latest height and the official
 * alert / evacuation thresholds (Instituto Nacional del Agua "a5" network:
 * Prefectura, INA, SHN, provincial networks). Color = state, cards for
 * stations at or above alert.
 */

export const INA_OVERLAY_SOURCE_ID = 'ina-rivers';
export const INA_LABEL_COHORT_LIMIT = 90;
export const INA_LABEL_MAX_ALTITUDE_M = 900_000;
export const INA_STALE_AFTER_MS = 3 * 60 * 60_000;
const OUTLINE = Cesium.Color.fromCssColorString('#0b1116').withAlpha(0.9);
const _colors = new Map();
function stateColor(state) {
  let c = _colors.get(state);
  if (!c) { c = Cesium.Color.fromCssColorString(STATE_COLORS[state] || STATE_COLORS.unknown); _colors.set(state, c); }
  return c;
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/** "San Fernando · Luján 0.57 m" (pure). */
export function stationTitle(station) {
  const river = station.river ? ` · ${station.river.charAt(0)}${station.river.slice(1).toLowerCase()}` : '';
  return `${station.name}${river} ${formatLevel(station.valueM, station.unit)}`;
}

export function stationCardDetails(station) {
  const lines = [STATE_LABELS[station.state] || STATE_LABELS.unknown];
  if (Number.isFinite(station.alertM)) lines.push(`ALERTA ${formatLevel(station.alertM)} · EVAC ${formatLevel(station.evacM)}`);
  if (station.valueMs) {
    const d = new Date(station.valueMs);
    lines.push(`OBS ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} · ${station.owner || station.network}`);
  }
  return lines;
}

export function createInaRiversLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiUrl = INA_API_URL,
} = {}) {
  let _points = null;
  /** @type {Map<number, {point: object, station: object}>} */
  let _byId = new Map();
  let _count = 0;
  let _withValue = 0;
  let _alerting = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _loading = false;
  let _viewer = null;
  let _detachCamera = null;

  function refreshLabels() {
    if (!_enabled) return;
    // Plain labels only inside the view and below ~900 km; gauges at alert
    // keep their card anywhere so a flood is never hidden by the gate.
    const rect = viewRectangleDeg(_viewer);
    const closeEnough = Boolean(rect) && cameraAltitude(_viewer) <= INA_LABEL_MAX_ALTITUDE_M;
    const entries = [];
    for (const { point, station } of _byId.values()) {
      const alerting = station.state === 'alert' || station.state === 'evacuation' || station.state === 'watch';
      const hasValue = Number.isFinite(station.valueM);
      if (!hasValue) continue;
      if (!alerting && (!closeEnough || !inRectangle(rect, station.lon, station.lat))) continue;
      entries.push({
        id: String(station.seriesId),
        position: point.position,
        variant: alerting ? 'card' : 'label',
        title: stationTitle(station),
        details: alerting ? stationCardDetails(station) : [],
        accent: STATE_COLORS[station.state],
        priority: (alerting ? 100000 : 0) + (Number.isFinite(station.alertM) ? 10000 : 0) + Math.round(station.valueMs / 60_000) % 10000,
        collisionGroup: 'ambient-label',
        paintLane: 'ambient-label',
        interactive: false,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        gapPx: 10,
        verticalOnly: !alerting,
        placement: 'above',
        maxDistance: alerting ? Number.POSITIVE_INFINITY : 400_000,
      });
    }
    entries.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    overlayHost.setEntries(INA_OVERLAY_SOURCE_ID, entries.slice(0, INA_LABEL_COHORT_LIMIT), {
      cohortLimit: INA_LABEL_COHORT_LIMIT,
      collisionCapacity: 80,
      moving: false,
    });
  }

  function applyStations(stations) {
    if (!_points) return;
    const seen = new Set();
    let withValue = 0;
    let alerting = 0;
    for (const station of stations) {
      seen.add(station.seriesId);
      if (Number.isFinite(station.valueM)) withValue += 1;
      if (station.state === 'alert' || station.state === 'evacuation') alerting += 1;
      const color = stateColor(station.state);
      const size = station.state === 'evacuation' ? 13 : station.state === 'alert' ? 11 : station.state === 'watch' ? 9 : (Number.isFinite(station.valueM) ? 7 : 5);
      const existing = _byId.get(station.seriesId);
      if (existing) {
        existing.station = station;
        existing.point.color = color;
        existing.point.pixelSize = size;
        continue;
      }
      const point = _points.add({
        position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat, 0),
        pixelSize: size,
        color,
        outlineColor: OUTLINE,
        outlineWidth: 1.2,
        scaleByDistance: new Cesium.NearFarScalar(20000, 1.3, 4000000, 0.55),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: `ina:${station.seriesId}`,
      });
      _byId.set(station.seriesId, { point, station });
    }
    for (const [id, record] of _byId) {
      if (seen.has(id)) continue;
      _points.remove(record.point);
      _byId.delete(id);
    }
    _count = _byId.size;
    _withValue = withValue;
    _alerting = alerting;
    refreshLabels();
    governorRequestRender('ina-rivers-points');
  }

  const layer = {
    id: 'ina-rivers',
    group: 'argentina',
    name: 'Ríos INA (alturas)',
    icon: '🌊',
    source: 'INA · Prefectura · SHN',
    updateInterval: INA_POLL_MS,

    init(viewer) {
      _viewer = viewer;
      _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
      _points.show = false;
      viewer.scene.primitives.add(_points);
      registerSpriteCollection('ina-rivers', _points);
      _byId = new Map();
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(INA_OVERLAY_SOURCE_ID, false);
      console.log('[Data:InaRivers] Initialized');
    },

    enable() {
      _enabled = true;
      if (_points) _points.show = true;
      registerPickOwner('ina-rivers', (pickedId) => String(pickedId).startsWith('ina:'));
      overlayHost.setVisible(INA_OVERLAY_SOURCE_ID, true);
      if (!_detachCamera) _detachCamera = onCameraSettled(_viewer, refreshLabels);
      refreshLabels();
      governorRequestRender('ina-rivers-visibility');
    },

    disable() {
      _enabled = false;
      if (_detachCamera) { _detachCamera(); _detachCamera = null; }
      if (_points) _points.show = false;
      unregisterPickOwner('ina-rivers');
      overlayHost.clearSource(INA_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(INA_OVERLAY_SOURCE_ID, false);
      governorRequestRender('ina-rivers-visibility');
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
          _lastError = `INA HTTP ${response.status}`;
          return false;
        }
        const payload = await response.json();
        const stations = Array.isArray(payload?.stations) ? payload.stations : null;
        if (!stations) {
          _lastError = 'Malformed INA response';
          return false;
        }
        applyStations(stations);
        _lastUpdate = Date.now();
        _lastError = payload?.stale ? 'Serving cached levels (upstream error)' : null;
        console.log(`[Data:InaRivers] Updated: ${_count} gauges, ${_withValue} with a reading, ${_alerting} at alert`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        console.warn('[Data:InaRivers] Fetch error:', error);
        _lastError = 'INA network error';
        return false;
      } finally {
        _loading = false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      if (_detachCamera) { _detachCamera(); _detachCamera = null; }
      unregisterPickOwner('ina-rivers');
      overlayHost.clearSource(INA_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(INA_OVERLAY_SOURCE_ID, false);
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
      return _byId.get(Number(String(id).replace(/^ina:/, '')))?.station || null;
    },

    getAnalystRecords(maxCount = 1500) {
      if (!_enabled || !_byId.size) return [];
      const out = [];
      for (const { station } of _byId.values()) {
        if (out.length >= maxCount) break;
        out.push({
          id: station.seriesId,
          name: station.name,
          river: station.river,
          province: station.province,
          lat: station.lat,
          lon: station.lon,
          levelM: station.valueM,
          alertM: station.alertM,
          evacuationM: station.evacM,
          state: station.state,
          owner: station.owner,
          timeMs: station.valueMs || null,
        });
      }
      return out;
    },

    getStats() {
      const stale = Boolean(_lastUpdate) && (Date.now() - _lastUpdate) > INA_STALE_AFTER_MS;
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        loading: _loading,
        loadingLabel: _loading ? 'LOADING GAUGES' : '',
        error: _lastError,
        stale,
        source: _count ? `INA · ${_withValue} con lectura · ${_alerting} en alerta` : 'INA · Prefectura · SHN',
      };
    },
  };
  return layer;
}

const inaRiversLayer = createInaRiversLayer();

export default inaRiversLayer;
