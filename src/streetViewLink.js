import * as Cesium from 'cesium';

/**
 * Google Street View URL helpers (used by the right-click context menu):
 * new tab, no API key, facing the camera's heading.
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
