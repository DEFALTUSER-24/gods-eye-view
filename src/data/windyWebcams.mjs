/**
 * Windy Webcams API v3 → GEV CCTV source items (pure helpers, no I/O).
 *
 * Windy image URLs carry a token that expires (10 min on the free tier), so a
 * source item keeps the numeric `windyId`; the server re-resolves a fresh
 * preview URL per frame request (see resolveWindyPreviewUrl in vite.config.js).
 *
 * API: https://api.windy.com/webcams/docs  (header x-windy-api-key)
 */

export const WINDY_API_BASE = 'https://api.windy.com/webcams/api/v3';
export const WINDY_PAGE_LIMIT = 50; // API maximum per request
export const WINDY_DEFAULT_MAX_SOURCES = 300;
export const WINDY_DEFAULT_COUNTRIES = 'AR';

/** Deterministic 0..359 heading from an id so cameras don't all face north. */
export function windyFallbackHeading(webcamId) {
  let h = 0;
  const s = String(webcamId);
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 16) * 22.5;
}

export function windySourceId(webcamId) {
  return `windy-${String(webcamId).trim()}`;
}

export function windyIdFromSourceId(sourceId) {
  const m = /^windy-(\d+)$/.exec(String(sourceId || '').trim());
  return m ? m[1] : '';
}

/**
 * Build the list URL for one page.
 * @param {{countries?:string, offset?:number, limit?:number, categories?:string}} opts
 */
export function windyListUrl({ countries = WINDY_DEFAULT_COUNTRIES, offset = 0, limit = WINDY_PAGE_LIMIT, categories = '' } = {}) {
  const params = new URLSearchParams({
    countries: String(countries),
    include: 'images,location,player,urls,categories',
    limit: String(Math.max(1, Math.min(WINDY_PAGE_LIMIT, Math.floor(limit)))),
    offset: String(Math.max(0, Math.floor(offset))),
    sortKey: 'popularity',
    sortDirection: 'desc',
  });
  if (categories) params.set('categories', String(categories));
  return `${WINDY_API_BASE}/webcams?${params.toString()}`;
}

export function windyDetailUrl(webcamId) {
  const params = new URLSearchParams({ include: 'images,player' });
  return `${WINDY_API_BASE}/webcams/${encodeURIComponent(String(webcamId))}?${params.toString()}`;
}

/** Pick the best still image URL from a webcam object (preview > thumbnail > icon). */
export function windyPreviewUrl(webcam) {
  const cur = webcam?.images?.current || {};
  const candidate = cur.preview || cur.thumbnail || cur.icon || '';
  return typeof candidate === 'string' && /^https:\/\//i.test(candidate) ? candidate : '';
}

/**
 * Map one Windy webcam object into a GEV CCTV source item.
 * Returns null when the webcam lacks coordinates or an image.
 */
export function windyWebcamToSource(webcam) {
  if (!webcam || typeof webcam !== 'object') return null;
  const id = webcam.webcamId ?? webcam.id;
  const lat = Number(webcam?.location?.latitude);
  const lon = Number(webcam?.location?.longitude);
  if (id === undefined || id === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (webcam.status && String(webcam.status).toLowerCase() !== 'active') return null;
  const url = windyPreviewUrl(webcam);
  if (!url) return null;

  const city = String(webcam?.location?.city || webcam?.location?.region || '').trim();
  const cats = Array.isArray(webcam.categories)
    ? webcam.categories.map((c) => String(c?.name || c?.id || c || '')).filter(Boolean)
    : [];
  const title = String(webcam.title || `Windy ${id}`).trim();
  return {
    id: windySourceId(id),
    windyId: String(id),
    name: title,
    city,
    cityId: city ? city.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : 'windy',
    provider: 'Windy Webcams',
    sourceKind: 'windy',
    feedType: 'image',
    url,
    snapshotUrl: url,
    lat,
    lon,
    headingDeg: windyFallbackHeading(id),
    headingConfidence: 'fallback',
    pitchDeg: -12,
    fovDeg: 70,
    rangeM: 600,
    mountHeightM: 15,
    license: `Windy Webcams (webcam ${id}); attribution: windy.com${cats.length ? ` · ${cats.join(', ')}` : ''}`,
    detailUrl: typeof webcam?.urls?.detail === 'string' ? webcam.urls.detail : '',
  };
}

/**
 * Map a list response body ({ total, webcams: [] }) into source items.
 * @returns {{ total:number, sources:object[] }}
 */
export function windyListToSources(body) {
  const list = Array.isArray(body?.webcams) ? body.webcams : Array.isArray(body) ? body : [];
  const sources = [];
  for (const cam of list) {
    const item = windyWebcamToSource(cam);
    if (item) sources.push(item);
  }
  const total = Number.isFinite(Number(body?.total)) ? Number(body.total) : sources.length;
  return { total, sources };
}
