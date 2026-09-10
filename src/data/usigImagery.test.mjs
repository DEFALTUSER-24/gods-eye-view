import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsigImageryLayer, CABA_AERIAL_VARIANTS, CABA_THEMATIC_VARIANTS } from './usigImagery.js';

function fakeViewer() {
  const layers = [];
  return {
    layers,
    imageryLayers: {
      addImageryProvider(provider) { const layer = { provider, alpha: 1, show: false }; layers.push(layer); return layer; },
      remove(layer) { const i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1); },
    },
  };
}

test('variant layers swap the WMS provider lazily and keep alpha', () => {
  const viewer = fakeViewer();
  const created = [];
  const layer = createUsigImageryLayer({
    id: 'caba-fotos-aereas',
    name: 'Fotos',
    variants: CABA_AERIAL_VARIANTS,
    defaultVariant: '1940',
    alpha: 1,
    createProvider: (wms) => { created.push(wms); return { wms }; },
  });
  layer.init(viewer);
  assert.equal(layer.getVariant(), '1940');
  assert.equal(created.length, 0, 'nothing is created before the first enable');
  // Changing the variant before enable only records the choice.
  assert.equal(layer.setVariant('1978'), true);
  assert.equal(created.length, 0);
  layer.enable();
  assert.deepEqual(created, ['fotografias_aereas_1978_caba_3857']);
  assert.equal(viewer.layers.length, 1);
  assert.equal(viewer.layers[0].show, true);
  layer.setAlpha(0.5);
  assert.equal(viewer.layers[0].alpha, 0.5);
  // Swapping while enabled replaces the imagery layer and keeps the alpha.
  layer.setVariant('2017');
  assert.equal(viewer.layers.length, 1);
  assert.equal(viewer.layers[0].provider.wms, 'fotografias_aereas_2017_caba_3857');
  assert.equal(viewer.layers[0].alpha, 0.5);
  assert.equal(layer.setVariant('2017'), false, 'same variant is a no-op');
  assert.equal(layer.setVariant('1899'), false, 'unknown variant is rejected');
  assert.match(layer.getStats().source, /2017/);
  layer.disable();
  assert.equal(viewer.layers[0].show, false);
  layer.destroy(viewer);
  assert.equal(viewer.layers.length, 0);
});

test('single-layer modules ignore the variant API', () => {
  const layer = createUsigImageryLayer({ id: 'caba-ruido', name: 'Ruido', wmsLayer: 'x', createProvider: (wms) => ({ wms }) });
  assert.deepEqual(layer.getVariants(), []);
  assert.equal(layer.getVariant(), null);
  assert.equal(layer.setVariant('anything'), false);
});

test('variant catalogues have unique ids and USIG 3857 layer names', () => {
  for (const list of [CABA_AERIAL_VARIANTS, CABA_THEMATIC_VARIANTS]) {
    assert.equal(new Set(list.map((v) => v.id)).size, list.length);
    for (const v of list) assert.match(v.wmsLayer, /_3857$/);
  }
  assert.equal(CABA_AERIAL_VARIANTS.length, 9);
});
