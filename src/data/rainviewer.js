import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';

/**
 * Radar de lluvia — RainViewer global precipitation radar composite, draped on
 * the globe as animated imagery (last ~2 h of 10-minute frames).
 *
 * Data: keyless RainViewer public API, brokered by /api/rainviewer/maps (frame
 * catalog); PNG tiles come straight from tilecache.rainviewer.com (CORS *).
 * Coverage is whatever national radars RainViewer ingests — Argentina is
 * partial (SINARAME radars around the Pampas / Litoral), so an empty area may
 * mean "no radar", not "no rain".
 */

export const RAINVIEWER_API_URL = '/api/rainviewer/maps';
export const RAINVIEWER_POLL_MS = 5 * 60_000;
export const RAINVIEWER_FRAME_COUNT = 8;
export const RAINVIEWER_FRAME_MS = 650;
export const RAINVIEWER_HOLD_LAST_MS = 1600;
export const RAINVIEWER_ALPHA = 0.78;
export const RAINVIEWER_COLOR_SCHEME = 2; // "Universal Blue"
export const RAINVIEWER_MAX_LEVEL = 10;

/** Build a Cesium tile template for one RainViewer frame (pure). */
export function frameTileTemplate(host, framePath, { color = RAINVIEWER_COLOR_SCHEME, smooth = 1, snow = 1 } = {}) {
  return `${host}${framePath}/256/{z}/{x}/{y}/${color}/${smooth}_${snow}.png`;
}

/** Normalize the catalog; returns { host, frames:[{time, path}] } newest last, or null. */
export function normalizeRainviewerCatalog(payload, frameCount = RAINVIEWER_FRAME_COUNT) {
  const host = typeof payload?.host === 'string' && /^https:\/\//.test(payload.host) ? payload.host : '';
  const past = Array.isArray(payload?.radar?.past) ? payload.radar.past : [];
  if (!host || !past.length) return null;
  const frames = past
    .filter((f) => Number.isFinite(Number(f?.time)) && typeof f?.path === 'string' && /^\/v2\/radar\/[a-z0-9]+$/i.test(f.path))
    .map((f) => ({ time: Number(f.time), path: f.path }))
    .sort((a, b) => a.time - b.time)
    .slice(-Math.max(1, frameCount));
  return frames.length ? { host, frames } : null;
}

/** "14:30" local time label for a frame epoch (seconds). */
export function frameClock(timeSec) {
  const d = new Date(timeSec * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function createRainviewerLayer({
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiUrl = RAINVIEWER_API_URL,
  createProvider = (url) => new Cesium.UrlTemplateImageryProvider({
    url,
    maximumLevel: RAINVIEWER_MAX_LEVEL,
    credit: new Cesium.Credit('Radar: RainViewer'),
  }),
} = {}) {
  let _viewer = null;
  /** @type {Map<string, {layer: object, time: number}>} path -> imagery layer */
  let _layers = new Map();
  /** @type {Array<{time:number, path:string}>} */
  let _frames = [];
  let _frameIndex = 0;
  let _timer = null;
  let _enabled = false;
  let _lastUpdate = null;
  let _lastError = null;
  let _loading = false;

  function showFrame(index) {
    if (!_frames.length) return;
    _frameIndex = ((index % _frames.length) + _frames.length) % _frames.length;
    const current = _frames[_frameIndex].path;
    for (const [framePath, record] of _layers) {
      record.layer.alpha = framePath === current ? RAINVIEWER_ALPHA : 0;
      record.layer.show = _enabled;
    }
    governorRequestRender('rainviewer-frame');
  }

  function stopAnimation() {
    if (_timer) clearTimeout(_timer);
    _timer = null;
  }

  function scheduleNext() {
    stopAnimation();
    if (!_enabled || _frames.length < 2) return;
    const atLast = _frameIndex === _frames.length - 1;
    _timer = setTimeout(() => {
      showFrame(_frameIndex + 1);
      scheduleNext();
    }, atLast ? RAINVIEWER_HOLD_LAST_MS : RAINVIEWER_FRAME_MS);
  }

  function syncLayers(catalog) {
    if (!_viewer) return;
    const wanted = new Set(catalog.frames.map((f) => f.path));
    for (const [framePath, record] of _layers) {
      if (wanted.has(framePath)) continue;
      _viewer.imageryLayers.remove(record.layer, true);
      _layers.delete(framePath);
    }
    for (const frame of catalog.frames) {
      if (_layers.has(frame.path)) continue;
      const provider = createProvider(frameTileTemplate(catalog.host, frame.path));
      const layer = _viewer.imageryLayers.addImageryProvider(provider);
      layer.alpha = 0;
      layer.show = _enabled;
      _layers.set(frame.path, { layer, time: frame.time });
    }
    _frames = catalog.frames;
    showFrame(_frames.length - 1);
    scheduleNext();
  }

  const layer = {
    id: 'rainviewer-radar',
    sourceUrl: 'https://www.rainviewer.com/',
    name: 'Radar de lluvia',
    icon: '🌧️',
    source: 'RainViewer',
    updateInterval: RAINVIEWER_POLL_MS,

    init(viewer) {
      _viewer = viewer;
      _layers = new Map();
      _frames = [];
      _enabled = false;
      _lastUpdate = null;
      _lastError = null;
      console.log('[Data:RainViewer] Initialized');
    },

    enable() {
      _enabled = true;
      showFrame(_frames.length ? _frames.length - 1 : 0);
      scheduleNext();
    },

    disable() {
      _enabled = false;
      stopAnimation();
      for (const record of _layers.values()) record.layer.show = false;
      governorRequestRender('rainviewer-visibility');
    },

    async update(viewer, { signal } = {}) {
      _loading = _frames.length === 0;
      try {
        const response = await fetchImpl(`${apiUrl}?ts=${Date.now()}`, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal,
        });
        if (!response.ok) {
          _lastError = `RainViewer HTTP ${response.status}`;
          return false;
        }
        const catalog = normalizeRainviewerCatalog(await response.json());
        if (!catalog) {
          _lastError = 'Malformed RainViewer catalog';
          return false;
        }
        syncLayers(catalog);
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:RainViewer] ${catalog.frames.length} radar frames, latest ${frameClock(catalog.frames.at(-1).time)}`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        console.warn('[Data:RainViewer] Fetch error:', error);
        _lastError = 'RainViewer network error';
        return false;
      } finally {
        _loading = false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      stopAnimation();
      for (const record of _layers.values()) viewer.imageryLayers.remove(record.layer, true);
      _layers = new Map();
      _frames = [];
      _viewer = null;
      _lastUpdate = null;
      _lastError = null;
    },

    /** Current frame time (seconds) — voice/analyst seam. */
    getCurrentFrameTime() {
      return _frames[_frameIndex]?.time ?? null;
    },

    getStats() {
      const latest = _frames.at(-1);
      const stale = Boolean(_lastUpdate) && (Date.now() - _lastUpdate) > 20 * 60_000;
      return {
        count: _frames.length,
        lastUpdate: _lastUpdate,
        loading: _loading,
        loadingLabel: _loading ? 'LOADING RADAR' : '',
        error: _lastError,
        stale,
        source: latest ? `RainViewer · ${frameClock(_frames[0].time)}–${frameClock(latest.time)}` : 'RainViewer',
      };
    },
  };
  return layer;
}

const rainviewerLayer = createRainviewerLayer();

export default rainviewerLayer;
