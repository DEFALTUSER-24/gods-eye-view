import * as Cesium from 'cesium';

/**
 * "Street View" button in the LOCATION toolbar: opens Google Maps Street
 * View (new tab, no API key) at the point under the centre of the view,
 * facing the camera's heading.
 */

export function streetViewUrl(lat, lon, headingDeg = 0) {
  const heading = Math.round(((Number(headingDeg) || 0) % 360 + 360) % 360);
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}&heading=${heading}`;
}

/** Ground point under the screen centre (3D tiles/terrain first, ellipsoid fallback). */
export function cameraTargetLatLon(viewer) {
  const scene = viewer?.scene;
  const canvas = scene?.canvas;
  if (!canvas) return null;
  const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  let cartesian = null;
  try {
    if (scene.pickPositionSupported) cartesian = scene.pickPosition(center) || null;
  } catch { cartesian = null; }
  if (!cartesian && scene.globe?.show) {
    const ray = viewer.camera.getPickRay(center);
    if (ray) cartesian = scene.globe.pick(ray, scene) || null;
  }
  if (!cartesian) cartesian = viewer.camera.pickEllipsoid(center, scene.globe?.ellipsoid) || null;
  if (!cartesian) return null;
  const carto = Cesium.Cartographic.fromCartesian(cartesian);
  if (!carto) return null;
  return {
    lat: Cesium.Math.toDegrees(carto.latitude),
    lon: Cesium.Math.toDegrees(carto.longitude),
    headingDeg: Cesium.Math.toDegrees(viewer.camera.heading),
  };
}

export function initStreetViewButton(viewer, { doc = globalThis.document, open = (url) => globalThis.open(url, '_blank', 'noopener') } = {}) {
  const toolbar = doc?.querySelector?.('#location-bar .location-toolbar');
  if (!toolbar || doc.getElementById('street-view-btn')) return null;
  const button = doc.createElement('button');
  button.id = 'street-view-btn';
  button.type = 'button';
  button.className = 'location-toolbar-btn';
  button.title = 'Abrir Google Street View en el centro de la vista (nueva pestaña)';
  button.innerHTML = '<span aria-hidden="true">👁</span><span>STREET VIEW</span>';
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const target = cameraTargetLatLon(viewer);
    if (!target) {
      button.classList.add('shake');
      setTimeout(() => button.classList.remove('shake'), 400);
      return;
    }
    open(streetViewUrl(target.lat, target.lon, target.headingDeg));
  });
  const collapse = toolbar.querySelector('.panel-collapse-btn');
  if (collapse) toolbar.insertBefore(button, collapse); else toolbar.appendChild(button);
  return button;
}
