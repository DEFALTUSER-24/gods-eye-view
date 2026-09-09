import { createLocalGeoJsonLayer } from './localGeojson.js';
import { createProximityPointsLayer } from './proximityPoints.js';
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

export default [
  datacenters,
  dams,
  pbaComisarias,
  trenEstaciones,
  cabaRadares,
  submarineCablesLayer,
  fires,
];
