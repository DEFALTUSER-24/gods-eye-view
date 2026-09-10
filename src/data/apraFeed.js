/**
 * APrA (Agencia de Protección Ambiental, CABA) air-quality network — pure
 * helpers shared by the Vite proxy and the layer.
 *
 *   estaciones-ambientales.csv  (';'-separated, decimal comma):
 *     long;lat;nombre;direccion;inicio_de_actividad;zona_de_emplazamiento;...
 *   calidad_aire_<year>.csv (','-separated, hourly):
 *     fecha,hora,co_centenario,no2_centenario,pm10_centenario,co_cordoba,...,pm10_palermo
 *     values 's/d' = no data. CO in ppm, NO2 in ppb, PM10 in µg/m³.
 */

export const APRA_API_URL = '/api/apra/aire';
export const APRA_POLL_MS = 60 * 60_000;

function num(v) {
  const s = String(v ?? '').trim();
  if (!s || /^s\/?d$/i.test(s)) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Station name → column suffix ("LA BOCA" → "la_boca"). */
export function stationKey(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_');
}

/** Parse the ';' station list. */
export function parseStations(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = lines[0].split(';').map((h) => h.trim().toLowerCase());
  const col = (n) => header.indexOf(n);
  const out = [];
  for (const line of lines.slice(1)) {
    const c = line.split(';');
    const lon = num(c[col('long')]); const lat = num(c[col('lat')]);
    const name = String(c[col('nombre')] || '').trim();
    if (lon === null || lat === null || !name) continue;
    const zone = String(c[col('zona_de_emplazamiento')] || '').trim();
    out.push({
      id: stationKey(name),
      name,
      address: String(c[col('direccion')] || '').trim(),
      lat,
      lon,
      inactive: /desactivada/i.test(zone),
      params: String(c[col('parametrios_medidos')] || c[col('parametros_medidos')] || '').trim(),
    });
  }
  return out;
}

/**
 * Parse the hourly CSV and return the latest non-empty reading per station key.
 * @returns {Map<string, {atMs:number, co:number|null, no2:number|null, pm10:number|null}>}
 */
export function latestReadings(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const out = new Map();
  if (lines.length < 2) return out;
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const keys = new Set();
  for (const h of header) { const m = /^(co|no2|pm10)_(.+)$/.exec(h); if (m) keys.add(m[2]); }
  const idx = (name) => header.indexOf(name);
  for (let i = lines.length - 1; i >= 1; i -= 1) {
    const c = lines[i].split(',');
    const date = c[idx('fecha')]; const hour = Number(c[idx('hora')]);
    const atMs = Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00-03:00`);
    if (!Number.isFinite(atMs)) continue;
    for (const key of keys) {
      if (out.has(key)) continue;
      const co = num(c[idx(`co_${key}`)]); const no2 = num(c[idx(`no2_${key}`)]); const pm10 = num(c[idx(`pm10_${key}`)]);
      if (co === null && no2 === null && pm10 === null) continue;
      out.set(key, { atMs, co, no2, pm10 });
    }
    if (out.size === keys.size) break;
  }
  return out;
}

/** PM10 (µg/m³) → band per common daily guidance: good <50, moderate <100, bad <150, very bad. */
export function pm10Band(pm10) {
  if (!Number.isFinite(pm10)) return 'unknown';
  if (pm10 < 50) return 'good';
  if (pm10 < 100) return 'moderate';
  if (pm10 < 150) return 'bad';
  return 'verybad';
}

export const BAND_COLORS = Object.freeze({
  good: '#4cd964',
  moderate: '#ffd23f',
  bad: '#ff8c1a',
  verybad: '#ff3b3b',
  unknown: '#8a8f98',
});
export const BAND_LABELS = Object.freeze({
  good: 'BUENA', moderate: 'MODERADA', bad: 'MALA', verybad: 'MUY MALA', unknown: 'SIN DATO',
});

/** Join stations with readings → JSON-safe list. */
export function joinAirQuality(stations, readings) {
  return stations.map((s) => {
    const r = readings.get(s.id) || null;
    return {
      ...s,
      atMs: r?.atMs || 0,
      co: r?.co ?? null,
      no2: r?.no2 ?? null,
      pm10: r?.pm10 ?? null,
      band: r ? pm10Band(r.pm10) : 'unknown',
    };
  });
}
