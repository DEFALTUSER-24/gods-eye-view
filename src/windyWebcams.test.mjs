import test from 'node:test';
import assert from 'node:assert/strict';
import {
  windyIdFromSourceId,
  windyListToSources,
  windyListUrl,
  windyWebcamToSource,
} from './data/windyWebcams.mjs';

const CAM = {
  webcamId: 1234567890,
  title: 'Buenos Aires: Obelisco',
  status: 'active',
  location: { city: 'Buenos Aires', region: 'Ciudad Autónoma', country: 'Argentina', latitude: -34.6037, longitude: -58.3816 },
  images: { current: { icon: 'https://images-webcams.windy.com/i.jpg', thumbnail: 'https://images-webcams.windy.com/t.jpg', preview: 'https://images-webcams.windy.com/p.jpg?token=abc' } },
  categories: [{ id: 'traffic', name: 'Traffic' }],
  urls: { detail: 'https://windy.com/webcams/1234567890' },
};

test('windyWebcamToSource maps a webcam into a CCTV source item', () => {
  const src = windyWebcamToSource(CAM);
  assert.equal(src.id, 'windy-1234567890');
  assert.equal(src.windyId, '1234567890');
  assert.equal(src.sourceKind, 'windy');
  assert.equal(src.feedType, 'image');
  assert.equal(src.url, 'https://images-webcams.windy.com/p.jpg?token=abc');
  assert.equal(src.lat, -34.6037);
  assert.equal(src.cityId, 'buenos-aires');
  assert.match(src.license, /Traffic/);
});

test('windyWebcamToSource rejects inactive or image-less webcams', () => {
  assert.equal(windyWebcamToSource({ ...CAM, status: 'inactive' }), null);
  assert.equal(windyWebcamToSource({ ...CAM, images: {} }), null);
  assert.equal(windyWebcamToSource({ ...CAM, location: {} }), null);
});

test('windyListToSources reads total + webcams', () => {
  const { total, sources } = windyListToSources({ total: 321, webcams: [CAM, { webcamId: 2 }] });
  assert.equal(total, 321);
  assert.equal(sources.length, 1);
});

test('windyListUrl pins the API limit and country filter', () => {
  const url = new URL(windyListUrl({ countries: 'AR', offset: 100, limit: 999 }));
  assert.equal(url.searchParams.get('limit'), '50');
  assert.equal(url.searchParams.get('offset'), '100');
  assert.equal(url.searchParams.get('countries'), 'AR');
});

test('windyIdFromSourceId round-trips', () => {
  assert.equal(windyIdFromSourceId('windy-42'), '42');
  assert.equal(windyIdFromSourceId('austin-42'), '');
});
