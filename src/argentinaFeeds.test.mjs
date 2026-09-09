import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hotspotAgeBucket,
  hotspotPixelSize,
  normalizeHotspotCollection,
  parseConaeLocalTime,
} from './data/conaeFeed.js';
import {
  normalizeOutages,
  outagePixelSize,
  outageWindowText,
  parseEdesurDate,
} from './data/edesurFeed.js';
import {
  headlinePrice,
  parseCsv,
  productLabel,
  reduceStations,
} from './data/fuelFeed.js';

test('CONAE: local timestamps, dedupe, age buckets', () => {
  assert.equal(parseConaeLocalTime('2026-09-09 13:20:00'), Date.UTC(2026, 8, 9, 16, 20));
  const { hotspots, newestMs } = normalizeHotspotCollection({
    features: [
      { geometry: { type: 'Point', coordinates: [-61.02, -27.57] }, properties: { Id: 1, 'Fecha_Local_UTC-3': '2026-09-09 13:20:00', Satelite: 'GOES19', Fire_Radiative_Power: 65.2 } },
      { geometry: { type: 'Point', coordinates: [-61.02, -27.57] }, properties: { Id: 1, 'Fecha_Local_UTC-3': '2026-09-09 13:30:00', Satelite: 'GOES19', Fire_Radiative_Power: 70 } },
      { geometry: null, properties: { Id: 2 } },
    ],
  });
  assert.equal(hotspots.length, 1);
  assert.equal(hotspots[0].frpMw, 70);
  assert.equal(newestMs, Date.UTC(2026, 8, 9, 16, 30));
  const now = Date.UTC(2026, 8, 9, 17, 0);
  assert.equal(hotspotAgeBucket(newestMs, now), 0);
  assert.equal(hotspotAgeBucket(newestMs - 5 * 3600_000, now), 1);
  assert.equal(hotspotAgeBucket(newestMs - 30 * 3600_000, now), 3);
  assert.ok(hotspotPixelSize(400) > hotspotPixelSize(10));
});

test('Edesur: dates, bbox filter, sizing, window text', () => {
  assert.equal(parseEdesurDate('10/09/2026 08:00:00'), Date.UTC(2026, 8, 10, 11, 0));
  const outages = normalizeOutages([
    { fechaInicio: '10/09/2026 08:00:00', fechaFin: '10/09/2026 16:00:00', latitud: '-34.6676', longitud: '-58.3462', clientesAfectados: 638, motivo: 'Mantenimiento', localidad: 'AVELLANEDA', estadoCorte: 'Avisado' },
    { fechaInicio: '10/09/2026 08:00:00', latitud: '0', longitud: '0', clientesAfectados: 1 },
    { fechaInicio: '10/09/2026 09:00:00', latitud: '-34.7', longitud: '-58.4', clientesAfectados: 20, estadoCorte: 'En curso' },
  ]);
  assert.equal(outages.length, 2);
  assert.equal(outages[0].customers, 638);
  assert.equal(outages[0].active, false);
  assert.equal(outages[1].active, true);
  assert.ok(outagePixelSize(638) > outagePixelSize(20));
  assert.match(outageWindowText(outages[0].startMs, outages[0].endMs), /^\d{2}\/\d{2} \d{2}:\d{2}–\d{2}:\d{2}$/);
});

test('Fuel: CSV parser with quoted geojson, reduction, labels', () => {
  const csv = [
    'indice_tiempo,idempresa,cuit,empresa,direccion,localidad,provincia,region,idproducto,producto,idtipohorario,tipohorario,precio,fecha_vigencia,idempresabandera,empresabandera,latitud,longitud,geojson',
    '2026-05,1376,33-1,10 DE SETIEMBRE S.A.,"Av. Mosconi 299, esq. X",LOMAS DEL MIRADOR,BUENOS AIRES,PAMPEANA,2,Nafta (súper) entre 92 y 95 Ron,2,Diurno,1500,2026-05-01 12:43:00,28,PUMA,-34.658476,-58.529443,"{""type"":""Point"",""coordinates"":[-58.529443,-34.658476]}"',
    '2026-05,1376,33-1,10 DE SETIEMBRE S.A.,"Av. Mosconi 299, esq. X",LOMAS DEL MIRADOR,BUENOS AIRES,PAMPEANA,2,Nafta (súper) entre 92 y 95 Ron,3,Nocturno,1510,2026-05-01 12:43:00,28,PUMA,-34.658476,-58.529443,"{""type"":""Point"",""coordinates"":[-58.529443,-34.658476]}"',
    '2026-05,1376,33-1,10 DE SETIEMBRE S.A.,"Av. Mosconi 299, esq. X",LOMAS DEL MIRADOR,BUENOS AIRES,PAMPEANA,19,Gas Oil Grado 2,2,Diurno,2190,2026-05-01 12:43:00,28,PUMA,-34.658476,-58.529443,"{""type"":""Point"",""coordinates"":[-58.529443,-34.658476]}"',
    '2017-01,99,33-2,VIEJA,Calle 1,X,SANTA FE,CENTRO,2,Nafta (súper) entre 92 y 95 Ron,2,Diurno,20,2017-01-01 00:00:00,1,YPF,-31.6,-60.7,""',
  ].join('\n');
  const rows = parseCsv(csv);
  assert.equal(rows.length, 5);
  assert.equal(rows[1][4], 'Av. Mosconi 299, esq. X');
  assert.equal(rows[1][18], '{"type":"Point","coordinates":[-58.529443,-34.658476]}');
  const { stations, newestMs } = reduceStations(rows, { nowMs: Date.UTC(2026, 8, 9), maxAgeDays: 400 });
  assert.equal(stations.length, 1, 'the 2017 station is dropped as stale');
  assert.equal(stations[0].brand, 'PUMA');
  assert.equal(stations[0].prices.SUPER, 1500, 'daytime price wins over night at the same vigencia');
  assert.equal(stations[0].prices.DIESEL, 2190);
  assert.equal(newestMs, Date.UTC(2026, 4, 1, 15, 43));
  assert.deepEqual(headlinePrice(stations[0].prices), { label: 'SUPER', price: 1500 });
  assert.equal(productLabel('3', 'Nafta (premium) de más de 95 Ron'), 'PREMIUM');
  assert.equal(productLabel('6', 'GNC'), 'GNC');
});
