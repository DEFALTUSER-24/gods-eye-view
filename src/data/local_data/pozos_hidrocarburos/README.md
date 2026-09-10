# Pozos de hidrocarburos — Neuquén, La Pampa, Tierra del Fuego

23767 wells (`local-pozos-hidrocarburos`) from three public provincial WFS services, snapshot 2026-09-10:
- Neuquén Hidrocarburos:Pozos: 20496
- La Pampa p_sec_energiaymineria:Pozo_hidrocarburifero: 1982
- Tierra del Fuego geonode:pozos_hc_tdf_202607: 1289

Sources: hidrocarburos.energianeuquen.gob.ar (`Hidrocarburos:Pozos`), geoidelp.lapampa.gob.ar
(`p_sec_energiaymineria:Pozo_hidrocarburifero`), tiles.tierradelfuego.gob.ar (`geonode:pozos_hc_tdf_202607`).
`tags.estado` is normalised to Activo / Inactivo / Abandonado / Sin dato; `tags.fluido` to Petróleo / Gas / Agua / …
Rebuild: `node scripts/build-provincias-layers.mjs pozos`.
