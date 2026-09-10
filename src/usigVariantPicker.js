import { legendFor } from './data/usigLegends.js';

/**
 * DISPLAY-panel group for a USIG imagery layer with variants (historical
 * aerial photos by year, thematic city maps).
 *
 * Same anatomy as the 3D / Scope / POI CABA groups: one big toggle button
 * (turns the data layer on/off), a single-select chip row (the year or the
 * map) and an opacity slider, both only visible while the layer is on. The
 * chosen variant and opacity persist per browser.
 */

export function storageKeyFor(layerId) {
  return `gev:usig-variant:${layerId}:v1`;
}

/** Read the persisted { variant, alpha } (pure, storage injected). */
export function readPickerState(storage, layerId, validIds = []) {
  try {
    const raw = storage?.getItem?.(storageKeyFor(layerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const variant = validIds.includes(parsed?.variant) ? parsed.variant : null;
    const alpha = Number(parsed?.alpha);
    return { variant, alpha: Number.isFinite(alpha) && alpha > 0 && alpha <= 1 ? alpha : null };
  } catch {
    return null;
  }
}

export function writePickerState(storage, layerId, state) {
  try { storage?.setItem?.(storageKeyFor(layerId), JSON.stringify(state)); } catch { /* private mode */ }
}

/**
 * @param {object} layer - USIG imagery layer (getVariants / setVariant / setAlpha)
 * @param {object} opts
 * @param {object} [opts.dataManager] - DataLayerManager, to toggle the layer
 * @param {string} [opts.label] - text on the big toggle button
 * @param {string} [opts.icon]
 * @param {string} [opts.chipsLabel] - aria label for the chip row
 * @param {Function} [opts.loadLegends] - () => Promise<legends json>; when given, a legend row
 *   (swatch + label per class, plus the map's abstract) follows the chosen variant
 */
export function initUsigVariantPicker(layer, {
  dataManager = null,
  label = 'Mapa',
  icon = '🗺️',
  chipsLabel = 'Variantes',
  loadLegends = null,
  container = null,
  storage = null,
  doc = globalThis.document,
} = {}) {
  if (!layer || !doc || typeof layer.getVariants !== 'function') return null;
  const host = container || doc.getElementById('pp-toggles');
  if (!host) return null;
  const variants = layer.getVariants();
  if (!variants.length) return null;
  const store = storage || (() => { try { return globalThis.localStorage; } catch { return null; } })();
  const layerId = layer.id;
  const saved = readPickerState(store, layerId, variants.map((v) => v.id));
  if (saved?.variant) layer.setVariant(saved.variant);
  if (saved?.alpha) layer.setAlpha(saved.alpha);

  const slug = String(layerId).replace(/[^a-z0-9]+/gi, '-');
  const group = doc.createElement('div');
  group.className = `pp-toggle-group usig-variant-group ${slug}-group`;
  group.innerHTML = `
    <button class="pp-toggle-btn usig-variant-toggle" id="${slug}-toggle" type="button" aria-pressed="false" title="${layer.name || label}">
      <span class="pp-icon"></span>
      <span class="pp-label"></span>
    </button>
    <div class="pp-slider-row usig-variant-row" id="${slug}-chip-row">
      <div class="pp-chip-wrap" role="radiogroup"></div>
    </div>
    <div class="pp-slider-row usig-variant-row" id="${slug}-alpha-row">
      <span class="pp-slider-mini-label">Opacidad</span>
      <input class="pp-slider usig-variant-alpha" type="range" min="10" max="100" step="5" aria-label="Opacidad">
      <span class="pp-slider-value usig-variant-alpha-value"></span>
    </div>
    <div class="pp-slider-row usig-variant-row usig-legend-row" id="${slug}-legend-row" hidden>
      <div class="usig-legend" role="list" aria-label="Referencias"></div>
    </div>
  `;
  const toggle = group.querySelector('.usig-variant-toggle');
  toggle.querySelector('.pp-icon').textContent = icon;
  toggle.querySelector('.pp-label').textContent = label;
  const rows = Array.from(group.querySelectorAll('.usig-variant-row'));
  const wrap = group.querySelector('.pp-chip-wrap');
  wrap.setAttribute('aria-label', chipsLabel);
  const slider = group.querySelector('.usig-variant-alpha');
  const sliderValue = group.querySelector('.usig-variant-alpha-value');
  const chips = new Map();
  const legendRow = group.querySelector('.usig-legend-row');
  const legendBox = group.querySelector('.usig-legend');
  let legends = null;

  function renderLegend() {
    if (!legendRow) return;
    const legend = legends ? legendFor(legends, layer.getVariant()) : null;
    legendBox.innerHTML = '';
    if (!legend) { legendRow.hidden = true; return; }
    for (const item of legend.items) {
      const row = doc.createElement('div');
      row.className = `usig-legend-item${item.heading ? ' heading' : ''}`;
      row.setAttribute('role', 'listitem');
      if (item.icon) {
        const img = doc.createElement('img');
        img.className = 'usig-legend-swatch';
        img.alt = '';
        img.src = item.icon;
        row.appendChild(img);
      }
      const label = doc.createElement('span');
      label.className = 'usig-legend-label';
      label.textContent = item.label;
      row.appendChild(label);
      legendBox.appendChild(row);
    }
    if (legend.abstract) {
      const note = doc.createElement('div');
      note.className = 'usig-legend-abstract';
      note.textContent = legend.abstract;
      legendBox.appendChild(note);
    }
    legendRow.hidden = false;
  }

  if (typeof loadLegends === 'function') {
    Promise.resolve().then(loadLegends).then((data) => { legends = data || null; renderLegend(); }).catch(() => {});
  }

  const layerOn = () => Boolean(dataManager?.isEnabled?.(layerId));
  function syncToggle() {
    const on = layerOn();
    toggle.classList.toggle('active', on);
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    for (const row of rows) row.classList.toggle('visible', on);
  }

  function persist() {
    writePickerState(store, layerId, { variant: layer.getVariant(), alpha: layer.getAlpha() });
  }

  function syncChips() {
    const current = layer.getVariant();
    for (const [id, chip] of chips) {
      const on = id === current;
      chip.classList.toggle('active', on);
      chip.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  function syncAlpha() {
    const pct = Math.round(layer.getAlpha() * 100);
    slider.value = String(pct);
    sliderValue.textContent = `${pct}%`;
  }

  for (const variant of variants) {
    const chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = 'pp-chip usig-variant-chip';
    chip.setAttribute('role', 'radio');
    chip.dataset.variant = variant.id;
    chip.title = variant.hint || variant.label;
    chip.style.setProperty('--chip-color', '#4fd8ff');
    chip.innerHTML = `<span class="pp-chip-label"></span>`;
    chip.querySelector('.pp-chip-label').textContent = variant.label;
    chip.addEventListener('click', () => {
      layer.setVariant(variant.id);
      syncChips();
      renderLegend();
      persist();
    });
    chips.set(variant.id, chip);
    wrap.appendChild(chip);
  }
  slider.addEventListener('input', () => {
    layer.setAlpha(Number(slider.value) / 100);
    syncAlpha();
  });
  slider.addEventListener('change', persist);
  toggle.addEventListener('click', async () => {
    if (!dataManager?.setEnabled) return;
    toggle.disabled = true;
    try { await dataManager.setEnabled(layerId, !layerOn(), { origin: 'user' }); } catch (error) { console.warn(`[${layerId}] toggle error:`, error); }
    finally { toggle.disabled = false; syncToggle(); }
  });

  const anchor = doc.getElementById('param-slider-panel');
  if (anchor && anchor.parentElement === host) host.insertBefore(group, anchor); else host.appendChild(group);
  syncChips();
  syncAlpha();
  syncToggle();
  // The DATA LAYERS row can also flip the layer; keep the DISPLAY button honest.
  const syncTimer = setInterval(syncToggle, 1000);

  return {
    group,
    syncToggle,
    syncChips,
    setVariant: (id) => { if (layer.setVariant(id)) { syncChips(); renderLegend(); persist(); } },
    renderLegend,
    destroy: () => clearInterval(syncTimer),
  };
}
