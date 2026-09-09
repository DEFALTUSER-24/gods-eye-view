/**
 * INA "a5" hydrology API (Instituto Nacional del Agua, Argentina) — pure
 * helpers shared by the Vite proxy and the river-levels layer.
 *
 * Upstream (keyless, slow: 1–30 s):
 *   GET https://alerta.ina.gob.ar/a5/obs/puntual/series?var_id=2&proc_id=1&date_range_after=<iso>
 *     → { rows: [{ id, estacion: { nombre, rio, provincia, geom: {coordinates:[lon,lat]},
 *          nivel_alerta, nivel_evacuacion, nivel_aguas_bajas, cero_ign, propietario, red: {nombre} },
 *          unidades: { abrev: "m" }, date_range: { timeend } }] }
 *   GET https://alerta.ina.gob.ar/a5/obs/puntual/observaciones?series_id=1,2,…&timestart=<iso>&timeend=<iso>
 *     → [{ series_id, timestart (UTC, Z), valor }]
 * var_id=2 = gage height in metres above the local staff zero; proc_id=1 = observed.
 */

export const INA_API_URL = '/api/ina/rivers';
export const INA_POLL_MS = 15 * 60_000;

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** List-endpoint timestamps without a zone are Argentina local (UTC−3). */
export function parseInaTime(text) {
  const s = String(text || '').trim();
  if (!s) return 0;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(s)) return Date.parse(s) || 0;
  const t = Date.parse(`${s}-03:00`);
  return Number.isFinite(t) ? t : 0;
}

/** Normalize one `series` row into a station record; null when it has no position. */
export function normalizeSeriesRow(row) {
  const st = row?.estacion || {};
  const coords = st.geom?.coordinates;
  const lon = num(Array.isArray(coords) ? coords[0] : null);
  const lat = num(Array.isArray(coords) ? coords[1] : null);
  const seriesId = num(row?.id);
  if (seriesId === null || lon === null || lat === null) return null;
  return {
    seriesId,
    stationId: num(st.id),
    name: String(st.nombre || `Serie ${seriesId}`).trim(),
    river: String(st.rio || '').trim(),
    province: String(st.provincia || '').trim(),
    owner: String(st.propietario || '').trim(),
    network: String(st.red?.nombre || '').trim(),
    lat,
    lon,
    alertM: num(st.nivel_alerta),
    evacM: num(st.nivel_evacuacion),
    lowM: num(st.nivel_aguas_bajas),
    zeroIgnM: num(st.cero_ign),
    unit: String(row?.unidades?.abrev || 'm'),
    lastObsMs: parseInaTime(row?.date_range?.timeend),
    valueM: null,
    valueMs: 0,
  };
}

export function normalizeSeriesRows(body) {
  const rows = Array.isArray(body?.rows) ? body.rows : (Array.isArray(body) ? body : []);
  const out = new Map();
  for (const row of rows) {
    const s = normalizeSeriesRow(row);
    if (s) out.set(s.seriesId, s);
  }
  return out;
}

/** Series ids whose last observation is newer than `sinceMs`. */
export function activeSeriesIds(stations, sinceMs) {
  const ids = [];
  for (const s of stations.values()) if (s.lastObsMs >= sinceMs) ids.push(s.seriesId);
  return ids;
}

/** Merge observation rows into stations: keep the newest value per series. */
export function mergeObservations(stations, observations) {
  let touched = 0;
  for (const obs of Array.isArray(observations) ? observations : []) {
    const id = num(obs?.series_id);
    const value = num(obs?.valor);
    const ms = parseInaTime(obs?.timestart);
    if (id === null || value === null || !ms) continue;
    const st = stations.get(id);
    if (!st) continue;
    if (ms >= st.valueMs) {
      st.valueM = value;
      st.valueMs = ms;
      if (ms > st.lastObsMs) st.lastObsMs = ms;
      touched += 1;
    }
  }
  return touched;
}

/** normal | watch (≥90 % of alert) | alert | evacuation | unknown. */
export function stationState(station) {
  const v = station?.valueM;
  if (!Number.isFinite(v)) return 'unknown';
  if (Number.isFinite(station.evacM) && v >= station.evacM) return 'evacuation';
  if (Number.isFinite(station.alertM)) {
    if (v >= station.alertM) return 'alert';
    if (v >= station.alertM * 0.9) return 'watch';
  }
  return 'normal';
}

export const STATE_COLORS = Object.freeze({
  evacuation: '#ff3b3b',
  alert: '#ff8c1a',
  watch: '#ffd23f',
  normal: '#4fa3ff',
  unknown: '#7d8794',
});

export const STATE_LABELS = Object.freeze({
  evacuation: 'EVACUACIÓN',
  alert: 'ALERTA',
  watch: 'VIGILANCIA',
  normal: 'NORMAL',
  unknown: 'SIN DATO',
});

/** Split ids into chunks (the upstream 60 s limit caps ~250 ids per 24 h query). */
export function chunkIds(ids, size = 230) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** "0.47 m" */
export function formatLevel(value, unit = 'm') {
  return Number.isFinite(value) ? `${value.toFixed(2)} ${unit}` : '—';
}

/** JSON-safe list for the proxy payload (only stations with a position). */
export function serializeStations(stations) {
  return Array.from(stations.values()).map((s) => ({ ...s, state: stationState(s) }));
}
