/**
 * Puerto de Buenos Aires — ship calls from the AGP "ePuertos" API. Pure
 * helpers shared by the Vite proxy and the layer.
 *
 *   GET https://api.agp-ports.gob.ar/api/giros/escalas?fechaIngresoDesde=YYYY-MM-DD&fechaIngresoHasta=YYYY-MM-DD&skip=0&take=100
 *   → { data: { totalCount, data: [{ id, estado, fechaETA, fechaETD, buque: { nombre, esloraMaxima, manga,
 *        tipoBuque: { nombre }, pais: { nombre, isoCode }, senalDistintiva }, agencia: { nombre },
 *        puertos: [{ ciudad: { nombre }, tipo: 'O'|'D' }], movimientos: [{ fechaETA, fechaETD, muelle: { nombre, latitud, longitud }, terminal }] }] } }
 */

export const AGP_API_URL = '/api/agp/escalas';
export const AGP_POLL_MS = 5 * 60_000;

export const CALL_STATUS_COLORS = Object.freeze({
  operando: '#4cd964',
  demorado: '#ff9f43',
  proximo: '#5aa9ff',
  finalizado: '#8a8f98',
  otro: '#c0c8d0',
});

export function statusKind(text) {
  const s = String(text || '').toLowerCase();
  if (/operand|atracad|en puerto/.test(s)) return 'operando';
  if (/demor/.test(s)) return 'demorado';
  if (/prox|previst|program/.test(s)) return 'proximo';
  if (/final|zarp|salid/.test(s)) return 'finalizado';
  return 'otro';
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function ms(v) { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; }

/** Normalize one call; null when no berth coordinates are known. */
export function normalizeCall(row) {
  if (!row || typeof row !== 'object') return null;
  const moves = Array.isArray(row.movimientos) ? row.movimientos : [];
  const withBerth = moves.find((m) => num(m?.muelle?.latitud) !== null && num(m?.muelle?.longitud) !== null);
  if (!withBerth) return null;
  const berth = withBerth.muelle;
  const ship = row.buque || {};
  const ports = Array.isArray(row.puertos) ? row.puertos : [];
  const origin = ports.find((p) => String(p?.tipo).toUpperCase() === 'O')?.ciudad?.nombre || '';
  const destination = ports.find((p) => String(p?.tipo).toUpperCase() === 'D')?.ciudad?.nombre || '';
  return {
    id: String(row.id),
    name: String(ship.nombre || 'BUQUE').trim(),
    type: String(ship.tipoBuque?.nombre || '').trim(),
    flag: String(ship.pais?.nombre || '').trim(),
    flagIso: String(ship.pais?.isoCode || '').trim(),
    callSign: String(ship.senalDistintiva || '').trim(),
    loaM: num(ship.esloraMaxima),
    beamM: num(ship.manga),
    status: String(row.estado || '').trim(),
    kind: statusKind(row.estado),
    etaMs: ms(withBerth.fechaETA || row.fechaETA),
    etdMs: ms(withBerth.fechaETD || row.fechaETD),
    berth: String(berth.nombre || '').trim(),
    terminal: String(withBerth.terminal?.nombre || withBerth.terminal || '').trim(),
    agency: String(row.agencia?.nombre || '').trim(),
    origin,
    destination,
    lat: num(berth.latitud),
    lon: num(berth.longitud),
  };
}

export function normalizeCalls(body) {
  const rows = Array.isArray(body?.data?.data) ? body.data.data : (Array.isArray(body?.data) ? body.data : (Array.isArray(body) ? body : []));
  const out = [];
  for (const row of rows) {
    const c = normalizeCall(row);
    if (c && c.kind !== 'finalizado') out.push(c);
  }
  return out;
}

/** Date window (YYYY-MM-DD) around now for the upstream query. */
export function callWindow(nowMs = Date.now(), daysBack = 3, daysAhead = 7) {
  const fmt = (t) => new Date(t).toISOString().slice(0, 10);
  return { from: fmt(nowMs - daysBack * 86_400_000), to: fmt(nowMs + daysAhead * 86_400_000) };
}

/** "14/09 10:00" */
export function shortDateTime(t) {
  if (!t) return '';
  const d = new Date(t);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
