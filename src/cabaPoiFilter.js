/**
 * DISPLAY-panel category chips for the "Puntos de interés CABA" layer.
 *
 * One bundled layer (17k points from the city's Mapa Interactivo BA) would be
 * unreadable at once, so the DISPLAY rail gets a chip per category. Chips are
 * multi-select, persisted per browser, and push a row predicate into the
 * proximity layer, which redraws only what is near the view anyway.
 */

export const CABA_POI_CATEGORIES = Object.freeze([
  { id: 'cultura', label: 'Cultura', color: '#ff8fd6' },
  { id: 'deporte', label: 'Deporte', color: '#4cd964' },
  { id: 'educacion', label: 'Educación', color: '#ffd166' },
  { id: 'salud', label: 'Salud', color: '#ff5c8a' },
  { id: 'social', label: 'Social', color: '#ffb347' },
  { id: 'seguridad', label: 'Seguridad', color: '#4f8cff' },
  { id: 'movilidad', label: 'Movilidad', color: '#4fd8ff' },
  { id: 'turismo', label: 'Turismo', color: '#c58cff' },
  { id: 'memoria', label: 'Memoria', color: '#cfd8dc' },
  { id: 'servicios', label: 'Servicios', color: '#7cffb2' },
]);

export const CABA_POI_STORAGE_KEY = 'gev:caba-poi-filter:v1';

export function categoryColor(category) {
  return CABA_POI_CATEGORIES.find((c) => c.id === category)?.color || '#cfd8dc';
}

/** Read the persisted selection; null = everything on (pure, storage injected). */
export function readSelection(storage) {
  try {
    const raw = storage?.getItem?.(CABA_POI_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = new Set(CABA_POI_CATEGORIES.map((c) => c.id));
    return new Set(parsed.filter((id) => valid.has(id)));
  } catch {
    return null;
  }
}

export function writeSelection(storage, selection) {
  try { storage?.setItem?.(CABA_POI_STORAGE_KEY, JSON.stringify(Array.from(selection))); } catch { /* private mode */ }
}

/** Build the predicate the layer applies; null when everything is selected. */
export function selectionPredicate(selection) {
  if (!selection || selection.size >= CABA_POI_CATEGORIES.length) return null;
  return (row) => selection.has(row.tags?.category);
}

/**
 * Mount the group into the DISPLAY panel and wire it to the layer.
 * Same anatomy as the 3D / Scope groups: one big toggle button (turns the
 * data layer on/off) and slider rows that are only visible while it is on.
 * @param {object} layer - the proximity layer (needs setFilter / countBy)
 * @param {object} [opts.dataManager] - DataLayerManager, to toggle the layer
 */
export function initCabaPoiFilter(layer, { dataManager = null, container = null, storage = null, doc = globalThis.document } = {}) {
  if (!layer || !doc) return null;
  const host = container || doc.getElementById('pp-toggles');
  if (!host) return null;
  const store = storage || (() => { try { return globalThis.localStorage; } catch { return null; } })();
  let selection = readSelection(store) || new Set(CABA_POI_CATEGORIES.map((c) => c.id));
  const layerId = layer.id;

  const group = doc.createElement('div');
  group.className = 'pp-toggle-group caba-poi-group';
  group.innerHTML = `
    <button class="pp-toggle-btn" id="caba-poi-toggle" type="button" aria-pressed="false" title="Puntos de interés CABA — prende la capa y elegí categorías">
      <span class="pp-icon">📍</span>
      <span class="pp-label">POI CABA</span>
    </button>
    <div class="pp-slider-row caba-poi-row" id="caba-poi-chip-row">
      <div class="pp-chip-wrap" role="group" aria-label="Categorías de puntos de interés CABA"></div>
    </div>
    <div class="pp-slider-row caba-poi-row" id="caba-poi-all-row">
      <span class="pp-slider-mini-label">Categorías</span>
      <div class="pp-mode-seg" role="group">
        <button class="pp-mode-btn caba-poi-all" type="button">Todas</button>
        <button class="pp-mode-btn caba-poi-none" type="button">Ninguna</button>
      </div>
    </div>
  `;
  const toggle = group.querySelector('#caba-poi-toggle');
  const rows = Array.from(group.querySelectorAll('.caba-poi-row'));
  const wrap = group.querySelector('.pp-chip-wrap');
  const chips = new Map();

  const layerOn = () => Boolean(dataManager?.isEnabled?.(layerId));
  function syncToggle() {
    const on = layerOn();
    toggle.classList.toggle('active', on);
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    for (const row of rows) row.classList.toggle('visible', on);
  }

  function apply() {
    writeSelection(store, selection);
    layer.setFilter?.(selectionPredicate(selection));
    for (const [id, chip] of chips) {
      const on = selection.has(id);
      chip.classList.toggle('active', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  for (const cat of CABA_POI_CATEGORIES) {
    const chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = 'pp-chip';
    chip.dataset.category = cat.id;
    chip.style.setProperty('--chip-color', cat.color);
    chip.innerHTML = `<span class="pp-chip-dot"></span><span class="pp-chip-label">${cat.label}</span><span class="pp-chip-count"></span>`;
    chip.addEventListener('click', () => {
      if (selection.has(cat.id)) selection.delete(cat.id); else selection.add(cat.id);
      apply();
    });
    chips.set(cat.id, chip);
    wrap.appendChild(chip);
  }
  group.querySelector('.caba-poi-all').addEventListener('click', () => { selection = new Set(CABA_POI_CATEGORIES.map((c) => c.id)); apply(); });
  group.querySelector('.caba-poi-none').addEventListener('click', () => { selection = new Set(); apply(); });
  toggle.addEventListener('click', async () => {
    if (!dataManager?.setEnabled) return;
    toggle.disabled = true;
    try { await dataManager.setEnabled(layerId, !layerOn(), { origin: 'user' }); } catch (error) { console.warn('[caba-poi] toggle error:', error); }
    finally { toggle.disabled = false; syncToggle(); }
  });

  const anchor = doc.getElementById('param-slider-panel');
  if (anchor && anchor.parentElement === host) host.insertBefore(group, anchor); else host.appendChild(group);
  apply();
  syncToggle();
  // The DATA LAYERS row can also flip the layer; keep the DISPLAY button honest.
  const syncTimer = setInterval(syncToggle, 1000);

  // Counts arrive once the dataset is loaded (lazy, on first enable).
  const fillCounts = () => {
    const counts = layer.countBy?.('category') || {};
    if (!Object.keys(counts).length) return false;
    for (const [id, chip] of chips) chip.querySelector('.pp-chip-count').textContent = counts[id] ? String(counts[id]) : '';
    return true;
  };
  if (!fillCounts()) {
    const timer = setInterval(() => { if (fillCounts()) clearInterval(timer); }, 3000);
  }
  return { group, apply, syncToggle, getSelection: () => new Set(selection), destroy: () => clearInterval(syncTimer) };
}
