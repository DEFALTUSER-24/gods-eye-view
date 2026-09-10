/**
 * Subte de Buenos Aires — pure helpers shared by the Vite proxy and the layer.
 *
 * Upstream (keyless, epok = Mapa Interactivo BA backend):
 *   https://epok.buenosaires.gob.ar/getGeoLayer/?categoria=estaciones_de_subte&formato=geojson&srid=4326
 *     → Point features { Id, Nombre, Linea, Estado }
 *   https://epok.buenosaires.gob.ar/getGeoLayer/?categoria=lineas_de_subte&geometria=lineas&formato=geojson&srid=4326
 *     → MultiLineString features { Id, Nombre, Linea, Estado }
 * `Estado` is "Normal" or free text such as "Estación Tribunales cerrada por obras".
 */

export const SUBTE_API_URL = '/api/epok/subte';
export const SUBTE_POLL_MS = 5 * 60_000;

export const SUBTE_LINE_COLORS = Object.freeze({
  A: '#18b7d6',
  B: '#ee3124',
  C: '#0a6cb5',
  D: '#00933a',
  E: '#7b3f98',
  H: '#f9b900',
  P: '#9e9e9e', // Premetro
});

export function lineColor(line) {
  const key = String(line || '').trim().toUpperCase();
  return SUBTE_LINE_COLORS[key] || '#b0bec5';
}

/** "Normal" (any case/whitespace) → true; anything else is an incident text. */
export function statusIsNormal(text) {
  return /^\s*normal\s*\.?\s*$/i.test(String(text || ''));
}

function fold(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * epok repeats the LINE notice on every station of that line ("Estación
 * Tribunales cerrada…" on all 16 stations of D). A station is only "not ok"
 * when the notice names it; otherwise it inherits a line-level notice.
 */
export function noticeMentionsStation(status, name) {
  const n = fold(name).replace(/[^a-z0-9 ]+/g, ' ').trim();
  if (!n) return false;
  const s = fold(status);
  const first = n.split(' ').filter((w) => w.length > 3)[0] || n;
  return s.includes(n) || s.includes(first);
}

export function normalizeStation(feature) {
  const p = feature?.properties || {};
  const [lon, lat] = feature?.geometry?.coordinates || [];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const status = String(p.Estado || '').trim();
  const name = String(p.Nombre || '').trim();
  const normal = statusIsNormal(status);
  return {
    id: String(feature.id || p.Id || `${p.Linea}-${p.Nombre}`),
    name,
    line: String(p.Linea || '').trim().toUpperCase(),
    status,
    ok: normal || !noticeMentionsStation(status, name),
    lineNotice: normal ? '' : status,
    lat,
    lon,
  };
}

export function normalizeLine(feature) {
  const p = feature?.properties || {};
  const g = feature?.geometry;
  if (!g) return null;
  const parts = g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
  const coordinates = parts.filter((part) => Array.isArray(part) && part.length >= 2);
  if (!coordinates.length) return null;
  const status = String(p.Estado || '').trim();
  return {
    id: String(feature.id || p.Id || p.Linea),
    name: String(p.Nombre || `Línea ${p.Linea}`).trim(),
    line: String(p.Linea || '').trim().toUpperCase(),
    status,
    ok: statusIsNormal(status),
    coordinates,
  };
}

/** Both collections → { stations, lines, incidents } */
export function normalizeSubte(stationsCollection, linesCollection) {
  const stations = (stationsCollection?.features || []).map(normalizeStation).filter(Boolean);
  const lines = (linesCollection?.features || []).map(normalizeLine).filter(Boolean);
  // One notice per line (the station copies are the same text), plus any
  // station-specific notice that differs from its line's.
  const lineNotice = new Map(lines.filter((l) => !l.ok).map((l) => [l.line, l.status]));
  const incidents = lines.filter((l) => !l.ok).map((l) => `Línea ${l.line}: ${l.status}`);
  for (const s of stations) {
    if (s.ok || !s.status || lineNotice.get(s.line) === s.status) continue;
    incidents.push(`${s.name} (${s.line}): ${s.status}`);
  }
  return { stations, lines, incidents: Array.from(new Set(incidents)) };
}
