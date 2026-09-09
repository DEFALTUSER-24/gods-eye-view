/**
 * SMN (Argentina) CAP 1.2 weather alerts — pure helpers shared by the Vite
 * proxy (index scrape + XML parse) and the layer. Browser-safe: regex only.
 *
 * Index: https://ssl.smn.gob.ar/CAP/AR.php (HTML, one .item per alert, link to
 *   https://ssl.smn.gob.ar/feeds/CAP/xml_generados/CAP_<stamp>_<Evento>_<Region>_alertas_alertas_<n>.xml)
 * Each XML: one <info> (es-AR) with event, severity, onset, expires, headline,
 * description, instruction and one <polygon> of "lat,lon lat,lon …".
 * <identifier> is NOT unique across files — key alerts by URL.
 */

export const SMN_ALERTS_API_URL = '/api/smn-alerts';
export const SMN_ALERTS_POLL_MS = 10 * 60_000;
export const SMN_CAP_INDEX_URL = 'https://ssl.smn.gob.ar/CAP/AR.php';

/** All CAP XML links in the index HTML (absolute, de-duplicated, in order). */
export function capIndexLinks(html) {
  const out = [];
  const seen = new Set();
  const re = /https?:\/\/ssl\.smn\.gob\.ar\/feeds\/CAP\/xml_generados\/[A-Za-z0-9_.-]+\.xml/g;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    if (!seen.has(m[0])) { seen.add(m[0]); out.push(m[0]); }
  }
  return out;
}

function tag(xml, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(xml);
  return m ? decodeEntities(m[1].trim()) : '';
}

export function decodeEntities(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

/** "lat,lon lat,lon …" → [[lon, lat], …] (closed ring dropped duplicate end). */
export function parseCapPolygon(text) {
  const ring = [];
  for (const pair of String(text || '').trim().split(/\s+/)) {
    const [latText, lonText] = pair.split(',');
    const lat = Number(latText); const lon = Number(lonText);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    ring.push([lon, lat]);
  }
  if (ring.length > 1) {
    const a = ring[0]; const b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) ring.pop();
  }
  return ring.length >= 3 ? ring : [];
}

/** Parse one CAP XML into a JSON-safe alert; null when it has no polygon. */
export function parseCapAlert(xml, url = '') {
  const info = tag(xml, 'info') || xml;
  const polygon = parseCapPolygon(tag(info, 'polygon'));
  if (!polygon.length) return null;
  const event = tag(info, 'event') || tag(info, 'headline') || 'Alerta';
  const onset = Date.parse(tag(info, 'onset') || tag(xml, 'sent')) || 0;
  const expires = Date.parse(tag(info, 'expires')) || 0;
  const centroid = polygon.reduce((acc, [lon, lat]) => [acc[0] + lon / polygon.length, acc[1] + lat / polygon.length], [0, 0]);
  return {
    id: url || tag(xml, 'identifier'),
    identifier: tag(xml, 'identifier'),
    sentMs: Date.parse(tag(xml, 'sent')) || 0,
    msgType: tag(xml, 'msgType'),
    event,
    kind: eventKind(event, tag(info, 'description')),
    severity: tag(info, 'severity'),
    urgency: tag(info, 'urgency'),
    certainty: tag(info, 'certainty'),
    onsetMs: onset,
    expiresMs: expires,
    headline: tag(info, 'headline'),
    description: tag(info, 'description'),
    instruction: tag(info, 'instruction'),
    areaDesc: tag(info, 'areaDesc'),
    polygon,
    centroid: [Number(centroid[0].toFixed(4)), Number(centroid[1].toFixed(4))],
  };
}

/** Event → styling family. */
export function eventKind(event, description = '') {
  const e = String(event || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/zonda/.test(e)) return 'zonda';
  if (/viento/.test(e)) return 'viento';
  if (/tormenta/.test(e)) return 'tormentas';
  if (/lluvia/.test(e)) return 'lluvias';
  if (/nevada|nieve/.test(e)) return 'nevadas';
  if (/calor/.test(e)) return 'calor';
  if (/frio/.test(e)) return 'frio';
  if (/niebla/.test(e)) return 'niebla';
  if (/ceniza/.test(e)) return 'cenizas';
  return 'otro';
}

export const EVENT_COLORS = Object.freeze({
  tormentas: '#b388ff',
  lluvias: '#4fa3ff',
  viento: '#4dd0e1',
  zonda: '#ff9e40',
  nevadas: '#e8f1ff',
  calor: '#ff5252',
  frio: '#80d8ff',
  niebla: '#cfd8dc',
  cenizas: '#a1887f',
  otro: '#ffd54f',
});

/** Yellow/orange/red level, inferred from the description text (severity is always "Moderate"). */
export function alertLevel(description) {
  const d = String(description || '').toLowerCase();
  if (/nivel rojo|rojo/.test(d)) return 'rojo';
  if (/nivel naranja|naranja/.test(d)) return 'naranja';
  if (/nivel amarillo|amarillo/.test(d)) return 'amarillo';
  return '';
}

/** Keep alerts that have not expired (plus a small grace window). */
export function activeAlerts(alerts, nowMs = Date.now(), graceMs = 30 * 60_000) {
  return (alerts || []).filter((a) => !a.expiresMs || a.expiresMs + graceMs > nowMs);
}

/** "vie 11 09:00–14:59" style window for cards. */
export function alertWindowText(onsetMs, expiresMs) {
  const fmt = (ms, withDay) => {
    if (!ms) return '';
    const d = new Date(ms);
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return withDay ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hm}` : hm;
  };
  const sameDay = onsetMs && expiresMs && new Date(onsetMs).toDateString() === new Date(expiresMs).toDateString();
  return `${fmt(onsetMs, true)}${expiresMs ? `–${fmt(expiresMs, !sameDay)}` : ''}`;
}
