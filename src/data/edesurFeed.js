/**
 * Edesur (electricity distributor, south GBA + south CABA) outage report —
 * pure helpers shared by the Vite proxy and the layer.
 *
 * Upstream (keyless, undocumented — consumed by rsc.edesur.com.ar/outage-report.html):
 *   https://ed.edesur.com.ar/api/utils/outage-report
 *   → [{ fechaInicio: "10/09/2026 08:00:00", fechaFin, latitud, longitud, clientesAfectados,
 *        motivo, localidad, precauciones, estadoCorte: "Avisado" | "En curso" | ... }]
 */

export const EDESUR_API_URL = '/api/edesur/outages';
export const EDESUR_POLL_MS = 5 * 60_000;

/** "10/09/2026 08:00:00" (Argentina local, UTC-3) → epoch ms. */
export function parseEdesurDate(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(text || '').trim());
  if (!m) return 0;
  return Date.UTC(+m[3], +m[2] - 1, +m[1], (+(m[4] || 0)) + 3, +(m[5] || 0), +(m[6] || 0));
}

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Normalize one outage row; null when it has no usable coordinates. */
export function normalizeOutage(row, index = 0) {
  const lat = num(row?.latitud ?? row?.lat);
  const lon = num(row?.longitud ?? row?.lng ?? row?.lon);
  if (lat === null || lon === null || lat > -33 || lat < -36 || lon > -57 || lon < -60) return null;
  const startMs = parseEdesurDate(row?.fechaInicio);
  const endMs = parseEdesurDate(row?.fechaFin);
  const status = String(row?.estadoCorte || '').trim() || 'Sin estado';
  return {
    id: `${startMs}|${lat.toFixed(5)}|${lon.toFixed(5)}|${index}`,
    lat,
    lon,
    startMs,
    endMs,
    customers: Math.max(0, Math.round(num(row?.clientesAfectados) ?? 0)),
    reason: String(row?.motivo || '').trim(),
    locality: String(row?.localidad || '').trim(),
    precautions: String(row?.precauciones || '').trim(),
    status,
    active: /curso|activo|en ejec/i.test(status),
  };
}

export function normalizeOutages(body) {
  const rows = Array.isArray(body) ? body : (Array.isArray(body?.outages) ? body.outages : []);
  const out = [];
  rows.forEach((row, index) => {
    const o = normalizeOutage(row, index);
    if (o) out.push(o);
  });
  return out;
}

/** Bubble size from affected customers, 8..34 px. */
export function outagePixelSize(customers) {
  const c = Math.max(0, Number(customers) || 0);
  return Math.max(8, Math.min(34, 8 + Math.sqrt(c) * 0.55));
}

/** "10/09 08:00–16:00" for the card. */
export function outageWindowText(startMs, endMs) {
  const fmt = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const a = fmt(startMs);
  const b = endMs ? fmt(endMs).slice(6) : '';
  return b ? `${a}–${b}` : a;
}
