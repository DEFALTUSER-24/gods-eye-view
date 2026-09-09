import test from 'node:test';
import assert from 'node:assert/strict';
import {
  frameClock,
  frameTileTemplate,
  normalizeRainviewerCatalog,
} from './data/rainviewer.js';

const CATALOG = {
  version: '2.0',
  host: 'https://tilecache.rainviewer.com',
  radar: {
    past: [
      { time: 1788927600, path: '/v2/radar/7d928d4f000d' },
      { time: 1788928200, path: '/v2/radar/8057c5afd8fd' },
      { time: 1788928800, path: '/v2/radar/a09555602c48' },
      { time: 1788929400, path: 'javascript:alert(1)' },
    ],
    nowcast: [],
  },
  satellite: { infrared: [] },
};

test('normalizeRainviewerCatalog keeps well-formed frames, newest last, capped', () => {
  const cat = normalizeRainviewerCatalog(CATALOG, 2);
  assert.equal(cat.host, 'https://tilecache.rainviewer.com');
  assert.deepEqual(cat.frames.map((f) => f.path), ['/v2/radar/8057c5afd8fd', '/v2/radar/a09555602c48']);
  assert.equal(normalizeRainviewerCatalog({ host: 'http://evil', radar: { past: CATALOG.radar.past } }), null);
  assert.equal(normalizeRainviewerCatalog({}), null);
});

test('frameTileTemplate builds the documented RainViewer tile URL', () => {
  assert.equal(
    frameTileTemplate('https://tilecache.rainviewer.com', '/v2/radar/abc'),
    'https://tilecache.rainviewer.com/v2/radar/abc/256/{z}/{x}/{y}/2/1_1.png',
  );
});

test('frameClock formats HH:MM', () => {
  assert.match(frameClock(1788927600), /^\d{2}:\d{2}$/);
});
