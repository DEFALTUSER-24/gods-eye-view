import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeColectivosBody,
  normalizeSimpleRow,
  routeColorHsl,
} from './data/colectivosFeed.js';

test('normalizeSimpleRow accepts API Transporte simple rows', () => {
  const row = normalizeSimpleRow({
    id: '1234',
    route_id: '1',
    route_short_name: '152A',
    latitude: '-34.6037',
    longitude: '-58.3816',
    speed: 8.3,
    direction: 90,
    timestamp: 1757390000,
    agency_name: 'Transportes Sur Nor',
    trip_headsign: 'a Olivos',
  });
  assert.equal(row.id, '1234');
  assert.equal(row.route, '152A');
  assert.equal(row.lat, -34.6037);
  assert.equal(row.headingDeg, 90);
  assert.equal(row.tsMs, 1757390000000);
});

test('normalizeSimpleRow drops rows outside AMBA or without coordinates', () => {
  assert.equal(normalizeSimpleRow({ id: 'x', latitude: 10, longitude: 10 }), null);
  assert.equal(normalizeSimpleRow({ id: 'x' }), null);
  assert.equal(normalizeSimpleRow({ latitude: -34.6, longitude: -58.4 }), null);
});

test('normalizeColectivosBody accepts GTFS-RT JSON and dedupes by vehicle id', () => {
  const body = {
    header: { timestamp: 1757390100 },
    entity: [
      { id: 'a', vehicle: { trip: { route_id: '9' }, position: { latitude: -34.6, longitude: -58.4, bearing: 45 }, vehicle: { id: 'v1', label: '60A' }, timestamp: 1757390000 } },
      { id: 'b', vehicle: { trip: { route_id: '9' }, position: { latitude: -34.61, longitude: -58.41, bearing: 50 }, vehicle: { id: 'v1', label: '60A' }, timestamp: 1757390090 } },
      { id: 'c', vehicle: { position: { latitude: 0, longitude: 0 }, vehicle: { id: 'v2' } } },
    ],
  };
  const { vehicles, generatedAtMs } = normalizeColectivosBody(body);
  assert.equal(vehicles.length, 1);
  assert.equal(vehicles[0].lat, -34.61);
  assert.equal(vehicles[0].route, '60A');
  assert.equal(generatedAtMs, 1757390100000);
});

test('routeColorHsl is stable per route', () => {
  assert.deepEqual(routeColorHsl('152A'), routeColorHsl('152A'));
  assert.notEqual(routeColorHsl('152A').h, routeColorHsl('60').h);
});
