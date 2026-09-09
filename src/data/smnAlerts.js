import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { governorRequestRender } from '../renderGovernor.js';
import {
  EVENT_COLORS,
  SMN_ALERTS_API_URL,
  SMN_ALERTS_POLL_MS,
  activeAlerts,
  alertLevel,
  alertWindowText,
} from './smnCap.js';

/**
 * Alertas SMN — official weather alerts (CAP) drawn as translucent ground
 * polygons colored by event family (tormentas, lluvias, viento, zonda,
 * nevadas, calor, frío…), with a card at the polygon centroid.
 */

export const SMN_ALERTS_OVERLAY_SOURCE_ID = 'smn-alerts';
export const SMN_ALERTS_STALE_AFTER_MS = 2 * 60 * 60_000;
const _fill = new Map();
const _outline = new Map();
function fillColor(kind) {
  let c = _fill.get(kind);
  if (!c) { c = Cesium.Color.fromCssColorString(EVENT_COLORS[kind] || EVENT_COLORS.otro).withAlpha(0.28); _fill.set(kind, c); }
  return c;
}
function outlineColor(kind) {
  let c = _outline.get(kind);
  if (!c) { c = Cesium.Color.fromCssColorString(EVENT_COLORS[kind] || EVENT_COLORS.otro).withAlpha(0.9); _outline.set(kind, c); }
  return c;
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

export function alertCardDetails(alert) {
  const lines = [alertWindowText(alert.onsetMs, alert.expiresMs)];
  const level = alertLevel(alert.description);
  if (level) lines.push(`NIVEL ${level.toUpperCase()}`);
  if (alert.description) lines.push(alert.description.replace(/\s+/g, ' ').slice(0, 72));
  return lines;
}

export function createSmnAlertsLayer({
  overlayHost = DEFAULT_OVERLAY_HOST,
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiUrl = SMN_ALERTS_API_URL,
} = {}) {
  let _dataSource = null;
  /** @type {Map<string, {entity: object, alert: object}>} */
  let _byId = new Map();
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;
  let _loading = false;
  let _kinds = {};

  function refreshCards() {
    if (!_enabled) return;
    const entries = [];
    for (const { alert } of _byId.values()) {
      entries.push({
        id: alert.id,
        position: Cesium.Cartesian3.fromDegrees(alert.centroid[0], alert.centroid[1], 0),
        variant: 'card',
        title: `SMN · ${String(alert.event).toUpperCase()}`,
        details: alertCardDetails(alert),
        accent: EVENT_COLORS[alert.kind] || EVENT_COLORS.otro,
        priority: (alert.kind === 'tormentas' ? 3 : alert.kind === 'zonda' ? 2 : 1) * 1000 + Math.round((alert.onsetMs || 0) / 3600_000) % 1000,
        collisionGroup: 'ambient-label',
        paintLane: 'ambient-label',
        interactive: false,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        gapPx: 12,
        placement: 'above',
      });
    }
    overlayHost.setEntries(SMN_ALERTS_OVERLAY_SOURCE_ID, entries, { cohortLimit: 80, collisionCapacity: 40, moving: false });
  }

  function applyAlerts(alerts) {
    if (!_dataSource) return;
    const seen = new Set();
    const kinds = {};
    for (const alert of alerts) {
      seen.add(alert.id);
      kinds[alert.kind] = (kinds[alert.kind] || 0) + 1;
      if (_byId.has(alert.id)) { _byId.get(alert.id).alert = alert; continue; }
      const entity = _dataSource.entities.add({
        id: `smn-alert:${alert.id}`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(alert.polygon.flat())),
          material: new Cesium.ColorMaterialProperty(fillColor(alert.kind)),
          outline: true,
          outlineColor: outlineColor(alert.kind),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        properties: { event: alert.event, kind: alert.kind, onsetMs: alert.onsetMs, expiresMs: alert.expiresMs },
      });
      _byId.set(alert.id, { entity, alert });
    }
    for (const [id, record] of _byId) {
      if (seen.has(id)) continue;
      _dataSource.entities.remove(record.entity);
      _byId.delete(id);
    }
    _kinds = kinds;
    _count = _byId.size;
    refreshCards();
    governorRequestRender('smn-alerts-polygons');
  }

  const layer = {
    id: 'smn-alerts',
    group: 'argentina',
    name: 'Alertas meteorológicas SMN',
    icon: '⚠️',
    source: 'SMN · CAP',
    updateInterval: SMN_ALERTS_POLL_MS,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('smn-alerts');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _byId = new Map();
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(SMN_ALERTS_OVERLAY_SOURCE_ID, false);
      console.log('[Data:SmnAlerts] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(SMN_ALERTS_OVERLAY_SOURCE_ID, true);
      refreshCards();
      governorRequestRender('smn-alerts-visibility');
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(SMN_ALERTS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SMN_ALERTS_OVERLAY_SOURCE_ID, false);
      governorRequestRender('smn-alerts-visibility');
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
          _lastError = `SMN CAP HTTP ${response.status}`;
          return false;
        }
        const payload = await response.json();
        const alerts = Array.isArray(payload?.alerts) ? activeAlerts(payload.alerts) : null;
        if (!alerts) {
          _lastError = 'Malformed SMN CAP response';
          return false;
        }
        applyAlerts(alerts);
        _lastUpdate = Date.now();
        _lastError = payload?.stale ? 'Serving cached alerts (upstream error)' : null;
        console.log(`[Data:SmnAlerts] Updated: ${_count} active alerts`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        console.warn('[Data:SmnAlerts] Fetch error:', error);
        _lastError = 'SMN CAP network error';
        return false;
      } finally {
        _loading = false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      overlayHost.clearSource(SMN_ALERTS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SMN_ALERTS_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _byId = new Map();
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    getAnalystRecords(maxCount = 200) {
      if (!_enabled || !_byId.size) return [];
      const out = [];
      for (const { alert } of _byId.values()) {
        if (out.length >= maxCount) break;
        out.push({
          id: alert.id,
          event: alert.event,
          kind: alert.kind,
          level: alertLevel(alert.description) || null,
          lat: alert.centroid[1],
          lon: alert.centroid[0],
          onsetMs: alert.onsetMs || null,
          expiresMs: alert.expiresMs || null,
          description: alert.description.slice(0, 200),
        });
      }
      return out;
    },

    getStats() {
      const stale = Boolean(_lastUpdate) && (Date.now() - _lastUpdate) > SMN_ALERTS_STALE_AFTER_MS;
      const mix = Object.entries(_kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ');
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        loading: _loading,
        loadingLabel: _loading ? 'LOADING ALERTS' : '',
        error: _lastError,
        stale,
        source: mix ? `SMN · ${mix}` : 'SMN · CAP',
      };
    },
  };
  return layer;
}

const smnAlertsLayer = createSmnAlertsLayer();

export default smnAlertsLayer;
