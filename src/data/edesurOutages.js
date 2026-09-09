import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { governorRequestRender } from '../renderGovernor.js';
import { registerPickOwner, unregisterPickOwner } from './pickRegistry.js';
import {
  EDESUR_API_URL,
  EDESUR_POLL_MS,
  outagePixelSize,
  outageWindowText,
} from './edesurFeed.js';

/**
 * Cortes de luz Edesur — programmed and active outages in the Edesur
 * concession (south of CABA + south/west GBA). Bubble area ∝ customers
 * affected; card with locality, reason and time window.
 */

export const EDESUR_OVERLAY_SOURCE_ID = 'edesur-outages';
export const EDESUR_STALE_AFTER_MS = 30 * 60_000;
const COLOR_PLANNED = Cesium.Color.fromCssColorString('#ffd166').withAlpha(0.6);
const COLOR_ACTIVE = Cesium.Color.fromCssColorString('#ff5c5c').withAlpha(0.65);
const OUTLINE = Cesium.Color.fromCssColorString('#fff2cc').withAlpha(0.9);

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

export function outageCardDetails(outage) {
  const lines = [];
  lines.push(`${outage.status.toUpperCase()} · ${outageWindowText(outage.startMs, outage.endMs)}`);
  if (outage.reason) lines.push(outage.reason.toUpperCase().slice(0, 48));
  return lines;
}

export function createEdesurOutagesLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiUrl = EDESUR_API_URL,
} = {}) {
  let _points = null;
  /** @type {Map<string, {point: object, outage: object}>} */
  let _byId = new Map();
  let _count = 0;
  let _active = 0;
  let _customers = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _loading = false;

  function refreshCards() {
    if (!_enabled) return;
    const entries = [];
    for (const { point, outage } of _byId.values()) {
      entries.push({
        id: outage.id,
        position: point.position,
        variant: 'card',
        title: `${outage.locality || 'EDESUR'} · ${outage.customers} clientes`,
        details: outageCardDetails(outage),
        accent: outage.active ? '#ff5c5c' : '#ffd166',
        priority: outage.customers + (outage.active ? 100000 : 0),
        collisionGroup: 'ambient-label',
        paintLane: 'ambient-label',
        interactive: false,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        gapPx: 12,
        placement: 'above',
        maxDistance: 120_000,
      });
    }
    overlayHost.setEntries(EDESUR_OVERLAY_SOURCE_ID, entries, {
      cohortLimit: 60,
      collisionCapacity: 40,
      moving: false,
    });
  }

  function applyOutages(outages) {
    if (!_points) return;
    const seen = new Set();
    let active = 0;
    let customers = 0;
    for (const outage of outages) {
      seen.add(outage.id);
      if (outage.active) active += 1;
      customers += outage.customers;
      const color = outage.active ? COLOR_ACTIVE : COLOR_PLANNED;
      const existing = _byId.get(outage.id);
      if (existing) {
        existing.point.color = color;
        existing.point.pixelSize = outagePixelSize(outage.customers);
        existing.outage = outage;
        continue;
      }
      const point = _points.add({
        position: Cesium.Cartesian3.fromDegrees(outage.lon, outage.lat, 0),
        pixelSize: outagePixelSize(outage.customers),
        color,
        outlineColor: OUTLINE,
        outlineWidth: 1.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: `edesur:${outage.id}`,
      });
      _byId.set(outage.id, { point, outage });
    }
    for (const [id, record] of _byId) {
      if (seen.has(id)) continue;
      _points.remove(record.point);
      _byId.delete(id);
    }
    _count = _byId.size;
    _active = active;
    _customers = customers;
    refreshCards();
    governorRequestRender('edesur-outages-points');
  }

  const layer = {
    id: 'edesur-outages',
    group: 'argentina',
    name: 'Cortes de luz Edesur',
    icon: '💡',
    source: 'Edesur',
    updateInterval: EDESUR_POLL_MS,

    init(viewer) {
      _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
      _points.show = false;
      viewer.scene.primitives.add(_points);
      _byId = new Map();
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(EDESUR_OVERLAY_SOURCE_ID, false);
      console.log('[Data:EdesurOutages] Initialized');
    },

    enable() {
      _enabled = true;
      if (_points) _points.show = true;
      registerPickOwner('edesur-outages', (pickedId) => String(pickedId).startsWith('edesur:'));
      overlayHost.setVisible(EDESUR_OVERLAY_SOURCE_ID, true);
      refreshCards();
      governorRequestRender('edesur-outages-visibility');
    },

    disable() {
      _enabled = false;
      if (_points) _points.show = false;
      unregisterPickOwner('edesur-outages');
      overlayHost.clearSource(EDESUR_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(EDESUR_OVERLAY_SOURCE_ID, false);
      governorRequestRender('edesur-outages-visibility');
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
          _lastError = `Edesur HTTP ${response.status}`;
          return false;
        }
        const payload = await response.json();
        const outages = Array.isArray(payload?.outages) ? payload.outages : null;
        if (!outages) {
          _lastError = 'Malformed Edesur response';
          return false;
        }
        applyOutages(outages);
        _lastUpdate = Date.now();
        _lastError = payload?.stale ? 'Serving cached outages (upstream error)' : null;
        console.log(`[Data:EdesurOutages] Updated: ${_count} outages, ${_customers} customers`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        console.warn('[Data:EdesurOutages] Fetch error:', error);
        _lastError = 'Edesur network error';
        return false;
      } finally {
        _loading = false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      unregisterPickOwner('edesur-outages');
      overlayHost.clearSource(EDESUR_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(EDESUR_OVERLAY_SOURCE_ID, false);
      if (_points) {
        viewer.scene.primitives.remove(_points);
        _points = null;
      }
      _byId = new Map();
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    getAnalystRecords(maxCount = 500) {
      if (!_enabled || !_byId.size) return [];
      const out = [];
      for (const { outage } of _byId.values()) {
        if (out.length >= maxCount) break;
        out.push({
          id: outage.id,
          locality: outage.locality,
          lat: outage.lat,
          lon: outage.lon,
          customers: outage.customers,
          status: outage.status,
          reason: outage.reason,
          startMs: outage.startMs || null,
          endMs: outage.endMs || null,
        });
      }
      return out;
    },

    getStats() {
      const stale = Boolean(_lastUpdate) && (Date.now() - _lastUpdate) > EDESUR_STALE_AFTER_MS;
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        loading: _loading,
        loadingLabel: _loading ? 'LOADING OUTAGES' : '',
        error: _lastError,
        stale,
        source: _count ? `Edesur · ${_active} en curso · ${_customers} clientes` : 'Edesur',
      };
    },
  };
  return layer;
}

const edesurOutagesLayer = createEdesurOutagesLayer();

export default edesurOutagesLayer;
