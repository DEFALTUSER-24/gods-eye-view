import test from 'node:test';
import assert from 'node:assert/strict';
import { describePicked, formatCoords, googleMapsUrl } from './contextMenu.js';
import { streetViewUrl } from './streetViewLink.js';

test('urls and coordinate formatting', () => {
  assert.equal(googleMapsUrl(-34.6037, -58.3816), 'https://www.google.com/maps/search/?api=1&query=-34.603700,-58.381600');
  assert.equal(streetViewUrl(-34.6037, -58.3816, -90), 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=-34.603700,-58.381600&heading=270');
  assert.equal(formatCoords(-34.60370001, -58.3816), '-34.60370, -58.38160');
});

test('describePicked prefers a layer describePick, falls back to the id', () => {
  const modules = [{ id: 'fuel-prices', describePick: (id) => (id.startsWith('fuel:') ? { title: 'YPF · Palermo', details: ['SUPER $1.500'] } : null) }];
  assert.deepEqual(describePicked({ id: 'fuel:12', primitive: {} }, modules), { title: 'YPF · Palermo', details: ['SUPER $1.500'], position: null, source: 'fuel-prices' });
  assert.equal(describePicked({ id: 'ina:52', primitive: {} }, modules).title, '52');
  assert.equal(describePicked(null, modules), null);
});
