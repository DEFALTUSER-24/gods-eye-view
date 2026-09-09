#!/usr/bin/env node
/**
 * Append Argentine dams (OpenStreetMap via Overpass) to the bundled Dams
 * dataset. The shipped snapshot (OpenInfraMap-derived) had zero features in
 * Argentina; this pulls waterway/man_made/building=dam inside the AR boundary
 * and writes them in the same feature shape the local layer already reads.
 *
 *   node scripts/build-argentina-dams.mjs            # append + rewrite
 *   node scripts/build-argentina-dams.mjs --dry-run  # report only
 *
 * License: ODbL 1.0 — keep "© OpenStreetMap contributors" attribution.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'src', 'data', 'local_data', 'dams');
const JSONL = path.join(DIR, 'dams.geojsonl');
const GEOJSON = path.join(DIR, 'dams.geojson');
const README = path.join(DIR, 'README.md');
const DRY_RUN = process.argv.includes('--dry-run');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const QUERY = `
[out:json][timeout:240];
area["ISO3166-1"="AR"]["admin_level"="2"]->.ar;
(
  way["waterway"="dam"](area.ar);
  way["man_made"="dam"](area.ar);
  way["building"="dam"](area.ar);
  relation["waterway"="dam"](area.ar);
  relation["man_made"="dam"](area.ar);
  node["waterway"="dam"](area.ar);
);
out tags geom center;
`;

/** Drop contact/note fields the shipped snapshot also strips (privacy transform). */
function cleanTags(tags = {}) {
  const out = {};
  for (const [key, value] of Object.entries(tags)) {
    if (/^(contact|phone|email|fax|note|fixme|website:contact)/i.test(key)) continue;
    if (typeof value === 'string' && /@|\+?\d[\d\s-]{7,}\d/.test(value) && /note|contact|phone|email/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function ringClosed(coords) {
  const a = coords[0]; const b = coords[coords.length - 1];
  return a && b && a[0] === b[0] && a[1] === b[1];
}

function toFeature(el) {
  const tags = cleanTags(el.tags);
  let geometry = null;
  if (el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
    geometry = { type: 'Point', coordinates: [el.lon, el.lat] };
  } else if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2) {
    const coords = el.geometry.map((p) => [p.lon, p.lat]);
    geometry = ringClosed(coords) && coords.length >= 4
      ? { type: 'Polygon', coordinates: [coords] }
      : { type: 'LineString', coordinates: coords };
  } else if (el.center && Number.isFinite(el.center.lat)) {
    geometry = { type: 'Point', coordinates: [el.center.lon, el.center.lat] };
  }
  if (!geometry) return null;
  const osmId = el.type === 'relation' ? -Math.abs(el.id) : el.id;
  return {
    id: osmId,
    type: 'Feature',
    geometry,
    properties: {
      id: osmId,
      tags,
      type: 'dam',
      osm_id: osmId,
      osm_type: el.type,
      country: 'AR',
    },
  };
}

async function queryOverpass() {
  let lastError = null;
  for (const endpoint of ENDPOINTS) {
    try {
      console.log(`[dams:AR] querying ${endpoint} …`);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'gods-eye-view-dams-build/1.0' },
        body: `data=${encodeURIComponent(QUERY)}`,
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json.elements)) throw new Error('no elements');
      return json.elements;
    } catch (error) {
      lastError = error;
      console.warn(`[dams:AR] ${endpoint} failed: ${error?.message || error}`);
    }
  }
  throw lastError || new Error('all Overpass endpoints failed');
}

const elements = await queryOverpass();
const fresh = elements.map(toFeature).filter(Boolean);
console.log(`[dams:AR] ${elements.length} OSM elements → ${fresh.length} features`);

const existingLines = readFileSync(JSONL, 'utf8').split(/\r?\n/).filter((l) => l.trim());
const existing = existingLines.map((l) => JSON.parse(l));
const known = new Set(existing.map((f) => String(f?.properties?.osm_id ?? f?.id)));
const added = fresh.filter((f) => !known.has(String(f.properties.osm_id)));
const named = added.filter((f) => f.properties.tags?.name).length;
console.log(`[dams:AR] ${added.length} new (${named} with a name); ${fresh.length - added.length} already present`);

if (DRY_RUN) {
  for (const f of added.slice(0, 25)) console.log('  -', f.properties.tags?.name || `(unnamed ${f.properties.osm_type} ${f.properties.osm_id})`);
  process.exit(0);
}

const merged = [...existing, ...added];
writeFileSync(JSONL, merged.map((f) => JSON.stringify(f)).join('\n') + '\n');
writeFileSync(GEOJSON, JSON.stringify({ type: 'FeatureCollection', features: merged }));

const readme = readFileSync(README, 'utf8')
  .replace(/Feature count: \d+/, `Feature count: ${merged.length}`)
  + (readFileSync(README, 'utf8').includes('Argentina') ? '' : `
## Argentina supplement (${new Date().toISOString().slice(0, 10)})

The original snapshot had no dams inside Argentina. \`scripts/build-argentina-dams.mjs\`
appends \`waterway=dam\` / \`man_made=dam\` / \`building=dam\` features inside the
AR boundary straight from OpenStreetMap (Overpass), tagged \`country: "AR"\`
(${added.length} features, ${named} named — e.g. Yacyretá, Salto Grande, El Chocón, Piedra del Águila).
Same ODbL 1.0 terms and the same privacy transform (contact/note fields dropped).
`);
writeFileSync(README, readme);
console.log(`[dams:AR] wrote ${merged.length} features to ${path.relative(ROOT, JSONL)}`);
