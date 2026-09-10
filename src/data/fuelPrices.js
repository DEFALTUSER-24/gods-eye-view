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
  FUEL_API_URL,
  FUEL_POLL_MS,
  PRODUCT_ORDER,
  brandColorCss,
  formatPrice,
  headlinePrice,
} from './fuelFeed.js';

/**
 * Precios de nafta — every reporting service station in Argentina (Secretaría
 * de Energía "precios en surtidor"), colored by brand, labeled with the SUPER
 * price. The card lists every product. Prices are the station's LAST report,
 * so the row shows how fresh the newest report is.
 */

export const FUEL_OVERLAY_SOURCE_ID = 'fuel-prices';
export const FUEL_LABEL_COHORT_LIMIT = 120;
export const FUEL_LABEL_MAX_ALTITUDE_M = 150_000;
export const FUEL_LABEL_MAX_DISTANCE_M = 60_000;
const OUTLINE = Cesium.Color.fromCssColorString('#0b1116').withAlpha(0.9);
const _brandColors = new Map();

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

function brandColor(brand) {
  const css = brandColorCss(brand);
  let c = _brandColors.get(css);
  if (!c) { c = Cesium.Color.fromCssColorString(css); _brandColors.set(css, c); }
  return c;
}

/** Card lines: every product price in canonical order (pure). */
export function stationCardDetails(station) {
  const lines = [];
  const seen = new Set();
  for (const label of PRODUCT_ORDER) {
    if (Number.isFinite(station.prices?.[label])) { lines.push(`${label} ${formatPrice(station.prices[label])}`); seen.add(label); }
  }
  for (const [label, price] of Object.entries(station.prices || {})) {
    if (!seen.has(label) && Number.isFinite(price)) lines.push(`${label} ${formatPrice(price)}`);
  }
  if (station.locality) lines.push(station.locality.toUpperCase());
  return lines.slice(0, 6);
}

export function createFuelPricesLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiUrl = FUEL_API_URL,
} = {}) {
  let _points = null;
  /** @type {Map<string, {point: object, station: object}>} */
  let _byId = new Map();
  let _count = 0;
  let _newestMs = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _loading = false;
  let _viewer = null;
  let _detachCamera = null;

  function refreshLabels() {
    if (!_enabled) return;
    // Cards only for stations inside the current view, and only when close
    // enough to read them — never a country-wide cohort.
    const rect = viewRectangleDeg(_viewer);
    if (!rect || cameraAltitude(_viewer) > FUEL_LABEL_MAX_ALTITUDE_M) {
      overlayHost.setEntries(FUEL_OVERLAY_SOURCE_ID, [], { cohortLimit: FUEL_LABEL_COHORT_LIMIT, collisionCapacity: 60, moving: false });
      return;
    }
    const entries = [];
    for (const { point, station } of _byId.values()) {
      if (!inRectangle(rect, station.lon, station.lat)) continue;
      const head = headlinePrice(station.prices);
      if (!head) continue;
      entries.push({
        id: station.id,
        position: point.position,
        variant: 'card',
        title: `${(station.brand || station.name || 'ESTACIÓN').toUpperCase().slice(0, 14)} · ${head.label} ${formatPrice(head.price)}`,
        details: stationCardDetails(station),
        accent: brandColorCss(station.brand),
        priority: Math.round(station.updatedMs / 60_000) % 1000000,
        collisionGroup: 'ambient-label',
        paintLane: 'ambient-label',
        interactive: false,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        gapPx: 10,
        placement: 'above',
        maxDistance: FUEL_LABEL_MAX_DISTANCE_M,
      });
    }
    entries.sort((a, b) => b.priority - a.priority || String(a.id).localeCompare(String(b.id)));
    overlayHost.setEntries(FUEL_OVERLAY_SOURCE_ID, entries.slice(0, FUEL_LABEL_COHORT_LIMIT), {
      cohortLimit: FUEL_LABEL_COHORT_LIMIT,
      collisionCapacity: 60,
      moving: false,
    });
  }

  function applyStations(stations) {
    if (!_points) return;
    const seen = new Set();
    for (const station of stations) {
      seen.add(station.id);
      const existing = _byId.get(station.id);
      if (existing) {
        existing.station = station;
        existing.point.color = brandColor(station.brand);
        continue;
      }
      const point = _points.add({
        position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat, 0),
        pixelSize: 7,
        color: brandColor(station.brand),
        outlineColor: OUTLINE,
        outlineWidth: 1.2,
        scaleByDistance: new Cesium.NearFarScalar(2000, 1.4, 300000, 0.45),
        translucencyByDistance: new Cesium.NearFarScalar(2000, 1.0, 900000, 0.25),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: `fuel:${station.id}`,
      });
      _byId.set(station.id, { point, station });
    }
    for (const [id, record] of _byId) {
      if (seen.has(id)) continue;
      _points.remove(record.point);
      _byId.delete(id);
    }
    _count = _byId.size;
    refreshLabels();
    governorRequestRender('fuel-prices-points');
  }

  const layer = {
    id: 'fuel-prices',
    group: 'argentina',
    sourceUrl: 'http://datos.energia.gob.ar/dataset/precios-en-surtidor',
    name: 'Precios de nafta',
    icon: '⛽',
    source: 'Sec. de Energía',
    updateInterval: FUEL_POLL_MS,

    init(viewer) {
      _viewer = viewer;
      _points = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT });
      _points.show = false;
      viewer.scene.primitives.add(_points);
      registerSpriteCollection('fuel-prices', _points);
      _byId = new Map();
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(FUEL_OVERLAY_SOURCE_ID, false);
      console.log('[Data:FuelPrices] Initialized');
    },

    enable() {
      _enabled = true;
      if (_points) _points.show = true;
      registerPickOwner('fuel-prices', (pickedId) => String(pickedId).startsWith('fuel:'));
      overlayHost.setVisible(FUEL_OVERLAY_SOURCE_ID, true);
      if (!_detachCamera) _detachCamera = onCameraSettled(_viewer, refreshLabels);
      refreshLabels();
      governorRequestRender('fuel-prices-visibility');
    },

    disable() {
      _enabled = false;
      if (_detachCamera) { _detachCamera(); _detachCamera = null; }
      if (_points) _points.show = false;
      unregisterPickOwner('fuel-prices');
      overlayHost.clearSource(FUEL_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(FUEL_OVERLAY_SOURCE_ID, false);
      governorRequestRender('fuel-prices-visibility');
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
          _lastError = `Energía HTTP ${response.status}`;
          return false;
        }
        const payload = await response.json();
        const stations = Array.isArray(payload?.stations) ? payload.stations : null;
        if (!stations) {
          _lastError = 'Malformed fuel-prices response';
          return false;
        }
        applyStations(stations);
        _newestMs = Number(payload.newestMs) || 0;
        _lastUpdate = Date.now();
        _lastError = payload?.stale ? 'Serving cached prices (upstream error)' : null;
        console.log(`[Data:FuelPrices] Updated: ${_count} stations`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        console.warn('[Data:FuelPrices] Fetch error:', error);
        _lastError = 'Energía network error';
        return false;
      } finally {
        _loading = false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      if (_detachCamera) { _detachCamera(); _detachCamera = null; }
      unregisterPickOwner('fuel-prices');
      overlayHost.clearSource(FUEL_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(FUEL_OVERLAY_SOURCE_ID, false);
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
      return _byId.get(String(id).replace(/^fuel:/, ''))?.station || null;
    },

    getAnalystRecords(maxCount = 3000) {
      if (!_enabled || !_byId.size) return [];
      const out = [];
      for (const { station } of _byId.values()) {
        if (out.length >= maxCount) break;
        out.push({
          id: station.id,
          name: station.name,
          brand: station.brand,
          locality: station.locality,
          province: station.province,
          lat: station.lat,
          lon: station.lon,
          ...Object.fromEntries(Object.entries(station.prices || {}).map(([k, v]) => [`price_${k.toLowerCase().replace('+', '_plus')}`, v])),
          timeMs: station.updatedMs || null,
        });
      }
      return out;
    },

    getStats() {
      const newest = _newestMs ? new Date(_newestMs) : null;
      const freshness = newest ? ` · último reporte ${String(newest.getDate()).padStart(2, '0')}/${String(newest.getMonth() + 1).padStart(2, '0')}` : '';
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        loading: _loading,
        loadingLabel: _loading ? 'LOADING STATIONS' : '',
        error: _lastError,
        source: `Sec. de Energía${freshness}`,
        generatedAt: _newestMs || null,
      };
    },
  };
  return layer;
}

const fuelPricesLayer = createFuelPricesLayer();

export default fuelPricesLayer;
