#!/usr/bin/env node
/**
 * Fetch the CABA + GBA open datasets bundled as local layers (round 2) and
 * rewrite them in the local-layer GeoJSONL shape.
 *
 *   node scripts/build-caba-static-layers.mjs [salud|bomberos|servicios|renabap|ciclovias|laplata|trenes]...
 *
 * Sources (all public, keyless, verified 2026-09-09):
 *   - epok.buenosaires.gob.ar (Mapa Interactivo BA backend): hospitals, CeSAC,
 *     fire stations, pharmacies, ATMs, taxi stands, terminals, antennas,
 *     museums, public wifi — GeoJSON WGS84, CC-BY GCBA.
 *   - catalogo.datos.gba.gob.ar CSVs: bomberos, establecimientos de salud
 *     públicos 2025, estaciones ferroviarias 08/2026 — CC-BY 4.0.
 *   - cdn.buenosaires.gob.ar ciclovias.geojson — CC-BY-2.5-AR.
 *   - geoportal.obraspublicas.gob.ar RENABAP 2020 polygons (AMBA bbox).
 *   - geoserver-nodo2.ideba.gba.gob.ar La Plata flood-risk streets.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../src/data/fuelFeed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = path.join(ROOT, 'src', 'data', 'local_data');
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; gods-eye-view-static-build/1.0)' };
const only = new Set(process.argv.slice(2));
const want = (name) => only.size === 0 || only.has(name);
const TODAY = new Date().toISOString().slice(0, 10);

async function getText(url, { insecure = false } = {}) {
  if (insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    if (insecure) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  }
}
const getJson = async (url, opts) => JSON.parse(await getText(url, opts));
const epok = (categoria) => getJson(`https://epok.buenosaires.gob.ar/getGeoLayer/?categoria=${categoria}&formato=geojson&srid=4326`);

function num(v) { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; }
function clean(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
function titleCase(s) { return clean(s).toLowerCase().replace(/(^|\s|\()(\S)/g, (m, a, b) => a + b.toUpperCase()); }

function point(id, lon, lat, tags, type) {
  return { type: 'Feature', id, geometry: { type: 'Point', coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))] }, properties: { id, name: tags.name, tags, type } };
}

function writeLayer(dir, features, readme) {
  mkdirSync(dir, { recursive: true });
  const base = path.basename(dir);
  writeFileSync(path.join(dir, `${base}.geojsonl`), features.map((f) => JSON.stringify(f)).join('\n') + '\n');
  writeFileSync(path.join(dir, 'README.md'), readme);
  console.log(`[${base}] ${features.length} features`);
}

// Douglas-Peucker (iterative) for lines and rings.
function perpDist(p, a, b) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function simplify(points, tol) {
  if (points.length <= 3) return points;
  const keep = new Uint8Array(points.length); keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop(); let maxD = 0; let idx = -1;
    for (let i = s + 1; i < e; i += 1) { const d = perpDist(points[i], points[s], points[e]); if (d > maxD) { maxD = d; idx = i; } }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return points.filter((_, i) => keep[i]);
}
const round5 = (c) => [Number(c[0].toFixed(5)), Number(c[1].toFixed(5))];

function epokPoints(collection, type, tagsOf) {
  const out = [];
  for (const f of collection?.features || []) {
    const [lon, lat] = f.geometry?.coordinates || [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = f.properties || {};
    out.push(point(String(f.id || p.Id || `${type}-${out.length}`), lon, lat, tagsOf(p), type));
  }
  return out;
}

// ── Salud: hospitales CABA (epok) + CeSAC + establecimientos PBA ─────────────
if (want('salud')) {
  const features = [];
  for (const [cat, kind] of [['hospitales_generales_de_agudos', 'Hospital general'], ['hospitales_especializados', 'Hospital especializado'], ['hospitales_de_ninos', 'Hospital de niños'], ['centros_de_salud_y_accion_comunitaria', 'CeSAC']]) {
    features.push(...epokPoints(await epok(cat), 'hospital', (p) => ({ name: clean(p.Nombre), healthcare: kind, jurisdiction: 'CABA', barrio: clean(p.Barrio), comuna: clean(p.Comuna) })));
  }
  const rows = parseCsv(await getText('https://catalogo.datos.gba.gob.ar/dataset/91743f68-bc82-4475-baca-7d5d6908eee8/resource/c52f9497-9eab-4ecd-a382-b4e4c6033a02/download/establecimientos_salud_publicos-2025.csv'));
  // ';' separated: the parser yields one column; split manually.
  const header = rows[0][0].replace(/^﻿/, '').split(';');
  const col = (n) => header.indexOf(n);
  let pba = 0;
  for (const r of rows.slice(1)) {
    const c = r.join(',').split(';');
    const lat = num(c[col('lat')]); const lon = num(c[col('long')]);
    if (lat === null || lon === null || lat > -33 || lat < -41 || lon > -56 || lon < -64) continue;
    features.push(point(`pba-salud-${c[col('id')]}`, lon, lat, {
      name: titleCase(c[col('nor')]),
      healthcare: titleCase(c[col('cat')]),
      jurisdiction: titleCase(c[col('Dep')] || 'Provincia'),
      partido: titleCase(c[col('nde')]),
      locality: titleCase(c[col('nba')]),
    }, 'hospital'));
    pba += 1;
  }
  writeLayer(path.join(LOCAL, 'ba_salud'), features, `# Salud pública — CABA + Provincia de Buenos Aires

${features.length} points: CABA hospitals (general, especializados, de niños) and CeSAC from epok.buenosaires.gob.ar
(Mapa Interactivo BA, CC-BY GCBA) plus ${pba} public health establishments of Provincia de Buenos Aires
(catalogo.datos.gba.gob.ar "Establecimientos de salud públicos 2025", CC-BY 4.0). Snapshot ${TODAY}.
Rebuild: \`node scripts/build-caba-static-layers.mjs salud\`.
`);
}

// ── Bomberos: CABA (epok) + PBA CSV ─────────────────────────────────────────
if (want('bomberos')) {
  const features = epokPoints(await epok('cuarteles_de_bomberos'), 'fire_station', (p) => ({ name: clean(p.Nombre), amenity: 'fire_station', operator: clean(p.Gestion), jurisdiction: 'CABA' }));
  const rows = parseCsv(await getText('https://catalogo.datos.gba.gob.ar/dataset/f3cf1025-b253-4627-b546-9c83457618f9/resource/9d601310-6bf9-4d82-b809-65fed2f3f63a/download/cuarteles-bomberos-082026.csv'));
  const header = rows[0].map((h) => h.replace(/^﻿/, '').trim());
  const col = (n) => header.indexOf(n);
  let pba = 0;
  for (const r of rows.slice(1)) {
    const lat = num(r[col('latitud')]); const lon = num(r[col('longitud')]);
    if (lat === null || lon === null || lat > -33 || lat < -41.5 || lon > -56 || lon < -64) continue;
    features.push(point(`pba-bomberos-${pba}`, lon, lat, { name: clean(r[col('nombre')]), amenity: 'fire_station', operator: clean(r[col('tipo')]), jurisdiction: 'Provincia', source: clean(r[col('fuente')]) }, 'fire_station'));
    pba += 1;
  }
  writeLayer(path.join(LOCAL, 'ba_bomberos'), features, `# Cuarteles de bomberos — CABA + Provincia de Buenos Aires

${features.length} points: 34 CABA stations (epok.buenosaires.gob.ar, CC-BY GCBA) + ${pba} provincial stations inside the
Buenos Aires bounding box (catalogo.datos.gba.gob.ar "Cuarteles de bomberos 08/2026", CC-BY 4.0). Snapshot ${TODAY}.
Rebuild: \`node scripts/build-caba-static-layers.mjs bomberos\`.
`);
}

// ── Servicios CABA: farmacias, cajeros, taxis, terminales, antenas, museos, wifi ─
if (want('servicios')) {
  const features = [];
  const packs = [
    ['farmacias', 'pharmacy', (p) => ({ name: clean(p.Nombre), service: 'Farmacia' })],
    ['cajeros_automaticos_red_link', 'atm', (p) => ({ name: clean(p.Nombre), service: 'Cajero Link' })],
    ['cajeros_automaticos_red_banelco', 'atm', (p) => ({ name: clean(p.Nombre), service: 'Cajero Banelco' })],
    ['paradas_de_taxi', 'taxi', (p) => ({ name: clean(p.Nombre), service: 'Parada de taxi' })],
    ['terminales', 'terminal', (p) => ({ name: clean(p.Nombre), service: 'Terminal' })],
    ['concesiones&rubros=ANTENAS', 'antenna', (p) => ({ name: clean(p.Nombre), service: 'Antena' })],
    ['dependencias_culturales&subcategoria=4', 'museum', (p) => ({ name: clean(p.Nombre), service: 'Museo', operator: clean(p.Dependencia) })],
    ['puntos_wifi&antena_principal=True', 'wifi', (p) => ({ name: clean(p.Nombre), service: 'WiFi público', kind: clean(p.Tipo), barrio: clean(p.Barrio) })],
  ];
  for (const [cat, type, tagsOf] of packs) {
    const got = epokPoints(await epok(cat), type, tagsOf);
    console.log(`  ${cat}: ${got.length}`);
    features.push(...got);
  }
  writeLayer(path.join(LOCAL, 'caba_servicios'), features, `# Servicios CABA — farmacias, cajeros, taxis, terminales, antenas, museos, wifi

${features.length} points from epok.buenosaires.gob.ar (Mapa Interactivo BA backend, CC-BY GCBA), snapshot ${TODAY}.
\`tags.service\` names the kind (Farmacia, Cajero Link/Banelco, Parada de taxi, Terminal, Antena, Museo, WiFi público).
Rebuild: \`node scripts/build-caba-static-layers.mjs servicios\`.
`);
}

// ── RENABAP AMBA polygons ───────────────────────────────────────────────────
if (want('renabap')) {
  const j = await getJson('https://geoportal.obraspublicas.gob.ar/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=geonode:renabap2020_smz&outputFormat=application/json&bbox=-59.0,-35.1,-58.2,-34.3,EPSG:4326&count=5000&srsName=EPSG:4326');
  const features = [];
  let vin = 0; let vout = 0;
  for (const f of j.features || []) {
    const g = f.geometry; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    const out = polys.map((rings) => rings.map((ring) => { vin += ring.length; const s = simplify(ring, 0.00015).map(round5); vout += s.length; return s; })).filter((rings) => rings[0]?.length >= 4);
    if (!out.length) continue;
    const p = f.properties || {};
    features.push({
      type: 'Feature',
      id: `renabap-${p.id_renabap}`,
      geometry: out.length === 1 ? { type: 'Polygon', coordinates: out[0] } : { type: 'MultiPolygon', coordinates: out },
      properties: {
        id: `renabap-${p.id_renabap}`,
        name: clean(p.Barrio),
        tags: { name: clean(p.Barrio), partido: clean(p.Departamen), localidad: clean(p.Localidad), year: clean(p.ano_de_cre), families: clean(p.familias_e), electricity: clean(p.Electricid), water: clean(p.Agua), sewage: clean(p.Cloaca) },
        type: 'renabap',
      },
    });
  }
  writeLayer(path.join(LOCAL, 'renabap_amba'), features, `# RENABAP 2020 — barrios populares del AMBA

${features.length} polygons (bbox -59.0,-35.1,-58.2,-34.3) from the Ministerio de Obras Públicas GeoNode
(\`geonode:renabap2020_smz\`, https://geoportal.obraspublicas.gob.ar/geoserver). Public national registry.
Rings simplified 0.00015° (${vin} → ${vout} vertices). Fields: barrio, partido, localidad, year, families,
electricity/water/sewage access. Snapshot ${TODAY}. Rebuild: \`node scripts/build-caba-static-layers.mjs renabap\`.
`);
}

// ── Ciclovías CABA ──────────────────────────────────────────────────────────
if (want('ciclovias')) {
  const j = await getJson('https://cdn.buenosaires.gob.ar/datosabiertos/datasets/transporte-y-obras-publicas/ciclovias/ciclovias.geojson');
  const features = [];
  for (const f of j.features || []) {
    if (f.geometry?.type !== 'LineString') continue;
    const coords = simplify(f.geometry.coordinates, 0.00005).map(round5);
    if (coords.length < 2) continue;
    const p = f.properties || {};
    features.push({ type: 'Feature', id: `ciclovia-${p.id}`, geometry: { type: 'LineString', coordinates: coords }, properties: { id: `ciclovia-${p.id}`, name: titleCase(p.nombre), tags: { name: titleCase(p.nombre), highway: 'cycleway', kind: clean(p.tipo), barrio: clean(p.barrio), comuna: clean(p.comuna), lengthM: num(p.longitud_m) }, type: 'cycleway' } });
  }
  writeLayer(path.join(LOCAL, 'caba_ciclovias'), features, `# Ciclovías CABA

${features.length} LineStrings from Buenos Aires Ciudad open data (cdn.buenosaires.gob.ar ciclovias.geojson, CC-BY-2.5-AR),
snapshot ${TODAY}. Fields: nombre, tipo (mano única / doble mano / bicisenda…), barrio, comuna, longitud_m.
Rebuild: \`node scripts/build-caba-static-layers.mjs ciclovias\`.
`);
}

// ── La Plata: calles con peligrosidad de inundación ─────────────────────────
if (want('laplata')) {
  const j = await getJson('https://geoserver-nodo2.ideba.gba.gob.ar/geoserver/laplata/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=laplata:peligrosidad_calles_3&outputFormat=application/json', { insecure: true });
  const features = [];
  for (const f of j.features || []) {
    if (f.geometry?.type !== 'LineString') continue;
    const coords = f.geometry.coordinates.map(round5);
    if (coords.length < 2) continue;
    const p = f.properties || {};
    const risk = clean(p.Peligrosidad).toLowerCase();
    features.push({ type: 'Feature', id: `lp-${p.fid ?? features.length}`, geometry: { type: 'LineString', coordinates: coords }, properties: { id: `lp-${p.fid ?? features.length}`, name: clean(p.Nombre), tags: { name: clean(p.Nombre), risk }, type: 'flood_risk' } });
  }
  writeLayer(path.join(LOCAL, 'laplata_inundacion'), features, `# La Plata — peligrosidad de inundación por calle

${features.length} street segments with \`tags.risk\` = alta | media, from the IDEBA nodo La Plata GeoServer
(\`laplata:peligrosidad_calles_3\`, https://geoserver-nodo2.ideba.gba.gob.ar). Public municipal data (Plan de
reducción de riesgo hídrico). Snapshot ${TODAY}. Rebuild: \`node scripts/build-caba-static-layers.mjs laplata\`.
`);
}

// ── Estaciones de tren: merge the PBA 08/2026 list into the national bundle ─
if (want('trenes')) {
  const dir = path.join(LOCAL, 'tren_estaciones');
  const file = path.join(dir, 'tren_estaciones.geojsonl');
  const existing = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)).filter((f) => !String(f.id).startsWith('pba-ffcc-')) : [];
  const rows = parseCsv(await getText('https://catalogo.datos.gba.gob.ar/dataset/007e56d4-9123-485c-83e0-4556b6c75784/resource/dc2d7c3e-96ba-4fe6-b18c-9becd9643e87/download/estaciones-ferrocarril-082026.csv'));
  const header = rows[0].map((h) => h.replace(/^﻿/, '').trim());
  const col = (n) => header.indexOf(n);
  const near = (a, b) => Math.hypot((a[0] - b[0]) * 0.83, a[1] - b[1]) < 0.003; // ~300 m
  let added = 0;
  for (const r of rows.slice(1)) {
    const lat = num(r[col('latitud')]); const lon = num(r[col('longitud')]);
    if (lat === null || lon === null) continue;
    if (existing.some((f) => near(f.geometry.coordinates, [lon, lat]))) continue;
    existing.push(point(`pba-ffcc-${added}`, lon, lat, { name: clean(r[col('nam')]), railway: clean(r[col('gna')]) === 'Estación' ? 'station' : 'halt', operator: clean(r[col('sag')]), jurisdiction: 'Provincia' }, 'railway_station'));
    added += 1;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, existing.map((f) => JSON.stringify(f)).join('\n') + '\n');
  writeFileSync(path.join(dir, 'README.md'), `# Estaciones ferroviarias — Argentina (con servicio 2022) + Provincia de Buenos Aires (08/2026)

${existing.length} points: 464 stations with service (IDE Transporte WFS \`idera:Estacion_ffcc_serv_22.view\`, CC-BY) plus
${added} stations/halts from catalogo.datos.gba.gob.ar "Estaciones de ferrocarril 08/2026" (CC-BY 4.0) that were not within
~300 m of an existing point. Snapshot ${TODAY}. Rebuild: \`node scripts/build-ba-static-layers.mjs trenes\` then
\`node scripts/build-caba-static-layers.mjs trenes\`.
`);
  console.log(`[tren_estaciones] ${existing.length} (+${added} PBA)`);
}
