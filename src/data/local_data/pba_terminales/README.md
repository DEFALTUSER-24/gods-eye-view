# Terminales de ómnibus y estaciones de peaje — Provincia de Buenos Aires

196 points (`local-pba-terminales`) from the IDEBA GeoServer (Infraestructura de Datos
Espaciales de la Provincia de Buenos Aires), WFS layers `IDEBA:Estacion_de_omnibus`
(105) and `IDEBA:estacion_de_peaje` (91) —
https://geoserver.ideba.gba.gob.ar/geoserver — snapshot 2026-09-10. The server drops accented letters
("Estaci?n"); the usual ones are repaired at build time. `tags.kind` = terminal | peaje.
Rebuild: `node scripts/build-pba-static-layers.mjs terminales`.
