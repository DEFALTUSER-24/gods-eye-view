/**
 * Buenos Aires "API Transporte" bus positions → normalized vehicle rows.
 * Pure helpers shared by the Vite proxy (server) and the Colectivos layer (client).
 *
 * Upstream: https://apitransporte.buenosaires.gob.ar
 *   GET /colectivos/vehiclePositionsSimple?client_id=…&client_secret=…
 *     → JSON array of { id, route_id, route_short_name, latitude, longitude,
 *                       speed, direction, timestamp, agency_name, agency_id,
 *                       trip_headsign, tip_id }
 *   GET /colectivos/vehiclePositions?json=1&client_id=…&client_secret=…
 *     → GTFS-Realtime FeedMessage as JSON (entity[].vehicle.position…)
 * Both shapes are accepted here so a change upstream degrades gracefully.
 */

export const COLECTIVOS_API_URL = '/api/ba-colectivos';
export const BAHIA_COLECTIVOS_API_URL = '/api/bahia-colectivos';
export const COLECTIVOS_POLL_MS = 30_000;

/** Named bounding boxes (generous). Rows outside are dropped as GPS noise. */
export const COLECTIVOS_BOUNDS = Object.freeze({
  amba: Object.freeze({ latMin: -35.4, latMax: -34.2, lonMin: -59.2, lonMax: -57.8 }),
  'bahia-blanca': Object.freeze({ latMin: -39.1, latMax: -38.4, lonMin: -62.7, lonMax: -61.9 }),
});

function num(value) {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function text(value, max = 80) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function tsToMs(value) {
  if (value === null || value === undefined || value === '') return 0;
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    return n > 1e12 ? n : n * 1000; // seconds vs milliseconds
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Normalize one "simple" row. Returns null when unusable. */
export function normalizeSimpleRow(row, { bounds = 'amba' } = {}) {
  if (!row || typeof row !== 'object') return null;
  const lat = num(row.latitude ?? row.lat);
  const lon = num(row.longitude ?? row.lon ?? row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const box = typeof bounds === 'string' ? COLECTIVOS_BOUNDS[bounds] : bounds;
  if (box && (lat < box.latMin || lat > box.latMax || lon < box.lonMin || lon > box.lonMax)) return null;
  const id = text(row.id ?? row.vehicle_id ?? row.vehicleId, 40);
  if (!id) return null;
  const route = text(row.route_short_name ?? row.routeShortName ?? row.route_id ?? '', 24);
  const speed = num(row.speed);
  const dir = num(row.direction ?? row.bearing);
  return {
    id,
    route,
    routeId: text(row.route_id ?? row.routeId ?? '', 40),
    lat,
    lon,
    speedMps: Number.isFinite(speed) ? Math.max(0, speed) : NaN,
    headingDeg: Number.isFinite(dir) ? ((dir % 360) + 360) % 360 : NaN,
    tsMs: tsToMs(row.timestamp),
    agency: text(row.agency_name ?? row.agencyName ?? '', 60),
    agencyId: text(row.agency_id ?? row.agencyId ?? '', 20),
    headsign: text(row.trip_headsign ?? row.tripHeadsign ?? '', 80),
    tripId: text(row.trip_id ?? row.tip_id ?? '', 60),
    label: text(row.vehicle_label ?? row.label ?? '', 24),
  };
}

/** Normalize one GTFS-RT JSON entity ({ id, vehicle: { trip, position, vehicle, timestamp } }). */
export function normalizeGtfsRtEntity(entity, options) {
  const v = entity?.vehicle;
  if (!v || typeof v !== 'object') return null;
  const pos = v.position || {};
  return normalizeSimpleRow({
    id: v.vehicle?.id ?? v.vehicle?.label ?? entity.id,
    route_id: v.trip?.route_id ?? v.trip?.routeId,
    route_short_name: v.vehicle?.label && !/^\d{4,}$/.test(String(v.vehicle.label)) ? v.vehicle.label : undefined,
    latitude: pos.latitude,
    longitude: pos.longitude,
    speed: pos.speed,
    direction: pos.bearing,
    timestamp: v.timestamp,
    trip_id: v.trip?.trip_id ?? v.trip?.tripId,
  }, options);
}

/**
 * Accept either upstream body shape and return { vehicles, generatedAtMs }.
 * @param {unknown} body parsed JSON
 * @param {{bounds?: string|object}} [options] bounding box name (default AMBA)
 */
export function normalizeColectivosBody(body, options = {}) {
  let rows = [];
  let generatedAtMs = 0;
  const simple = (row) => normalizeSimpleRow(row, options);
  if (Array.isArray(body)) {
    rows = body.map(simple);
  } else if (body && typeof body === 'object') {
    if (Array.isArray(body.entity)) {
      rows = body.entity.map((e) => normalizeGtfsRtEntity(e, options));
      generatedAtMs = tsToMs(body.header?.timestamp);
    } else if (Array.isArray(body.vehicles)) {
      rows = body.vehicles.map(simple);
      generatedAtMs = tsToMs(body.generatedAt ?? body.timestamp);
    } else if (Array.isArray(body.data)) {
      rows = body.data.map(simple);
    }
  }
  const byId = new Map();
  for (const row of rows) {
    if (!row) continue;
    const prev = byId.get(row.id);
    if (!prev || row.tsMs >= prev.tsMs) byId.set(row.id, row);
  }
  const vehicles = Array.from(byId.values());
  if (!generatedAtMs) {
    generatedAtMs = vehicles.reduce((max, r) => (r.tsMs > max ? r.tsMs : max), 0) || Date.now();
  }
  return { vehicles, generatedAtMs };
}

/** Stable pastel-ish color per route so a line keeps its color across polls. */
export function routeColorHsl(route) {
  const s = String(route || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return { h: h % 360, s: 0.75, l: 0.58 };
}
