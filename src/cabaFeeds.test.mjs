import test from 'node:test';
import assert from 'node:assert/strict';
import { lineColor, normalizeSubte, statusIsNormal } from './data/subteFeed.js';
import { callWindow, normalizeCalls, statusKind } from './data/agpFeed.js';
import { joinAirQuality, latestReadings, parseStations, pm10Band } from './data/apraFeed.js';

test('subte: status parsing, colors, incidents', () => {
  assert.equal(statusIsNormal('Normal'), true);
  assert.equal(statusIsNormal(' normal. '), true);
  assert.equal(statusIsNormal('Estación Tribunales cerrada por obras'), false);
  assert.equal(lineColor('h'), '#f9b900');
  const notice = 'Estación Tribunales cerrada por obras de renovación integral.';
  const data = normalizeSubte(
    { features: [
      { id: 'estaciones_de_subte|6', geometry: { type: 'Point', coordinates: [-58.38, -34.60] }, properties: { Nombre: 'Tribunales', Linea: 'D', Estado: notice } },
      { id: 'estaciones_de_subte|7', geometry: { type: 'Point', coordinates: [-58.39, -34.61] }, properties: { Nombre: 'Callao', Linea: 'D', Estado: notice } },
      { id: 'estaciones_de_subte|8', geometry: { type: 'Point', coordinates: [-58.40, -34.62] }, properties: { Nombre: 'Malabia', Linea: 'B', Estado: 'Estación Malabia cerrada por obras.' } },
    ] },
    { features: [{ id: 'lineas_de_subte|1', geometry: { type: 'MultiLineString', coordinates: [[[-58.4, -34.6], [-58.39, -34.61]]] }, properties: { Nombre: 'Línea D', Linea: 'D', Estado: notice } }] },
  );
  assert.equal(data.stations.length, 3);
  assert.equal(data.stations[0].ok, false, 'Tribunales is named in the notice');
  assert.equal(data.stations[1].ok, true, 'Callao only inherits the line notice');
  assert.equal(data.stations[2].ok, false);
  assert.deepEqual(data.incidents, [`Línea D: ${notice}`, 'Malabia (B): Estación Malabia cerrada por obras.']);
});

test('agp: calls normalize to berths, finished calls drop, window formats', () => {
  const calls = normalizeCalls({ data: { totalCount: 2, data: [
    { id: 1, estado: 'operando', fechaETA: '2026-09-14T10:00:00.000Z', buque: { nombre: 'COSCO', esloraMaxima: 285, tipoBuque: { nombre: 'PORTACONTENEDORES' }, pais: { nombre: 'HONG KONG', isoCode: 'HK' } }, puertos: [{ ciudad: { nombre: 'Shanghai' }, tipo: 'O' }], movimientos: [{ muelle: { nombre: 'DNA C/6TA', latitud: -34.5811, longitud: -58.3641 } }] },
    { id: 2, estado: 'finalizado', buque: { nombre: 'X' }, movimientos: [{ muelle: { nombre: 'M', latitud: -34.58, longitud: -58.36 } }] },
    { id: 3, estado: 'proximo', buque: { nombre: 'Y' }, movimientos: [] },
  ] } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'operando');
  assert.equal(calls[0].origin, 'Shanghai');
  assert.equal(calls[0].lat, -34.5811);
  assert.equal(statusKind('Demorado'), 'demorado');
  const w = callWindow(Date.UTC(2026, 8, 10), 3, 7);
  assert.deepEqual(w, { from: '2026-09-07', to: '2026-09-17' });
});

test('apra: station CSV, latest readings per station, bands', () => {
  const stations = parseStations('long;lat;nombre;direccion;inicio_de_actividad;zona_de_emplazamiento;en_red;parametrios_medidos\n-58,3663;-34,6252;LA BOCA;AV. BRASIL 100;2009-05-01;ZONA MIXTA;2009-09-01;CO, NO2, PM10\n-58,4053;-34,5834;PALERMO;X;2009;ESTACION DESACTIVADA DESDE 2010;;CO');
  assert.equal(stations.length, 2);
  assert.equal(stations[0].id, 'la_boca');
  assert.equal(stations[1].inactive, true);
  const readings = latestReadings('fecha,hora,co_la_boca,no2_la_boca,pm10_la_boca,co_palermo,no2_palermo,pm10_palermo\n2026-09-04,4,0.23,8,16,,,\n2026-09-04,10,s/d,s/d,s/d,,,');
  assert.equal(readings.get('la_boca').pm10, 16);
  assert.equal(readings.get('la_boca').atMs, Date.parse('2026-09-04T04:00:00-03:00'));
  assert.equal(readings.has('palermo'), false);
  const joined = joinAirQuality(stations, readings);
  assert.equal(joined[0].band, 'good');
  assert.equal(joined[1].band, 'unknown');
  assert.equal(pm10Band(120), 'bad');
});
