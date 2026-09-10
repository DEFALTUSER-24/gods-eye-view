import { createLocalGeoJsonLayer } from './localGeojson.js';
import { createProximityPointsLayer } from './proximityPoints.js';
import { createGatedGeoJsonLayer } from './gatedGeoJson.js';
import baSaludUrl from './local_data/ba_salud/ba_salud.geojsonl?url';
import baBomberosUrl from './local_data/ba_bomberos/ba_bomberos.geojsonl?url';
import cabaServiciosUrl from './local_data/caba_servicios/caba_servicios.geojsonl?url';
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

const SERVICE_COLORS = {
  Farmacia: '#7cffb2', 'Cajero Link': '#ffd166', 'Cajero Banelco': '#ffb347', 'Parada de taxi': '#f5f5f5',
  Terminal: '#ff7f50', Antena: '#c58cff', Museo: '#ff8fd6', 'WiFi público': '#4fd8ff',
};

// ── CABA / GBA round 2: bundled open datasets (see scripts/build-caba-static-layers.mjs) ──
const baSalud = createProximityPointsLayer({
  id: 'local-ba-salud',
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

const cabaServicios = createProximityPointsLayer({
  id: 'local-caba-servicios',
  group: 'argentina',
  url: cabaServiciosUrl,
  name: 'Servicios CABA',
  color: '#cfd8dc',
  icon: '📍',
  source: 'Buenos Aires Ciudad',
  maxAltitudeM: 25_000,
  maxPoints: 900,
  labelMax: 70,
  colorOf: (p, t) => SERVICE_COLORS[t.service] || '#cfd8dc',
  detailsOf: (p, t) => [t.service || '', t.kind || t.operator || ''].filter(Boolean).map((s) => String(s).toUpperCase()),
  analystFields: ['service', 'kind', 'barrio'],
});

const renabap = createGatedGeoJsonLayer({
  id: 'local-renabap-amba',
  group: 'argentina',
  url: renabapUrl,
  name: 'Barrios populares (RENABAP)',
  icon: '🏘️',
  source: 'RENABAP 2020',
  maxAltitudeM: 120_000,
  defaultStyle: { stroke: '#ffb347', strokeWidth: 2, fill: '#ffb347', fillAlpha: 0.28 },
});

const ciclovias = createGatedGeoJsonLayer({
  id: 'local-caba-ciclovias',
  group: 'argentina',
  url: cicloviasUrl,
  name: 'Ciclovías CABA',
  icon: '🚴',
  source: 'Buenos Aires Ciudad',
  maxAltitudeM: 60_000,
  defaultStyle: { stroke: '#7cffb2', strokeWidth: 3, fill: '#7cffb2', fillAlpha: 0.2 },
  styleOf: (p, t) => (/doble/i.test(t.kind || '') ? { stroke: '#4cd964', strokeWidth: 4 } : {}),
});

const laplataInundacion = createGatedGeoJsonLayer({
  id: 'local-laplata-inundacion',
  group: 'argentina',
  url: laplataUrl,
  name: 'Riesgo de inundación La Plata',
  icon: '🌧️',
  source: 'Municipalidad de La Plata',
  maxAltitudeM: 40_000,
  defaultStyle: { stroke: '#ff3b3b', strokeWidth: 3, fill: '#ff3b3b', fillAlpha: 0.2 },
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
  submarineCablesLayer,
  fires,
];
