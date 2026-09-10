import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUsigTilePath, usigUpstreamTileUrl, usigRetryDelayMs, USIG_TILE_TEMPLATE } from './usigTiles.js';

test('parseUsigTilePath accepts only *_3857 tiles inside the grid and zoom range', () => {
  assert.deepEqual(parseUsigTilePath('/fotografias_aereas_1940_caba_3857/15/11059/13023.png'), { layer: 'fotografias_aereas_1940_caba_3857', z: 15, x: 11059, y: 13023 });
  assert.equal(parseUsigTilePath('/fotografias_aereas_1940_caba_3857/19/1/1.png'), null, 'zoom above the tileset');
  assert.equal(parseUsigTilePath('/fotografias_aereas_1940_caba_3857/2/4/1.png'), null, 'x outside the grid');
  assert.equal(parseUsigTilePath('/../etc/passwd'), null);
  assert.equal(parseUsigTilePath('/mapa_oficial/1/0/0.png'), null, 'not a 3857 tileset');
  assert.equal(parseUsigTilePath('/a_3857/1/0/0.jpg'), null);
});

test('upstream url, retry backoff and client template', () => {
  assert.equal(usigUpstreamTileUrl({ layer: 'arbolado_censo2018_3857', z: 3, x: 2, y: 1 }), 'https://tiles1.usig.buenosaires.gob.ar/mapcache/tms/1.0.0/arbolado_censo2018_3857@GoogleMapsCompatible/3/2/1.png');
  assert.deepEqual([0, 1, 2, 3, 9].map(usigRetryDelayMs), [300, 600, 1200, 2400, 2500]);
  assert.equal(USIG_TILE_TEMPLATE, '/api/usig/tiles/{layer}/{z}/{x}/{reverseY}.png');
});
