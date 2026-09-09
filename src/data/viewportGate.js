import * as Cesium from 'cesium';

/**
 * Small viewport helpers shared by the Argentina layers so labels/cards are
 * only produced for rows near the current view (never for the whole country).
 */

/** Camera height above the ellipsoid in metres (Infinity when unknown). */
export function cameraAltitude(viewer) {
  const carto = viewer?.camera?.positionCartographic;
  return carto && Number.isFinite(carto.height) ? carto.height : Infinity;
}

/** Current view rectangle in degrees, or null when the camera looks at space. */
export function viewRectangleDeg(viewer) {
  const rect = viewer?.camera?.computeViewRectangle?.(viewer.scene?.globe?.ellipsoid);
  if (!rect) return null;
  return {
    west: Cesium.Math.toDegrees(rect.west),
    east: Cesium.Math.toDegrees(rect.east),
    south: Cesium.Math.toDegrees(rect.south),
    north: Cesium.Math.toDegrees(rect.north),
  };
}

/** True when lon/lat falls inside `rect` expanded by `marginRatio` (pure). */
export function inRectangle(rect, lon, lat, marginRatio = 0.15) {
  if (!rect) return false;
  const w = (rect.east - rect.west) * marginRatio;
  const h = (rect.north - rect.south) * marginRatio;
  return lon >= rect.west - w && lon <= rect.east + w && lat >= rect.south - h && lat <= rect.north + h;
}

/**
 * Attach a debounced camera.changed listener. Returns a detach function.
 * @param {object} viewer
 * @param {() => void} fn
 * @param {number} [debounceMs]
 */
export function onCameraSettled(viewer, fn, debounceMs = 220) {
  if (!viewer?.camera?.changed) return () => {};
  let timer = null;
  const handler = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(); }, debounceMs);
  };
  viewer.camera.changed.addEventListener(handler);
  viewer.camera.percentageChanged = Math.min(viewer.camera.percentageChanged || 1, 0.05);
  return () => {
    viewer.camera.changed.removeEventListener(handler);
    if (timer) clearTimeout(timer);
  };
}
