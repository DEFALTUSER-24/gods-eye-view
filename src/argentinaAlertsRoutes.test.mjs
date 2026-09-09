import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeAlerts,
  alertLevel,
  capIndexLinks,
  eventKind,
  parseCapAlert,
  parseCapPolygon,
} from './data/smnCap.js';
import {
  normalizeRouteKey,
  normalizeTramos,
  summarizeByRoute,
} from './data/rutasFeed.js';

const CAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
<identifier>urn:oid:2.49.0.1.32.0.2026.09.09.08.55.28.1</identifier>
<sender>smn@smn.gob.ar</sender><sent>2026-09-09T08:55:28-03:00</sent>
<status>Actual</status><msgType>Update</msgType><scope>Public</scope>
<info><language>es-AR</language><category>Met</category><event>Tormentas</event>
<urgency>Future</urgency><severity>Moderate</severity><certainty>Likely</certainty>
<onset>2026-09-11T09:00:00-03:00</onset><expires>2026-09-11T14:59:59-03:00</expires>
<headline>Tormentas</headline>
<description>El &#225;rea ser&#225; afectada por tormentas de nivel amarillo con lluvias entre 20 y 40 mm.</description>
<area><areaDesc></areaDesc><polygon>-31.9,-64.68 -31.9,-64.64 -31.94,-64.68 -31.9,-64.68</polygon></area>
</info></alert>`;

test('CAP: index links, polygon order, alert parse, kinds and levels', () => {
  const html = '<div class="item"><a href="https://ssl.smn.gob.ar/feeds/CAP/xml_generados/CAP_20260909085538_Tormenta_Llanura_alertas_alertas_1.xml">x</a></div>'
    + '<a href="https://ssl.smn.gob.ar/feeds/CAP/xml_generados/CAP_20260909085538_Tormenta_Llanura_alertas_alertas_1.xml">dup</a>'
    + '<a href="https://ssl.smn.gob.ar/feeds/CAP/xml_generados/CAP_20260909085539_Nevada_Patagonia_alertas_alertas_14.xml">y</a>';
  assert.equal(capIndexLinks(html).length, 2);
  assert.deepEqual(parseCapPolygon('-31.9,-64.68 -31.9,-64.64 -31.94,-64.68 -31.9,-64.68'), [[-64.68, -31.9], [-64.64, -31.9], [-64.68, -31.94]]);
  const alert = parseCapAlert(CAP_XML, 'https://example/x.xml');
  assert.equal(alert.id, 'https://example/x.xml');
  assert.equal(alert.event, 'Tormentas');
  assert.equal(alert.kind, 'tormentas');
  assert.equal(alert.onsetMs, Date.parse('2026-09-11T09:00:00-03:00'));
  assert.equal(alert.polygon.length, 3);
  assert.match(alert.description, /^El área será/);
  assert.equal(alertLevel(alert.description), 'amarillo');
  assert.equal(eventKind('Viento Zonda'), 'zonda');
  assert.equal(eventKind('Nevadas'), 'nevadas');
  assert.equal(activeAlerts([alert], Date.parse('2026-09-12T00:00:00-03:00')).length, 0);
  assert.equal(activeAlerts([alert], Date.parse('2026-09-10T00:00:00-03:00')).length, 1);
  assert.equal(parseCapAlert('<alert><info><event>X</event></info></alert>'), null);
});

test('rutas: route keys, tramo normalization, worst-color summary', () => {
  assert.equal(normalizeRouteKey('A-001'), 'A1');
  assert.equal(normalizeRouteKey('A005'), 'A5');
  assert.equal(normalizeRouteKey('0003'), '3');
  assert.equal(normalizeRouteKey('1v03'), '1V03');
  assert.equal(normalizeRouteKey('RN 22'), '22');
  const tramos = normalizeTramos([
    { tramo_id: 1, ruta: '3', provincia: 'Buenos Aires', nombre_tramo: 'A - B', estado_raw: 'HABILITADA', estado_color: 'green', extension_km: '10' },
    { tramo_id: 2, ruta: '3', provincia: 'Buenos Aires', nombre_tramo: 'B - C', estado_raw: 'CORTE TOTAL', estado_color: 'red', observaciones: 'Km 692' },
    { tramo_id: 3, ruta: '3', provincia: 'Río Negro', nombre_tramo: 'X - Y', estado_raw: 'RESTRINGIDA', estado_color: 'blue' },
    { tramo_id: 4, ruta: '', provincia: 'Chubut' },
  ]);
  assert.equal(tramos.length, 3);
  const summary = summarizeByRoute(tramos);
  assert.equal(summary.get('3|buenos aires').color, 'red');
  assert.equal(summary.get('3|buenos aires').incidents.length, 1);
  assert.equal(summary.get('3|rio negro').color, 'blue');
});
