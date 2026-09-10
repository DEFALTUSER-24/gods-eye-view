import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { cameraAltitude, onCameraSettled } from './viewportGate.js';

/**
 * Altitude-gated bundled GeoJSON layer for polygons and lines (RENABAP
 * polygons, ciclovías, flood-risk streets). The dataset is loaded lazily the
 * first time the camera is below `maxAltitudeM`, drawn clamped to ground with
 * a per-feature style, and simply hidden while the camera is above the gate —
 * so a country-wide toggle never stalls the globe.
 */

export function createGatedGeoJsonLayer({
  id,
  url,
  name,
  group = null,
  icon = '▭',
  source = 'Local',
  maxAltitudeM = 120_000,
  styleOf = null, // (properties, tags) => { stroke, strokeWidth, fill, fillAlpha }
  defaultStyle = { stroke: '#ffffff', strokeWidth: 2, fill: '#ffffff', fillAlpha: 0.25 },
  fetchImpl = (...args) => globalThis.fetch(...args),
}) {
  let _viewer = null;
  let _dataSource = null;
  let _loadPromise = null;
  let _loaded = false;
  let _count = 0;
  let _enabled = false;
  let _gated = true;
  let _detachCamera = null;
  let _lastError = null;
  let _lastUpdate = null;
  let _loading = false;
  const _colorCache = new Map();

  function color(css, alpha = 1) {
    const key = `${css}|${alpha}`;
    let c = _colorCache.get(key);
    if (!c) { c = Cesium.Color.fromCssColorString(css).withAlpha(alpha); _colorCache.set(key, c); }
    return c;
  }

  function parseGeoJsonl(text) {
    const features = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { features.push(JSON.parse(line)); } catch { /* skip */ }
    }
    return { type: 'FeatureCollection', features };
  }

  async function ensureLoaded() {
    if (_loaded || !_viewer) return;
    if (!_loadPromise) {
      _loading = true;
      _loadPromise = (async () => {
        const response = await fetchImpl(url, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        // A whole FeatureCollection parses as one value; GeoJSONL does not.
        let collection = null;
        try { const parsed = JSON.parse(text); if (Array.isArray(parsed?.features)) collection = parsed; } catch { collection = null; }
        if (!collection) collection = parseGeoJsonl(text);
        const ds = await Cesium.GeoJsonDataSource.load(collection, { clampToGround: true });
        for (const entity of ds.entities.values) {
          const props = entity.properties;
          const plain = {};
          if (props) for (const key of props.propertyNames) plain[key] = props[key]?.getValue?.();
          const tags = plain.tags || {};
          const style = { ...defaultStyle, ...(typeof styleOf === 'function' ? styleOf(plain, tags) : {}) };
          if (entity.polygon) {
            entity.polygon.material = color(style.fill, style.fillAlpha);
            entity.polygon.outline = false;
            // Outline as a separate clamped polyline (polygon outlines do not clamp).
            const hierarchy = entity.polygon.hierarchy?.getValue?.(Cesium.JulianDate.now());
            if (hierarchy?.positions?.length) {
              entity.polyline = new Cesium.PolylineGraphics({
                positions: [...hierarchy.positions, hierarchy.positions[0]],
                width: style.strokeWidth,
                material: color(style.stroke, 0.9),
                clampToGround: true,
              });
            }
          } else if (entity.polyline) {
            entity.polyline.width = style.strokeWidth;
            entity.polyline.material = color(style.stroke, 0.95);
            entity.polyline.clampToGround = true;
          }
          if (entity.billboard) entity.billboard = undefined;
        }
        _count = ds.entities.values.length;
        ds.show = _enabled && !_gated;
        _dataSource = ds;
        _viewer.dataSources.add(ds);
        _loaded = true;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:${id}] Loaded ${_count} features`);
      })().catch((error) => {
        _lastError = `Dataset load failed (${error?.message || error})`;
        _loadPromise = null;
        throw error;
      }).finally(() => { _loading = false; });
    }
    return _loadPromise;
  }

  function refresh() {
    if (!_enabled || !_viewer) return;
    const gated = cameraAltitude(_viewer) > maxAltitudeM;
    if (gated === _gated && _loaded) return;
    _gated = gated;
    if (!gated) {
      ensureLoaded().then(() => {
        if (_dataSource) { _dataSource.show = _enabled && !_gated; governorRequestRender(`${id}-show`); }
      }).catch(() => {});
    } else if (_dataSource) {
      _dataSource.show = false;
      governorRequestRender(`${id}-hide`);
    }
  }

  const layer = {
    id,
    group,
    name,
    icon,
    source,
    updateInterval: 60 * 60_000,

    init(viewer) {
      _viewer = viewer;
      _enabled = false;
      _gated = true;
      console.log(`[Data:${id}] Initialized (gated ≤${Math.round(maxAltitudeM / 1000)} km)`);
    },

    enable() {
      _enabled = true;
      if (!_detachCamera) _detachCamera = onCameraSettled(_viewer, refresh);
      _gated = true;
      refresh();
    },

    disable() {
      _enabled = false;
      if (_detachCamera) { _detachCamera(); _detachCamera = null; }
      if (_dataSource) _dataSource.show = false;
      governorRequestRender(`${id}-visibility`);
    },

    async update() {
      refresh();
      return true;
    },

    destroy(viewer) {
      _enabled = false;
      if (_detachCamera) { _detachCamera(); _detachCamera = null; }
      if (_dataSource) { viewer.dataSources.remove(_dataSource, true); _dataSource = null; }
      _loaded = false;
      _loadPromise = null;
      _viewer = null;
    },

    getStats() {
      return {
        count: _loaded && !_gated ? _count : 0,
        lastUpdate: _lastUpdate,
        loading: _loading,
        loadingLabel: _loading ? 'LOADING DATASET' : '',
        error: _lastError,
        status: _enabled && _gated ? 'zoom-in' : undefined,
        source: _enabled && _gated
          ? `${source} · acercate a menos de ${Math.round(maxAltitudeM / 1000)} km`
          : (_loaded ? `${source} · ${_count} en total` : source),
      };
    },
  };
  return layer;
}
