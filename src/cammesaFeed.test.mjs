import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMMESA_REGIONS,
  formatMw,
  latestDemandPoint,
  latestGenerationPoint,
  normalizeGridPayload,
  peakDemand,
  sharePct,
} from './data/cammesaFeed.js';

const DEMAND = [
  { fecha: '2026-09-09T00:00:00.000-0300', demHoy: 17849, demAyer: 19334, demPrevista: 18185, tempHoy: 11.8 },
  { fecha: '2026-09-09T00:05:00.000-0300', demHoy: 17778, demAyer: 19110 },
  { fecha: '2026-09-09T00:10:00.000-0300', demAyer: 18942, demPrevista: 18000 },
];

test('latestDemandPoint returns the newest sample with a demand value', () => {
  const p = latestDemandPoint(DEMAND);
  assert.equal(p.demandMw, 17778);
  assert.equal(p.yesterdayMw, 19110);
  assert.equal(p.atMs, Date.parse('2026-09-09T00:05:00.000-0300'));
  assert.equal(latestDemandPoint([]), null);
  assert.equal(latestDemandPoint(null), null);
});

test('latestGenerationPoint and peakDemand', () => {
  const g = latestGenerationPoint([
    { fecha: '2026-09-09T00:00:00.000-0300', sumTotal: 17849.4, hidraulico: 5391.8, termico: 6520.3, nuclear: 1409.7, renovable: 4436.5, importacion: 91.1 },
    { fecha: '2026-09-09T00:05:00.000-0300' },
  ]);
  assert.equal(g.totalMw, 17849.4);
  assert.equal(g.nuclearMw, 1409.7);
  assert.equal(peakDemand(DEMAND), 17849);
});

test('normalizeGridPayload keeps only regions with coordinates and demand', () => {
  const data = normalizeGridPayload({
    generatedAt: 1,
    regions: [
      { id: 426, name: 'GBA', lat: -34.6, lon: -58.5, demandMw: 5097, forecastMw: 5372 },
      { id: 999, name: 'broken', lat: null, lon: -58, demandMw: 1 },
      { id: 998, name: 'no-demand', lat: -30, lon: -60 },
    ],
    total: { demandMw: 15313, generation: { totalMw: 15313, hydroMw: 5000 } },
  });
  assert.equal(data.regions.length, 1);
  assert.equal(data.regions[0].id, '426');
  assert.equal(data.total.generation.hydroMw, 5000);
  assert.equal(normalizeGridPayload({}), null);
});

test('formatMw / sharePct / region table', () => {
  assert.equal(formatMw(5097), '5.1 GW');
  assert.equal(formatMw(795), '795 MW');
  assert.equal(formatMw(NaN), '—');
  assert.equal(sharePct(5097, 15313), 33);
  assert.equal(sharePct(1, 0), null);
  assert.equal(new Set(CAMMESA_REGIONS.map((r) => r.id)).size, CAMMESA_REGIONS.length);
  for (const r of CAMMESA_REGIONS) {
    assert.ok(r.lat < -20 && r.lat > -56 && r.lon < -53 && r.lon > -74, `${r.name} anchor inside Argentina`);
  }
});
