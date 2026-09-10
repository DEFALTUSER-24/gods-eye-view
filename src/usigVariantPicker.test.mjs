import test from 'node:test';
import assert from 'node:assert/strict';
import { readPickerState, writePickerState, storageKeyFor } from './usigVariantPicker.js';

function fakeStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}

test('picker state round-trips and rejects unknown variants / bad alpha', () => {
  const store = fakeStorage();
  assert.equal(readPickerState(store, 'caba-fotos-aereas', ['1940']), null);
  writePickerState(store, 'caba-fotos-aereas', { variant: '1978', alpha: 0.6 });
  assert.deepEqual(readPickerState(store, 'caba-fotos-aereas', ['1940', '1978']), { variant: '1978', alpha: 0.6 });
  assert.deepEqual(readPickerState(store, 'caba-fotos-aereas', ['1940']), { variant: null, alpha: 0.6 });
  store.setItem(storageKeyFor('x'), JSON.stringify({ variant: 'a', alpha: 7 }));
  assert.deepEqual(readPickerState(store, 'x', ['a']), { variant: 'a', alpha: null });
  store.setItem(storageKeyFor('y'), '{not json');
  assert.equal(readPickerState(store, 'y', ['a']), null);
});
