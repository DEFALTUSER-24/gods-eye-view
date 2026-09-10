# Salud pública provincial (fuera de Buenos Aires)

2663 points (`local-prov-salud`) from the provincial IDE GeoServers, snapshot 2026-09-10:
- Córdoba idecor:Centros_Salud: 889
- Corrientes salud_ide:Hospital: 53
- Corrientes salud_ide:CAPS: 90
- Corrientes salud_ide:SAPS: 74
- Jujuy geonode:efectores_de_salud_caps: 88
- Jujuy geonode:efectores_de_salud_puestos_de_salud: 155
- Jujuy geonode:efectores_de_salud_cic: 18
- Jujuy geonode:efectores_de_salud_nodos: 9
- Río Negro geonode:HOSPITALES: 35
- Río Negro geonode:CENTROS_DE_SALUD_10_2021_b: 170
- Salta geonode:rfes: 871
- Santa Cruz min_salud:estab_sanitarios_pubypriv_v11: 67
- Tierra del Fuego geonode:centros_atencion_salud_publica: 23
- Chaco idechaco:centros-salud: 42
- La Pampa p_min_salud:centros_salud: 79

Buenos Aires (CABA + PBA) is covered by the "Salud pública BA" layer. `tags.healthcare` is normalised to
Hospital / internación, Centro de salud, Clínica or Servicio complementario; `tags.provincia` and `tags.fuente` name the source.
Rebuild: `node scripts/build-provincias-layers.mjs salud`.
