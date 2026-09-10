import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import { registerSpriteCollection } from './spriteOrder.js';
import {
  CONAE_API_URL,
  CONAE_POLL_MS,
  HOTSPOT_AGE_COLORS,
  hotspotAgeBucket,
  hotspotPixelSize,
} from './conaeFeed.js';

/**
 * Focos de calor CONAE — GOES-19 fire detections over Argentina (last 24 h),
 * refreshed every 10 minutes. Keyless alternative to the FIRMS layer.
 * Color = age (red <1 h → brown >6 h), size = fire radiative power.
 */

export const CONAE_STALE_AFTER_MS = 60 * 60_000;
const OUTLINE = Cesium.Color.fromCssColorString('#1a0d05').withAlpha(0.85);
const AGE_COLORS = HOTSPOT_AGE_COLORS.map((css) => Cesium.Color.fromCssColorString(css));

export function createConaeFiresLayer({
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiUrl = CONAE_API_URL,
} = {}) {
  let _points = null;
  /** @type {Map<string, {point: object, hotspot: object}>} */
  let _byId = new Map();
  let _count = 0;
  let _fresh = 0;
  let _newestMs = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _loading = false;

  function restyle(now = Date.now()) {
    let fresh = 0;
    for (const { point, hotspot } of _byId.values()) {
      const bucket = hotspotAgeBucket(hotspot.tsMs, now);
      if (bucket === 0) fresh += 1;
      point.color = AGE_COLORS[bucket];
    }
    _fresh = fresh;
  }

  function applyHotspots(hotspots) {
    if (!_points) return;
    const seen = new Set();
    for (const hotspot of hotspots) {
      seen.add(hotspot.id);
      const existing = _byId.get(hotspot.id);
      if (existing) {
        existing.hotspot = hotspot;
        continue;
      }
      const point = _points.add({
        position: Cesium.Cartesian3.fromDegrees(hotspot.lon, hotspot.lat, 0),
        pixelSize: hotspotPixelSize(hotspot.frpMw),
        color: AGE_COLORS[hotspotAgeBucket(hotspot.tsMs)],
        outlineColor: OUTLINE,
        outlineWidth: 1,
        scaleByDistance: new Cesium.NearFarScalar(50000, 1.2, 4000000, 0.55),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: `conae:${hotspot.id}`,
      });
      _byId.set(hotspot.id, { point, hotspot });
    }
    for (const [id, record] of _byId) {
      if (seen.has(id)) continue;
      _points.remove(record.point);
      _byId.delete(id);
    }
    _count = _byId.size;
    restyle();
    governorRequestRender('conae-fires-points');
  }

  const layer = {
    id: 'conae-fires',
    group: 'argentina',
    sourceUrl: 'https://focosdecalor.conae.gov.ar/',
    name: 'Focos de calor CONAE',
    icon: '🔥',
    source: 'CONAE · GOES-19',
    updateInterval: CONAE_POLL_MS,

    init(viewer) {
      _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
      _points.show = false;
      viewer.scene.primitives.add(_points);
      registerSpriteCollection('conae-fires', _points);
      _byId = new Map();
      _count = 0;
      _fresh = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      console.log('[Data:ConaeFires] Initialized');
    },

    enable() {
      _enabled = true;
      if (_points) _points.show = true;
      registerPickOwner('conae-fires', (pickedId) => String(pickedId).startsWith('conae:'));
      restyle();
      governorRequestRender('conae-fires-visibility');
    },

    disable() {
      _enabled = false;
      if (_points) _points.show = false;
      unregisterPickOwner('conae-fires');
      governorRequestRender('conae-fires-visibility');
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
          _lastError = `CONAE HTTP ${response.status}`;
          return false;
        }
        const payload = await response.json();
        const hotspots = Array.isArray(payload?.hotspots) ? payload.hotspots : null;
        if (!hotspots) {
          _lastError = 'Malformed CONAE response';
          return false;
        }
        applyHotspots(hotspots);
        _newestMs = Number(payload.newestMs) || 0;
        _lastUpdate = Date.now();
        _lastError = payload?.stale ? 'Serving cached hotspots (upstream error)' : null;
        console.log(`[Data:ConaeFires] Updated: ${_count} hotspots (${_fresh} in the last hour)`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        console.warn('[Data:ConaeFires] Fetch error:', error);
        _lastError = 'CONAE network error';
        return false;
      } finally {
        _loading = false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      unregisterPickOwner('conae-fires');
      if (_points) {
        viewer.scene.primitives.remove(_points);
        _points = null;
      }
      _byId = new Map();
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    getHotspot(id) {
      return _byId.get(String(id).replace(/^conae:/, ''))?.hotspot || null;
    },

    getDetectableObjects({ maxCount = 150, seed = 0 } = {}) {
      if (!_enabled || !_byId.size) return [];
      const records = Array.from(_byId.values())
        .filter(({ hotspot }) => hotspotAgeBucket(hotspot.tsMs) <= 1)
        .sort((a, b) => (b.hotspot.frpMw || 0) - (a.hotspot.frpMw || 0));
      const limit = Math.max(1, Math.min(400, Math.floor(maxCount) || 150));
      const start = records.length ? Math.abs(Math.floor(seed)) % records.length : 0;
      const out = [];
      for (let i = 0; i < records.length && out.length < limit; i += 1) {
        const { point, hotspot } = records[(start + i) % records.length];
        out.push({ position: point.position, sourceId: `conae:${hotspot.id}`, id: `FIRE-${hotspot.id}`, type: 'FIRE', skipLabel: false });
      }
      return out;
    },

    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || !_byId.size) return [];
      const out = [];
      for (const { hotspot } of _byId.values()) {
        if (out.length >= maxCount) break;
        out.push({
          id: hotspot.id,
          lat: hotspot.lat,
          lon: hotspot.lon,
          frpMw: hotspot.frpMw,
          satellite: hotspot.satellite,
          ageHours: Math.round(((Date.now() - hotspot.tsMs) / 3600_000) * 10) / 10,
          timeMs: hotspot.tsMs || null,
        });
      }
      return out;
    },

    getStats() {
      restyle();
      const stale = Boolean(_lastUpdate) && (Date.now() - _lastUpdate) > CONAE_STALE_AFTER_MS;
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        loading: _loading,
        loadingLabel: _loading ? 'LOADING HOTSPOTS' : '',
        error: _lastError,
        stale,
        source: _count ? `CONAE · GOES-19 · ${_fresh} última hora` : 'CONAE · GOES-19',
        generatedAt: _newestMs || null,
      };
    },
  };
  return layer;
}

const conaeFiresLayer = createConaeFiresLayer();

export default conaeFiresLayer;
