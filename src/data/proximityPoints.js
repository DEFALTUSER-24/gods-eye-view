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
 * Proximity-gated point layer for bundled GeoJSONL datasets (police stations,
 * train stations, speed cameras…). Nothing is drawn above `maxAltitudeM`;
 * below it, only the features inside the current view rectangle (plus a
 * margin) become PointPrimitives, capped at `maxPoints` nearest the view
 * center, with a bounded label cohort through the world overlay. The camera
 * listener is debounced, so panning stays cheap even with thousands of rows.
 */

export const PROXIMITY_DEFAULTS = Object.freeze({
  maxAltitudeM: 250_000,
  maxPoints: 1200,
  labelMax: 110,
  pixelSize: 7,
  marginRatio: 0.15,
  debounceMs: 220,
});

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/** Parse GeoJSONL text into light rows { id, lon, lat, name, tags } (pure). */
export function parsePointRows(text, { nameOf } = {}) {
  const rows = [];
  let index = 0;
  const src = String(text || '');
  // A whole FeatureCollection parses as one JSON value; GeoJSONL (one feature
  // per line) does not, so fall back to line-by-line parsing.
  let items = null;
  try { const col = JSON.parse(src); if (Array.isArray(col?.features)) items = col.features; } catch { items = null; }
  if (!items) items = src.split(/\r?\n/).filter((l) => l.trim()).map((line) => { try { return JSON.parse(line); } catch { return null; } });
  for (const f of items) {
    if (!f) continue;
    const g = f?.geometry;
    let lon; let lat;
    if (g?.type === 'Point') [lon, lat] = g.coordinates || [];
    else if (g?.type === 'MultiPoint') [lon, lat] = g.coordinates?.[0] || [];
    else continue;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const props = f.properties || {};
    const tags = props.tags || {};
    const name = typeof nameOf === 'function' ? nameOf(props, tags) : (props.name || tags.name || '');
    rows.push({ id: String(f.id ?? props.id ?? index), lon, lat, name: String(name || '').trim(), tags, props });
    index += 1;
  }
  return rows;
}

/** Rows inside a lon/lat rectangle expanded by `marginRatio` (pure). */
export function selectInRectangle(rows, rect, { marginRatio = 0.15, maxPoints = 1200 } = {}) {
  if (!rect) return [];
  const w = rect.east - rect.west; const h = rect.north - rect.south;
  const west = rect.west - w * marginRatio; const east = rect.east + w * marginRatio;
  const south = rect.south - h * marginRatio; const north = rect.north + h * marginRatio;
  const cx = (rect.west + rect.east) / 2; const cy = (rect.south + rect.north) / 2;
  const inside = [];
  for (const r of rows) {
    if (r.lon < west || r.lon > east || r.lat < south || r.lat > north) continue;
    inside.push(r);
  }
  if (inside.length <= maxPoints) return inside;
  const cosLat = Math.cos(cy * Math.PI / 180);
  return inside
    .map((r) => ({ r, d: ((r.lon - cx) * cosLat) ** 2 + (r.lat - cy) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, maxPoints)
    .map((x) => x.r);
}

export function createProximityPointsLayer({
  id,
  url,
  name,
  group = null,
  icon = '•',
  source = 'Local',
  color = '#ffffff',
  colorOf = null, // (props, tags) => css color, per row
  pixelSize = PROXIMITY_DEFAULTS.pixelSize,
  maxAltitudeM = PROXIMITY_DEFAULTS.maxAltitudeM,
  maxPoints = PROXIMITY_DEFAULTS.maxPoints,
  labelMax = PROXIMITY_DEFAULTS.labelMax,
  marginRatio = PROXIMITY_DEFAULTS.marginRatio,
  debounceMs = PROXIMITY_DEFAULTS.debounceMs,
  nameOf = null,
  detailsOf = null,
  analystFields = null,
  overlayHost = DEFAULT_OVERLAY_HOST,
  fetchImpl = (...args) => globalThis.fetch(...args),
}) {
  const overlaySourceId = id;
  const pointColor = Cesium.Color.fromCssColorString(color);
  const outline = Cesium.Color.fromCssColorString('#0b1116').withAlpha(0.9);
  const _rowColors = new Map();
  function rowColor(row) {
    if (typeof colorOf !== 'function') return pointColor;
    const css = colorOf(row.props, row.tags) || color;
    let c = _rowColors.get(css);
    if (!c) { c = Cesium.Color.fromCssColorString(css); _rowColors.set(css, c); }
    return c;
  }
  let _viewer = null;
  let _points = null;
  let _rows = null;
  let _loadPromise = null;
  /** @type {Map<string, {point: object, row: object}>} */
  let _visible = new Map();
  let _enabled = false;
  let _gated = true;
  let _timer = null;
  let _listenerAttached = false;
  let _lastError = null;
  let _lastUpdate = null;
  let _loading = false;
  /** Optional row predicate (e.g. category chips); null = show everything. */
  let _filter = null;

  async function ensureRows() {
    if (_rows) return _rows;
    if (!_loadPromise) {
      _loading = true;
      _loadPromise = fetchImpl(url, { cache: 'force-cache' })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          _rows = parsePointRows(await response.text(), { nameOf });
          _lastUpdate = Date.now();
          _lastError = null;
          console.log(`[Data:${id}] Loaded ${_rows.length} rows`);
          return _rows;
        })
        .catch((error) => {
          _lastError = `Dataset load failed (${error?.message || error})`;
          _loadPromise = null;
          throw error;
        })
        .finally(() => { _loading = false; });
    }
    return _loadPromise;
  }

  function viewRectangleDeg() {
    const rect = _viewer?.camera?.computeViewRectangle?.(_viewer.scene.globe?.ellipsoid);
    if (!rect) return null;
    return {
      west: Cesium.Math.toDegrees(rect.west),
      east: Cesium.Math.toDegrees(rect.east),
      south: Cesium.Math.toDegrees(rect.south),
      north: Cesium.Math.toDegrees(rect.north),
    };
  }

  function refreshLabels(rowsInView) {
    if (!_enabled) return;
    const entries = [];
    for (const row of rowsInView.slice(0, labelMax)) {
      if (!row.name) continue;
      const record = _visible.get(row.id);
      if (!record) continue;
      const details = typeof detailsOf === 'function' ? detailsOf(row.props, row.tags) : [];
      entries.push({
        id: row.id,
        position: record.point.position,
        variant: details.length ? 'card' : 'label',
        title: row.name.slice(0, 48),
        details,
        accent: typeof colorOf === 'function' ? (colorOf(row.props, row.tags) || color) : color,
        priority: labelMax - entries.length,
        collisionGroup: 'ambient-label',
        paintLane: 'ambient-label',
        interactive: false,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        gapPx: 10,
        verticalOnly: !details.length,
        placement: 'above',
      });
    }
    overlayHost.setEntries(overlaySourceId, entries, { cohortLimit: labelMax, collisionCapacity: Math.min(labelMax, 60), moving: false });
  }

  function clearVisible() {
    if (_points) _points.removeAll();
    _visible = new Map();
    overlayHost.clearSource(overlaySourceId);
  }

  function refresh() {
    _timer = null;
    if (!_enabled || !_points || !_rows || !_viewer) return;
    const altitude = _viewer.camera?.positionCartographic?.height ?? Infinity;
    if (altitude > maxAltitudeM) {
      if (!_gated) { clearVisible(); governorRequestRender(`${id}-gate`); }
      _gated = true;
      return;
    }
    _gated = false;
    const rect = viewRectangleDeg();
    const pool = typeof _filter === 'function' ? _rows.filter(_filter) : _rows;
    const rowsInView = selectInRectangle(pool, rect, { marginRatio, maxPoints });
    // Rows nearest the center first, so the label cohort favors the middle.
    const seen = new Set();
    for (const row of rowsInView) {
      seen.add(row.id);
      if (_visible.has(row.id)) continue;
      const point = _points.add({
        position: Cesium.Cartesian3.fromDegrees(row.lon, row.lat, 0),
        pixelSize,
        color: rowColor(row),
        outlineColor: outline,
        outlineWidth: 1.2,
        scaleByDistance: new Cesium.NearFarScalar(2000, 1.4, 250000, 0.5),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: `${id}:${row.id}`,
      });
      _visible.set(row.id, { point, row });
    }
    for (const [rowId, record] of _visible) {
      if (seen.has(rowId)) continue;
      _points.remove(record.point);
      _visible.delete(rowId);
    }
    refreshLabels(rowsInView);
    governorRequestRender(`${id}-refresh`);
  }

  function scheduleRefresh() {
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(refresh, debounceMs);
  }

  function attachListener() {
    if (_listenerAttached || !_viewer) return;
    _viewer.camera.changed.addEventListener(scheduleRefresh);
    _viewer.camera.percentageChanged = Math.min(_viewer.camera.percentageChanged || 1, 0.05);
    _listenerAttached = true;
  }

  function detachListener() {
    if (!_listenerAttached || !_viewer) return;
    _viewer.camera.changed.removeEventListener(scheduleRefresh);
    _listenerAttached = false;
    if (_timer) { clearTimeout(_timer); _timer = null; }
  }

  const layer = {
    id,
    group,
    name,
    icon,
    source,
    updateInterval: 60 * 60_000, // rows are static; the camera listener does the real work

    init(viewer) {
      _viewer = viewer;
      _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
      _points.show = false;
      viewer.scene.primitives.add(_points);
      registerSpriteCollection(id, _points);
      _visible = new Map();
      _enabled = false;
      _gated = true;
      overlayHost.setVisible(overlaySourceId, false);
      console.log(`[Data:${id}] Initialized (proximity-gated, ≤${Math.round(maxAltitudeM / 1000)} km)`);
    },

    enable() {
      _enabled = true;
      if (_points) _points.show = true;
      registerPickOwner(id, (pickedId) => String(pickedId).startsWith(`${id}:`));
      overlayHost.setVisible(overlaySourceId, true);
      attachListener();
      ensureRows().then(() => scheduleRefresh()).catch(() => {});
    },

    disable() {
      _enabled = false;
      detachListener();
      clearVisible();
      if (_points) _points.show = false;
      unregisterPickOwner(id);
      overlayHost.setVisible(overlaySourceId, false);
      governorRequestRender(`${id}-visibility`);
    },

    async update() {
      try {
        await ensureRows();
        refresh();
        return true;
      } catch {
        return false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      detachListener();
      unregisterPickOwner(id);
      overlayHost.clearSource(overlaySourceId);
      overlayHost.setVisible(overlaySourceId, false);
      if (_points) {
        viewer.scene.primitives.remove(_points);
        _points = null;
      }
      _visible = new Map();
      _viewer = null;
    },

    /** Set (or clear with null) a row predicate; redraws immediately when enabled. */
    setFilter(predicate) {
      _filter = typeof predicate === 'function' ? predicate : null;
      if (_enabled) { clearVisible(); _gated = true; refresh(); }
    },

    /** Row counts per `tags[field]` over the whole dataset (for chip badges). */
    countBy(field) {
      const out = {};
      for (const row of _rows || []) { const k = row.tags?.[field] || ''; if (k) out[k] = (out[k] || 0) + 1; }
      return out;
    },

    getRow(pickedId) {
      return _visible.get(String(pickedId).replace(`${id}:`, ''))?.row || null;
    },

    getAnalystRecords(maxCount = 1500) {
      if (!_enabled) return [];
      const out = [];
      for (const { row } of _visible.values()) {
        if (out.length >= maxCount) break;
        const record = { id: row.id, name: row.name, lat: row.lat, lon: row.lon };
        for (const field of analystFields || []) record[field] = row.tags?.[field] ?? row.props?.[field] ?? null;
        out.push(record);
      }
      return out;
    },

    getStats() {
      const total = _rows?.length ?? 0;
      return {
        count: _visible.size,
        lastUpdate: _lastUpdate,
        loading: _loading,
        loadingLabel: _loading ? 'LOADING DATASET' : '',
        error: _lastError,
        status: _enabled && _gated && _rows ? 'zoom-in' : undefined,
        source: _gated && _rows
          ? `${source} · ${total} en total · acercate a menos de ${Math.round(maxAltitudeM / 1000)} km`
          : (total ? `${source} · ${_visible.size} en vista de ${total}` : source),
      };
    },
  };
  return layer;
}
