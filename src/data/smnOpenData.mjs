/**
 * SMN (Servicio Meteorológico Nacional, Argentina) open data — server-side
 * helpers. Node-only (.mjs): the Vite proxy uses these; the browser layer
 * consumes the normalized JSON from /api/smn/observations.
 *
 * Sources (keyless, Latin-1 text inside a ZIP):
 *   https://ssl.smn.gob.ar/dpd/zipopendata.php?dato=tiepre      current weather
 *   https://ssl.smn.gob.ar/dpd/zipopendata.php?dato=estaciones  station list
 *
 * tiepre line:  Name;DD-month-YYYY;HH:MM;sky;visibility;tempC;feelsC;humidity;WindDir  kmh;pressure /
 * estaciones:   fixed-width NAME(31) PROVINCE(39) latDeg latMin lonDeg lonMin altM wmo icao
 */
import { inflateRawSync } from 'node:zlib';

export const SMN_TIEPRE_URL = 'https://ssl.smn.gob.ar/dpd/zipopendata.php?dato=tiepre';
export const SMN_ESTACIONES_URL = 'https://ssl.smn.gob.ar/dpd/zipopendata.php?dato=estaciones';

/**
 * Minimal ZIP reader: returns the first entry's bytes (stored or deflated).
 * Walks the central directory so data-descriptor entries work too.
 * @param {Buffer} buf
 * @returns {{ name: string, data: Buffer }|null}
 */
export function readFirstZipEntry(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return null;
  // End of central directory (0x06054b50), scanned backwards (comment may follow).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset + 46 > buf.length || buf.readUInt32LE(cdOffset) !== 0x02014b50) return null;
  const method = buf.readUInt16LE(cdOffset + 10);
  const compSize = buf.readUInt32LE(cdOffset + 20);
  const nameLen = buf.readUInt16LE(cdOffset + 28);
  const extraLen = buf.readUInt16LE(cdOffset + 30);
  const commentLen = buf.readUInt16LE(cdOffset + 32);
  const localOffset = buf.readUInt32LE(cdOffset + 42);
  const name = buf.subarray(cdOffset + 46, cdOffset + 46 + nameLen).toString('latin1');
  void extraLen; void commentLen;
  if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) return null;
  const lNameLen = buf.readUInt16LE(localOffset + 26);
  const lExtraLen = buf.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + lNameLen + lExtraLen;
  const raw = buf.subarray(start, start + compSize);
  if (method === 0) return { name, data: Buffer.from(raw) };
  if (method === 8) return { name, data: inflateRawSync(raw) };
  return null;
}

/** Decode SMN Latin-1 text. */
export function decodeLatin1(bytes) {
  return Buffer.from(bytes).toString('latin1');
}

/** Accent/case-insensitive key for joining names across the two files. */
export function stationKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(aero|aeropuerto|aerodromo|base|estacion)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function num(value) {
  const n = parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const SPANISH_MONTHS = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

/** "09-septiembre-2026" + "02:00" (Argentina local, UTC-3) → epoch ms. */
export function parseSmnTimestamp(dateText, timeText) {
  const m = /^(\d{1,2})-([a-záéíóú]+)-(\d{4})$/i.exec(String(dateText || '').trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(String(timeText || '').trim());
  if (!m || !t) return 0;
  const month = SPANISH_MONTHS[m[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')];
  if (!month) return 0;
  return Date.UTC(Number(m[3]), month - 1, Number(m[1]), Number(t[1]) + 3, Number(t[2]));
}

const WIND_DIRS = {
  norte: 0, noreste: 45, este: 90, sudeste: 135, sureste: 135, sur: 180,
  sudoeste: 225, suroeste: 225, oeste: 270, noroeste: 315, calma: null,
};

/** "Noreste  11" → { dirDeg: 45, kmh: 11 }; "Calma" → { dirDeg: null, kmh: 0 }. */
export function parseWind(text) {
  const raw = String(text || '').trim();
  if (!raw) return { dirDeg: null, kmh: null, label: '' };
  const m = /^([A-Za-zÁÉÍÓÚáéíóú]+)\s*(\d+)?/.exec(raw);
  if (!m) return { dirDeg: null, kmh: null, label: raw };
  const key = m[1].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // "Direcciones variables  9" — no dominant direction.
  if (key.startsWith('direccion')) {
    const speed = /(\d+)\s*$/.exec(raw);
    return { dirDeg: null, kmh: speed ? Number(speed[1]) : null, label: 'Variable' };
  }
  const dirDeg = key in WIND_DIRS ? WIND_DIRS[key] : null;
  const kmh = key === 'calma' ? 0 : (m[2] !== undefined ? Number(m[2]) : null);
  return { dirDeg, kmh, label: m[1] };
}

/** Parse the tiepre text into observation rows (unjoined). */
export function parseTiepre(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const parts = line.split(';');
    if (parts.length < 9) continue;
    const name = parts[0].trim();
    if (!name) continue;
    const wind = parseWind(parts[8]);
    const pressure = num(String(parts[9] || '').replace('/', ''));
    rows.push({
      name,
      key: stationKey(name),
      observedAt: parseSmnTimestamp(parts[1], parts[2]),
      sky: parts[3].trim(),
      visibility: parts[4].trim(),
      tempC: num(parts[5]),
      feelsC: num(parts[6]),
      humidity: num(parts[7]),
      windDirDeg: wind.dirDeg,
      windKmh: wind.kmh,
      windLabel: wind.label,
      pressureHpa: pressure,
    });
  }
  return rows;
}

/** Parse the fixed-width station list into { key, name, province, lat, lon, elevM, wmo, icao }. */
export function parseEstaciones(text) {
  const out = [];
  const tail = /(-?\d+)\s+(\d+)\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s+(\d+)\s*([A-Z0-9]*)\s*$/;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim() || /^NOMBRE|^\s*\[gr\]/.test(line)) continue;
    const m = tail.exec(line);
    if (!m) continue;
    const head = line.slice(0, m.index);
    const name = head.slice(0, 31).trim();
    const province = head.slice(31).trim();
    if (!name) continue;
    const latDeg = Number(m[1]); const latMin = Number(m[2]);
    const lonDeg = Number(m[3]); const lonMin = Number(m[4]);
    const lat = latDeg < 0 || Object.is(latDeg, -0) ? latDeg - latMin / 60 : latDeg + latMin / 60;
    const lon = lonDeg < 0 || Object.is(lonDeg, -0) ? lonDeg - lonMin / 60 : lonDeg + lonMin / 60;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      key: stationKey(name),
      name,
      province,
      lat,
      lon,
      elevM: Number(m[5]),
      wmo: m[6],
      icao: m[7] || '',
    });
  }
  return out;
}

/**
 * Join observations to station coordinates. Unmatched observations are
 * dropped (no position → nothing to draw). Returns JSON-safe rows.
 */
export function joinObservations(observations, stations) {
  const byKey = new Map();
  for (const s of stations) byKey.set(s.key, s);
  const out = [];
  for (const obs of observations) {
    let st = byKey.get(obs.key);
    if (!st) {
      // Fallback: station name contained in observation name or vice versa.
      for (const cand of stations) {
        if (cand.key && (obs.key.includes(cand.key) || cand.key.includes(obs.key))) { st = cand; break; }
      }
    }
    if (!st) continue;
    out.push({
      id: st.wmo || st.key,
      name: st.name,
      province: st.province,
      lat: st.lat,
      lon: st.lon,
      elevM: st.elevM,
      icao: st.icao,
      observedAt: obs.observedAt,
      sky: obs.sky,
      visibility: obs.visibility,
      tempC: obs.tempC,
      feelsC: obs.feelsC,
      humidity: obs.humidity,
      windDirDeg: obs.windDirDeg,
      windKmh: obs.windKmh,
      windLabel: obs.windLabel,
      pressureHpa: obs.pressureHpa,
    });
  }
  return out;
}
