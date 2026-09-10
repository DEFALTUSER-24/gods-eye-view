import * as Cesium from 'cesium';

/**
 * Per-layer data attribution registered into Cesium's credit display.
 *
 * Legal requirement (see DATA_SOURCES.md, findings H10/H11 in
 * docs/pre-ship-audit-2026-07-01.md): every third-party data layer this app can
 * display carries its own license and required attribution — ODbL (OSM
 * datacenters/dams, adsb.lol, Overpass roads), CC BY-NC-SA (TeleGeography
 * cables), NASA FIRMS, CelesTrak, USGS, City of Austin, GBFS operators, OpenSky.
 * The MIT code license does NOT cover this data.
 *
 * These credits are registered ONCE at init as STATIC credits with
 * showOnScreen=false, so they live in the expandable bottom-left "Data
 * attribution" lightbox (Cesium's credit popover) rather than cluttering the
 * on-globe line. Always-present is intentional and reversible: the lightbox is
 * the app's canonical attribution surface and DATA_SOURCES.md is the
 * machine-readable index. Strings are copied verbatim from DATA_SOURCES.md — if
 * you add a data source, add it there AND here.
 */

/**
 * Attribution entries. `html` is the credit markup; keep it minimal and
 * link out where DATA_SOURCES.md provides a canonical URL. Order roughly
 * follows DATA_SOURCES.md (live sources, then bundled snapshots).
 * @type {{ key: string, html: string }[]}
 */
export const DATA_CREDITS = [
  // ── Live sources ────────────────────────────────────────────────
  {
    key: 'opensky',
    html:
      'Flights: OpenSky Network — Schäfer et al., ' +
      '“Bringing Up OpenSky”, IPSN 2014 · ' +
      '<a href="https://opensky-network.org" target="_blank" rel="noopener">opensky-network.org</a> ' +
      '(non-commercial)',
  },
  {
    key: 'adsblol',
    html:
      'Military flights, aircraft traces &amp; bounded regional flight fallback: ' +
      '<a href="https://adsb.lol" target="_blank" rel="noopener">adsb.lol</a> ' +
      '(ODbL 1.0)',
  },
  {
    key: 'aisstream',
    html:
      'Live vessels (AIS): ' +
      '<a href="https://aisstream.io" target="_blank" rel="noopener">AISStream.io</a>',
  },
  {
    key: 'celestrak',
    html:
      'Satellites (TLEs): CelesTrak ' +
      '(<a href="https://celestrak.org" target="_blank" rel="noopener">celestrak.org</a>), ' +
      'Dr. T.S. Kelso',
  },
  {
    key: 'launch-library-2',
    html:
      'Space mission launch, payload &amp; recovery metadata: ' +
      '<a href="https://ll.thespacedevs.com/docs/" target="_blank" rel="noopener">Launch Library 2 — The Space Devs</a> ' +
      '(API documentation and rate limits)',
  },
  {
    key: 'usgs',
    html: 'Earthquakes: Data courtesy of the U.S. Geological Survey',
  },
  {
    key: 'overpass',
    html:
      'Road geometry (traffic): ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      '(ODbL 1.0)',
  },
  {
    key: 'military-installations-osm',
    html:
      'Mapped installation context: ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      '(ODbL 1.0; incomplete mapped context)',
  },
  {
    key: 'cockpit-place-osm',
    html:
      'Cockpit place context: ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      'via Nominatim (ODbL 1.0)',
  },
  {
    key: 'open-meteo',
    html:
      'Cockpit current conditions: ' +
      '<a href="https://open-meteo.com/en/licence" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a> ' +
      '(CC BY 4.0)',
  },
  {
    key: 'google-news-rss',
    html:
      'Cockpit regional headlines: ' +
      '<a href="https://policies.google.com/terms" target="_blank" rel="noopener">Google News RSS</a> ' +
      '(location-matched article links; publisher terms apply)',
  },
  {
    key: 'gdelt',
    html:
      'Cockpit regional headlines: ' +
      '<a href="https://www.gdeltproject.org/about.html" target="_blank" rel="noopener">GDELT Project</a> ' +
      '(location-matched article links; publisher terms apply)',
  },
  {
    key: 'austin-cctv',
    html:
      'CCTV cameras &amp; frames: City of Austin, TX — ' +
      '<a href="https://data.austintexas.gov" target="_blank" rel="noopener">data.austintexas.gov</a>',
  },
  {
    key: 'caltrans-cctv',
    html:
      'CCTV cameras &amp; frames (California): Caltrans — ' +
      '<a href="https://cwwp2.dot.ca.gov/" target="_blank" rel="noopener">cwwp2.dot.ca.gov</a>',
  },
  {
    key: 'tfl-cctv',
    html:
      'CCTV cameras &amp; frames (London): ' +
      '<a href="https://tfl.gov.uk/info-for/open-data-users/" target="_blank" rel="noopener">Powered by TfL Open Data</a>. ' +
      'Contains OS data © Crown copyright and database rights.',
  },
  {
    key: 'gbfs',
    html: 'Bikeshare availability: GBFS operator feeds (e.g. Austin BCycle, Buenos Aires Ecobici via API Transporte)',
  },
  {
    key: 'ba-colectivos',
    html:
      'Buenos Aires bus positions (Colectivos): ' +
      '<a href="https://api-transporte.buenosaires.gob.ar" target="_blank" rel="noopener">API Transporte — Gobierno de la Ciudad de Buenos Aires</a>',
  },
  {
    key: 'windy-webcams',
    html:
      'Webcams (Windy pack): ' +
      '<a href="https://www.windy.com/webcams" target="_blank" rel="noopener">Windy Webcams</a> — each frame links to its broadcaster',
  },
  {
    key: 'smn',
    html:
      'Clima (Argentina): ' +
      '<a href="https://www.smn.gob.ar/descarga-de-datos" target="_blank" rel="noopener">Servicio Meteorológico Nacional — datos abiertos</a>',
  },
  {
    key: 'cammesa',
    html:
      'Red eléctrica (Argentina): ' +
      '<a href="https://cammesaweb.cammesa.com" target="_blank" rel="noopener">CAMMESA — demanda y generación en tiempo real</a>',
  },
  {
    key: 'rainviewer',
    html:
      'Precipitation radar: ' +
      '<a href="https://www.rainviewer.com/api.html" target="_blank" rel="noopener">RainViewer</a> (public API; coverage limited to ingested national radars)',
  },
  {
    key: 'conae',
    html:
      'Focos de calor: ' +
      '<a href="https://focosdecalor.conae.gov.ar" target="_blank" rel="noopener">CONAE — Comisión Nacional de Actividades Espaciales (GOES-19)</a>',
  },
  {
    key: 'edesur',
    html:
      'Cortes de luz: ' +
      '<a href="https://www.edesur.com.ar" target="_blank" rel="noopener">Edesur — reporte público de cortes</a>',
  },
  {
    key: 'energia-surtidor',
    html:
      'Precios de combustibles: ' +
      '<a href="http://datos.energia.gob.ar/dataset/precios-en-surtidor" target="_blank" rel="noopener">Secretaría de Energía — precios en surtidor (Res. 314/2016)</a> (CC-BY)',
  },
  {
    key: 'pba-seguridad',
    html:
      'Comisarías + radares PBA: ' +
      '<a href="https://gis.mseg.gba.gov.ar/server/rest/services" target="_blank" rel="noopener">Ministerio de Seguridad de la Provincia de Buenos Aires</a> / ' +
      '<a href="https://github.com/datos-provincia-abierta/Radares" target="_blank" rel="noopener">Datos Provincia Abierta</a>',
  },
  {
    key: 'ide-transporte',
    html:
      'Estaciones ferroviarias: ' +
      '<a href="https://ide.transporte.gob.ar" target="_blank" rel="noopener">IDE Transporte — Ministerio de Transporte de la Nación</a> (CC-BY)',
  },
  {
    key: 'epok-caba',
    html:
      'Subte, salud, bomberos y servicios CABA: ' +
      '<a href="https://mapa.buenosaires.gob.ar" target="_blank" rel="noopener">Mapa Interactivo BA — Buenos Aires Ciudad</a> (CC-BY)',
  },
  {
    key: 'agp',
    html:
      'Puerto de Buenos Aires: ' +
      '<a href="https://www.argentina.gob.ar/puerto-buenos-aires" target="_blank" rel="noopener">AGP ePuertos — escalas de buques</a>',
  },
  {
    key: 'apra',
    html:
      'Calidad de aire CABA: ' +
      '<a href="https://data.buenosaires.gob.ar/dataset/calidad-aire" target="_blank" rel="noopener">APrA — Buenos Aires Ciudad</a> (CC-BY-2.5-AR)',
  },
  {
    key: 'renabap',
    html:
      'Barrios populares: ' +
      '<a href="https://datos.gob.ar/dataset/habitat-registro-nacional-de-barrios-populares" target="_blank" rel="noopener">RENABAP 2023 — Secretaría de Integración Socio Urbana (datos.gob.ar)</a>',
  },
  {
    key: 'usig',
    html:
      'Mapas de ruido, hidrología, fotos aéreas históricas y mapas temáticos CABA: ' +
      '<a href="https://usig.buenosaires.gob.ar" target="_blank" rel="noopener">USIG — Buenos Aires Ciudad</a>',
  },
  {
    key: 'laplata',
    html:
      'Riesgo de inundación La Plata: ' +
      '<a href="https://www.laplata.gob.ar" target="_blank" rel="noopener">Municipalidad de La Plata (IDEBA nodo La Plata)</a>',
  },
  {
    key: 'pba-datos',
    html:
      'Salud, bomberos, escuelas y estaciones PBA: ' +
      '<a href="https://catalogo.datos.gba.gob.ar" target="_blank" rel="noopener">Datos Abiertos Provincia de Buenos Aires</a> (CC-BY 4.0)',
  },
  {
    key: 'ideba',
    html:
      'Terminales de ómnibus y peajes PBA: ' +
      '<a href="https://www.gba.gob.ar/ideba" target="_blank" rel="noopener">IDEBA — Infraestructura de Datos Espaciales de la Provincia de Buenos Aires</a>',
  },
  {
    key: 'mardelplata',
    html:
      'Colectivos de Mar del Plata: ' +
      '<a href="https://datos.mardelplata.gob.ar" target="_blank" rel="noopener">Datos Abiertos — Municipalidad de General Pueyrredón</a>',
  },
  {
    key: 'ides-provinciales',
    html:
      'Salud, comisarías y bomberos provinciales: ' +
      '<a href="https://www.idera.gob.ar" target="_blank" rel="noopener">IDEs provinciales (IDECOR Córdoba, IDE Corrientes, IDE Jujuy, IDE Río Negro, IDE Salta, SITU Santa Cruz, IDE Tierra del Fuego, IDE Chaco, IDE La Pampa, GeoSPLAN Tucumán, Municipalidad de Salta)</a>',
  },
  {
    key: 'hidrocarburos',
    html:
      'Pozos de petróleo y gas: ' +
      '<a href="https://hidrocarburos.energianeuquen.gob.ar" target="_blank" rel="noopener">Subsecretaría de Energía de Neuquén</a>, IDE La Pampa, IDE Tierra del Fuego',
  },
  {
    key: 'mapa-educativo',
    html:
      'Escuelas del resto del país: ' +
      '<a href="https://mapa.educacion.gob.ar" target="_blank" rel="noopener">Mapa Educativo Nacional — Ministerio de Educación (DIEE)</a>',
  },
  {
    key: 'ina',
    html:
      'Alturas de ríos: ' +
      '<a href="https://alerta.ina.gob.ar" target="_blank" rel="noopener">Instituto Nacional del Agua — Sistema de Información y Alerta Hidrológico</a> (datos de Prefectura Naval, SHN y redes provinciales)',
  },
  {
    key: 'smn-cap',
    html:
      'Alertas meteorológicas: ' +
      '<a href="https://www.smn.gob.ar/alertas" target="_blank" rel="noopener">Servicio Meteorológico Nacional — feed CAP</a>',
  },
  {
    key: 'vialidad',
    html:
      'Red vial y estado de rutas: ' +
      '<a href="https://www.argentina.gob.ar/transporte/vialidad-nacional/estado-de-rutas" target="_blank" rel="noopener">Vialidad Nacional</a> via ' +
      '<a href="https://rutas.ar" target="_blank" rel="noopener">rutas.ar</a>',
  },
  {
    key: 'gps-bahia',
    html:
      'Colectivos Bahía Blanca: ' +
      '<a href="https://www.gpsbahia.com.ar" target="_blank" rel="noopener">GPS Bahía — Municipio de Bahía Blanca</a> (unofficial feed)',
  },
  {
    key: 'caba-radares',
    html:
      'Fotomultas CABA: ' +
      '<a href="https://data.buenosaires.gob.ar/dataset/camaras-fijas-control-vehicular" target="_blank" rel="noopener">Buenos Aires Ciudad — data.buenosaires.gob.ar</a> (CC-BY-2.5-AR)',
  },
  {
    key: 'mendoza-cctv',
    html:
      'CCTV (Mendoza): ' +
      '<a href="https://camarasmunicapital.ciudaddemendoza.gov.ar" target="_blank" rel="noopener">Ciudad de Mendoza — cámaras públicas</a>',
  },
  {
    key: 'radio-browser',
    html:
      'Internet-radio station directory: ' +
      '<a href="https://www.radio-browser.info/" target="_blank" rel="noopener">Radio Browser</a> ' +
      '(public domain; audio delivered directly by each broadcaster)',
  },
  {
    key: 'reearth-terrain',
    html:
      'Terrain (keyless globe stacks): ' +
      '<a href="https://terrain.reearth.land" target="_blank" rel="noopener">Re:Earth Terrain</a> / ' +
      'Mapterhorn (CC BY 4.0) / EGM2008 (NGA)',
  },
  // ── Bundled snapshots ───────────────────────────────────────────
  {
    key: 'datacenters',
    html:
      'Datacenters: ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      '(ODbL 1.0)',
  },
  {
    key: 'dams',
    html:
      'Dams: ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      '(ODbL 1.0) + Open Infrastructure Map',
  },
  {
    key: 'firms',
    html:
      'Active fires: NASA FIRMS — we acknowledge the use of data and/or imagery ' +
      'from NASA’s Fire Information for Resource Management System ' +
      '(<a href="https://earthdata.nasa.gov/firms" target="_blank" rel="noopener">earthdata.nasa.gov/firms</a>), ' +
      'part of NASA’s Earth Observing System Data and Information System (EOSDIS)',
  },
  {
    key: 'telegeography',
    html:
      'Submarine cables: © TeleGeography — ' +
      '<a href="https://www.submarinecablemap.com" target="_blank" rel="noopener">submarinecablemap.com</a> ' +
      '(CC BY-NC-SA 3.0 — NonCommercial)',
  },
];

/**
 * Conditional credits — registered via `registerDynamicCredit` only when the
 * corresponding capability actually activates (deliberately NOT part of
 * DATA_CREDITS, which is always-on). TomTom terms require attribution when
 * their flow data is displayed; keyless installs never show it, so the
 * credit only appears once live traffic-flow mode activates.
 * @type {{ key: string, html: string }}
 */
export const TOMTOM_CREDIT = {
  key: 'tomtom',
  html:
    'Traffic flow data © ' +
    '<a href="https://www.tomtom.com" target="_blank" rel="noopener">TomTom</a>',
};

/** Registered when the first Natural Earth region outline resolves (public
 * domain — no attribution required; credited as a courtesy). */
export const NATURAL_EARTH_CREDIT = {
  key: 'natural-earth',
  html:
    'Physical region boundaries from ' +
    '<a href="https://www.naturalearthdata.com" target="_blank" rel="noopener">Natural Earth</a> (public domain)',
};

/** @type {Set<string>} Keys of dynamic credits already registered this session. */
const _dynamicCreditKeys = new Set();

/**
 * Register a conditional credit at the moment its data source activates.
 * Idempotent per `credit.key`; lands in the same "Data attribution" popover
 * as the static credits (showOnScreen=false).
 * @param {Cesium.Viewer} viewer — the initialized Cesium viewer
 * @param {{ key: string, html: string }} credit — e.g. `TOMTOM_CREDIT`
 * @returns {boolean} True when the credit is (now) registered.
 */
export function registerDynamicCredit(viewer, credit) {
  const creditDisplay = viewer?.creditDisplay;
  if (!creditDisplay || typeof creditDisplay.addStaticCredit !== 'function') {
    return false;
  }
  if (!credit?.key || !credit?.html) return false;
  if (_dynamicCreditKeys.has(credit.key)) return true;
  creditDisplay.addStaticCredit(new Cesium.Credit(credit.html, false));
  _dynamicCreditKeys.add(credit.key);
  return true;
}

/**
 * Register every per-layer data credit into the viewer's credit display.
 * Idempotent: safe to call once at init. Credits are static and always
 * present in the "Data attribution" popover.
 * @param {Cesium.Viewer} viewer — the initialized Cesium viewer
 */
export function registerDataCredits(viewer) {
  const creditDisplay = viewer?.creditDisplay;
  if (!creditDisplay || typeof creditDisplay.addStaticCredit !== 'function') {
    return;
  }
  for (const { html } of DATA_CREDITS) {
    // showOnScreen=false → lives in the expandable "Data attribution" popover,
    // not the on-globe credit line.
    creditDisplay.addStaticCredit(new Cesium.Credit(html, false));
  }
}
