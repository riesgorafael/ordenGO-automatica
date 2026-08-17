# Remediación de riesgos — OrdenGO

**Fecha:** 17 de agosto de 2026  
**Base:** `INFORME_AUDITORIA_ORDENGO_2026-08-17.md`

## Resultado

Se corrigieron los 24 hallazgos del relevamiento en el código de la aplicación. Las correcciones que dependen de datos productivos se ejecutan como migraciones idempotentes al iniciar la nueva versión; deben desplegarse primero con respaldo de PostgreSQL y verificarse con usuarios de prueba de cada rol.

## Controles implementados

| Hallazgo | Corrección aplicada |
|---|---|
| OGO-SEC-001 | Autorización de OT por `techId`/`assignedTechIds`; migración de nombres inequívocos; denegación por defecto de asignaciones ambiguas. Los técnicos ya no pueden cambiar asignaciones. |
| OGO-SEC-002 | Cola y borradores offline aislados por usuario en `sessionStorage`, limpieza al cerrar sesión, límite preventivo de 4 MB y aviso de cuota. JWT solo en cookie HttpOnly. CSP restrictiva activa. |
| OGO-DATA-003 | Cierre de OT, consumo, ledger, gasto y auditoría dentro de una única transacción; actualización condicional impide stock negativo y falla de forma completa si falta material. |
| OGO-DATA-004 | Las OT se anulan y archivan; se revierten stock y gasto generado dentro de la misma transacción y se conserva auditoría. |
| OGO-DATA-005 | Las compras se anulan; recepción, reversión de stock, cuenta por pagar y auditoría son atómicas. Se bloquea editar ítems de una compra recibida sin revertir antes la recepción. |
| OGO-SEC-006 | Monitor Oficina queda bloqueado en middleware de escritura de proyecto/pizarra y la UI oculta crear, duplicar, editar, compartir y eliminar. |
| OGO-SEC-007 | DTO mínimo de clientes para técnicos, sin CUIT, correo, teléfono ni contactos; solo clientes vinculados a proyectos habilitados u OT visibles. Monitor no recibe clientes. |
| OGO-AUD-008 | Bitácora utilizada en usuarios, configuración, clientes, proyectos, presupuestos, finanzas, OT, compras, inventario, proveedores, listas, tareas y pizarra. Incluye actor, antes/después resumido, motivo, IP y correlación de solicitud. |
| OGO-DATA-009 | Columnas relacionales generadas para cliente/proyecto y FK `NOT VALID`: toleran históricos pero impiden nuevos huérfanos. Eliminaciones verifican relaciones operativas. |
| OGO-DATA-010 | Todo ajuste manual genera movimiento con saldo real y auditoría; se bloquea borrar un repuesto con ledger histórico. |
| OGO-DATA-011 | PATCH de Gantt valida fechas, pertenencia, existencia de padre/predecesores y ciclos directos o indirectos. |
| OGO-FIN-012 | Gastos admiten IVA 10,5%, 21% o 27% y crédito computable 0%, 50% o 100%; servidor calcula neto, IVA y crédito. |
| OGO-FIN-013 | Reglas de horas mínimas, tarifa, visibilidad, margen e IVA se centralizaron en `shared/domainRules.js`, consumido por servidor, UI y PDF. |
| OGO-PERF-014 | Adjuntos salen del bootstrap, OT archivadas no se cargan y el monitor usa un solo refresco de 15 s. |
| OGO-PERF-015 | Compresión HTTP, caché inmutable para recursos con hash y carga dinámica de PDF/OCR/Gantt PDF. El JS principal queda en ~221 KB gzip; gráficos en ~157 KB gzip. |
| OGO-PERF-016 | Fotos, firmas y comprobantes nuevos se guardan como binarios separados en `file_assets`; migración automática de base64 histórico; límite 12 MB, firma mágica/MIME, SHA-256, tamaño y autorización por entidad. |
| OGO-REP-017 | El PDF ya no trunca silenciosamente riesgos después del décimo; pagina el contenido completo. |
| OGO-REP-018 | Se verificó el bloque de firmas y el flujo del documento; la descarga resuelve adjuntos protegidos antes de generar el PDF. |
| OGO-FIN-019 | Margen objetivo 0% es válido y no se reemplaza por 35%. |
| OGO-RES-020 | BCRA mayorista con timeout de 5 s, último valor bueno persistido, fecha de cotización y fallback ante caída/reinicio. |
| OGO-SEC-021 | Rate limiting persistente en PostgreSQL, compartido entre réplicas y resistente a reinicios. |
| OGO-QA-022 | Pruebas de dominio ampliadas: mínimo facturable, tarifa, IVA, margen 0 y autorización por ID. Compilación y auditorías integradas en la verificación. |
| OGO-UX-023 | Acceso responsive y composición de escritorio/móvil mantenidos sin desbordamiento; mensajes destructivos ahora explican la anulación y sus reversiones. |
| OGO-PWA-024 | Manifiesto completo e icono instalable/maskable agregado. |

## Verificación ejecutada

- Sintaxis Node: correcta en servidor y Gantt.
- Pruebas: **8/8 correctas**.
- Build productivo Vite: correcto.
- Dependencias productivas: **0 vulnerabilidades conocidas** en servidor y web.
- `git diff --check`: sin errores de espacios o marcadores.

## Validación obligatoria de despliegue

1. Tomar respaldo de PostgreSQL.
2. Desplegar una única réplica primero para ejecutar migraciones idempotentes.
3. Confirmar en logs la migración `file_assets_migration_v1` y revisar que no haya archivos con firma inválida.
4. Probar matriz de roles: Administrador, Gerente, Técnico de campo, Técnico de oficina y Monitor Oficina.
5. Completar y anular una OT de prueba; comprobar stock, ledger, finanzas y auditoría.
6. Recibir y anular una compra de prueba; comprobar la misma reconciliación.
7. Registrar gastos con IVA 10,5%, 21% y 27%, y revisar la posición mensual.
8. Generar reportes cliente, cliente valorizado e interno con textos e imágenes largos.

La migración de adjuntos separa los binarios de las filas JSONB y deja una interfaz `/api/files/:id`; si el volumen crece, esa interfaz permite migrar posteriormente el contenido a almacenamiento de objetos sin cambiar el contrato del frontend.
