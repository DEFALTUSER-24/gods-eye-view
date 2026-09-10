/**
 * Legends of the USIG thematic maps (bundled by scripts/build-usig-legends.mjs
 * from the Mapa Interactivo BA catalogue). Loaded lazily the first time a
 * legend is shown; ~230 KB with the swatch PNGs inlined.
 */

let _promise = null;

export function loadUsigLegends(importer = () => import('./local_data/usig_legends/usig_legends.json')) {
  if (!_promise) {
    _promise = importer().then((mod) => mod?.default || mod || {}).catch((error) => {
      console.warn('[usig-legends] load failed:', error?.message || error);
      _promise = null;
      return {};
    });
  }
  return _promise;
}

/** Rows to render for a variant (pure): items first, abstract as a note. */
export function legendFor(legends, variantId) {
  const entry = legends?.[variantId];
  if (!entry) return null;
  const items = (entry.items || []).filter((i) => i && i.label);
  const abstract = String(entry.abstract || '').trim();
  if (!items.length && !abstract) return null;
  return { title: entry.title || '', items, abstract };
}
