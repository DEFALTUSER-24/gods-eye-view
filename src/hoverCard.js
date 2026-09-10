/**
 * Shared hover card: one small DOM tooltip that follows the pointer and shows
 * a title + detail lines for whatever a layer reports under the cursor
 * (RENABAP polygons, bike lanes, bus routes…). Layers call `showHoverCard`
 * on MOUSE_MOVE and `hideHoverCard(owner)` when nothing of theirs is picked;
 * the `owner` tag keeps two layers from hiding each other's card.
 */

let _card = null;
let _owner = null;

function ensureCard(doc) {
  if (_card && _card.isConnected) return _card;
  if (!doc?.body) return null;
  const card = doc.createElement('div');
  card.id = 'gev-hover-card';
  card.className = 'gev-hover-card';
  card.hidden = true;
  card.innerHTML = '<div class="gev-hover-title"></div><div class="gev-hover-details"></div>';
  doc.body.appendChild(card);
  _card = card;
  return card;
}

/** Trim/limit lines for the card (pure). */
export function hoverLines(details, { max = 6, maxLen = 90 } = {}) {
  return (details || [])
    .map((line) => String(line ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, max)
    .map((line) => (line.length > maxLen ? `${line.slice(0, maxLen - 1)}…` : line));
}

/** Keep the card inside the viewport, offset from the pointer (pure). */
export function placeCard({ x, y, width, height, viewportWidth, viewportHeight, offset = 14 }) {
  let left = x + offset;
  let top = y + offset;
  if (left + width + 8 > viewportWidth) left = Math.max(4, x - width - offset);
  if (top + height + 8 > viewportHeight) top = Math.max(4, y - height - offset);
  return { left, top };
}

export function showHoverCard({ x, y, title, details = [], accent = '#4fd8ff', owner = 'layer', doc = globalThis.document } = {}) {
  const card = ensureCard(doc);
  if (!card) return;
  _owner = owner;
  card.querySelector('.gev-hover-title').textContent = String(title || '').slice(0, 72);
  const box = card.querySelector('.gev-hover-details');
  box.innerHTML = '';
  for (const line of hoverLines(details)) {
    const div = doc.createElement('div');
    div.className = 'gev-hover-line';
    div.textContent = line;
    box.appendChild(div);
  }
  card.style.setProperty('--hover-accent', accent);
  card.hidden = false;
  const width = card.offsetWidth || 220; const height = card.offsetHeight || 60;
  const { left, top } = placeCard({
    x, y, width, height,
    viewportWidth: doc.documentElement.clientWidth || 1280,
    viewportHeight: doc.documentElement.clientHeight || 720,
  });
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

export function hideHoverCard(owner = null) {
  if (!_card) return;
  if (owner && _owner && owner !== _owner) return; // someone else's card
  _card.hidden = true;
  _owner = null;
}
