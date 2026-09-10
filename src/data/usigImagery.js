import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { USIG_TILE_TEMPLATE, USIG_TILE_MAX_LEVEL } from './usigTiles.js';

/**
 * USIG (Buenos Aires Ciudad) raster overlays served as tiles from the city's
 * mapcache (via /api/usig/tiles): noise map, hydrology (piped streams / basins), historical aerial
 * photos, thematic maps. One imagery layer per dataset, clipped to the CABA
 * rectangle, created lazily on the first enable and only shown when enabled.
 *
 * A layer may expose `variants` (e.g. one per year of aerial photography):
 * a single DATA LAYERS entry whose WMS layer is swapped with `setVariant(id)`
 * from the DISPLAY panel (see src/usigVariantPicker.js).
 */

export const USIG_WMS_URL = 'https://tiles1.usig.buenosaires.gob.ar/mapcache/';
export const CABA_RECTANGLE_DEG = Object.freeze({ west: -58.55, south: -34.72, east: -58.32, north: -34.51 });
export const USIG_TILE_RETRIES = 3;

/**
 * XYZ tiles through the dev-server proxy (/api/usig/tiles, see
 * src/data/usigTiles.js): the proxy retries the city's on-demand renderer
 * and the provider retries a tile that still failed, so no patch of the
 * photo is left at the blurry parent level.
 */
export function createUsigTileProvider(layer, { retries = USIG_TILE_RETRIES } = {}) {
  const provider = new Cesium.UrlTemplateImageryProvider({
    url: USIG_TILE_TEMPLATE.replace('{layer}', layer),
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    rectangle: Cesium.Rectangle.fromDegrees(CABA_RECTANGLE_DEG.west, CABA_RECTANGLE_DEG.south, CABA_RECTANGLE_DEG.east, CABA_RECTANGLE_DEG.north),
    maximumLevel: USIG_TILE_MAX_LEVEL,
    credit: new Cesium.Credit('USIG — Buenos Aires Ciudad'),
  });
  provider.errorEvent.addEventListener((error) => {
    if (error && Number(error.timesRetried) < retries) error.retry = true;
  });
  return provider;
}

export function createUsigImageryLayer({
  id,
  name,
  wmsLayer = null,
  variants = null, // [{ id, label, wmsLayer, hint? }]
  defaultVariant = null,
  group = 'argentina',
  sourceUrl = 'https://mapa.buenosaires.gob.ar/',
  icon = '🗺️',
  source = 'USIG · Buenos Aires Ciudad',
  alpha = 0.75,
  createProvider = (layers) => createUsigTileProvider(layers),
} = {}) {
  const _variants = Array.isArray(variants) && variants.length ? variants.map((v) => ({ ...v })) : null;
  let _variantId = _variants ? (_variants.find((v) => v.id === defaultVariant)?.id || _variants[0].id) : null;
  let _alpha = alpha;
  let _viewer = null;
  let _layer = null;
  let _enabled = false;
  let _lastError = null;

  const currentWmsLayer = () => (_variants ? _variants.find((v) => v.id === _variantId)?.wmsLayer : wmsLayer);

  function ensureLayer() {
    if (_layer || !_viewer) return;
    try {
      _layer = _viewer.imageryLayers.addImageryProvider(createProvider(currentWmsLayer()));
      _layer.alpha = _alpha;
      _layer.show = _enabled;
      _lastError = null;
    } catch (error) {
      _lastError = `WMS provider failed (${error?.message || error})`;
    }
  }

  function dropLayer() {
    if (_layer && _viewer) { try { _viewer.imageryLayers.remove(_layer, true); } catch { /* already gone */ } }
    _layer = null;
  }

  return {
    id,
    group,
    sourceUrl,
    name,
    icon,
    source,
    updateInterval: 6 * 60 * 60_000,

    init(viewer) {
      _viewer = viewer;
      _enabled = false;
      console.log(`[Data:${id}] Initialized (USIG tiles ${currentWmsLayer()})`);
    },

    enable() {
      _enabled = true;
      ensureLayer();
      if (_layer) _layer.show = true;
      governorRequestRender(`${id}-visibility`);
    },

    disable() {
      _enabled = false;
      if (_layer) _layer.show = false;
      governorRequestRender(`${id}-visibility`);
    },

    async update() {
      return !_lastError;
    },

    destroy(viewer) {
      _enabled = false;
      if (_layer) { viewer.imageryLayers.remove(_layer, true); _layer = null; }
      _viewer = null;
    },

    /** Variant API (year / thematic map picker). */
    getVariants() { return _variants ? _variants.map((v) => ({ ...v })) : []; },
    getVariant() { return _variantId; },
    setVariant(variantId) {
      if (!_variants || !_variants.some((v) => v.id === variantId) || variantId === _variantId) return false;
      _variantId = variantId;
      // Swap the provider only if it already exists; a lazy layer picks the
      // new WMS name up on its first enable.
      if (_layer) { dropLayer(); ensureLayer(); }
      governorRequestRender(`${id}-variant`);
      return true;
    },
    getAlpha() { return _alpha; },
    setAlpha(value) {
      const next = Math.min(1, Math.max(0.05, Number(value)));
      if (!Number.isFinite(next)) return;
      _alpha = next;
      if (_layer) _layer.alpha = next;
      governorRequestRender(`${id}-alpha`);
    },

    getStats() {
      const variant = _variants ? _variants.find((v) => v.id === _variantId) : null;
      return {
        count: _layer ? 1 : 0,
        lastUpdate: _layer ? Date.now() : null,
        error: _lastError,
        source: `${source} · sólo CABA${variant ? ` · ${variant.label}` : ''}`,
      };
    },
  };
}

export const cabaRuidoLayer = createUsigImageryLayer({
  id: 'caba-ruido',
  name: 'Mapa de ruido CABA (diurno)',
  icon: '🔊',
  wmsLayer: 'impacto_acustico_periodo_diurno_caba_3857',
});

export const cabaHidricaLayer = createUsigImageryLayer({
  id: 'caba-hidrica',
  name: 'Arroyos y cuencas CABA',
  icon: '💧',
  wmsLayer: 'informacion_hidrica_caba_3857',
  alpha: 0.8,
});

/** Historical aerial photography + satellite mosaics of the city (USIG). */
export const CABA_AERIAL_VARIANTS = Object.freeze([
  { id: '1940', label: '1940', wmsLayer: 'fotografias_aereas_1940_caba_3857', hint: 'Fotografía aérea 1940' },
  { id: '1965', label: '1965', wmsLayer: 'fotografias_aereas_1965_caba_3857', hint: 'Fotografía aérea 1965' },
  { id: '1978', label: '1978', wmsLayer: 'fotografias_aereas_1978_caba_3857', hint: 'Fotografía aérea 1978' },
  { id: '2004', label: '2004', wmsLayer: 'imagen_satelital_2004_caba_3857', hint: 'Imagen satelital 2004' },
  { id: '2006', label: '2006', wmsLayer: 'imagen_satelital_2006_caba_3857', hint: 'Imagen satelital 2006' },
  { id: '2008', label: '2008', wmsLayer: 'imagen_satelital_2008_caba_3857', hint: 'Imagen satelital 2008' },
  { id: '2009', label: '2009', wmsLayer: 'imagen_satelital_2009_caba_3857', hint: 'Imagen satelital 2009' },
  { id: '2014', label: '2014', wmsLayer: 'fotografias_aereas_2014_caba_3857', hint: 'Fotografía aérea 2014' },
  { id: '2017', label: '2017', wmsLayer: 'fotografias_aereas_2017_caba_3857', hint: 'Fotografía aérea 2017' },
]);

export const cabaFotosAereasLayer = createUsigImageryLayer({
  id: 'caba-fotos-aereas',
  name: 'Fotos aéreas históricas CABA',
  icon: '🕰️',
  variants: CABA_AERIAL_VARIANTS,
  defaultVariant: '1940',
  alpha: 1,
});

/** Thematic city maps (USIG rasters) — one layer, picker in DISPLAY. */
export const CABA_THEMATIC_VARIANTS = Object.freeze([
  { id: 'arbolado', label: 'Arbolado 2018', wmsLayer: 'arbolado_censo2018_3857', hint: 'Censo de arbolado urbano 2018' },
  { id: 'terrenos', label: 'Precio terrenos', wmsLayer: 'precios_de_terrenos_caba_3857', hint: 'Precio del m² de terreno' },
  { id: 'poblacion', label: 'Población', wmsLayer: 'poblacion_por_radio_censal_caba_3857', hint: 'Población por radio censal' },
  { id: 'planeamiento', label: 'Cód. urbanístico', wmsLayer: 'codigo_de_planeamiento_urbano_caba_3857', hint: 'Código de planeamiento urbano' },
  { id: 'veredas', label: 'Ancho veredas', wmsLayer: 'ancho_de_veredas_caba_3857', hint: 'Ancho de veredas' },
  { id: 'ruido-noche', label: 'Ruido nocturno', wmsLayer: 'impacto_acustico_periodo_nocturno_caba_3857', hint: 'Mapa de ruido, período nocturno' },
  { id: 'ferias', label: 'Ferias', wmsLayer: 'ferias_caba_3857', hint: 'Ferias itinerantes y permanentes' },
  { id: 'antenas', label: 'Antenas', wmsLayer: 'medicion_de_antenas_caba_3857', hint: 'Mediciones de antenas (radiación)' },
  { id: 'transformadores', label: 'Transformadores', wmsLayer: 'transformadores_caba_3857', hint: 'Transformadores eléctricos' },
  { id: 'obras', label: 'Obras', wmsLayer: 'inspecciones_de_obras_en_construccion_caba_3857', hint: 'Inspecciones de obras en construcción' },
  { id: 'accesibilidad', label: 'Accesibilidad', wmsLayer: 'accesibilidad_caba_3857', hint: 'Accesibilidad urbana' },
  { id: 'colectividades', label: 'Colectividades', wmsLayer: 'colectividades_caba_3857', hint: 'Colectividades por barrio' },
  { id: 'manzanas', label: 'Manzanas atípicas', wmsLayer: 'manzanas_atipicas_caba_3857', hint: 'Manzanas atípicas' },
  { id: 'red-vial', label: 'Red vial', wmsLayer: 'red_vial_caba_3857', hint: 'Jerarquía de la red vial' },
  { id: 'ruido-dia', label: 'Ruido diurno', wmsLayer: 'impacto_acustico_periodo_diurno_caba_3857', hint: 'Mapa de ruido, período diurno' },
  { id: 'hidrica', label: 'Arroyos', wmsLayer: 'informacion_hidrica_caba_3857', hint: 'Cuencas y arroyos entubados' },
]);

export const cabaTematicoLayer = createUsigImageryLayer({
  id: 'caba-tematico',
  name: 'Mapas temáticos CABA (USIG)',
  icon: '🧭',
  variants: CABA_THEMATIC_VARIANTS,
  defaultVariant: 'arbolado',
  alpha: 0.8,
});
