#!/usr/bin/env node
/**
 * Build the "Puntos de interés CABA" bundle: ~75 point layers of the Mapa
 * Interactivo BA backend (epok.buenosaires.gob.ar) merged into one GeoJSONL
 * with `tags.category` (filter chip) and `tags.service` (specific kind).
 *
 *   node scripts/build-caba-poi.mjs
 *
 * The layer index (https://epok.buenosaires.gob.ar/mapainteractivoba/layers/)
 * is fetched live so URLs with extra filters (e.g. memoria_ba&mba_categoria=…)
 * are taken verbatim. Public city data, CC-BY GCBA.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'src', 'data', 'local_data', 'caba_poi');
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; gods-eye-view-static-build/1.0)' };
const TODAY = new Date().toISOString().slice(0, 10);

/** index group key → category id. Groups not listed are skipped. */
const GROUP_CATEGORY = {
  museos: 'cultura', teatros_museos_centros_culturales: 'cultura', cines: 'cultura', centros_culturales: 'cultura',
  bibliotecas: 'cultura', bibliotecas_publicas_y_populares: 'cultura', galerias_de_arte: 'cultura', milongas: 'cultura',
  tanguerias_milongas_y_penas: 'cultura', bares_culturales: 'cultura', librerias_y_disquerias: 'cultura',
  espacios_escenicos: 'cultura', espacios_culturales: 'cultura', calesitas: 'cultura',
  sedes_deportivas: 'deporte', pistas_de_skate: 'deporte', actividades_deportivas_gratuitas: 'deporte', clubes_de_barrio: 'deporte',
  establecimientos_educativos_de_gestion_estatal: 'educacion', establecimientos_educativos_de_gestion_privada: 'educacion',
  universidades: 'educacion', centros_de_educacion_no_formal: 'educacion',
  comisarias: 'seguridad', fiscalias: 'seguridad',
  estaciones_de_bicicletas: 'movilidad', estacionamiento_para_bicicletas: 'movilidad', estaciones_de_servicio: 'movilidad',
  tramites_vehiculares: 'movilidad', paradas_de_taxi: 'movilidad', ecobici: 'movilidad', paradas_de_bus_turistico: 'movilidad',
  centros_de_salud: 'salud', centros_de_salud_y_accion_comunitaria: 'salud', centros_vacunatorios: 'salud',
  postas_sanitarias: 'salud', UFU: 'salud', servicios_sociales: 'social',
  embajadas_y_consulados: 'turismo', alojamientos: 'turismo', informacion_turistica: 'turismo', agencias_de_viaje: 'turismo',
  memoria_ba: 'memoria', terrorismo_de_estado_en_argentina: 'memoria', malvinas: 'memoria', atentado_amia_embajada_de_israel: 'memoria',
  ddhh_recordatorios_urbanos: 'memoria', tragedia_de_cromagnon: 'memoria', genocidios_internacionales: 'memoria',
  farmacias: 'servicios', cajeros_automaticos: 'servicios', wifi_gratis: 'servicios', bancos: 'servicios',
  ciudad_verde: 'servicios', sitio_privado_recoleccion_pila: 'servicios',
};
/** Specific layers inside multi-layer groups to skip (already elsewhere or noise). */
const SKIP_LAYER_NAMES = new Set(['Paseos Virtuales', 'Terminales de trenes, ómnibus y buques']);
/** concesiones is a grab-bag: keep only these named layers. */
const CONCESIONES_KEEP = { Antenas: 'servicios', 'Playas de estacionamiento': 'movilidad', 'Áreas de recreación': 'deporte' };

function clean(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }

async function getJson(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const index = await getJson('https://epok.buenosaires.gob.ar/mapainteractivoba/layers/');
const jobs = [];
for (const [group, layers] of Object.entries(index)) {
  for (const [key, layer] of Object.entries(layers)) {
    if (layer.format !== 'geojson' || !layer.url) continue;
    const name = clean(layer.nombre || key);
    let category = GROUP_CATEGORY[group];
    if (group === 'concesiones') category = CONCESIONES_KEEP[name];
    if (!category || SKIP_LAYER_NAMES.has(name)) continue;
    jobs.push({ group, key, name, category, url: String(layer.url).replace(/^\/\//, 'https://') });
  }
}
console.log(`[poi] ${jobs.length} epok layers selected`);

const features = [];
const perCategory = {};
let failed = 0;
for (const job of jobs) {
  try {
    const col = await getJson(job.url);
    let n = 0;
    for (const f of col?.features || []) {
      const [lon, lat] = f.geometry?.coordinates || [];
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || f.geometry?.type !== 'Point') continue;
      if (lat < -34.75 || lat > -34.5 || lon < -58.6 || lon > -58.3) continue;
      const p = f.properties || {};
      const name = clean(p.Nombre || p.nombre || p.Titulo || p.titulo || p.Name || job.name);
      features.push({
        type: 'Feature',
        id: `poi-${features.length}`,
        geometry: { type: 'Point', coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))] },
        properties: {
          id: `poi-${features.length}`,
          name,
          tags: {
            name,
            category: job.category,
            service: job.name,
            barrio: clean(p.Barrio || p.barrio),
            comuna: clean(p.Comuna || p.comuna),
            extra: clean(p.Tipo || p.Actividad || p.Gestion || p.Dependencia || p.Rubro || p.Subcategoria || ''),
          },
          type: 'poi',
        },
      });
      n += 1;
    }
    perCategory[job.category] = (perCategory[job.category] || 0) + n;
    console.log(`  ${job.category.padEnd(10)} ${job.name}: ${n}`);
  } catch (error) {
    failed += 1;
    console.warn(`  FAILED ${job.name}: ${error?.message || error}`);
  }
}
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, 'caba_poi.geojsonl'), features.map((f) => JSON.stringify(f)).join('\n') + '\n');
writeFileSync(path.join(OUT_DIR, 'README.md'), `# Puntos de interés CABA — Mapa Interactivo BA

${features.length} points merged from ${jobs.length - failed} layers of the Buenos Aires Ciudad "Mapa Interactivo BA"
backend (https://epok.buenosaires.gob.ar, index https://epok.buenosaires.gob.ar/mapainteractivoba/layers/), CC-BY GCBA.
Snapshot ${TODAY}. \`tags.category\` drives the DISPLAY filter chips; \`tags.service\` is the source layer name.

Per category: ${Object.entries(perCategory).map(([k, v]) => `${k} ${v}`).join(', ')}.
Rebuild: \`node scripts/build-caba-poi.mjs\`.
`);
console.log(`[poi] wrote ${features.length} points (${failed} layers failed)`, perCategory);
