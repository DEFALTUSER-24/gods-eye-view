import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeSeriesIds,
  chunkIds,
  mergeObservations,
  normalizeSeriesRows,
  parseInaTime,
  stationState,
} from './data/inaFeed.js';

const SERIES = {
  rows: [
    { id: 52, estacion: { id: 52, nombre: 'San Fernando', geom: { type: 'Point', coordinates: [-58.55, -34.4333] }, provincia: 'BUENOSAIRES', rio: 'LUJAN', propietario: 'PNA', nivel_alerta: 3, nivel_evacuacion: 3.5, red: { nombre: 'escalas Prefectura Nacional' } }, unidades: { abrev: 'm' }, date_range: { timeend: '2026-09-09T11:45:00' } },
    { id: 999, estacion: { id: 999, nombre: 'Sin geom' }, date_range: { timeend: '2026-09-09T11:45:00' } },
    { id: 1, estacion: { id: 1, nombre: 'Vieja', geom: { coordinates: [-58, -32] } }, date_range: { timeend: '2026-06-30T20:00:00' } },
  ],
};

test('INA: series rows → stations; local timestamps; active filter; chunks', () => {
  const stations = normalizeSeriesRows(SERIES);
  assert.equal(stations.size, 2);
  const sf = stations.get(52);
  assert.equal(sf.name, 'San Fernando');
  assert.equal(sf.alertM, 3);
  assert.equal(sf.lastObsMs, Date.parse('2026-09-09T11:45:00-03:00'));
  assert.equal(parseInaTime('2026-09-09T14:45:00.000Z'), Date.parse('2026-09-09T14:45:00Z'));
  assert.deepEqual(activeSeriesIds(stations, Date.parse('2026-08-10T00:00:00Z')), [52]);
  assert.deepEqual(chunkIds([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('INA: observations merge keeps the newest value and states follow thresholds', () => {
  const stations = normalizeSeriesRows(SERIES);
  const touched = mergeObservations(stations, [
    { series_id: 52, timestart: '2026-09-09T14:45:00.000Z', valor: 0.74 },
    { series_id: 52, timestart: '2026-09-09T13:45:00.000Z', valor: 3.6 },
    { series_id: 424242, timestart: '2026-09-09T14:45:00.000Z', valor: 1 },
  ]);
  assert.equal(touched, 1);
  const sf = stations.get(52);
  assert.equal(sf.valueM, 0.74);
  assert.equal(stationState(sf), 'normal');
  sf.valueM = 2.8; assert.equal(stationState(sf), 'watch');
  sf.valueM = 3.1; assert.equal(stationState(sf), 'alert');
  sf.valueM = 3.6; assert.equal(stationState(sf), 'evacuation');
  assert.equal(stationState(stations.get(1)), 'unknown');
});
