#!/usr/bin/env node
/**
 * Bundle a simplified geometry of Argentina's national road network for the
 * "Estado de rutas" layer.
 *
 * Source: rutas.ar/data/rutas_nacionales.geojson — the Vialidad Nacional
 * SIG-Vial 2025 network (public WFS, sigvial.vialidad.gob.ar) already split by
 * DNV district with progresivas (km). One LineString per route × district ×
 * direction; we keep direction "A", drop the "D" twin, map district → province
 * and Douglas-Peucker to ~90 m so the whole country is ~350 KB.
 *
 *   node scripts/build-vialidad-routes.mjs [--tolerance 0.0008]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'src', 'data', 'local_data', 'vialidad_rutas');
const SOURCE_URL = 'https://rutas.ar/data/rutas_nacionales.geojson';
const tolArg = process.argv.indexOf('--tolerance');
const TOLERANCE_DEG = tolArg > 0 ? Number(process.argv[tolArg + 1]) : 0.0008;

const DISTRITO_TO_PROVINCIA = { 'Bahía Blanca': 'Buenos Aires' };

function perpDist(p, a, b) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Iterative Douglas-Peucker (stack based; routes have up to ~15k vertices). */
function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0; let idx = -1;
    for (let i = s + 1; i < e; i += 1) {
      const d = perpDist(points[i], points[s], points[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolerance && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return points.filter((_, i) => keep[i]);
}

console.log(`[rutas] fetching ${SOURCE_URL} …`);
const res = await fetch(SOURCE_URL, { headers: { 'User-Agent': 'gods-eye-view-routes-build/1.0' }, signal: AbortSignal.timeout(300_000) });
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const collection = await res.json();
let inputVertices = 0; let outputVertices = 0;
const features = [];
for (const f of collection.features || []) {
  const p = f.properties || {};
  if (String(p.sentido || 'A').toUpperCase() !== 'A') continue;
  if (f.geometry?.type !== 'LineString') continue;
  const coords = f.geometry.coordinates.map((c) => [c[0], c[1]]);
  inputVertices += coords.length;
  const simplified = simplify(coords, TOLERANCE_DEG).map((c) => [Number(c[0].toFixed(5)), Number(c[1].toFixed(5))]);
  outputVertices += simplified.length;
  const distrito = String(p.distrito || '').trim();
  const provincia = DISTRITO_TO_PROVINCIA[distrito] || distrito;
  const ruta = String(p.ruta || '').trim().toUpperCase();
  const id = `${ruta}|${provincia}|${p.progresiva_i || ''}`;
  features.push({
    type: 'Feature',
    id,
    geometry: { type: 'LineString', coordinates: simplified },
    properties: {
      id,
      ruta,
      provincia,
      distrito,
      pkStart: Number(p.progresiva_i) || 0,
      pkEnd: Number(p.progresiva_f) || 0,
      name: `RN ${ruta}`,
      tags: { ref: `RN ${ruta}`, name: `RN ${ruta} · ${provincia}` },
      type: 'route',
    },
  });
}
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, 'vialidad_rutas.geojsonl'), features.map((f) => JSON.stringify(f)).join('\n') + '\n');
writeFileSync(path.join(OUT_DIR, 'README.md'), `# Red vial nacional (Vialidad Nacional, 2025) — simplified

${features.length} LineStrings (one per route × province, direction "A"), ${outputVertices} vertices
(from ${inputVertices}; Douglas-Peucker tolerance ${TOLERANCE_DEG}° ≈ ${Math.round(TOLERANCE_DEG * 111_000)} m).

Source geometry: Vialidad Nacional SIG-Vial \`dnv:Red_Vial_Ncional2025\` (public WFS,
https://sigvial.vialidad.gob.ar/geoserver), as republished per DNV district with progresivas by
https://rutas.ar/data/rutas_nacionales.geojson. Public national road data; cite "Vialidad Nacional".
Properties: ruta, provincia, distrito, pkStart/pkEnd (km). Used by the "Estado de rutas" layer,
which colors each route-in-province with the live status from rutas.ar (scraped from Vialidad).

Rebuild: \`node scripts/build-vialidad-routes.mjs\` (${new Date().toISOString().slice(0, 10)}).
`);
console.log(`[rutas] ${features.length} features, ${inputVertices} → ${outputVertices} vertices`);
