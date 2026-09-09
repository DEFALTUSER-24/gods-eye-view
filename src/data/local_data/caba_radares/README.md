# Fotomultas BA — CABA + Provincia de Buenos Aires

Two public snapshots merged into one point layer (`local-caba-radares`):

- **CABA** (224 points): "Cámaras fijas de control vehicular" — Buenos Aires Ciudad open data,
  https://data.buenosaires.gob.ar/dataset/camaras-fijas-control-vehicular — CC-BY-2.5-AR.
  `tags.enforcement` = "Cinemómetro" (speed) or "Analítica de video" (red light / lane).
- **Provincia** (252 points): "Radares" — Provincia de Buenos Aires open data repository
  https://github.com/datos-provincia-abierta/Radares (`base_radares_estandarizada.geojson`), the same file
  the provincial site infraccionesba.gba.gob.ar/radares uses. Fields: ruta, km, sentido, municipio, estado.
  `tags.propietario` = "Provincial".

Rebuild: `node scripts/build-ba-static-layers.mjs radares` (2026-09-09).
