/**
 * CONAE "Focos de calor" (GOES-19 fire hotspots over Argentina) — pure helpers
 * shared by the Vite proxy and the layer.
 *
 * Upstream (keyless GeoServer WFS → GeoJSON):
 *   https://focosdecalor.conae.gov.ar/geoserver/FocosDeCalor/wfs?...typeNames=FocosDeCalor:FocosGOES_24hs
 *   feature.properties: { Id, "Fecha_Local_UTC-3": "2026-09-09 13:20:00", Satelite: "GOES19",
 *                         Latitud, Longitud, Fire_Radiative_Power }
 */

export const CONAE_API_URL = '/api/conae/hotspots';
export const CONAE_POLL_MS = 10 * 60_000;

/** "2026-09-09 13:20:00" in Argentina local time (UTC-3) → epoch ms. */
export function parseConaeLocalTime(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text || '').trim());
  if (!m) return 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 3, +m[5], +(m[6] || 0));
}

/** Normalize one WFS feature; null when unusable. */
export function normalizeHotspot(feature) {
  const p = feature?.properties || {};
  const coords = feature?.geometry?.coordinates;
  const lon = Number(Array.isArray(coords) ? coords[0] : p.Longitud);
  const lat = Number(Array.isArray(coords) ? coords[1] : p.Latitud);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const tsMs = parseConaeLocalTime(p['Fecha_Local_UTC-3'] ?? p.fecha ?? p.Fecha);
  const frp = Number(p.Fire_Radiative_Power ?? p.FP_Power ?? p.frp);
  const id = p.Id ?? p.id ?? feature?.id;
  return {
    id: String(id ?? `${lat.toFixed(4)},${lon.toFixed(4)},${tsMs}`),
    lat,
    lon,
    tsMs,
    frpMw: Number.isFinite(frp) ? frp : null,
    satellite: String(p.Satelite || p.satelite || 'GOES'),
  };
}

/** Whole FeatureCollection → { hotspots, newestMs } (dedupe by id, newest wins). */
export function normalizeHotspotCollection(collection) {
  const byId = new Map();
  for (const f of Array.isArray(collection?.features) ? collection.features : []) {
    const row = normalizeHotspot(f);
    if (!row) continue;
    const prev = byId.get(row.id);
    if (!prev || row.tsMs > prev.tsMs) byId.set(row.id, row);
  }
  const hotspots = Array.from(byId.values());
  const newestMs = hotspots.reduce((m, h) => (h.tsMs > m ? h.tsMs : m), 0);
  return { hotspots, newestMs };
}

/** Age bucket for styling: 0 = <1 h, 1 = <6 h, 2 = <24 h, 3 = older. */
export function hotspotAgeBucket(tsMs, nowMs = Date.now()) {
  const age = nowMs - (Number(tsMs) || 0);
  if (age < 60 * 60_000) return 0;
  if (age < 6 * 60 * 60_000) return 1;
  if (age < 24 * 60 * 60_000) return 2;
  return 3;
}

/** CSS color per age bucket (fresh = brightest). */
export const HOTSPOT_AGE_COLORS = Object.freeze(['#ff3b30', '#ff8c1a', '#b8641a', '#5c4a3a']);

/** Point size from fire radiative power (MW), 5..14 px. */
export function hotspotPixelSize(frpMw) {
  const frp = Number.isFinite(frpMw) ? Math.max(0, frpMw) : 20;
  return Math.max(5, Math.min(14, 5 + Math.sqrt(frp) * 0.6));
}
