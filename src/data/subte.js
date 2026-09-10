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
import { SUBTE_API_URL, SUBTE_POLL_MS, lineColor } from './subteFeed.js';

/**
 * Subte (Buenos Aires) — the six lines drawn on the ground in their official
 * colors plus every station as a point; the live `Estado` from the city's
 * map backend turns closed stations / disrupted lines red and gives them a
 * card. Station labels only inside the view, below ~40 km.
 */

export const SUBTE_OVERLAY_SOURCE_ID = 'subte';
export const SUBTE_LABEL_MAX_ALTITUDE_M = 40_000;
export const SUBTE_STALE_AFTER_MS = 60 * 60_000;
const OUTLINE_OK = Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.95);
const OUTLINE_BAD = Cesium.Color.fromCssColorString('#ff2d2d');
const _colors = new Map();
function css(color, alpha = 1) {
  const key = `${color}|${alpha}`;
  let c = _colors.get(key);
  if (!c) { c = Cesium.Color.fromCssColorString(color).withAlpha(alpha); _colors.set(key, c); }
  return c;
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

export function createSubteLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiUrl = SUBTE_API_URL,
} = {}) {
  let _viewer = null;
  let _points = null;
  let _dataSource = null;
  /** @type {Map<string, {point: object, station: object}>} */
  let _stations = new Map();
  /** @type {Map<string, {entities: object[], line: object}>} */
  let _lines = new Map();
  let _incidents = [];
  let _enabled = false;
  let _lastUpdate = null;
  let _lastError = null;
  let _loading = false;
  let _detachCamera = null;

  function refreshLabels() {
    if (!_enabled) return;
    const rect = viewRectangleDeg(_viewer);
    const close = Boolean(rect) && cameraAltitude(_viewer) <= SUBTE_LABEL_MAX_ALTITUDE_M;
    const entries = [];
    for (const { point, station } of _stations.values()) {
      const inView = close && inRectangle(rect, station.lon, station.lat);
      if (station.ok && !inView) continue;
      entries.push({
        id: station.id,
        position: point.position,
        variant: station.ok ? 'label' : 'card',
        title: station.ok ? `${station.name} · ${station.line}` : `${station.name} · LÍNEA ${station.line}`,
        details: station.ok ? [] : [station.status.toUpperCase().slice(0, 64)],
        accent: station.ok ? lineColor(station.line) : '#ff2d2d',
        priority: (station.ok ? 0 : 100000) + (inView ? 1000 : 0),
        collisionGroup: 'ambient-label',
        paintLane: 'ambient-label',
        interactive: false,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        gapPx: 9,
        verticalOnly: station.ok,
        placement: 'above',
        maxDistance: station.ok ? 60_000 : Number.POSITIVE_INFINITY,
      });
    }
    entries.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    overlayHost.setEntries(SUBTE_OVERLAY_SOURCE_ID, entries.slice(0, 120), { cohortLimit: 120, collisionCapacity: 60, moving: false });
  }

  function applyPayload({ stations, lines, incidents }) {
    if (!_points || !_dataSource) return;
    const seen = new Set();
    for (const station of stations) {
      seen.add(station.id);
      const color = css(lineColor(station.line));
      const outline = station.ok ? OUTLINE_OK : OUTLINE_BAD;
      const existing = _stations.get(station.id);
      if (existing) {
        existing.station = station;
        existing.point.color = color;
        existing.point.outlineColor = outline;
        existing.point.outlineWidth = station.ok ? 1.5 : 3;
        continue;
      }
      const point = _points.add({
        position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat, 0),
        pixelSize: 8,
        color,
        outlineColor: outline,
        outlineWidth: station.ok ? 1.5 : 3,
        scaleByDistance: new Cesium.NearFarScalar(1000, 1.4, 80000, 0.6),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: `subte:${station.id}`,
      });
      _stations.set(station.id, { point, station });
    }
    for (const [id, record] of _stations) {
      if (seen.has(id)) continue;
      _points.remove(record.point);
      _stations.delete(id);
    }
    const seenLines = new Set();
    for (const line of lines) {
      seenLines.add(line.id);
      const material = css(lineColor(line.line), line.ok ? 0.95 : 0.6);
      const existing = _lines.get(line.id);
      if (existing) {
        existing.line = line;
        for (const entity of existing.entities) { entity.polyline.material = material; entity.polyline.width = line.ok ? 5 : 7; }
        continue;
      }
      const entities = line.coordinates.map((part, index) => _dataSource.entities.add({
        id: `subte-line:${line.id}:${index}`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(part.flat()),
          width: line.ok ? 5 : 7,
          material,
          clampToGround: true,
        },
      }));
      _lines.set(line.id, { entities, line });
    }
    for (const [id, record] of _lines) {
      if (seenLines.has(id)) continue;
      for (const entity of record.entities) _dataSource.entities.remove(entity);
      _lines.delete(id);
    }
    _incidents = incidents;
    refreshLabels();
    governorRequestRender('subte-update');
  }

  const layer = {
    id: 'subte',
    group: 'argentina',
    sourceUrl: 'https://mapa.buenosaires.gob.ar/',
    name: 'Subte (estado del servicio)',
    icon: '🚇',
    source: 'Buenos Aires Ciudad',
    updateInterval: SUBTE_POLL_MS,

    init(viewer) {
      _viewer = viewer;
      _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
      _points.show = false;
      viewer.scene.primitives.add(_points);
      registerSpriteCollection('subte', _points);
      _dataSource = new Cesium.CustomDataSource('subte-lines');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _stations = new Map();
      _lines = new Map();
      _enabled = false;
      overlayHost.setVisible(SUBTE_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Subte] Initialized');
    },

    enable() {
      _enabled = true;
      if (_points) _points.show = true;
      if (_dataSource) _dataSource.show = true;
      registerPickOwner('subte', (pickedId) => String(pickedId).startsWith('subte:'));
      overlayHost.setVisible(SUBTE_OVERLAY_SOURCE_ID, true);
      if (!_detachCamera) _detachCamera = onCameraSettled(_viewer, refreshLabels);
      refreshLabels();
      governorRequestRender('subte-visibility');
    },

    disable() {
      _enabled = false;
      if (_detachCamera) { _detachCamera(); _detachCamera = null; }
      if (_points) _points.show = false;
      if (_dataSource) _dataSource.show = false;
      unregisterPickOwner('subte');
      overlayHost.clearSource(SUBTE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SUBTE_OVERLAY_SOURCE_ID, false);
      governorRequestRender('subte-visibility');
    },

    async update(viewer, { signal } = {}) {
      _loading = _stations.size === 0;
      try {
        const response = await fetchImpl(`${apiUrl}?ts=${Date.now()}`, { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
        if (!response.ok) { _lastError = `epok HTTP ${response.status}`; return false; }
        const payload = await response.json();
        if (!Array.isArray(payload?.stations) || !Array.isArray(payload?.lines)) { _lastError = 'Malformed subte response'; return false; }
        applyPayload({ stations: payload.stations, lines: payload.lines, incidents: payload.incidents || [] });
        _lastUpdate = Date.now();
        _lastError = payload?.stale ? 'Serving cached status (upstream error)' : null;
        console.log(`[Data:Subte] Updated: ${_stations.size} stations, ${_lines.size} lines, ${_incidents.length} incidents`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        console.warn('[Data:Subte] Fetch error:', error);
        _lastError = 'Subte network error';
        return false;
      } finally {
        _loading = false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      if (_detachCamera) { _detachCamera(); _detachCamera = null; }
      unregisterPickOwner('subte');
      overlayHost.clearSource(SUBTE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SUBTE_OVERLAY_SOURCE_ID, false);
      if (_points) { viewer.scene.primitives.remove(_points); _points = null; }
      if (_dataSource) { viewer.dataSources.remove(_dataSource, true); _dataSource = null; }
      _stations = new Map();
      _lines = new Map();
    },

    getAnalystRecords(maxCount = 200) {
      if (!_enabled) return [];
      const out = [];
      for (const { line } of _lines.values()) out.push({ id: `line-${line.line}`, kind: 'line', line: line.line, status: line.status, ok: line.ok });
      for (const { station } of _stations.values()) {
        if (out.length >= maxCount) break;
        out.push({ id: station.id, kind: 'station', name: station.name, line: station.line, status: station.status, ok: station.ok, lat: station.lat, lon: station.lon });
      }
      return out;
    },

    getStats() {
      const stale = Boolean(_lastUpdate) && (Date.now() - _lastUpdate) > SUBTE_STALE_AFTER_MS;
      return {
        count: _stations.size,
        lastUpdate: _lastUpdate,
        loading: _loading,
        loadingLabel: _loading ? 'LOADING SUBTE' : '',
        error: _lastError,
        stale,
        source: _stations.size
          ? (_incidents.length ? `Buenos Aires Ciudad · ${_incidents.length} novedades · ${_incidents[0].slice(0, 60)}` : 'Buenos Aires Ciudad · servicio normal')
          : 'Buenos Aires Ciudad',
      };
    },
  };
  return layer;
}

const subteLayer = createSubteLayer();

export default subteLayer;
