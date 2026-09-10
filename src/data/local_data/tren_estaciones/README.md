# Estaciones ferroviarias — Argentina (con servicio 2022) + Provincia de Buenos Aires (08/2026)

1213 points: 464 stations with service (IDE Transporte WFS `idera:Estacion_ffcc_serv_22.view`, CC-BY) plus
749 stations/halts from catalogo.datos.gba.gob.ar "Estaciones de ferrocarril 08/2026" (CC-BY 4.0) that were not within
~300 m of an existing point. Snapshot 2026-09-10. Rebuild: `node scripts/build-ba-static-layers.mjs trenes` then
`node scripts/build-caba-static-layers.mjs trenes`.
