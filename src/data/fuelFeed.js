/**
 * Secretaría de Energía "Precios en surtidor" (Res. 314/2016) — pure helpers
 * shared by the Vite proxy (CSV → station list) and the Fuel layer.
 *
 * Upstream CSV (datos.energia.gob.ar, CC-BY): one row per station × product ×
 * schedule with `latitud, longitud, precio, fecha_vigencia, empresabandera…`.
 * Rows carry each station's LAST reported price, so dates vary per station.
 */

export const FUEL_API_URL = '/api/energia/fuel-prices';
export const FUEL_POLL_MS = 60 * 60_000;
export const FUEL_MAX_AGE_DAYS = 400;

/** Minimal RFC-4180 CSV parser (quotes, embedded commas/newlines). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Product id / name → short label used on the map. */
export function productLabel(idproducto, producto = '') {
  const id = String(idproducto || '').trim();
  const name = String(producto || '').toLowerCase();
  if (id === '2' || /s[uú]per/.test(name)) return 'SUPER';
  if (id === '3' || /premium|m[aá]s de 95/.test(name)) return 'PREMIUM';
  if (id === '19' || /grado 2/.test(name)) return 'DIESEL';
  if (id === '21' || /grado 3/.test(name)) return 'DIESEL+';
  if (id === '6' || /gnc/.test(name)) return 'GNC';
  return name ? name.toUpperCase().slice(0, 12) : `P${id}`;
}

export const PRODUCT_ORDER = Object.freeze(['SUPER', 'PREMIUM', 'DIESEL', 'DIESEL+', 'GNC']);

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** "2026-05-01 12:43:00" (local) → epoch ms. */
export function parseVigencia(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(text || '').trim());
  if (!m) return 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], (+(m[4] || 0)) + 3, +(m[5] || 0));
}

/**
 * Reduce parsed CSV rows to one record per station with its latest price per
 * product (daytime schedule preferred). Drops rows older than `maxAgeDays`.
 * @returns {{ stations: object[], newestMs: number, period: string }}
 */
export function reduceStations(rows, { nowMs = Date.now(), maxAgeDays = FUEL_MAX_AGE_DAYS } = {}) {
  if (!rows.length) return { stations: [], newestMs: 0, period: '' };
  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const cIdEmp = col('idempresa'); const cEmp = col('empresa'); const cDir = col('direccion');
  const cLoc = col('localidad'); const cProv = col('provincia'); const cIdProd = col('idproducto');
  const cProd = col('producto'); const cHor = col('tipohorario'); const cPrecio = col('precio');
  const cVig = col('fecha_vigencia'); const cBand = col('empresabandera'); const cLat = col('latitud');
  const cLon = col('longitud'); const cPeriod = col('indice_tiempo');
  const minMs = nowMs - maxAgeDays * 86_400_000;
  const byStation = new Map();
  let newestMs = 0;
  let period = '';
  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    const lat = num(r[cLat]); const lon = num(r[cLon]); const price = num(r[cPrecio]);
    if (lat === null || lon === null || price === null || price <= 0) continue;
    if (lat < -56 || lat > -21 || lon < -74 || lon > -53) continue;
    const vigMs = parseVigencia(r[cVig]);
    if (vigMs && vigMs < minMs) continue;
    if (vigMs > newestMs) { newestMs = vigMs; period = String(r[cPeriod] || ''); }
    const key = String(r[cIdEmp] || `${lat.toFixed(5)},${lon.toFixed(5)}`);
    let st = byStation.get(key);
    if (!st) {
      st = {
        id: key,
        name: String(r[cEmp] || '').trim(),
        brand: String(r[cBand] || '').trim(),
        address: String(r[cDir] || '').trim(),
        locality: String(r[cLoc] || '').trim(),
        province: String(r[cProv] || '').trim(),
        lat,
        lon,
        prices: {},
        updatedMs: 0,
      };
      byStation.set(key, st);
    }
    const label = productLabel(r[cIdProd], r[cProd]);
    const daytime = /diurno/i.test(String(r[cHor] || ''));
    const prev = st.prices[label];
    const better = !prev || vigMs > prev.vigMs || (vigMs === prev.vigMs && daytime && !prev.daytime);
    if (better) st.prices[label] = { price, vigMs, daytime };
    if (vigMs > st.updatedMs) st.updatedMs = vigMs;
  }
  const stations = [];
  for (const st of byStation.values()) {
    const prices = {};
    for (const [label, rec] of Object.entries(st.prices)) prices[label] = rec.price;
    if (!Object.keys(prices).length) continue;
    stations.push({ ...st, prices });
  }
  return { stations, newestMs, period };
}

/** "$1.234" style label (ARS, no decimals). */
export function formatPrice(value) {
  if (!Number.isFinite(value)) return '—';
  return `$${Math.round(value).toLocaleString('es-AR')}`;
}

/** Headline price for a station: SUPER, else the first product in canonical order. */
export function headlinePrice(prices) {
  if (!prices || typeof prices !== 'object') return null;
  for (const label of PRODUCT_ORDER) {
    if (Number.isFinite(prices[label])) return { label, price: prices[label] };
  }
  const first = Object.entries(prices).find(([, v]) => Number.isFinite(v));
  return first ? { label: first[0], price: first[1] } : null;
}

/** Stable color per brand (CSS). */
export function brandColorCss(brand) {
  const b = String(brand || '').toUpperCase();
  if (/YPF/.test(b)) return '#3a7bd5';
  if (/SHELL/.test(b)) return '#ffcc00';
  if (/AXION/.test(b)) return '#c62828';
  if (/PUMA/.test(b)) return '#e65100';
  if (/GULF/.test(b)) return '#ff7f11';
  if (/REFINOR|DAPSA|VOY/.test(b)) return '#7cb342';
  return '#b0bec5';
}
