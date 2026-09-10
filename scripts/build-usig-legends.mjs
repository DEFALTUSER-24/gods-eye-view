#!/usr/bin/env node
/**
 * Bundle the legends ("referencias") of the USIG thematic maps from the Mapa
 * Interactivo BA catalogue into src/data/local_data/usig_legends/usig_legends.json.
 *
 *   node scripts/build-usig-legends.mjs
 *
 * Source: https://epok.buenosaires.gob.ar/mapainteractivoba/mapas/?formato=json
 * (public, keyless). Each map carries `metadatos.abstract` and a list of
 * `{ iconUrl, desc }` legend rows; the 36×36 PNG swatches are inlined as data
 * URIs so the legend renders offline and without cross-origin requests.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'src', 'data', 'local_data', 'usig_legends');
const CATALOGUE_URL = 'https://epok.buenosaires.gob.ar/mapainteractivoba/mapas/?formato=json';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; gods-eye-view-static-build/1.0)' };

/** variant id (src/data/usigImagery.js) → catalogue key */
export const LEGEND_KEYS = {
  arbolado: 'arbolado_2018',
  terrenos: 'precios_de_terrenos',
  poblacion: 'poblacion_por_radio_censal',
  planeamiento: 'codigo_de_planeamiento_urbano',
  veredas: 'ancho_veredas',
  'ruido-noche': 'impacto_acustico_periodo_nocturno',
  'ruido-dia': 'impacto_acustico_periodo_diurno',
  hidrica: 'informacion_hidrica',
  ferias: 'ferias',
  antenas: 'medicion_de_antenas',
  transformadores: 'transformadores',
  obras: 'inspecciones_de_obras_en_construccion',
  accesibilidad: 'accesibilidad',
  colectividades: 'colectividades',
  manzanas: 'manzanas_atipicas',
  'red-vial': 'red_vial',
};

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&oacute;/g, 'ó').replace(/&aacute;/g, 'á')
  .replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function fetchIcon(url, cache) {
  if (!url) return null;
  const abs = url.startsWith('//') ? `https:${url}` : url;
  const normalized = abs.replace('gob.ar//', 'gob.ar/');
  if (cache.has(normalized)) return cache.get(normalized);
  let data = null;
  try {
    const res = await fetch(normalized, { headers: UA, signal: AbortSignal.timeout(60_000) });
    if (res.ok && String(res.headers.get('content-type') || '').startsWith('image/')) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length <= 20_000) data = `data:${res.headers.get('content-type')};base64,${buf.toString('base64')}`;
    }
  } catch { data = null; }
  cache.set(normalized, data);
  return data;
}

const res = await fetch(CATALOGUE_URL, { headers: UA, signal: AbortSignal.timeout(120_000) });
if (!res.ok) throw new Error(`HTTP ${res.status} for catalogue`);
const catalogue = await res.json();
const icons = new Map();
const out = {};
for (const [variant, key] of Object.entries(LEGEND_KEYS)) {
  const map = catalogue[key];
  if (!map) { console.warn(`[legends] ${variant}: catalogue key ${key} missing`); continue; }
  const refs = (map.metadatos?.referencias || []).filter((r) => r && typeof r.desc === 'string');
  const items = [];
  for (const r of refs) {
    const label = stripHtml(r.desc);
    if (!label) continue;
    items.push({ label, icon: await fetchIcon(r.iconUrl, icons), heading: /<b>/i.test(r.desc) });
  }
  out[variant] = {
    title: stripHtml(map.nombre),
    abstract: stripHtml(map.metadatos?.abstract).slice(0, 420),
    items,
  };
  console.log(`[legends] ${variant} ← ${key}: ${items.length} rows, ${items.filter((i) => i.icon).length} icons`);
}
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, 'usig_legends.json'), JSON.stringify(out));
writeFileSync(path.join(OUT_DIR, 'README.md'), `# Leyendas de los mapas temáticos USIG

Legend rows (\`referencias\`) and abstracts of the Mapa Interactivo BA thematic maps, taken from the public
catalogue https://epok.buenosaires.gob.ar/mapainteractivoba/mapas/?formato=json (Buenos Aires Ciudad, CC-BY).
Swatch PNGs are inlined as data URIs. Keys are the variant ids of \`caba-tematico\` (src/data/usigImagery.js).
Snapshot ${new Date().toISOString().slice(0, 10)}. Rebuild: \`node scripts/build-usig-legends.mjs\`.
`);
console.log(`[legends] wrote ${Object.keys(out).length} legends`);
