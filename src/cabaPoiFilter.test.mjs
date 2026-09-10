import test from 'node:test';
import assert from 'node:assert/strict';
import { CABA_POI_CATEGORIES, categoryColor, readSelection, selectionPredicate, writeSelection } from './cabaPoiFilter.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('selection round-trips through storage and ignores unknown ids', () => {
  const store = memoryStorage();
  writeSelection(store, new Set(['cultura', 'bogus']));
  assert.deepEqual(Array.from(readSelection(store)), ['cultura']);
  assert.equal(readSelection(memoryStorage()), null);
});

test('predicate is null when everything is selected, else filters by category', () => {
  assert.equal(selectionPredicate(new Set(CABA_POI_CATEGORIES.map((c) => c.id))), null);
  const only = selectionPredicate(new Set(['deporte']));
  assert.equal(only({ tags: { category: 'deporte' } }), true);
  assert.equal(only({ tags: { category: 'cultura' } }), false);
  assert.equal(categoryColor('memoria'), '#cfd8dc');
  assert.equal(categoryColor('nope'), '#cfd8dc');
});
