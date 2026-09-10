#!/usr/bin/env node
/**
 * Fetch the Provincia de Buenos Aires open datasets bundled as local layers
 * (round 3) and rewrite them in the local-layer GeoJSONL shape.
 *
 *   node scripts/build-pba-static-layers.mjs [escuelas|terminales|mdp]...
 *
 * Sources (all public, keyless, verified 2026-09-10):
 *   - catalogo.datos.gba.gob.ar: establecimientos educativos (CSV with
 *     lat/lon, matrícula, nivel, sector) — CC-BY 4.0.
 *   - geoserver.ideba.gba.gob.ar WFS (IDEBA): Estacion_de_omnibus (bus
 *     terminals) + estacion_de_peaje (toll plazas).
 *   - datos.mardelplata.gob.ar: recorridos.geojson (bus routes) and
 *     paradas.geojson (bus stops) of General Pueyrredón.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../src/data/fuelFeed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = path.join(ROOT, 'src', 'data', 'local_data');
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; gods-eye-view-static-build/1.0)' };
const only = new Set(process.argv.slice(2));
const want = (name) => only.size === 0 || only.has(name);
const TODAY = new Date().toISOString().slice(0, 10);

async function getText(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
const getJson = async (url) => JSON.parse(await getText(url));

function writeLayer(dir, features, readme) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, path.basename(dir) + '.geojsonl'), features.map((f) => JSON.stringify(f)).join('\n') + '\n');
  writeFileSync(path.join(dir, 'README.md'), readme);
}

function pointFeature(id, lon, lat, tags, type) {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))] },
    properties: { id, name: tags.name, tags, type },
  };
}

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const title = (s) => clean(s).toLowerCase().replace(/(^|\s|\()\S/g, (m) => m.toUpperCase());

/** IDEBA's GeoServer replaces accented letters with "?"; repair the usual ones. */
export function repairIdebaText(value) {
  return clean(value)
    .replace(/Estaci\?n/g, 'Estación').replace(/\?mnibus/g, 'Ómnibus').replace(/Tuy\?/g, 'Tuyú')
    .replace(/Ca\?uelas/g, 'Cañuelas').replace(/Mar\?a/g, 'María').replace(/Jos\?/g, 'José')
    .replace(/Ram\?rez/g, 'Ramírez').replace(/Lan\?s/g, 'Lanús').replace(/Per\?n/g, 'Perón')
    .replace(/Chascom\?s/g, 'Chascomús').replace(/Bah\?a/g, 'Bahía').replace(/Mart\?n/g, 'Martín')
    .replace(/Concepci\?n/g, 'Concepción').replace(/Ju\?rez/g, 'Juárez').replace(/Rodr\?guez/g, 'Rodríguez')
    .replace(/Gonz\?lez/g, 'González').replace(/Cnel\. Su\?rez/g, 'Cnel. Suárez').replace(/Su\?rez/g, 'Suárez')
    .replace(/Gu\?men/g, 'Guamini').replace(/Ch\?vez/g, 'Chávez').replace(/Bel\?n/g, 'Belén')
    .replace(/Am\?rica/g, 'América').replace(/Trenque Launquen/g, 'Trenque Lauquen')
    .replace(/Concesi\?n/g, 'Concesión').replace(/Autom\?vil/g, 'Automóvil').replace(/Ol\?mpica/g, 'Olímpica')
    .replace(/\?/g, '');
}

// ── Escuelas PBA (CSV) ─────────────────────────────────────────────────────
if (want('escuelas')) {
  const url = 'https://catalogo.datos.gba.gob.ar/dataset/4becb4b7-0a21-4fef-8f2c-30df7f345a01/resource/3951210e-7e0e-4fed-bbf1-0183e704c9ae/download/establecimientos-educativos-07092026.csv';
  const table = parseCsv(await getText(url));
  const header = (table[0] || []).map((h) => clean(h).toLowerCase());
  const rows = table.slice(1).map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i]])));
  const features = [];
  const seen = new Set();
  for (const r of rows) {
    const lat = Number(r.latitud); const lon = Number(r.longitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat > -33 || lat < -41.5 || lon > -56 || lon < -64) continue;
    const id = `pba-esc-${r.cueanexo || r.establecimiento_id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    features.push(pointFeature(id, lon, lat, {
      name: title(r.establecimiento_nombre),
      amenity: 'school',
      nivel: clean(r.nivel),
      modalidad: clean(r.modalidad),
      sector: clean(r.sector),
      municipio: clean(r.municipio_nombre),
      'addr:street': clean(r.direccion),
      matricula: Number(r.matricula) || 0,
    }, 'school'));
  }
  writeLayer(path.join(LOCAL, 'pba_escuelas'), features, `# Establecimientos educativos — Provincia de Buenos Aires

${features.length} points (\`local-pba-escuelas\`) from the Dirección General de Cultura y Educación dataset
"Establecimientos educativos" — https://catalogo.datos.gba.gob.ar/dataset/establecimientos-educativos —
CC-BY 4.0, snapshot ${TODAY}. Fields: nombre, nivel, modalidad, sector (Estatal/Privado), municipio,
dirección, matrícula. Rows without coordinates or outside the province bbox are dropped.
Rebuild: \`node scripts/build-pba-static-layers.mjs escuelas\`.
`);
  console.log(`[escuelas] ${features.length} of ${rows.length}`);
}

// ── Terminales de ómnibus + peajes (IDEBA WFS) ─────────────────────────────
if (want('terminales')) {
  const base = 'https://geoserver.ideba.gba.gob.ar/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&outputFormat=application/json&srsName=EPSG:4326&typeNames=';
  const features = [];
  const omnibus = await getJson(`${base}IDEBA:Estacion_de_omnibus`);
  for (const f of omnibus.features || []) {
    const [lon, lat] = (f.geometry?.type === 'MultiPoint' ? f.geometry.coordinates[0] : f.geometry?.coordinates) || [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = f.properties || {};
    features.push(pointFeature(`pba-term-${p.__gid}`, lon, lat, {
      name: repairIdebaText(p.fna || p.nam || 'Terminal de ómnibus'),
      kind: 'terminal',
      localidad: repairIdebaText(p.nam || ''),
      fuente: repairIdebaText(p.fdc || 'IGN'),
    }, 'bus_station'));
  }
  const peajes = await getJson(`${base}IDEBA:estacion_de_peaje`);
  for (const f of peajes.features || []) {
    const [lon, lat] = (f.geometry?.type === 'MultiPoint' ? f.geometry.coordinates[0] : f.geometry?.coordinates) || [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = f.properties || {};
    features.push(pointFeature(`pba-peaje-${p.__gid}`, lon, lat, {
      name: repairIdebaText(p.fna || p.nam || 'Estación de peaje'),
      kind: 'peaje',
      localidad: repairIdebaText(p.nam || ''),
      fuente: repairIdebaText(p.fdc || ''),
    }, 'toll_booth'));
  }
  writeLayer(path.join(LOCAL, 'pba_terminales'), features, `# Terminales de ómnibus y estaciones de peaje — Provincia de Buenos Aires

${features.length} points (\`local-pba-terminales\`) from the IDEBA GeoServer (Infraestructura de Datos
Espaciales de la Provincia de Buenos Aires), WFS layers \`IDEBA:Estacion_de_omnibus\`
(${omnibus.features?.length || 0}) and \`IDEBA:estacion_de_peaje\` (${peajes.features?.length || 0}) —
https://geoserver.ideba.gba.gob.ar/geoserver — snapshot ${TODAY}. The server drops accented letters
("Estaci?n"); the usual ones are repaired at build time. \`tags.kind\` = terminal | peaje.
Rebuild: \`node scripts/build-pba-static-layers.mjs terminales\`.
`);
  console.log(`[terminales] ${features.length}`);
}

// ── Mar del Plata: recorridos + paradas de colectivo ───────────────────────
if (want('mdp')) {
  const recorridos = await getJson('https://datos.mardelplata.gob.ar/sites/default/files/recorridos.geojson');
  const lines = [];
  for (const f of recorridos.features || []) {
    const p = f.properties || {};
    const linea = clean(p.col1 || p.linea || '');
    const desc = clean(p.col2 || p.descripcion || '');
    if (!f.geometry) continue;
    lines.push({
      type: 'Feature',
      id: `mdp-rec-${p.cartodb_id}`,
      geometry: f.geometry,
      properties: { id: `mdp-rec-${p.cartodb_id}`, name: `Línea ${linea}${desc ? ` · ${desc}` : ''}`, tags: { linea, ramal: desc, route: 'bus' }, type: 'bus_route' },
    });
  }
  writeLayer(path.join(LOCAL, 'mdp_recorridos'), lines, `# Recorridos de colectivos — Mar del Plata (General Pueyrredón)

${lines.length} bus route lines (\`local-mdp-recorridos\`) from the Municipalidad de General Pueyrredón open
data portal — https://datos.mardelplata.gob.ar/ (recorridos.geojson) — snapshot ${TODAY}.
\`tags.linea\` = line number, \`tags.ramal\` = branch description. Rebuild: \`node scripts/build-pba-static-layers.mjs mdp\`.
`);
  const paradas = await getJson('https://datos.mardelplata.gob.ar/sites/default/files/paradas.geojson');
  const points = [];
  for (const f of paradas.features || []) {
    const [lon, lat] = f.geometry?.coordinates || [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = f.properties || {};
    const linea = clean(p.linea || '');
    points.push(pointFeature(`mdp-par-${p.cartodb_id}`, lon, lat, { name: `Parada línea ${linea}`, linea, highway: 'bus_stop' }, 'bus_stop'));
  }
  writeLayer(path.join(LOCAL, 'mdp_paradas'), points, `# Paradas de colectivos — Mar del Plata (General Pueyrredón)

${points.length} bus stops (\`local-mdp-paradas\`) from the Municipalidad de General Pueyrredón open data
portal — https://datos.mardelplata.gob.ar/ (paradas.geojson) — snapshot ${TODAY}. \`tags.linea\` = line.
Rebuild: \`node scripts/build-pba-static-layers.mjs mdp\`.
`);
  console.log(`[mdp] recorridos ${lines.length}, paradas ${points.length}`);
}
