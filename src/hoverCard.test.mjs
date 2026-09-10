import test from 'node:test';
import assert from 'node:assert/strict';
import { hoverLines, placeCard } from './hoverCard.js';
import { legendFor } from './data/usigLegends.js';

test('hoverLines trims, drops blanks and caps length/count', () => {
  assert.deepEqual(hoverLines(['  a  b ', '', null, 'c']), ['a b', 'c']);
  assert.equal(hoverLines(['x'.repeat(120)])[0].length, 90);
  assert.equal(hoverLines(Array.from({ length: 10 }, (_, i) => `l${i}`)).length, 6);
});

test('placeCard keeps the card inside the viewport', () => {
  assert.deepEqual(placeCard({ x: 10, y: 10, width: 200, height: 80, viewportWidth: 1000, viewportHeight: 700 }), { left: 24, top: 24 });
  const flipped = placeCard({ x: 950, y: 680, width: 200, height: 80, viewportWidth: 1000, viewportHeight: 700 });
  assert.deepEqual(flipped, { left: 736, top: 586 });
});

test('legendFor returns rows + abstract, null when the map has neither', () => {
  const legends = {
    terrenos: { title: 'Precios', abstract: 'Serie 2001-2011', items: [{ label: 'Diciembre 2001', icon: 'data:image/png;base64,AA==' }, { label: '' }] },
    poblacion: { title: 'Población', abstract: 'Censo 2010', items: [] },
    vacio: { title: 'Nada', abstract: '', items: [] },
  };
  assert.equal(legendFor(legends, 'terrenos').items.length, 1);
  assert.equal(legendFor(legends, 'poblacion').abstract, 'Censo 2010');
  assert.equal(legendFor(legends, 'vacio'), null);
  assert.equal(legendFor(legends, 'missing'), null);
  assert.equal(legendFor(null, 'terrenos'), null);
});
