#!/usr/bin/env node
/**
 * Fetch open geodata from the provincial spatial-data infrastructures (IDEs)
 * and bundle it as four nationwide local layers:
 *
 *   node scripts/build-provincias-layers.mjs [pozos|salud|seguridad|escuelas]...
 *
 *   - pozos      Oil & gas wells: Neuquén (Subsecretaría de Energía, 20 496),
 *                La Pampa (Sec. Energía y Minería) and Tierra del Fuego.
 *   - salud      Public health facilities published by the IDEs of Córdoba,
 *                Corrientes, Jujuy, Río Negro, Salta, Santa Cruz, Tierra del
 *                Fuego, Chaco and La Pampa.
 *   - seguridad  Police stations (Corrientes, Salta capital, Santa Cruz,
 *                Tucumán) and fire stations (Córdoba, Jujuy, Tierra del Fuego).
 *   - escuelas   Every school outside Buenos Aires from the Mapa Educativo Nacional.
 *
 * Every source is a public WFS (GeoServer) — keyless, verified 2026-09-10.
 * Buenos Aires (CABA + PBA) has its own layers; these cover the rest.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = path.join(ROOT, 'src', 'data', 'local_data');
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; gods-eye-view-static-build/1.0)' };
const only = new Set(process.argv.slice(2));
const want = (name) => only.size === 0 || only.has(name);
const TODAY = new Date().toISOString().slice(0, 10);

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').replace(/�/g, '').trim();
const title = (s) => clean(s).toLowerCase().replace(/(^|\s|\(|\.)(\S)/g, (m, a, b) => a + b.toUpperCase());
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

function wfsUrl(base, layer, extra = '') {
  return `${base}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${layer}&outputFormat=application/json&srsName=EPSG:4326${extra}`;
}

async function getJson(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/** GetFeature with paging (GeoServer caps a single response). */
async function wfsAll(base, layer, { pageSize = 3000, sortBy = null, propertyName = null } = {}) {
  const all = [];
  for (let start = 0; start < 200_000; start += pageSize) {
    const extra = `&count=${pageSize}&startIndex=${start}${sortBy ? `&sortBy=${sortBy}` : ''}${propertyName ? `&propertyName=${propertyName}` : ''}`;
    const j = await getJson(wfsUrl(base, layer, extra));
    const feats = j.features || [];
    all.push(...feats);
    if (feats.length < pageSize) break;
  }
  return all;
}

function firstPoint(geometry) {
  if (!geometry) return null;
  const c = geometry.type === 'Point' ? geometry.coordinates : geometry.type === 'MultiPoint' ? geometry.coordinates?.[0] : null;
  if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  if (c[0] < -74 || c[0] > -53 || c[1] < -56 || c[1] > -21) return null; // Argentina bbox
  return [Number(c[0].toFixed(6)), Number(c[1].toFixed(6))];
}

function pointFeature(id, coords, tags, type) {
  return { type: 'Feature', id, geometry: { type: 'Point', coordinates: coords }, properties: { id, name: tags.name, tags, type } };
}

function writeLayer(dir, features, readme) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, path.basename(dir) + '.geojsonl'), features.map((f) => JSON.stringify(f)).join('\n') + '\n');
  writeFileSync(path.join(dir, 'README.md'), readme);
}

/** Pull `sources` (each {prov, base, layer, map(props) → tags|null}) into one feature list. */
async function collect(sources, type, idPrefix) {
  const features = [];
  const counts = {};
  for (const src of sources) {
    try {
      const feats = await wfsAll(src.base, src.layer, src.opts || {});
      let n = 0;
      for (const f of feats) {
        const coords = firstPoint(f.geometry);
        if (!coords) continue;
        const tags = src.map(f.properties || {});
        if (!tags || !tags.name) continue;
        for (const key of Object.keys(tags)) if (tags[key] === '' || tags[key] === null || tags[key] === undefined) delete tags[key];
        tags.provincia = src.prov;
        if (!src.omitFuente) tags.fuente = src.fuente;
        features.push(pointFeature(`${idPrefix}-${features.length}`, coords, tags, type));
        n += 1;
      }
      counts[`${src.prov} ${src.layer}`] = n;
      console.log(`  ${src.prov.padEnd(18)} ${src.layer}: ${n}`);
    } catch (error) {
      counts[`${src.prov} ${src.layer}`] = `FAILED ${error?.message || error}`;
      console.warn(`  FAILED ${src.prov} ${src.layer}: ${error?.message || error}`);
    }
  }
  return { features, counts };
}

const countsTable = (counts) => Object.entries(counts).map(([k, v]) => `- ${k}: ${v}`).join('\n');

// ── Pozos de hidrocarburos ─────────────────────────────────────────────────
if (want('pozos')) {
  const estado = (v) => {
    const s = clean(v).toLowerCase();
    if (/^activ|produc|inyec|operativ/.test(s)) return 'Activo';
    if (/abandon/.test(s)) return 'Abandonado';
    if (/inactiv|parad|cerrad|suspend/.test(s)) return 'Inactivo';
    return s ? title(s) : 'Sin dato';
  };
  const fluido = (v) => ({ PET: 'Petróleo', GAS: 'Gas', AGU: 'Agua', SUM: 'Sumidero', OT: 'Otro' }[clean(v)] || (clean(v) && !/S\/D|no disponible/i.test(v) ? title(v) : ''));
  const sources = [
    {
      prov: 'Neuquén', omitFuente: true, fuente: 'Subsecretaría de Energía, Minería e Hidrocarburos de Neuquén',
      base: 'https://hidrocarburos.energianeuquen.gob.ar/geoserver/wfs', layer: 'Hidrocarburos:Pozos',
      opts: { sortBy: 'UWI_NQN', propertyName: 'WELL_NAME,ESTADO_GIS,ORIGINAL_STATUS,FLUIDO,OPERADOR,YACIMIENTO,A%C3%91O_PERF,PROFUNDIDAD_MEDIDA,SIST_EXTRACCION,AREA_LEGAL,CLASS_NAME,SHAPE' },
      map: (p) => ({ name: clean(p.WELL_NAME), estado: estado(p.ESTADO_GIS), detalle: clean(p.ORIGINAL_STATUS), fluido: fluido(p.FLUIDO), operador: title(p.OPERADOR), yacimiento: title(p.YACIMIENTO), area: title(p.AREA_LEGAL), anio: num(p['AÑO_PERF']), profundidadM: num(p.PROFUNDIDAD_MEDIDA), extraccion: clean(p.SIST_EXTRACCION), clase: clean(p.CLASS_NAME) }),
    },
    {
      prov: 'La Pampa', omitFuente: true, fuente: 'Subsecretaría de Hidrocarburos y Minería de La Pampa (IDE La Pampa)',
      base: 'https://geoidelp.lapampa.gob.ar/geoserver/ows', layer: 'p_sec_energiaymineria:Pozo_hidrocarburifero',
      map: (p) => ({ name: clean(p.nam), estado: estado(p.fun), fluido: fluido(p.ppo), detalle: clean(p.sub_clasif || p.tipo_pozo || '') }),
    },
    {
      prov: 'Tierra del Fuego', omitFuente: true, fuente: 'Secretaría de Hidrocarburos de Tierra del Fuego (IDE TDF)',
      base: 'https://tiles.tierradelfuego.gob.ar/geoserver/ows', layer: 'geonode:pozos_hc_tdf_202607',
      map: (p) => ({ name: clean(p.nam), estado: estado(p.srv), detalle: clean(p.srv), fluido: fluido(p.ppo), operador: title(p.eop), tipo: clean(p.tre), profundidadM: num(p.pvv), extraccion: clean(p.sie) }),
    },
  ];
  const { features, counts } = await collect(sources, 'oil_well', 'pozo');
  writeLayer(path.join(LOCAL, 'pozos_hidrocarburos'), features, `# Pozos de hidrocarburos — Neuquén, La Pampa, Tierra del Fuego

${features.length} wells (\`local-pozos-hidrocarburos\`) from three public provincial WFS services, snapshot ${TODAY}:
${countsTable(counts)}

Sources: hidrocarburos.energianeuquen.gob.ar (\`Hidrocarburos:Pozos\`), geoidelp.lapampa.gob.ar
(\`p_sec_energiaymineria:Pozo_hidrocarburifero\`), tiles.tierradelfuego.gob.ar (\`geonode:pozos_hc_tdf_202607\`).
\`tags.estado\` is normalised to Activo / Inactivo / Abandonado / Sin dato; \`tags.fluido\` to Petróleo / Gas / Agua / …
Rebuild: \`node scripts/build-provincias-layers.mjs pozos\`.
`);
  console.log(`[pozos] ${features.length}`);
}

// ── Salud provincial ───────────────────────────────────────────────────────
if (want('salud')) {
  // REFES typology codes: ESCI* = con internación, ESSI* = sin internación,
  // ESC = complementario; Córdoba adds HOM/HOP/HON (hospitals) and CSM/CSP (centros).
  const kind = (v) => {
    const s = clean(v);
    const l = s.toLowerCase();
    if (/hospital|^ho[mpn]\b|con internaci|^esci/i.test(l)) return 'Hospital / internación';
    if (/^cs[mp]\b|caps|saps|centro de salud|centro de atenci|primaria|puesto|posta|\bcic\b|nodo|dispensario|sin internaci|^essi/i.test(l)) return 'Centro de salud';
    if (/clinic|sanatorio/.test(l)) return 'Clínica';
    if (/complementario|^esc\b/i.test(l)) return 'Servicio complementario';
    return s ? title(s) : 'Establecimiento de salud';
  };
  const G = 'https://geo.idejuy.jujuy.gob.ar/geoserver/ows';
  const jujuy = (layer, label) => ({ prov: 'Jujuy', fuente: 'IDE Jujuy', base: G, layer, map: (p) => ({ name: title(p.nam || p.fna), healthcare: label, operador: title(p.sag), gestion: clean(p.caa) }) });
  const C = 'http://geoportal.corrientes.gob.ar/geoserver/wfs';
  const corrientes = (layer) => ({ prov: 'Corrientes', fuente: 'IDE Corrientes', base: C, layer, map: (p) => ({ name: clean(p.nombre), healthcare: kind(p.tipo), categoria: clean(p.categoria), localidad: title(p.localidad), 'addr:street': clean(p.direccion) }) });
  const sources = [
    { prov: 'Córdoba', fuente: 'IDECOR — Ministerio de Salud de Córdoba', base: 'https://idecor-ws.mapascordoba.gob.ar/geoserver/ows', layer: 'idecor:Centros_Salud',
      map: (p) => ({ name: title(p.establecimiento_salud), healthcare: kind(`${p.tipologia || ''} ${p.tipo || ''}`), tipologia: clean(p.tipologia), localidad: title(p.localidad), 'addr:street': clean(p.domicilio), gestion: clean(p.dependencia || p.sector) }) },
    corrientes('salud_ide:Hospital'), corrientes('salud_ide:CAPS'), corrientes('salud_ide:SAPS'),
    jujuy('geonode:efectores_de_salud_caps', 'Centro de salud'), jujuy('geonode:efectores_de_salud_puestos_de_salud', 'Puesto de salud'),
    jujuy('geonode:efectores_de_salud_cic', 'Centro integrador comunitario'), jujuy('geonode:efectores_de_salud_nodos', 'Nodo de salud'),
    { prov: 'Río Negro', fuente: 'IDE Río Negro — Ministerio de Salud', base: 'https://idern.rionegro.gov.ar/geoserver/ows', layer: 'geonode:HOSPITALES', map: (p) => ({ name: `Hospital ${title(p.NOMBRE)}`, healthcare: 'Hospital', url: clean(p.URL) }) },
    { prov: 'Río Negro', fuente: 'IDE Río Negro — Ministerio de Salud', base: 'https://idern.rionegro.gov.ar/geoserver/ows', layer: 'geonode:CENTROS_DE_SALUD_10_2021_b', map: (p) => ({ name: `Centro de salud ${title(p.NAME)}`, healthcare: 'Centro de salud', url: clean(p.URL) }) },
    { prov: 'Salta', fuente: 'IDE Salta — REFES', base: 'https://geoportal.salta.gob.ar/geoserver/wfs', layer: 'geonode:rfes',
      map: (p) => ({ name: title(p.nombre), healthcare: kind(p.tipologia), tipologia: clean(p.tipologia), categoria: clean(p.categoria_), localidad: title(p.localidad || p.localidad_), 'addr:street': clean(p.domicilio) }) },
    { prov: 'Santa Cruz', fuente: 'SITU Santa Cruz — Ministerio de Salud', base: 'https://situ.santacruz.gob.ar/geoserver/ows', layer: 'min_salud:estab_sanitarios_pubypriv_v11',
      map: (p) => ({ name: title(p.Nombre), healthcare: kind(p['Tipología']), tipologia: clean(p['Tipología']), categoria: clean(p['Categoría']), localidad: title(p.Localidad), 'addr:street': clean(p.Domicilio), telefono: clean(p['Teléfono']) }) },
    { prov: 'Tierra del Fuego', fuente: 'IDE Tierra del Fuego — Ministerio de Salud', base: 'https://tiles.tierradelfuego.gob.ar/geoserver/ows', layer: 'geonode:centros_atencion_salud_publica',
      map: (p) => ({ name: title(p.fna), healthcare: kind(p.gna), localidad: title(p.dpto), 'addr:street': clean(p.direccion), horario: clean(p.horario).slice(0, 60) }) },
    { prov: 'Chaco', fuente: 'IDE Chaco', base: 'http://idechaco.gob.ar/geoserver/idechaco/wfs', layer: 'idechaco:centros-salud',
      map: (p) => ({ name: `Centro de salud ${title(p.centro_sal)}`, healthcare: 'Centro de salud', 'addr:street': clean(p.direccion), telefono: clean(p.telefono) }) },
    { prov: 'La Pampa', fuente: 'IDE La Pampa — Ministerio de Salud', base: 'https://geoidelp.lapampa.gob.ar/geoserver/ows', layer: 'p_min_salud:centros_salud',
      map: (p) => ({ name: `Centro de salud ${title(p.nombre)}`, healthcare: 'Centro de salud', localidad: title(p.localidad), 'addr:street': clean(p.direccion), telefono: clean(p.telefonos) }) },
  ];
  const { features, counts } = await collect(sources, 'health', 'salud');
  writeLayer(path.join(LOCAL, 'prov_salud'), features, `# Salud pública provincial (fuera de Buenos Aires)

${features.length} points (\`local-prov-salud\`) from the provincial IDE GeoServers, snapshot ${TODAY}:
${countsTable(counts)}

Buenos Aires (CABA + PBA) is covered by the "Salud pública BA" layer. \`tags.healthcare\` is normalised to
Hospital / internación, Centro de salud, Clínica or Servicio complementario; \`tags.provincia\` and \`tags.fuente\` name the source.
Rebuild: \`node scripts/build-provincias-layers.mjs salud\`.
`);
  console.log(`[salud] ${features.length}`);
}

// ── Seguridad provincial (comisarías + bomberos) ───────────────────────────
if (want('seguridad')) {
  const sources = [
    { prov: 'Corrientes', fuente: 'IDE Corrientes', base: 'http://geoportal.corrientes.gob.ar/geoserver/wfs', layer: 'seguridad_ide:comisaria',
      map: (p) => ({ name: title(p.name || p.official_n), kind: 'police', localidad: title(p.addr_city), 'addr:street': clean(p.addr_stree) }) },
    { prov: 'Salta', fuente: 'GeoCloud Municipalidad de Salta', base: 'https://geocloud.municipalidadsalta.gob.ar/geoserver/ows', layer: 'public:policia_capital',
      map: (p) => ({ name: title(p.nombre), kind: 'police', localidad: title(p.localidad), 'addr:street': clean(p.domicilio) }) },
    { prov: 'Santa Cruz', fuente: 'SITU Santa Cruz — Policía de la Provincia', base: 'https://situ.santacruz.gob.ar/geoserver/ows', layer: 'policia_prov:dependencias_pol',
      map: (p) => ({ name: title(p.Nombre), kind: /bomber/i.test(p.Tipo) ? 'fire' : 'police', tipo: clean(p.Tipo), localidad: title(p.Localidad), 'addr:street': clean(p['Dirección']), telefono: clean(p['Teléfono']) }) },
    { prov: 'Tucumán', fuente: 'GeoSPLAN Tucumán', base: 'http://g.geosplan.tucuman.gov.ar/geoserver/WFS_GEOSPLAN/wfs', layer: 'WFS_GEOSPLAN:comisasrias_2014',
      map: (p) => ({ name: title(p.DEPENDENCI), kind: 'police', 'addr:street': clean(p.DOMICILIO) }) },
    { prov: 'Córdoba', fuente: 'IDECOR — Bomberos Voluntarios', base: 'https://idecor-ws.mapascordoba.gob.ar/geoserver/ows', layer: 'idecor:cuarteles_bbvv',
      map: (p) => ({ name: `Bomberos Voluntarios ${title(p.nombre)}`, kind: 'fire', localidad: title(p.departamento), telefono: clean(p.telefono) }) },
    { prov: 'Jujuy', fuente: 'IDE Jujuy — Ministerio de Seguridad', base: 'https://geo.idejuy.jujuy.gob.ar/geoserver/ows', layer: 'geonode:cuartel_de_bomberos',
      map: (p) => ({ name: title(p.nam || p.fna), kind: 'fire' }) },
    { prov: 'Tierra del Fuego', fuente: 'IDE Tierra del Fuego', base: 'https://tiles.tierradelfuego.gob.ar/geoserver/ows', layer: 'geonode:cuartel_de_bomberos',
      map: (p) => ({ name: title(p.fna || p.nam), kind: 'fire' }) },
  ];
  const { features, counts } = await collect(sources, 'security', 'seg');
  writeLayer(path.join(LOCAL, 'prov_seguridad'), features, `# Comisarías y cuarteles de bomberos provinciales (fuera de Buenos Aires)

${features.length} points (\`local-prov-seguridad\`) from provincial / municipal GeoServers, snapshot ${TODAY}:
${countsTable(counts)}

Buenos Aires is covered by "Comisarías PBA" and "Bomberos BA". \`tags.kind\` = police | fire.
Rebuild: \`node scripts/build-provincias-layers.mjs seguridad\`.
`);
  console.log(`[seguridad] ${features.length}`);
}

// ── Escuelas del resto del país (Mapa Educativo Nacional) ──────────────────
// 64 639 establishments nationwide; CABA (cue 02…) and Provincia de Buenos
// Aires (cue 06…) are skipped because they have their own richer layers.
if (want('escuelas')) {
  const feats = await wfsAll('https://mapa.educacion.gob.ar/geoserver/ows', 'publico:establecimiento_educativo', { pageSize: 5000, sortBy: 'cue' });
  const JURISDICCION = { '10': 'Catamarca', '14': 'Córdoba', '18': 'Corrientes', '22': 'Chaco', '26': 'Chubut', '30': 'Entre Ríos', '34': 'Formosa', '38': 'Jujuy', '42': 'La Pampa', '46': 'La Rioja', '50': 'Mendoza', '54': 'Misiones', '58': 'Neuquén', '62': 'Río Negro', '66': 'Salta', '70': 'San Juan', '74': 'San Luis', '78': 'Santa Cruz', '82': 'Santa Fe', '86': 'Santiago del Estero', '90': 'Tucumán', '94': 'Tierra del Fuego' };
  const features = [];
  const perProv = {};
  for (const f of feats) {
    const p = f.properties || {};
    const cue = clean(p.cue);
    const prov = JURISDICCION[cue.slice(0, 2)];
    if (!prov) continue;
    const coords = firstPoint(f.geometry);
    if (!coords) continue;
    const name = title(p.fna || p.nam || '');
    if (!name) continue;
    features.push(pointFeature(`esc-${cue || features.length}`, coords, {
      name, amenity: 'school', provincia: prov, sector: clean(p.ges), ambito: clean(p.amg),
      nivel: clean(p.nen).replace(/;\s*$/, '').split(';').map((s) => s.trim()).filter(Boolean).slice(0, 3).join(' · '),
      estado: clean(p.fun),
    }, 'school'));
    perProv[prov] = (perProv[prov] || 0) + 1;
  }
  writeLayer(path.join(LOCAL, 'escuelas_argentina'), features, `# Establecimientos educativos — resto del país (Mapa Educativo Nacional)

${features.length} of ${feats.length} points (\`local-escuelas-argentina\`) from the Ministerio de Educación WFS
\`publico:establecimiento_educativo\` (https://mapa.educacion.gob.ar/geoserver — DIEE), snapshot ${TODAY}.
CABA and Provincia de Buenos Aires are excluded (see "Escuelas PBA" and "Puntos de interés CABA").
${countsTable(perProv)}
Rebuild: \`node scripts/build-provincias-layers.mjs escuelas\`.
`);
  console.log(`[escuelas] ${features.length} of ${feats.length}`);
}
