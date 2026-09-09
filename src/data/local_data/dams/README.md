# Dams

Extracted from local decoded OpenInfraMap/PostGIS layers.

Filters: `waterway=dam`, `man_made=dam`, or `building=dam`.

Feature count: 1642

Runtime output: `dams.geojsonl`

License: Open Database License (ODbL) 1.0. Keep the OpenStreetMap contributor
attribution and the Open Infrastructure Map source credit when redistributing
this derived database.

The public-release snapshot removes contact-oriented fields and note values
that contain email or phone identifiers. The runtime layer does not display or
depend on those fields. Both `dams.geojson` and the runtime JSONL form carry the
same privacy transform.

## Argentina supplement (2026-09-09)

The original snapshot had no dams inside Argentina. `scripts/build-argentina-dams.mjs`
appends `waterway=dam` / `man_made=dam` / `building=dam` features inside the
AR boundary straight from OpenStreetMap (Overpass), tagged `country: "AR"`
(938 features, 189 named — e.g. Yacyretá-Apipé, Salto Grande, Alicurá, Casa de Piedra, El Nihuil, San Roque).
Same ODbL 1.0 terms and the same privacy transform (contact/note fields dropped).
