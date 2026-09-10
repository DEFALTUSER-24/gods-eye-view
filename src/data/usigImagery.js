import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';

/**
 * USIG (Buenos Aires Ciudad) raster overlays served as WMS from the city's
 * mapcache: noise map, hydrology (piped streams / basins), etc. One imagery
 * layer per dataset, clipped to the CABA rectangle, created lazily on the
 * first enable and only shown when enabled.
 */

export const USIG_WMS_URL = 'https://tiles1.usig.buenosaires.gob.ar/mapcache/';
export const CABA_RECTANGLE_DEG = Object.freeze({ west: -58.55, south: -34.72, east: -58.32, north: -34.51 });

export function createUsigImageryLayer({
  id,
  name,
  wmsLayer,
  group = 'argentina',
  sourceUrl = 'https://mapa.buenosaires.gob.ar/',
  icon = '🗺️',
  source = 'USIG · Buenos Aires Ciudad',
  alpha = 0.75,
  createProvider = (layers) => new Cesium.WebMapServiceImageryProvider({
    url: USIG_WMS_URL,
    layers,
    parameters: { format: 'image/png', transparent: true, version: '1.1.1' },
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    rectangle: Cesium.Rectangle.fromDegrees(CABA_RECTANGLE_DEG.west, CABA_RECTANGLE_DEG.south, CABA_RECTANGLE_DEG.east, CABA_RECTANGLE_DEG.north),
    maximumLevel: 18,
    credit: new Cesium.Credit('USIG — Buenos Aires Ciudad'),
  }),
} = {}) {
  let _viewer = null;
  let _layer = null;
  let _enabled = false;
  let _lastError = null;

  function ensureLayer() {
    if (_layer || !_viewer) return;
    try {
      _layer = _viewer.imageryLayers.addImageryProvider(createProvider(wmsLayer));
      _layer.alpha = alpha;
      _layer.show = _enabled;
    } catch (error) {
      _lastError = `WMS provider failed (${error?.message || error})`;
    }
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
      console.log(`[Data:${id}] Initialized (WMS ${wmsLayer})`);
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

    getStats() {
      return {
        count: _layer ? 1 : 0,
        lastUpdate: _layer ? Date.now() : null,
        error: _lastError,
        source: `${source} · sólo CABA`,
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
