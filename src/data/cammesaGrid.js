import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import {
  CAMMESA_API_URL,
  CAMMESA_POLL_MS,
  formatMw,
  normalizeGridPayload,
  sharePct,
} from './cammesaFeed.js';

/**
 * Grid (Argentina) — live electricity demand per CAMMESA region, drawn as a
 * bubble per region (area ∝ MW) with a card carrying demand, forecast, the
 * same time yesterday, and the national generation mix.
 *
 * Data: keyless CAMMESA API, 5-minute samples, brokered by /api/cammesa/grid.
 */

export const CAMMESA_OVERLAY_SOURCE_ID = 'cammesa-grid';
export const CAMMESA_STALE_AFTER_MS = 20 * 60_000;
const BUBBLE_MIN_PX = 10;
const BUBBLE_MAX_PX = 46;
const BUBBLE_COLOR = Cesium.Color.fromCssColorString('#ffd166').withAlpha(0.55);
const BUBBLE_OUTLINE = Cesium.Color.fromCssColorString('#ffe9a8').withAlpha(0.95);

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/** Bubble pixel size — area proportional to demand, clamped to a legible band. */
export function bubblePixelSize(demandMw, maxMw) {
  const max = Number.isFinite(maxMw) && maxMw > 0 ? maxMw : 1;
  const ratio = Math.max(0, Math.min(1, (Number(demandMw) || 0) / max));
  return BUBBLE_MIN_PX + Math.sqrt(ratio) * (BUBBLE_MAX_PX - BUBBLE_MIN_PX);
}

/** Card lines for one region (pure). */
export function regionCardDetails(region, total) {
  const lines = [];
  if (Number.isFinite(region.forecastMw)) lines.push(`PREVISTA ${formatMw(region.forecastMw)}`);
  if (Number.isFinite(region.yesterdayMw)) {
    const delta = region.demandMw - region.yesterdayMw;
    const sign = delta >= 0 ? '+' : '−';
    lines.push(`AYER ${formatMw(region.yesterdayMw)} (${sign}${formatMw(Math.abs(delta))})`);
  }
  if (Number.isFinite(region.tempC)) lines.push(`TEMP ${region.tempC.toFixed(1)}°C`);
  if (total?.demandMw && region.demandMw) {
    lines.push(`${sharePct(region.demandMw, total.demandMw)}% DEL SADI`);
  }
  return lines;
}

/** National generation-mix line for the stats row / cards (pure). */
export function generationMixText(generation) {
  if (!generation || !Number.isFinite(generation.totalMw) || generation.totalMw <= 0) return '';
  const parts = [
    ['HIDRO', generation.hydroMw],
    ['TÉRMICA', generation.thermalMw],
    ['NUCLEAR', generation.nuclearMw],
    ['RENOV', generation.renewableMw],
  ].filter(([, mw]) => Number.isFinite(mw))
    .map(([label, mw]) => `${label} ${sharePct(mw, generation.totalMw)}%`);
  return parts.join(' · ');
}

export function createCammesaGridLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiUrl = CAMMESA_API_URL,
} = {}) {
  let _points = null;
  /** @type {Map<string, {point: object, region: object}>} */
  let _byId = new Map();
  let _total = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _loading = false;
  let _generatedAt = 0;

  function refreshCards() {
    if (!_enabled) return;
    const entries = [];
    for (const { point, region } of _byId.values()) {
      entries.push({
        id: region.id,
        position: point.position,
        variant: 'card',
        title: `${region.name.toUpperCase()} · ${formatMw(region.demandMw)}`,
        details: regionCardDetails(region, _total),
        accent: '#ffd166',
        priority: Math.round(region.demandMw),
        collisionGroup: 'ambient-label',
        paintLane: 'ambient-label',
        interactive: false,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        gapPx: 14,
        placement: 'above',
      });
    }
    overlayHost.setEntries(CAMMESA_OVERLAY_SOURCE_ID, entries, {
      cohortLimit: 12,
      collisionCapacity: 12,
      moving: false,
    });
  }

  function applyPayload(data) {
    if (!_points) return;
    const maxMw = data.regions.reduce((m, r) => Math.max(m, r.demandMw), 0);
    const seen = new Set();
    for (const region of data.regions) {
      seen.add(region.id);
      const position = Cesium.Cartesian3.fromDegrees(region.lon, region.lat, 0);
      const pixelSize = bubblePixelSize(region.demandMw, maxMw);
      const existing = _byId.get(region.id);
      if (existing) {
        existing.point.position = position;
        existing.point.pixelSize = pixelSize;
        existing.region = region;
        continue;
      }
      const point = _points.add({
        position,
        pixelSize,
        color: BUBBLE_COLOR,
        outlineColor: BUBBLE_OUTLINE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: `cammesa:${region.id}`,
      });
      _byId.set(region.id, { point, region });
    }
    for (const [id, record] of _byId) {
      if (seen.has(id)) continue;
      _points.remove(record.point);
      _byId.delete(id);
    }
    _total = data.total;
    _count = _byId.size;
    refreshCards();
    governorRequestRender('cammesa-grid-points');
  }

  const layer = {
    id: 'cammesa-grid',
    group: 'argentina',
    sourceUrl: 'https://cammesaweb.cammesa.com/demanda-y-generacion-en-tiempo-real/',
    name: 'Red Eléctrica (Argentina)',
    icon: '⚡',
    source: 'CAMMESA',
    updateInterval: CAMMESA_POLL_MS,

    init(viewer) {
      _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
      _points.show = false;
      viewer.scene.primitives.add(_points);
      _byId = new Map();
      _total = null;
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(CAMMESA_OVERLAY_SOURCE_ID, false);
      console.log('[Data:CammesaGrid] Initialized');
    },

    enable() {
      _enabled = true;
      if (_points) _points.show = true;
      registerPickOwner('cammesa-grid', (pickedId) => String(pickedId).startsWith('cammesa:'));
      overlayHost.setVisible(CAMMESA_OVERLAY_SOURCE_ID, true);
      refreshCards();
      governorRequestRender('cammesa-grid-visibility');
    },

    disable() {
      _enabled = false;
      if (_points) _points.show = false;
      unregisterPickOwner('cammesa-grid');
      overlayHost.clearSource(CAMMESA_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(CAMMESA_OVERLAY_SOURCE_ID, false);
      governorRequestRender('cammesa-grid-visibility');
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
          _lastError = `CAMMESA HTTP ${response.status}`;
          return false;
        }
        const data = normalizeGridPayload(await response.json());
        if (!data || !data.regions.length) {
          _lastError = 'Malformed CAMMESA response';
          return false;
        }
        applyPayload(data);
        _generatedAt = data.generatedAt;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:CammesaGrid] Updated: ${_count} regions, SADI ${formatMw(data.total?.demandMw)}`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        console.warn('[Data:CammesaGrid] Fetch error:', error);
        _lastError = 'CAMMESA network error';
        return false;
      } finally {
        _loading = false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      unregisterPickOwner('cammesa-grid');
      overlayHost.clearSource(CAMMESA_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(CAMMESA_OVERLAY_SOURCE_ID, false);
      if (_points) {
        viewer.scene.primitives.remove(_points);
        _points = null;
      }
      _byId = new Map();
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    getAnalystRecords(maxCount = 100) {
      if (!_enabled || !_byId.size) return [];
      const out = [];
      for (const { region } of _byId.values()) {
        if (out.length >= maxCount) break;
        out.push({
          id: region.id,
          name: region.name,
          lat: region.lat,
          lon: region.lon,
          demandMw: region.demandMw,
          forecastMw: region.forecastMw,
          yesterdayMw: region.yesterdayMw,
          tempC: region.tempC,
          timeMs: region.atMs || null,
        });
      }
      if (_total) {
        out.push({
          id: 'SADI',
          name: 'Total del SADI',
          lat: null,
          lon: null,
          demandMw: _total.demandMw,
          forecastMw: _total.forecastMw,
          yesterdayMw: _total.yesterdayMw,
          generation: _total.generation,
          timeMs: _total.atMs || null,
        });
      }
      return out;
    },

    getStats() {
      const stale = Boolean(_lastUpdate) && (Date.now() - _lastUpdate) > CAMMESA_STALE_AFTER_MS;
      const mix = generationMixText(_total?.generation);
      const source = _total?.demandMw
        ? `CAMMESA · SADI ${formatMw(_total.demandMw)}${mix ? ` · ${mix}` : ''}`
        : 'CAMMESA';
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        loading: _loading,
        loadingLabel: _loading ? 'LOADING GRID' : '',
        error: _lastError,
        stale,
        source,
        generatedAt: _generatedAt || null,
      };
    },
  };
  return layer;
}

const cammesaGridLayer = createCammesaGridLayer();

export default cammesaGridLayer;
