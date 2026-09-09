/**
 * Estado de rutas nacionales — pure helpers shared by the Vite proxy and the
 * layer. Status comes from rutas.ar (a public scrape of Vialidad Nacional's
 * "Estado de rutas"), geometry from the bundled Vialidad network.
 *
 *   GET https://rutas.ar/api/estado → [{ tramo_id, ruta, provincia, nombre_tramo,
 *       calzada, extension_km, estado_raw, estado_color, observaciones,
 *       conoce_mas_url, source_updated, scraped_at }]
 */

export const RUTAS_API_URL = '/api/rutas/estado';
export const RUTAS_POLL_MS = 10 * 60_000;

/** rutas.ar "A-001" / "A005" / "0003" / "1v03" → "A1" / "A5" / "3" / "1V03". */
export function normalizeRouteKey(value) {
  let s = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  s = s.replace(/^RN/, '');
  const m = /^([A-Z]*)-?0*(\d+)([A-Z0-9]*)$/.exec(s);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  return s;
}

/** Accent/case-insensitive province key. */
export function provinceKey(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export const STATUS_PRIORITY = Object.freeze({ red: 4, yellow: 3, blue: 2, green: 1, gray: 0 });
export const STATUS_COLORS = Object.freeze({
  red: '#ff4d4d',
  yellow: '#ffd23f',
  blue: '#5aa9ff',
  green: '#4cd964',
  gray: '#8a8f98',
});
export const STATUS_LABELS = Object.freeze({
  red: 'CORTE TOTAL',
  yellow: 'CORTE PARCIAL',
  blue: 'RESTRINGIDA',
  green: 'HABILITADA',
  gray: 'SIN DATO',
});

function colorOf(raw, colorHint) {
  const hint = String(colorHint || '').toLowerCase();
  if (hint in STATUS_COLORS) return hint;
  const text = String(raw || '').toUpperCase();
  if (/CORTE TOTAL|INTRANSITABLE/.test(text)) return 'red';
  if (/CORTE PARCIAL|PRECAUCI/.test(text)) return 'yellow';
  if (/RESTRING/.test(text)) return 'blue';
  if (/HABILIT/.test(text)) return 'green';
  return 'gray';
}

/** Normalize one rutas.ar tramo; null when unusable. */
export function normalizeTramo(row) {
  if (!row || typeof row !== 'object') return null;
  const ruta = normalizeRouteKey(row.ruta);
  const provincia = String(row.provincia || '').trim();
  if (!ruta || !provincia) return null;
  return {
    id: String(row.tramo_id ?? `${ruta}|${provincia}|${row.nombre_tramo || ''}`),
    ruta,
    routeLabel: String(row.ruta || '').trim(),
    provincia,
    key: `${ruta}|${provinceKey(provincia)}`,
    name: String(row.nombre_tramo || '').trim(),
    surface: String(row.calzada || '').trim(),
    lengthKm: Number(row.extension_km) || null,
    status: String(row.estado_raw || '').trim() || 'SIN DATO',
    color: colorOf(row.estado_raw, row.estado_color),
    notes: String(row.observaciones || '').trim(),
    moreUrl: String(row.conoce_mas_url || '').trim(),
    sourceUpdated: String(row.source_updated || '').trim(),
  };
}

export function normalizeTramos(body) {
  const rows = Array.isArray(body) ? body : (Array.isArray(body?.tramos) ? body.tramos : []);
  const out = [];
  for (const row of rows) {
    const t = normalizeTramo(row);
    if (t) out.push(t);
  }
  return out;
}

/**
 * Per route-in-province summary: worst color, counts, the non-green tramos.
 * @returns {Map<string, {color, total, incidents: object[]}>}
 */
export function summarizeByRoute(tramos) {
  const map = new Map();
  for (const t of tramos) {
    let s = map.get(t.key);
    if (!s) { s = { color: 'gray', total: 0, incidents: [] }; map.set(t.key, s); }
    s.total += 1;
    if (STATUS_PRIORITY[t.color] > STATUS_PRIORITY[s.color]) s.color = t.color;
    if (t.color !== 'green' && t.color !== 'gray') s.incidents.push(t);
  }
  return map;
}
