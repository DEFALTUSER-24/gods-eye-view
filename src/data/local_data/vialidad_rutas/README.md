# Red vial nacional (Vialidad Nacional, 2025) — simplified

244 LineStrings (one per route × province, direction "A"), 16684 vertices
(from 262918; Douglas-Peucker tolerance 0.0008° ≈ 89 m).

Source geometry: Vialidad Nacional SIG-Vial `dnv:Red_Vial_Ncional2025` (public WFS,
https://sigvial.vialidad.gob.ar/geoserver), as republished per DNV district with progresivas by
https://rutas.ar/data/rutas_nacionales.geojson. Public national road data; cite "Vialidad Nacional".
Properties: ruta, provincia, distrito, pkStart/pkEnd (km). Used by the "Estado de rutas" layer,
which colors each route-in-province with the live status from rutas.ar (scraped from Vialidad).

Rebuild: `node scripts/build-vialidad-routes.mjs` (2026-09-09).
