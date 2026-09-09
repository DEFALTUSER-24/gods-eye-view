import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePointRows, selectInRectangle } from './data/proximityPoints.js';

const JSONL = [
  JSON.stringify({ type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [-58.4, -34.6] }, properties: { name: 'Centro', tags: { police: 'COMISARIA' } } }),
  JSON.stringify({ type: 'Feature', id: 'b', geometry: { type: 'Point', coordinates: [-58.5, -34.7] }, properties: { tags: { name: 'Sur' } } }),
  JSON.stringify({ type: 'Feature', id: 'c', geometry: { type: 'Point', coordinates: [-62.2, -38.7] }, properties: { name: 'Bahía' } }),
  JSON.stringify({ type: 'Feature', id: 'd', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: {} }),
  'not json',
].join('\n');

test('parsePointRows keeps points only and resolves names from props or tags', () => {
  const rows = parsePointRows(JSONL);
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c']);
  assert.equal(rows[0].name, 'Centro');
  assert.equal(rows[1].name, 'Sur');
  assert.equal(rows[0].tags.police, 'COMISARIA');
  const custom = parsePointRows(JSONL, { nameOf: (p, t) => `${p.name || t.name} !` });
  assert.equal(custom[0].name, 'Centro !');
});

test('selectInRectangle filters by the expanded view and caps nearest the center', () => {
  const rows = parsePointRows(JSONL);
  const rect = { west: -58.6, east: -58.3, south: -34.75, north: -34.5 };
  assert.deepEqual(selectInRectangle(rows, rect).map((r) => r.id), ['a', 'b']);
  assert.deepEqual(selectInRectangle(rows, rect, { maxPoints: 1 }).map((r) => r.id), ['a']);
  assert.deepEqual(selectInRectangle(rows, null), []);
});
