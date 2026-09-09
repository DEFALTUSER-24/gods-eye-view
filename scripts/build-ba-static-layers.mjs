#!/usr/bin/env node
/**
 * Fetch the Buenos Aires (CABA + Provincia) static open datasets bundled as
 * local layers and rewrite them in the local-layer GeoJSONL shape.
 *
 *   node scripts/build-ba-static-layers.mjs [radares|comisarias|trenes]...
 *
 * Sources (all public, verified 2026-09-09):
 *   - PBA speed radars: github.com/datos-provincia-abierta/Radares (via jsDelivr)
 *   - PBA police stations: gis.mseg.gba.gov.ar ArcGIS REST (2000/page)
 *   - Train stations with service 2022: ide.transporte.gob.ar WFS (CC-BY)
 * The CABA radars snapshot (data.buenosaires.gob.ar, CC-BY-2.5-AR) is kept as
 * is; the PBA radars are merged into the same file with `propietario`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = path.join(ROOT, 'src', 'data', 'local_data');
const UA = { 'User-Agent': 'gods-eye-view-static-build/1.0 (+https://github.com/bilawalsidhu/gods-eye-view)' };
const only = new Set(process.argv.slice(2));
const want = (name) => only.size === 0 || only.has(name);

async function getJson(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function writeLayer(dir, features, readme) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, path.basename(dir) + '.geojsonl'), features.map((f) => JSON.stringify(f)).join('\n') + '\n');
  writeFileSync(path.join(dir, path.basename(dir) + '.geojson'), JSON.stringify({ type: 'FeatureCollection', features }));
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

// ── Radares: CABA (existing) + PBA ─────────────────────────────────────────
if (want('radares')) {
  const dir = path.join(LOCAL, 'caba_radares');
  const jsonl = path.join(dir, 'radares.geojsonl');
  const existing = readFileSync(jsonl, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
    .filter((f) => f.properties?.tags?.propietario !== 'Provincial');
  const pba = await getJson('https://cdn.jsdelivr.net/gh/datos-provincia-abierta/Radares@master/base_radares_estandarizada.geojson');
  const pbaFeatures = [];
  for (const f of pba.features || []) {
    const [lon, lat] = f.geometry?.coordinates || [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = f.properties || {};
    const name = `${String(p['ubicación'] || p.ubicacion || 'Ruta').trim()} km ${p.km || '?'} · ${p.proyecto || ''}`.trim();
    pbaFeatures.push(pointFeature(`pba-${p.n_serie || p.id}`, lon, lat, {
      name,
      enforcement: p.producto || 'Cinemómetro',
      tipo: p.tipo || '',
      municipio: p.proyecto || '',
      ruta: String(p['ubicación'] || '').trim(),
      km: p.km || '',
      sentido: p.sen || '',
      estado: p.estado || '',
      propietario: 'Provincial',
    }, 'speed_camera'));
  }
  const merged = [...existing, ...pbaFeatures];
  writeFileSync(path.join(dir, 'radares.geojsonl'), merged.map((f) => JSON.stringify(f)).join('\n') + '\n');
  writeFileSync(path.join(dir, 'radares.geojson'), JSON.stringify({ type: 'FeatureCollection', features: merged }));
  writeFileSync(path.join(dir, 'README.md'), `# Fotomultas BA — CABA + Provincia de Buenos Aires

Two public snapshots merged into one point layer (\`local-caba-radares\`):

- **CABA** (${existing.length} points): "Cámaras fijas de control vehicular" — Buenos Aires Ciudad open data,
  https://data.buenosaires.gob.ar/dataset/camaras-fijas-control-vehicular — CC-BY-2.5-AR.
  \`tags.enforcement\` = "Cinemómetro" (speed) or "Analítica de video" (red light / lane).
- **Provincia** (${pbaFeatures.length} points): "Radares" — Provincia de Buenos Aires open data repository
  https://github.com/datos-provincia-abierta/Radares (\`base_radares_estandarizada.geojson\`), the same file
  the provincial site infraccionesba.gba.gob.ar/radares uses. Fields: ruta, km, sentido, municipio, estado.
  \`tags.propietario\` = "Provincial".

Rebuild: \`node scripts/build-ba-static-layers.mjs radares\` (${new Date().toISOString().slice(0, 10)}).
`);
  console.log(`[radares] CABA ${existing.length} + PBA ${pbaFeatures.length} = ${merged.length}`);
}

// ── Comisarías PBA (ArcGIS REST, paginated) ────────────────────────────────
if (want('comisarias')) {
  const base = 'https://gis.mseg.gba.gov.ar/server/rest/services/Dependencias_Policiales_WMS/MapServer/0/query';
  const features = [];
  let offset = 0;
  for (let page = 0; page < 20; page += 1) {
    const url = `${base}?where=1%3D1&outFields=*&f=geojson&resultOffset=${offset}&resultRecordCount=2000`;
    const json = await getJson(url);
    const batch = json.features || [];
    for (const f of batch) {
      const [lon, lat] = f.geometry?.coordinates || [];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const p = f.properties || {};
      features.push(pointFeature(`pba-pol-${p.objectid}`, lon, lat, {
        name: String(p.nombre || '').trim(),
        police: String(p.tipo || '').trim(),
        partido: String(p.partido || '').trim(),
        'addr:street': String(p.direccion || '').trim(),
      }, 'police'));
    }
    console.log(`[comisarias] page ${page}: ${batch.length}`);
    if (!json.exceededTransferLimit || batch.length === 0) break;
    offset += batch.length;
  }
  writeLayer(path.join(LOCAL, 'pba_comisarias'), features, `# Dependencias policiales — Provincia de Buenos Aires

${features.length} points from the Ministerio de Seguridad PBA ArcGIS Server
(\`Dependencias_Policiales_WMS/MapServer/0\`, https://gis.mseg.gba.gov.ar/server/rest/services),
snapshot ${new Date().toISOString().slice(0, 10)}. Public map service, no token. Fields: nombre, tipo,
partido, dirección. Rebuild: \`node scripts/build-ba-static-layers.mjs comisarias\`.
`);
  console.log(`[comisarias] total ${features.length}`);
}

// ── Estaciones de tren con servicio (IDE Transporte, WFS) ──────────────────
if (want('trenes')) {
  const url = 'https://ide.transporte.gob.ar/geoserver/idera/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=idera:Estacion_ffcc_serv_22.view&maxFeatures=5000&outputFormat=json';
  const json = await getJson(url);
  const features = [];
  for (const f of json.features || []) {
    const [lon, lat] = f.geometry?.coordinates || [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = f.properties || {};
    features.push(pointFeature(`ffcc-${p.id}`, lon, lat, {
      name: String(p.nam || p.fna || '').trim(),
      railway: 'station',
      line: String(p['línea'] || p.linea || '').trim(),
      operator: String(p.caa || '').trim(),
    }, 'railway_station'));
  }
  writeLayer(path.join(LOCAL, 'tren_estaciones'), features, `# Estaciones ferroviarias con servicio (Argentina, 2022)

${features.length} points from IDE Transporte (Ministerio de Transporte de la Nación) WFS layer
\`idera:Estacion_ffcc_serv_22.view\` — https://ide.transporte.gob.ar/geoserver — CC-BY.
Fields: nombre, línea (e.g. "FFCC Sarmiento"), operador (SOFSE, etc.). Snapshot ${new Date().toISOString().slice(0, 10)}.
Rebuild: \`node scripts/build-ba-static-layers.mjs trenes\`.
`);
  console.log(`[trenes] total ${features.length}`);
}
