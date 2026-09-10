import * as Cesium from 'cesium';
import { streetViewUrl } from './streetViewLink.js';

/**
 * Right-click context menu on the globe.
 *
 * Right-click (without dragging — Cesium's right-drag still tilts) on any
 * point of the map, or on a feature of any data layer, opens a small menu:
 * Street View, Google Maps, copy coordinates. When the pick hits a layer
 * feature the menu is anchored to that feature's own position and shows its
 * name (layers may expose `describePick(id)` for a richer title/details;
 * entities fall back to their name / tags).
 */

export function googleMapsUrl(lat, lon) {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

export function formatCoords(lat, lon) {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function cartoOf(cartesian) {
  if (!cartesian) return null;
  const carto = Cesium.Cartographic.fromCartesian(cartesian);
  return carto ? { lat: Cesium.Math.toDegrees(carto.latitude), lon: Cesium.Math.toDegrees(carto.longitude) } : null;
}

/** Ground point under a screen position (3D tiles/terrain first, ellipsoid fallback). */
export function groundAt(viewer, screen) {
  const scene = viewer.scene;
  let cartesian = null;
  try { if (scene.pickPositionSupported) cartesian = scene.pickPosition(screen) || null; } catch { cartesian = null; }
  if (!cartesian && scene.globe?.show) {
    const ray = viewer.camera.getPickRay(screen);
    if (ray) cartesian = scene.globe.pick(ray, scene) || null;
  }
  if (!cartesian) cartesian = viewer.camera.pickEllipsoid(screen, scene.globe?.ellipsoid) || null;
  return cartoOf(cartesian);
}

/**
 * Resolve what sits under the cursor: a layer feature (with its own position
 * and a title) or nothing. Pure given `picked` (the scene.pick result).
 */
export function describePicked(picked, layerModules = []) {
  if (!picked) return null;
  // Entity (GeoJsonDataSource / CustomDataSource)
  const entity = picked.id instanceof Cesium.Entity ? picked.id : (picked.id?.entity ?? null);
  if (entity) {
    const now = Cesium.JulianDate.now();
    const props = entity.properties;
    const tags = props?.tags?.getValue?.(now) || {};
    const name = entity.name || tags.name || props?.name?.getValue?.(now) || String(entity.id);
    const position = entity.position?.getValue?.(now) || null;
    return { title: String(name).slice(0, 64), details: [], position, source: 'entity' };
  }
  // Primitive with a string id (PointPrimitive / Billboard)
  const id = typeof picked.id === 'string' ? picked.id : (picked.id?.id ?? null);
  if (typeof id !== 'string') return null;
  const position = picked.primitive?.position instanceof Cesium.Cartesian3 ? picked.primitive.position : null;
  for (const module of layerModules) {
    if (typeof module?.describePick !== 'function') continue;
    let described = null;
    try { described = module.describePick(id); } catch { described = null; }
    if (described) return { title: String(described.title || id).slice(0, 64), details: (described.details || []).slice(0, 4), position, source: module.id };
  }
  return { title: id.replace(/^[a-z-]+:/i, '').slice(0, 64), details: [], position, source: 'primitive' };
}

export function initContextMenu(viewer, { dataManager = null, doc = globalThis.document, open = (url) => globalThis.open(url, '_blank', 'noopener') } = {}) {
  const canvas = viewer?.scene?.canvas;
  if (!canvas || !doc) return null;
  const menu = doc.createElement('div');
  menu.id = 'gev-context-menu';
  menu.className = 'gev-context-menu';
  menu.hidden = true;
  doc.body.appendChild(menu);

  let downAt = null;
  const close = () => { menu.hidden = true; menu.innerHTML = ''; };

  function layerModules() {
    const out = [];
    try { for (const layer of dataManager?.getAll?.() || []) { const m = dataManager.layers.get(layer.id)?.module; if (m) out.push(m); } } catch { /* ignore */ }
    return out;
  }

  function show(clientX, clientY, target) {
    const { lat, lon } = target;
    const heading = Cesium.Math.toDegrees(viewer.camera.heading);
    const items = [
      { label: '👁 Ver en Street View', run: () => open(streetViewUrl(lat, lon, heading)) },
      { label: '🗺 Abrir en Google Maps', run: () => open(googleMapsUrl(lat, lon)) },
      { label: '📋 Copiar coordenadas', run: () => { try { globalThis.navigator?.clipboard?.writeText(formatCoords(lat, lon)); } catch { /* no clipboard */ } } },
    ];
    menu.innerHTML = '';
    const head = doc.createElement('div');
    head.className = 'gev-context-title';
    head.innerHTML = `<span class="gev-context-name"></span><span class="gev-context-coords"></span>`;
    head.querySelector('.gev-context-name').textContent = target.title || 'Punto del mapa';
    head.querySelector('.gev-context-coords').textContent = formatCoords(lat, lon);
    menu.appendChild(head);
    for (const line of target.details || []) {
      const d = doc.createElement('div');
      d.className = 'gev-context-detail';
      d.textContent = line;
      menu.appendChild(d);
    }
    for (const item of items) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'gev-context-item';
      b.textContent = item.label;
      b.addEventListener('click', () => { item.run(); close(); });
      menu.appendChild(b);
    }
    menu.hidden = false;
    // Keep the menu inside the viewport.
    const w = menu.offsetWidth || 220; const h = menu.offsetHeight || 140;
    const x = Math.min(clientX, (doc.documentElement.clientWidth || 1000) - w - 8);
    const y = Math.min(clientY, (doc.documentElement.clientHeight || 800) - h - 8);
    menu.style.left = `${Math.max(4, x)}px`;
    menu.style.top = `${Math.max(4, y)}px`;
  }

  canvas.addEventListener('mousedown', (event) => { if (event.button === 2) downAt = { x: event.clientX, y: event.clientY }; });
  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 5) { downAt = null; return; } // right-drag = tilt
    downAt = null;
    const rect = canvas.getBoundingClientRect();
    const screen = new Cesium.Cartesian2(event.clientX - rect.left, event.clientY - rect.top);
    let picked = null;
    try { picked = viewer.scene.pick(screen); } catch { picked = null; }
    const feature = describePicked(picked, layerModules());
    const ground = (feature?.position && cartoOf(feature.position)) || groundAt(viewer, screen);
    if (!ground) { close(); return; }
    show(event.clientX, event.clientY, { ...ground, title: feature?.title || '', details: feature?.details || [] });
  });
  doc.addEventListener('mousedown', (event) => { if (!menu.hidden && !menu.contains(event.target)) close(); }, true);
  doc.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  canvas.addEventListener('wheel', close, { passive: true });
  return { menu, close };
}
