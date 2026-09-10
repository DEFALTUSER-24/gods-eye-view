import { createLocalGeoJsonLayer } from './localGeojson.js';
import { createProximityPointsLayer } from './proximityPoints.js';
import { createGatedGeoJsonLayer } from './gatedGeoJson.js';
import baSaludUrl from './local_data/ba_salud/ba_salud.geojsonl?url';
import baBomberosUrl from './local_data/ba_bomberos/ba_bomberos.geojsonl?url';
import cabaPoiUrl from './local_data/caba_poi/caba_poi.geojsonl?url';
import { categoryColor } from '../cabaPoiFilter.js';
import renabapUrl from './local_data/renabap_amba/renabap_amba.geojsonl?url';
import cicloviasUrl from './local_data/caba_ciclovias/caba_ciclovias.geojsonl?url';
import laplataUrl from './local_data/laplata_inundacion/laplata_inundacion.geojsonl?url';
import { createFirmsHeatmapLayer } from './firmsHeatmap.js';
import submarineCablesLayer from './telegeographySubmarineCables.js';

// Use Vite's ?url import to properly resolve these assets in dev and build
import datacentersUrl from './local_data/datacenters/datacenters.geojsonl?url';
import damsUrl from './local_data/dams/dams.geojsonl?url';
import cabaRadaresUrl from './local_data/caba_radares/radares.geojsonl?url';
import pbaComisariasUrl from './local_data/pba_comisarias/pba_comisarias.geojsonl?url';
import trenEstacionesUrl from './local_data/tren_estaciones/tren_estaciones.geojsonl?url';
import pbaEscuelasUrl from './local_data/pba_escuelas/pba_escuelas.geojsonl?url';
import pbaTerminalesUrl from './local_data/pba_terminales/pba_terminales.geojsonl?url';
import mdpParadasUrl from './local_data/mdp_paradas/mdp_paradas.geojsonl?url';
import mdpRecorridosUrl from './local_data/mdp_recorridos/mdp_recorridos.geojsonl?url';
import pozosUrl from './local_data/pozos_hidrocarburos/pozos_hidrocarburos.geojsonl?url';
import provSaludUrl from './local_data/prov_salud/prov_salud.geojsonl?url';
import provSeguridadUrl from './local_data/prov_seguridad/prov_seguridad.geojsonl?url';
import escuelasArUrl from './local_data/escuelas_argentina/escuelas_argentina.geojsonl?url';

/**
 * Registry of local GeoJSON datasets.
 * These are lazily loaded natively into Cesium when enabled.
 */
const datacenters = createLocalGeoJsonLayer({
  id: 'local-datacenters',
  url: datacentersUrl,
  name: 'Datacenters',
  color: '#00ffff', // Cyan
  icon: '▣',
  source: 'Local',
  labels: true,
  labelMax: 700,
  labelGridPx: 138,
});

const dams = createLocalGeoJsonLayer({
  id: 'local-dams',
  url: damsUrl,
  name: 'Dams',
  color: '#0088ff', // Blue
  icon: '▰',
  source: 'USACE',
  labels: true,
  labelMax: 900,
  labelGridPx: 132,
});

// Buenos Aires Ciudad fixed enforcement cameras (speed + red-light/analytics),
// 224 points from data.buenosaires.gob.ar (CC-BY-2.5-AR). See the folder README.
// These three are proximity-gated point layers (src/data/proximityPoints.js):
// thousands of rows, but only the ones inside the current view below ~250 km
// become primitives, so toggling them never stalls the globe.
const cabaRadares = createProximityPointsLayer({
  id: 'local-caba-radares',
  sourceUrl: 'https://data.buenosaires.gob.ar/dataset/camaras-fijas-control-vehicular',
  group: 'argentina',
  url: cabaRadaresUrl,
  name: 'Fotomultas BA (CABA + PBA)',
  color: '#ff6b6b', // Red — enforcement
  icon: '📸',
  source: 'Buenos Aires Ciudad + Provincia',
  maxAltitudeM: 200_000,
  maxPoints: 800,
  labelMax: 90,
  detailsOf: (props, tags) => [tags.enforcement || tags.tipo || '', tags.municipio || tags.propietario || ''].filter(Boolean).map((s) => String(s).toUpperCase()),
  analystFields: ['enforcement', 'municipio', 'ruta', 'km', 'propietario'],
});

// Provincia de Buenos Aires police stations (Ministerio de Seguridad ArcGIS).
const pbaComisarias = createProximityPointsLayer({
  id: 'local-pba-comisarias',
  sourceUrl: 'https://gis.mseg.gba.gov.ar/server/rest/services/Dependencias_Policiales_WMS/MapServer',
  group: 'argentina',
  url: pbaComisariasUrl,
  name: 'Comisarías PBA',
  color: '#4f8cff', // Police blue
  icon: '🚓',
  source: 'Min. Seguridad PBA',
  maxAltitudeM: 150_000,
  maxPoints: 900,
  labelMax: 80,
  detailsOf: (props, tags) => [tags.police || '', tags['addr:street'] || ''].filter(Boolean).map((s) => String(s).toUpperCase()),
  analystFields: ['police', 'partido', 'addr:street'],
});

// Train stations with service (Ministerio de Transporte de la Nación, 2022).
const trenEstaciones = createProximityPointsLayer({
  id: 'local-tren-estaciones',
  sourceUrl: 'https://ide.transporte.gob.ar/',
  group: 'argentina',
  url: trenEstacionesUrl,
  name: 'Estaciones de tren',
  color: '#c0ff6b', // Lime — rail
  icon: '🚆',
  source: 'IDE Transporte',
  maxAltitudeM: 400_000,
  maxPoints: 700,
  labelMax: 100,
  detailsOf: (props, tags) => [tags.line || '', tags.operator || ''].filter(Boolean).map((s) => String(s).toUpperCase()),
  analystFields: ['line', 'operator'],
});

// Live NASA FIRMS fires (VIIRS ×3 NRT via the /api/firms proxy). The id keeps
// the historical `local-` prefix for persistence + voice-tool-enum compat,
// but the data is NOT bundled anymore — it needs FIRMS_MAP_KEY server-side.
const fires = createFirmsHeatmapLayer({
  id: 'local-firms',
  name: 'FIRMS Active Fires',
  icon: '▲',
  source: 'NASA FIRMS · LIVE',
});


// ── CABA / GBA round 2: bundled open datasets (see scripts/build-caba-static-layers.mjs) ──
const baSalud = createProximityPointsLayer({
  id: 'local-ba-salud',
  sourceUrl: 'https://catalogo.datos.gba.gob.ar/dataset/establecimientos-de-salud-publicos',
  group: 'argentina',
  url: baSaludUrl,
  name: 'Salud pública BA',
  color: '#ff5c8a',
  icon: '🏥',
  source: 'GCBA + Min. Salud PBA',
  maxAltitudeM: 150_000,
  maxPoints: 900,
  labelMax: 80,
  colorOf: (p, t) => (t.jurisdiction === 'CABA' ? '#ff5c8a' : '#ff9ab5'),
  detailsOf: (p, t) => [t.healthcare || '', t.partido || t.barrio || ''].filter(Boolean).map((s) => String(s).toUpperCase()),
  analystFields: ['healthcare', 'jurisdiction', 'partido', 'locality'],
});

const baBomberos = createProximityPointsLayer({
  id: 'local-ba-bomberos',
  sourceUrl: 'https://catalogo.datos.gba.gob.ar/dataset/cuarteles-de-bomberos',
  group: 'argentina',
  url: baBomberosUrl,
  name: 'Bomberos BA',
  color: '#ff4d4d',
  icon: '🚒',
  source: 'GCBA + Provincia',
  maxAltitudeM: 300_000,
  maxPoints: 600,
  labelMax: 80,
  detailsOf: (p, t) => [t.operator || ''].filter(Boolean).map((s) => String(s).toUpperCase()),
  analystFields: ['operator', 'jurisdiction'],
});

// 17k points from ~75 city layers; the DISPLAY panel chips (cabaPoiFilter.js)
// filter by `tags.category`, and only the view's neighbourhood is drawn.
export const cabaPoiLayer = createProximityPointsLayer({
  id: 'local-caba-servicios',
  sourceUrl: 'https://mapa.buenosaires.gob.ar/',
  group: 'argentina',
  url: cabaPoiUrl,
  name: 'Puntos de interés CABA',
  color: '#cfd8dc',
  icon: '📍',
  source: 'Mapa Interactivo BA',
  maxAltitudeM: 25_000,
  maxPoints: 900,
  labelMax: 70,
  colorOf: (p, t) => categoryColor(t.category),
  detailsOf: (p, t) => [t.service || '', t.extra || t.barrio || ''].filter(Boolean).map((s) => String(s).toUpperCase()),
  analystFields: ['category', 'service', 'extra', 'barrio'],
});
const cabaServicios = cabaPoiLayer;

const renabap = createGatedGeoJsonLayer({
  id: 'local-renabap-amba',
  sourceUrl: 'https://datos.gob.ar/dataset/habitat-registro-nacional-de-barrios-populares',
  group: 'argentina',
  url: renabapUrl,
  name: 'Barrios populares (RENABAP)',
  icon: '🏘️',
  source: 'RENABAP 2023',
  maxAltitudeM: 120_000,
  defaultStyle: { stroke: '#ffb347', strokeWidth: 2, fill: '#ffb347', fillAlpha: 0.28 },
  hoverOf: (p, t) => ({
    title: t.name || p.name || 'Barrio popular',
    details: [
      [t.localidad, t.partido].filter(Boolean).join(' · '),
      [t.families ? `${t.families} familias` : '', t.dwellings ? `${t.dwellings} viviendas` : '', t.areaM2 ? `${(t.areaM2 / 10000).toFixed(t.areaM2 < 100000 ? 1 : 0)} ha` : ''].filter(Boolean).join(' · '),
      [t.kind ? `Tipo: ${t.kind}` : '', t.year ? `desde ${t.year}` : (t.decade || '')].filter(Boolean).join(' · '),
      t.tenure || '',
      t.electricity ? `Luz: ${t.electricity}` : '',
      t.water ? `Agua: ${t.water}` : '',
      t.sewage ? `Cloaca: ${t.sewage}` : '',
    ],
  }),
});

const ciclovias = createGatedGeoJsonLayer({
  id: 'local-caba-ciclovias',
  sourceUrl: 'https://data.buenosaires.gob.ar/dataset/ciclovias',
  group: 'argentina',
  url: cicloviasUrl,
  name: 'Ciclovías CABA',
  icon: '🚴',
  source: 'Buenos Aires Ciudad',
  maxAltitudeM: 60_000,
  defaultStyle: { stroke: '#7cffb2', strokeWidth: 3, fill: '#7cffb2', fillAlpha: 0.2 },
  styleOf: (p, t) => (/doble/i.test(t.kind || '') ? { stroke: '#4cd964', strokeWidth: 4 } : {}),
  hoverOf: (p, t) => ({ title: t.name || p.name || 'Ciclovía', details: [t.kind || '', [t.barrio, t.comuna ? `Comuna ${t.comuna}` : ''].filter(Boolean).join(' · '), t.lengthM ? `${Math.round(t.lengthM)} m` : ''] }),
});

const laplataInundacion = createGatedGeoJsonLayer({
  id: 'local-laplata-inundacion',
  sourceUrl: 'https://geoserver-nodo2.ideba.gba.gob.ar/geoserver/laplata/wfs?service=WFS&request=GetCapabilities',
  group: 'argentina',
  url: laplataUrl,
  name: 'Riesgo de inundación La Plata',
  icon: '🌧️',
  source: 'Municipalidad de La Plata',
  maxAltitudeM: 40_000,
  defaultStyle: { stroke: '#ff3b3b', strokeWidth: 3, fill: '#ff3b3b', fillAlpha: 0.2 },
  hoverOf: (p, t) => ({ title: /^d/.test(t.name || '') ? `Calle ${t.name}` : (t.name || p.name || 'Calle'), details: [`Riesgo de inundación: ${t.risk || 'alto'}`, 'Plan de reducción de riesgo hídrico · La Plata'] }),
});

// ── PBA round 3 (see scripts/build-pba-static-layers.mjs) ──────────────────
const pbaEscuelas = createProximityPointsLayer({
  id: 'local-pba-escuelas',
  sourceUrl: 'https://catalogo.datos.gba.gob.ar/dataset/establecimientos-educativos',
  group: 'argentina',
  url: pbaEscuelasUrl,
  name: 'Escuelas PBA',
  color: '#ffd166',
  icon: '🏫',
  source: 'DGCyE · Datos Abiertos PBA',
  maxAltitudeM: 40_000,
  maxPoints: 900,
  labelMax: 70,
  colorOf: (p, t) => (t.sector === 'Privado' ? '#ffb347' : '#ffd166'),
  detailsOf: (p, t) => [t.nivel || '', t.sector || '', t.matricula ? `${t.matricula} alumnos` : ''].filter(Boolean).map((s) => String(s).toUpperCase()),
  analystFields: ['nivel', 'modalidad', 'sector', 'municipio', 'matricula'],
});

const pbaTerminales = createProximityPointsLayer({
  id: 'local-pba-terminales',
  sourceUrl: 'https://geoserver.ideba.gba.gob.ar/geoserver/web/',
  group: 'argentina',
  url: pbaTerminalesUrl,
  name: 'Terminales y peajes PBA',
  color: '#4fd8ff',
  icon: '🚌',
  source: 'IDEBA',
  maxAltitudeM: 900_000,
  maxPoints: 400,
  labelMax: 90,
  pixelSize: 9,
  colorOf: (p, t) => (t.kind === 'peaje' ? '#ff9f43' : '#4fd8ff'),
  detailsOf: (p, t) => [t.kind === 'peaje' ? 'Peaje' : 'Terminal de ómnibus', t.localidad || ''].filter(Boolean).map((s) => String(s).toUpperCase()),
  analystFields: ['kind', 'localidad', 'fuente'],
});

const mdpParadas = createProximityPointsLayer({
  id: 'local-mdp-paradas',
  sourceUrl: 'https://datos.mardelplata.gob.ar/',
  group: 'argentina',
  url: mdpParadasUrl,
  name: 'Paradas colectivo Mar del Plata',
  color: '#7cffb2',
  icon: '🚏',
  source: 'Municipalidad Gral. Pueyrredón',
  maxAltitudeM: 20_000,
  maxPoints: 900,
  labelMax: 60,
  pixelSize: 5,
  detailsOf: (p, t) => [t.linea ? `Línea ${t.linea}` : ''].filter(Boolean).map((s) => String(s).toUpperCase()),
  analystFields: ['linea'],
});

const MDP_LINE_COLORS = ['#ff6b6b', '#4fd8ff', '#ffd166', '#c58cff', '#7cffb2', '#ff8fd6', '#ffb347', '#4cd964'];
const mdpRecorridos = createGatedGeoJsonLayer({
  id: 'local-mdp-recorridos',
  sourceUrl: 'https://datos.mardelplata.gob.ar/',
  group: 'argentina',
  url: mdpRecorridosUrl,
  name: 'Recorridos colectivo Mar del Plata',
  icon: '🚍',
  source: 'Municipalidad Gral. Pueyrredón',
  maxAltitudeM: 80_000,
  defaultStyle: { stroke: '#4fd8ff', strokeWidth: 2.5, fill: '#4fd8ff', fillAlpha: 0.2 },
  styleOf: (p, t) => ({ stroke: MDP_LINE_COLORS[(parseInt(t.linea, 10) || 0) % MDP_LINE_COLORS.length] }),
  hoverOf: (p, t) => ({ title: t.linea ? `Línea ${t.linea}` : (p.name || 'Recorrido'), details: [t.ramal || ''] }),
});

// ── Resto del país: IDEs provinciales + Mapa Educativo Nacional (scripts/build-provincias-layers.mjs) ──
const POZO_COLORS = { Activo: '#4cd964', Inactivo: '#ffd166', Abandonado: '#8a94a0' };
const pozosHidrocarburos = createProximityPointsLayer({
  id: 'local-pozos-hidrocarburos',
  sourceUrl: 'https://hidrocarburos.energianeuquen.gob.ar/geoserver/web/',
  group: 'argentina',
  url: pozosUrl,
  name: 'Pozos de petróleo y gas',
  color: '#cfd8dc',
  icon: '🛢️',
  source: 'Neuquén · La Pampa · TDF',
  maxAltitudeM: 400_000,
  maxPoints: 1200,
  labelMax: 60,
  pixelSize: 5,
  colorOf: (p, t) => POZO_COLORS[t.estado] || '#cfd8dc',
  detailsOf: (p, t) => [[t.estado, t.fluido].filter(Boolean).join(' · '), t.operador || '', [t.yacimiento || t.area || '', t.anio ? `perforado ${t.anio}` : '', t.profundidadM ? `${t.profundidadM} m` : ''].filter(Boolean).join(' · ')].filter(Boolean).map((s) => String(s).toUpperCase()),
  analystFields: ['estado', 'fluido', 'operador', 'yacimiento', 'provincia', 'anio'],
});

const provSalud = createProximityPointsLayer({
  id: 'local-prov-salud',
  sourceUrl: 'https://www.idera.gob.ar/',
  group: 'argentina',
  url: provSaludUrl,
  name: 'Salud pública provincias',
  color: '#ff5c8a',
  icon: '🏥',
  source: 'IDEs provinciales',
  maxAltitudeM: 300_000,
  maxPoints: 900,
  labelMax: 80,
  colorOf: (p, t) => (/hospital/i.test(t.healthcare || '') ? '#ff5c8a' : '#ff9ab5'),
  detailsOf: (p, t) => [t.healthcare || '', [t.localidad, t.provincia].filter(Boolean).join(' · '), t['addr:street'] || ''].filter(Boolean).map((s) => String(s).toUpperCase()),
  analystFields: ['healthcare', 'provincia', 'localidad', 'fuente'],
});

const provSeguridad = createProximityPointsLayer({
  id: 'local-prov-seguridad',
  sourceUrl: 'https://www.idera.gob.ar/',
  group: 'argentina',
  url: provSeguridadUrl,
  name: 'Comisarías y bomberos provincias',
  color: '#4f8cff',
  icon: '🚓',
  source: 'IDEs provinciales',
  maxAltitudeM: 600_000,
  maxPoints: 700,
  labelMax: 80,
  colorOf: (p, t) => (t.kind === 'fire' ? '#ff4d4d' : '#4f8cff'),
  detailsOf: (p, t) => [t.kind === 'fire' ? 'Bomberos' : (t.tipo || 'Policía'), [t.localidad, t.provincia].filter(Boolean).join(' · '), t['addr:street'] || ''].filter(Boolean).map((s) => String(s).toUpperCase()),
  analystFields: ['kind', 'provincia', 'localidad', 'fuente'],
});

const escuelasArgentina = createProximityPointsLayer({
  id: 'local-escuelas-argentina',
  sourceUrl: 'https://mapa.educacion.gob.ar/',
  group: 'argentina',
  url: escuelasArUrl,
  name: 'Escuelas resto del país',
  color: '#ffd166',
  icon: '🏫',
  source: 'Mapa Educativo Nacional',
  maxAltitudeM: 40_000,
  maxPoints: 900,
  labelMax: 70,
  colorOf: (p, t) => (t.sector === 'Privado' ? '#ffb347' : '#ffd166'),
  detailsOf: (p, t) => [t.nivel || '', [t.sector, t.ambito].filter(Boolean).join(' · '), t.provincia || ''].filter(Boolean).map((s) => String(s).toUpperCase()),
  analystFields: ['nivel', 'sector', 'ambito', 'provincia'],
});

export default [
  baSalud,
  baBomberos,
  cabaServicios,
  renabap,
  ciclovias,
  laplataInundacion,
  datacenters,
  dams,
  pbaComisarias,
  trenEstaciones,
  cabaRadares,
  pbaEscuelas,
  pbaTerminales,
  mdpParadas,
  mdpRecorridos,
  pozosHidrocarburos,
  provSalud,
  provSeguridad,
  escuelasArgentina,
  submarineCablesLayer,
  fires,
];
