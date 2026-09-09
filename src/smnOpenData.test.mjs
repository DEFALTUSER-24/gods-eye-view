import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  joinObservations,
  parseEstaciones,
  parseSmnTimestamp,
  parseTiepre,
  parseWind,
  readFirstZipEntry,
  stationKey,
} from './data/smnOpenData.mjs';

/** Build a one-entry ZIP (deflated) the way SMN serves its text files. */
function makeZip(name, text) {
  const data = Buffer.from(text, 'latin1');
  const comp = deflateRawSync(data);
  const nameBuf = Buffer.from(name, 'latin1');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const localOffset = 0;
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(comp.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt32LE(localOffset, 42);
  const cdOffset = local.length + nameBuf.length + comp.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length + nameBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, comp, cd, nameBuf, eocd]);
}

const TIEPRE = [
  'Azul;09-septiembre-2026;02:00;Despejado;15 km;8.8;6.5; 68;Norte  14;999.3 / ',
  ' Bahía Blanca;09-septiembre-2026;02:00;Despejado;15 km;9.9;6.9; 69;Norte  24;1004.2 / ',
  ' Bolívar;08-septiembre-2026;21:00;Despejado;10 km;8;No se calcula; 78;Calma;1005.7 / ',
].join('\r\n');

const ESTACIONES = [
  'NOMBRE                         PROVINCIA                              LATITUD          LONGITUD       ALTURA  NRO   NroOACI',
  '                                                                    [gr]    [min]    [gr]    [min]       [m]',
  'AZUL AERO                      BUENOS AIRES                         -36      49       -59      53        147  87641 SAZA',
  'BAHIA BLANCA AERO              BUENOS AIRES                         -38      44       -62      10         83  87750 SAZB',
  'BASE BELGRANO II               ANTARTIDA                            -77      52       -34      37        256  89034 SAYB',
].join('\r\n');

test('readFirstZipEntry inflates a deflated single-entry zip', () => {
  const entry = readFirstZipEntry(makeZip('estado_tiempo.txt', TIEPRE));
  assert.equal(entry.name, 'estado_tiempo.txt');
  assert.equal(entry.data.toString('latin1'), TIEPRE);
});

test('parseTiepre reads temperature, wind, pressure and timestamps', () => {
  const rows = parseTiepre(TIEPRE);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, 'Azul');
  assert.equal(rows[0].tempC, 8.8);
  assert.equal(rows[0].windDirDeg, 0);
  assert.equal(rows[0].windKmh, 14);
  assert.equal(rows[0].pressureHpa, 999.3);
  assert.equal(rows[0].observedAt, Date.UTC(2026, 8, 9, 5, 0)); // 02:00 ART = 05:00 UTC
  assert.equal(rows[2].feelsC, null);
  assert.equal(rows[2].windKmh, 0);
});

test('parseEstaciones converts degree/minute pairs to decimal degrees', () => {
  const st = parseEstaciones(ESTACIONES);
  assert.equal(st.length, 3);
  assert.equal(st[0].name, 'AZUL AERO');
  assert.equal(st[0].province, 'BUENOS AIRES');
  assert.ok(Math.abs(st[0].lat - -36.8167) < 0.001);
  assert.ok(Math.abs(st[0].lon - -59.8833) < 0.001);
  assert.equal(st[0].wmo, '87641');
  assert.equal(st[0].icao, 'SAZA');
});

test('joinObservations matches accented names to the AERO station list', () => {
  const joined = joinObservations(parseTiepre(TIEPRE), parseEstaciones(ESTACIONES));
  assert.deepEqual(joined.map((s) => s.name), ['AZUL AERO', 'BAHIA BLANCA AERO']);
  assert.equal(joined[1].tempC, 9.9);
  assert.equal(joined[1].id, '87750');
});

test('stationKey / parseWind / parseSmnTimestamp edge cases', () => {
  assert.equal(stationKey('Bahía Blanca'), stationKey('BAHIA BLANCA AERO'));
  assert.deepEqual(parseWind('Calma'), { dirDeg: null, kmh: 0, label: 'Calma' });
  assert.equal(parseWind('Sudoeste  31').dirDeg, 225);
  assert.equal(parseSmnTimestamp('31-diciembre-2026', '23:30'), Date.UTC(2027, 0, 1, 2, 30));
  assert.equal(parseSmnTimestamp('bad', '00:00'), 0);
});
