/**
 * CAMMESA (Argentine wholesale electricity market operator) real-time grid
 * feed — pure helpers shared by the Vite proxy and the Grid layer.
 *
 * Upstream (keyless, JSON, 5-minute samples for the current day):
 *   https://api.cammesa.com/demanda-svc/demanda/ObtieneDemandaYTemperaturaRegion?id_region=<id>
 *     → [{ fecha, demHoy, demAyer, demSemanaAnt, demPrevista, tempHoy, ... }]
 *   https://api.cammesa.com/demanda-svc/generacion/ObtieneGeneracioEnergiaPorRegion?id_region=1002
 *     → [{ fecha, sumTotal, hidraulico, termico, nuclear, renovable, importacion }]
 * Region ids come from /demanda/RegionesDemanda (checked 2026-09-09).
 */

export const CAMMESA_API_URL = '/api/cammesa/grid';
export const CAMMESA_POLL_MS = 5 * 60_000;
export const CAMMESA_TOTAL_REGION_ID = 1002;

/** Demand regions with a hand-placed display anchor (approximate centroid). */
export const CAMMESA_REGIONS = Object.freeze([
  Object.freeze({ id: 426, name: 'GBA', lat: -34.62, lon: -58.55 }),
  Object.freeze({ id: 425, name: 'Buenos Aires', lat: -36.9, lon: -60.6 }),
  Object.freeze({ id: 417, name: 'Litoral', lat: -31.6, lon: -60.4 }),
  Object.freeze({ id: 422, name: 'Centro', lat: -31.9, lon: -64.3 }),
  Object.freeze({ id: 429, name: 'Cuyo', lat: -32.9, lon: -68.7 }),
  Object.freeze({ id: 418, name: 'NEA', lat: -27.2, lon: -58.6 }),
  Object.freeze({ id: 419, name: 'NOA', lat: -26.6, lon: -65.3 }),
  Object.freeze({ id: 420, name: 'Comahue', lat: -39.0, lon: -68.1 }),
  Object.freeze({ id: 111, name: 'Patagonia', lat: -46.6, lon: -68.5 }),
]);

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function atMs(value) {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? t : 0;
}

/** Latest sample of a demand series that carries a real demand value. */
export function latestDemandPoint(series) {
  if (!Array.isArray(series)) return null;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const row = series[i];
    const demand = num(row?.demHoy);
    if (demand === null) continue;
    return {
      atMs: atMs(row.fecha),
      demandMw: demand,
      forecastMw: num(row.demPrevista),
      yesterdayMw: num(row.demAyer),
      lastWeekMw: num(row.demSemanaAnt),
      tempC: num(row.tempHoy),
    };
  }
  return null;
}

/** Latest sample of the generation-mix series with a total. */
export function latestGenerationPoint(series) {
  if (!Array.isArray(series)) return null;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const row = series[i];
    const total = num(row?.sumTotal);
    if (total === null) continue;
    return {
      atMs: atMs(row.fecha),
      totalMw: total,
      hydroMw: num(row.hidraulico),
      thermalMw: num(row.termico),
      nuclearMw: num(row.nuclear),
      renewableMw: num(row.renovable),
      importMw: num(row.importacion),
    };
  }
  return null;
}

/** Peak demand of the day so far (for bubble scaling context). */
export function peakDemand(series) {
  if (!Array.isArray(series)) return null;
  let peak = null;
  for (const row of series) {
    const d = num(row?.demHoy);
    if (d !== null && (peak === null || d > peak)) peak = d;
  }
  return peak;
}

/** Validate the proxy payload shape on the client; returns null if unusable. */
export function normalizeGridPayload(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.regions)) return null;
  const regions = [];
  for (const r of payload.regions) {
    const lat = num(r?.lat); const lon = num(r?.lon); const demand = num(r?.demandMw);
    if (lat === null || lon === null || demand === null) continue;
    regions.push({
      id: String(r.id),
      name: String(r.name || r.id),
      lat,
      lon,
      demandMw: demand,
      forecastMw: num(r.forecastMw),
      yesterdayMw: num(r.yesterdayMw),
      lastWeekMw: num(r.lastWeekMw),
      tempC: num(r.tempC),
      peakMw: num(r.peakMw),
      atMs: num(r.atMs) || 0,
    });
  }
  const total = payload.total && typeof payload.total === 'object' ? payload.total : null;
  return {
    generatedAt: num(payload.generatedAt) || Date.now(),
    regions,
    total: total ? {
      demandMw: num(total.demandMw),
      forecastMw: num(total.forecastMw),
      yesterdayMw: num(total.yesterdayMw),
      peakMw: num(total.peakMw),
      atMs: num(total.atMs) || 0,
      generation: total.generation && typeof total.generation === 'object' ? {
        totalMw: num(total.generation.totalMw),
        hydroMw: num(total.generation.hydroMw),
        thermalMw: num(total.generation.thermalMw),
        nuclearMw: num(total.generation.nuclearMw),
        renewableMw: num(total.generation.renewableMw),
        importMw: num(total.generation.importMw),
      } : null,
    } : null,
  };
}

/** "5097" → "5.1 GW"; "795" → "795 MW". */
export function formatMw(mw) {
  if (!Number.isFinite(mw)) return '—';
  if (Math.abs(mw) >= 1000) return `${(mw / 1000).toFixed(1)} GW`;
  return `${Math.round(mw)} MW`;
}

/** Share of a generation source in percent, rounded. */
export function sharePct(part, total) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null;
  return Math.round((part / total) * 100);
}
