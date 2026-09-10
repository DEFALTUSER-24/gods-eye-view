import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { cameraAltitude, onCameraSettled } from './viewportGate.js';
import { showHoverCard, hideHoverCard } from '../hoverCard.js';

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
  sourceUrl = '',
  icon = '▭',
  source = 'Local',
  maxAltitudeM = 120_000,
  styleOf = null, // (properties, tags) => { stroke, strokeWidth, fill, fillAlpha }
  hoverOf = null, // (properties, tags) => { title, details[] } shown in a card under the pointer
  hoverThrottleMs = 60,
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
  let _hoverHandler = null;
  let _hoverAt = 0;
  let _hoverId = null;
  const _colorCache = new Map();
  /** line-primitive instance id → { props, tags } (for hover) */
  const _lineFeatures = new Map();

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

  /** @type {object[]} GroundPolylinePrimitive batches (line-only datasets) */
  let _linePrimitives = [];

  function loadLinePrimitives(collection) {
    const BATCH = 2000;
    let instances = [];
    let count = 0;
    const flush = () => {
      if (!instances.length) return;
      const primitive = new Cesium.GroundPolylinePrimitive({
        geometryInstances: instances,
        appearance: new Cesium.PolylineColorAppearance(),
        asynchronous: true,
        show: _enabled && !_gated,
      });
      _viewer.scene.groundPrimitives.add(primitive);
      _linePrimitives.push(primitive);
      instances = [];
    };
    for (const f of collection.features) {
      const props = f.properties || {};
      const tags = props.tags || {};
      const style = { ...defaultStyle, ...(typeof styleOf === 'function' ? styleOf(props, tags) : {}) };
      const parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const part of parts) {
        const flat = [];
        let last = null;
        for (const c of part) {
          if (!Number.isFinite(c?.[0]) || !Number.isFinite(c?.[1])) continue;
          if (last && last[0] === c[0] && last[1] === c[1]) continue; // duplicate vertex breaks the geometry
          flat.push(c[0], c[1]);
          last = c;
        }
        if (flat.length < 4) continue;
        const instanceId = `${id}:${f.id ?? count}`;
        _lineFeatures.set(instanceId, { props, tags });
        instances.push(new Cesium.GeometryInstance({
          geometry: new Cesium.GroundPolylineGeometry({ positions: Cesium.Cartesian3.fromDegreesArray(flat), width: style.strokeWidth }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color(style.stroke, 0.95)) },
          id: instanceId,
        }));
        count += 1;
        if (instances.length >= BATCH) flush();
      }
    }
    flush();
    _count = count;
    _loaded = true;
    _lastUpdate = Date.now();
    _lastError = null;
    console.log(`[Data:${id}] Loaded ${count} lines in ${_linePrimitives.length} ground primitives`);
  }

  function setShown(shown) {
    if (_dataSource) _dataSource.show = shown;
    for (const primitive of _linePrimitives) primitive.show = shown;
  }

  async function ensureLoaded() {
    if (_loaded || !_viewer) return;
    if (!_loadPromise) {
      _loading = true;
      _loadPromise = (async () => {
        const response = await fetchImpl(url, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        // A whole FeatureCollection parses as one value; GeoJSONL does not.
        let collection = null;
        try { const parsed = JSON.parse(text); if (Array.isArray(parsed?.features)) collection = parsed; } catch { collection = null; }
        if (!collection) collection = parseGeoJsonl(text);
        // Line-only datasets (ciclovías, flood-risk streets: thousands of short
        // segments) go into batched GroundPolylinePrimitives — one draw call per
        // ~2 000 lines — instead of one entity each, which stalls the globe.
        const linesOnly = collection.features.length > 0
          && collection.features.every((f) => f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString');
        if (linesOnly && Cesium.GroundPolylinePrimitive.isSupported(_viewer.scene)) {
          loadLinePrimitives(collection);
          return;
        }
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

  /** Resolve what of this layer sits under a pick result (pure given picked). */
  function describeHover(picked) {
    if (!picked || typeof hoverOf !== 'function') return null;
    const entity = picked.id instanceof Cesium.Entity ? picked.id : null;
    if (entity && _dataSource && _dataSource.entities.contains(entity)) {
      const props = entity.properties;
      const plain = {};
      if (props) for (const key of props.propertyNames) plain[key] = props[key]?.getValue?.();
      const described = hoverOf(plain, plain.tags || {});
      return described ? { key: entity.id, ...described } : null;
    }
    const instanceId = typeof picked.id === 'string' ? picked.id : null;
    const line = instanceId ? _lineFeatures.get(instanceId) : null;
    if (line) {
      const described = hoverOf(line.props, line.tags);
      return described ? { key: instanceId, ...described } : null;
    }
    return null;
  }

  function onHover(movement) {
    if (!_enabled || _gated || !_loaded) return;
    const now = Date.now();
    if (now - _hoverAt < hoverThrottleMs) return;
    _hoverAt = now;
    let picked = null;
    try { picked = _viewer.scene.pick(movement.endPosition); } catch { picked = null; }
    const described = describeHover(picked);
    if (!described) {
      if (_hoverId) { hideHoverCard(id); _hoverId = null; _viewer.scene.canvas.style.cursor = ''; }
      return;
    }
    _hoverId = described.key;
    _viewer.scene.canvas.style.cursor = 'help';
    const rect = _viewer.scene.canvas.getBoundingClientRect();
    showHoverCard({
      x: rect.left + movement.endPosition.x,
      y: rect.top + movement.endPosition.y,
      title: described.title,
      details: described.details || [],
      accent: defaultStyle.stroke,
      owner: id,
    });
  }

  function attachHover() {
    if (_hoverHandler || typeof hoverOf !== 'function' || !_viewer?.scene?.canvas) return;
    _hoverHandler = new Cesium.ScreenSpaceEventHandler(_viewer.scene.canvas);
    _hoverHandler.setInputAction(onHover, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  function detachHover() {
    if (_hoverHandler) { _hoverHandler.destroy(); _hoverHandler = null; }
    if (_hoverId) { hideHoverCard(id); _hoverId = null; if (_viewer?.scene?.canvas) _viewer.scene.canvas.style.cursor = ''; }
  }

  function refresh() {
    if (!_enabled || !_viewer) return;
    const gated = cameraAltitude(_viewer) > maxAltitudeM;
    if (gated === _gated && _loaded) return;
    _gated = gated;
    if (!gated) {
      ensureLoaded().then(() => {
        setShown(_enabled && !_gated);
        governorRequestRender(`${id}-show`);
      }).catch(() => {});
    } else {
      setShown(false);
      governorRequestRender(`${id}-hide`);
    }
  }

  const layer = {
    id,
    group,
    sourceUrl,
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
      attachHover();
      refresh();
    },

    disable() {
      _enabled = false;
      if (_detachCamera) { _detachCamera(); _detachCamera = null; }
      detachHover();
      setShown(false);
      governorRequestRender(`${id}-visibility`);
    },

    async update() {
      refresh();
      return true;
    },

    destroy(viewer) {
      _enabled = false;
      if (_detachCamera) { _detachCamera(); _detachCamera = null; }
      detachHover();
      _lineFeatures.clear();
      if (_dataSource) { viewer.dataSources.remove(_dataSource, true); _dataSource = null; }
      for (const primitive of _linePrimitives) viewer.scene.groundPrimitives.remove(primitive);
      _linePrimitives = [];
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
    describeHover,
  };
  return layer;
}
