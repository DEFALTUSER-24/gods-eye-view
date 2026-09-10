/**
 * USIG (Buenos Aires Ciudad) mapcache tiles — shared, dependency-free helpers
 * for the client provider and the dev-server proxy.
 *
 * The city's mapcache renders tiles on demand; when many are requested at
 * once it answers a share of them with HTTP 500 ("another thread/process
 * failed to create the tile I was waiting for"). Those tiles are fine a
 * moment later, so the proxy retries with a small backoff and limits how
 * many requests hit the upstream at the same time.
 */

export const USIG_TILE_ROUTE = '/api/usig/tiles';
export const USIG_TMS_BASE = 'https://tiles1.usig.buenosaires.gob.ar/mapcache/tms/1.0.0';
export const USIG_TILE_MAX_LEVEL = 18; // GoogleMapsCompatible tilesets stop at 18

/** Tile template the Cesium provider uses (Cesium fills in {z}/{x}/{reverseY}). */
export const USIG_TILE_TEMPLATE = `${USIG_TILE_ROUTE}/{layer}/{z}/{x}/{reverseY}.png`;

/**
 * Parse "/<layer>/<z>/<x>/<tmsY>.png" (pure). Returns null on anything that
 * is not a well-formed request for a *_3857 tileset within the zoom range.
 */
export function parseUsigTilePath(pathname) {
  const match = /^\/?([a-z0-9_]+_3857)\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.png$/i.exec(String(pathname || ''));
  if (!match) return null;
  const z = Number(match[2]); const x = Number(match[3]); const y = Number(match[4]);
  if (z > USIG_TILE_MAX_LEVEL) return null;
  const n = 2 ** z;
  if (x >= n || y >= n) return null;
  return { layer: match[1].toLowerCase(), z, x, y };
}

export function usigUpstreamTileUrl({ layer, z, x, y }) {
  return `${USIG_TMS_BASE}/${layer}@GoogleMapsCompatible/${z}/${x}/${y}.png`;
}

/** Backoff for the n-th retry (0-based): 300, 600, 1200 … capped at 2.5 s. */
export function usigRetryDelayMs(attempt) {
  return Math.min(2500, 300 * 2 ** Math.max(0, attempt));
}
