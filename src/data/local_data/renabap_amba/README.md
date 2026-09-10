# RENABAP 2023 — barrios populares de CABA + Provincia de Buenos Aires

2103 of 6467 polygons from the official Registro Nacional de Barrios Populares release of
2023-12-05 (Secretaría de Integración Socio Urbana; datos.gob.ar dataset
https://datos.gob.ar/dataset/habitat-registro-nacional-de-barrios-populares, file
archivo.infraestructura.gob.ar/dataset/ssisu/20231205_info_publica.geojson). Public national registry.
Rings simplified 0.00015° (32714 → 21288 vertices). Fields: barrio, partido, localidad, year/decade, families,
dwellings, area (m²), kind (villa / asentamiento), tenure, electricity/water/sewage/cooking/heating access.
Snapshot 2026-09-10. Rebuild: `node scripts/build-caba-static-layers.mjs renabap`.
