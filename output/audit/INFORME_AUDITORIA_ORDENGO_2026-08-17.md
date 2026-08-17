# Auditoría integral de OrdenGO

**Fecha:** 17 de agosto de 2026  
**Alcance:** aplicación web, API, reglas de negocio, permisos, persistencia, reportes PDF, experiencia móvil, dependencias y rendimiento de entrega.  
**Modalidad:** revisión estática del código, compilación, pruebas automatizadas, inspección visual pública y análisis de un PDF real. No se modificaron datos productivos.

## 1. Resumen ejecutivo

La aplicación compila correctamente, las dependencias productivas no presentan vulnerabilidades conocidas en el registro de paquetes y las cinco pruebas unitarias existentes pasan. El acceso público se adapta correctamente a 390 × 844 px y no genera desbordamiento horizontal. El PDF de estado de proyecto revisado presenta una base visual sólida.

Sin embargo, la auditoría identifica **6 riesgos críticos**, **10 riesgos altos**, **6 riesgos medios** y **2 oportunidades menores**. Los riesgos prioritarios no son cosméticos: afectan aislamiento entre usuarios, privacidad en dispositivos compartidos, consistencia de inventario, trazabilidad financiera y confiabilidad de los reportes.

Los cuatro frentes que deben atenderse primero son:

1. Reemplazar la autorización de órdenes basada en nombres por identificadores inmutables de usuario.
2. Hacer transaccionales el cierre de órdenes, el consumo de inventario y sus movimientos financieros.
3. Evitar almacenar fotos, firmas, ubicación y borradores completos en `localStorage` o JSONB/base64.
4. Aplicar permisos de solo lectura reales al perfil Monitor Oficina y limitar el contenido de `/api/bootstrap` por rol.

## 2. Alcance, método y limitaciones

### Verificaciones ejecutadas

- Compilación productiva del frontend con Vite: **correcta**.
- Pruebas del servidor: **5/5 correctas**.
- Cobertura del único archivo probado (`domainRules.js`): líneas 100%, funciones 100%, ramas 68,42%.
- Auditoría de dependencias productivas: **0 vulnerabilidades conocidas** en servidor y web.
- Inspección estática de rutas, validaciones, permisos, reglas financieras, inventario, offline, Gantt y generación PDF.
- Medición de la entrega pública de recursos.
- Revisión visual de acceso público en escritorio y teléfono.
- Renderizado e inspección de las tres páginas del reporte de estado disponible.

### Limitaciones

- No había una conexión local o credencial de base de datos de solo lectura disponible. Por seguridad no se reutilizaron secretos presentes en historiales o registros previos. Por ello, las consultas de calidad de datos incluidas al final están preparadas, pero **no fueron ejecutadas contra producción**.
- La aplicación productiva no disponía de una sesión de auditoría autenticada. Se verificó el acceso público, pero los recorridos autenticados deben repetirse con usuarios desechables de cada rol.
- No se hicieron pruebas de carga destructivas ni escritura sobre producción.

## 3. Hallazgos priorizados

### OGO-SEC-001 — Acceso a órdenes determinado por el nombre del técnico

**Impacto:** crítico · confidencialidad y autorización horizontal  
**Evidencia:** `server/index.js`, funciones `orderAssignedNames` y `orderVisibleToUser` (aprox. líneas 674–681).

La autorización compara el nombre normalizado del usuario con nombres guardados en la orden. El correo es único, pero el nombre no lo es y además puede cambiar.

**Reproducción:** crear dos técnicos de campo con el mismo nombre visible; asignar una orden a uno; iniciar sesión con el segundo y solicitar la orden. Ambos nombres normalizan al mismo valor.

**Corrección:** guardar `assignedTechIds` y `techId` con UUID/ID inmutable, migrar órdenes históricas y usar nombres solo para presentación. Denegar por defecto si la migración es ambigua.

**Regresión:** pruebas de API con nombres duplicados, cambio de nombre, técnico inactivo y orden sin asignación.

### OGO-SEC-002 — Datos sensibles y órdenes completas en almacenamiento local sin protección

**Impacto:** crítico · privacidad, pérdida de datos y dispositivos compartidos  
**Evidencia:** `web/src/offline.js` escribe la cola en `localStorage`; `web/src/App.jsx` encola el objeto completo de la orden y conserva borradores que incluyen cliente, GPS, fotos, firmas y notas.

`localStorage` es legible por cualquier script del mismo origen y persiste después de cerrar sesión. Además, una orden con imágenes base64 puede superar la cuota del navegador; la escritura no ofrece una recuperación robusta al técnico.

**Reproducción:** crear una orden offline con imágenes/firma, cerrar sesión y abrir el almacenamiento desde el mismo dispositivo; o adjuntar varias imágenes hasta superar la cuota.

**Corrección:** IndexedDB por usuario, blobs separados, cifrado con clave de sesión/dispositivo, cuota previa, borrado/bloqueo al cerrar sesión y estado explícito de sincronización con reintento.

**Regresión:** dispositivo compartido A→logout→B; cuota agotada; cierre abrupto; sincronización duplicada; adjunto corrupto.

### OGO-DATA-003 — Cierre de orden y descuento de inventario no atómicos

**Impacto:** crítico · stock, costos y trazabilidad  
**Evidencia:** `server/index.js`, `adjustPartStock` y flujo de finalización de órdenes (aprox. líneas 591 y 2261).

El stock se limita con `GREATEST(0, stock + delta)`, pero el movimiento registra el delta solicitado. Por ejemplo, stock 1 y consumo 5 deja saldo 0 y movimiento −5. Además, el cierre procesa materiales fuera de una transacción, captura errores y puede completar la orden después de descontar solo parte del inventario.

**Reproducción:** orden con dos materiales; provocar falta de stock o error en el segundo. Verificar orden completada, primer material descontado y segundo pendiente.

**Corrección:** una transacción con bloqueo `SELECT ... FOR UPDATE` o actualización condicional, política explícita de faltantes/backorder y movimiento por cantidad realmente aplicada. Orden, stock, ledger y gasto deben confirmar o revertir juntos.

**Regresión:** concurrencia de dos cierres sobre el mismo repuesto, falta parcial, reintento de cierre y rollback inducido.

### OGO-DATA-004 — Eliminación de órdenes puede dejar stock y finanzas huérfanos

**Impacto:** crítico · integridad contable e inventario  
**Evidencia:** `DELETE /api/orders/:id` elimina la orden sin revertir consumos ni conciliar movimientos `EXP-ORDER-*`.

**Reproducción:** completar una orden con material y costo, eliminarla, consultar inventario, movimientos y finanzas.

**Corrección:** reemplazar eliminación por anulación con motivo, usuario y fecha. Si la política admite reversión, generar contramovimientos transaccionales; nunca borrar el rastro original.

**Regresión:** anulación antes/después de facturar, orden con múltiples repuestos y orden ya cobrada.

### OGO-DATA-005 — Eliminar una compra recibida no revierte el ingreso de stock

**Impacto:** crítico · inventario inflado  
**Evidencia:** `server/index.js`, eliminación de compras (aprox. líneas 1430–1439) borra finanzas y compra, pero no revierte `stockAppliedAt`.

**Reproducción:** recibir una compra, confirmar incremento, eliminarla y volver a consultar el stock.

**Corrección:** impedir el borrado de una compra recibida o aplicar una anulación transaccional con movimiento inverso. Conservar documento y auditoría.

**Regresión:** compra no recibida, recibida parcialmente, recibida y usada por una orden.

### OGO-SEC-006 — Monitor Oficina no es estrictamente de solo lectura

**Impacto:** crítico · permisos mal asignados  
**Evidencia:** la interfaz describe al monitor como solo visualización, pero las rutas de pizarra en `server/index.js` (aprox. líneas 1578, 1590 y 1607) exigen autenticación, no permiso de escritura.

**Reproducción:** iniciar sesión como Monitor Oficina y enviar POST/PATCH/DELETE directamente a las rutas de pizarra.

**Corrección:** middleware central de capacidades y denegación explícita para Monitor en todas las mutaciones. No confiar en botones ocultos.

**Regresión:** matriz automatizada rol × ruta × método para administrador, oficina, campo y monitor.

### OGO-SEC-007 — `/api/bootstrap` expone datos maestros más allá de la necesidad del rol

**Impacto:** alto · minimización de datos  
**Evidencia:** `server/index.js` (aprox. líneas 811–873) retorna todos los clientes a todos los perfiles autenticados, con CUIT, domicilio, teléfono, correo, contactos y plantas.

**Reproducción:** iniciar sesión con técnico o monitor, inspeccionar la respuesta de bootstrap aunque el módulo Clientes no sea visible.

**Corrección:** DTO mínimo por rol y alcance; para campo entregar solo clientes/sitios necesarios para órdenes asignadas. Aplicar autorización en consulta, no solo en UI.

**Regresión:** snapshots de campos y cantidades permitidas por rol.

### OGO-AUD-008 — La bitácora de auditoría está creada pero no se utiliza

**Impacto:** alto · trazabilidad y no repudio  
**Evidencia:** existe `auditChange`, pero no hay invocaciones en CRUD normal; `/api/audit-log` consulta una tabla que permanece vacía.

**Reproducción:** editar permisos, costos, presupuesto o stock y consultar la bitácora.

**Corrección:** registrar dentro de la misma transacción actor, acción, entidad, ID, antes/después, IP, correlación y motivo. Hacer la bitácora append-only y aplicar retención.

**Regresión:** toda mutación financiera, de inventario, permisos y estados debe producir exactamente un evento auditable.

### OGO-DATA-009 — Modelo JSONB sin integridad referencial suficiente

**Impacto:** alto · registros huérfanos, incompletos y difíciles de consultar  
**Evidencia:** la mayoría de entidades usa `{id, data jsonb}` sin claves foráneas ni restricciones. Las eliminaciones de cliente/proyecto no cubren todas las relaciones con órdenes y listas.

**Reproducción:** eliminar proyecto o cliente referenciado por una orden/lista y buscar referencias al ID eliminado.

**Corrección:** extraer columnas relacionales críticas (`client_id`, `project_id`, `order_id`, `part_id`, estado, fechas), agregar FK/UNIQUE/CHECK y soft delete. Mantener JSONB solo para extensiones no críticas.

**Regresión:** suite de restricciones y migración que reporte huérfanos antes de activar FK.

### OGO-DATA-010 — Ajustes manuales de stock no completan el ledger

**Impacto:** alto · imposibilidad de reconciliación  
**Evidencia:** el PATCH de repuestos actualiza el stock sin crear siempre un `stock_movement` ni una entrada de auditoría.

**Reproducción:** editar stock manualmente y comparar saldo con suma de movimientos.

**Corrección:** endpoint específico de ajuste con motivo obligatorio, movimiento compensatorio y permiso administrativo. Derivar o conciliar saldo contra ledger.

**Regresión:** identidad `saldo inicial + movimientos = saldo actual` para cada repuesto.

### OGO-DATA-011 — Validación incompleta al editar tareas Gantt

**Impacto:** alto · grafos corruptos y planificación inconsistente  
**Evidencia:** la creación valida padre y predecesores dentro del proyecto; PATCH solo impide autoparentado e inversión de fechas.

**Reproducción:** editar una tarea con `parentId` inexistente/de otro proyecto o formar un ciclo A→B→A.

**Corrección:** reutilizar la misma validación en create/update, validar pertenencia, existencia y ciclos dentro de una transacción.

**Regresión:** referencias cruzadas, ciclos directos/indirectos y borrado de predecesor.

### OGO-FIN-012 — IVA de egresos fijo al 21% no representa el régimen real

**Impacto:** alto · posición fiscal estimada incorrecta  
**Evidencia:** compras soportan tasas variables, pero un movimiento financiero solo ofrece `vatIncluded` y normaliza a 21%.

**Reproducción:** registrar comprobante al 10,5%, 27%, exento o crédito no computable y comparar la posición mensual.

**Corrección:** líneas impositivas por alícuota, neto, IVA, percepción/retención, condición fiscal, porcentaje computable y período fiscal. Hasta entonces rotular el indicador como **estimación no fiscal**.

**Regresión:** facturas con múltiples alícuotas, nota de crédito, exento y redondeos centavo a centavo.

### OGO-FIN-013 — Regla de facturación duplicada entre servidor, interfaz y PDF

**Impacto:** alto · importes divergentes  
**Evidencia:** horas facturables y mínimos aparecen implementados en `server/domainRules.js`, `web/src/App.jsx` y `web/src/pdf.js`.

**Reproducción:** cambiar una regla en una capa, generar vista y PDF con la misma orden y comparar.

**Corrección:** paquete de dominio compartido o cálculo autoritativo del servidor con desglose firmado/versionado. El PDF debe consumir el mismo resultado, no recalcularlo.

**Regresión:** fixtures contractuales idénticos para API, UI y PDF: mínimo 2 h, espera facturable, varios técnicos, tarifa histórica y redondeos.

### OGO-PERF-014 — Bootstrap monolítico y refrescos duplicados del monitor

**Impacto:** alto · latencia, transferencia y carga de base  
**Evidencia:** bootstrap consulta tablas completas y devuelve órdenes con imágenes/firmas. El monitor agenda refrescos de 60 s y otro boot de 15 s, coincidiendo cada minuto.

**Reproducción:** abrir monitor, registrar solicitudes durante 65 s y comparar duplicados; aumentar órdenes con fotos y medir payload/heap.

**Corrección:** endpoints paginados/resumen, blobs bajo demanda, cursor de cambios/ETag o SSE/WebSocket, y un único scheduler con backoff.

**Regresión:** presupuesto de payload, número máximo de consultas/minuto y prueba con 10.000 órdenes.

### OGO-PERF-015 — Recursos pesados precargados, sin compresión ni caché inmutable

**Impacto:** alto · tiempo de carga y consumo móvil  
**Evidencia medida en producción:** HTML 200 en ~333 ms; carga inicial precarga aproximadamente 1,85 MB sin comprimir: principal 822,7 KB, gráficos 553,5 KB, PDF 391,4 KB y CSS 78,3 KB. Los recursos con hash respondieron `Cache-Control: max-age=0` y sin gzip/brotli.

**Reproducción:** sesión privada con caché vacía, inspeccionar headers y modulepreload antes de iniciar sesión.

**Corrección:** brotli/gzip, `public,max-age=31536000,immutable` para archivos con hash, lazy import de gráficos/PDF/OCR después del login y presupuesto de bundle en CI.

**Regresión:** Lighthouse/WebPageTest móvil, límite JS inicial <350 KB gzip y verificación automatizada de headers.

### OGO-PERF-016 — Adjuntos base64 dentro de JSON/JSONB

**Impacto:** alto · memoria, WAL, backups y latencia  
**Evidencia:** límite JSON del servidor de 24 MB; fotos, comprobantes y firmas se transportan/almacenan como data URI.

**Reproducción:** cargar varios adjuntos cercanos al límite y medir memoria, tamaño de fila y tiempo de actualización/backup.

**Corrección:** almacenamiento de objetos, subida directa, metadatos en DB (clave, MIME, tamaño, hash, propietario), URLs firmadas y miniaturas. Antivirus y política de retención.

**Regresión:** archivo grande, MIME falso, imagen corrupta, acceso cruzado y eliminación con retención.

### OGO-REP-017 — El reporte de proyecto oculta riesgos después del décimo

**Impacto:** medio · información incompleta para dirección  
**Evidencia visual:** el resumen indica 13 tareas atrasadas, pero la tabla de riesgos muestra solo 10. El código aplica `.slice(0, 10)` sin avisar que existen más.

**Reproducción:** proyecto con más de diez tareas críticas/atrasadas y exportar PDF.

**Corrección:** listar todos en anexo paginado o indicar “Mostrando 10 de 13” con enlace/criterio de priorización.

**Regresión:** 0, 1, 10, 11 y 100 riesgos; verificar conteo y paginación.

### OGO-REP-018 — Posible solapamiento de observaciones y firma en constancia valorizada

**Impacto:** medio · legibilidad del documento  
**Evidencia estática:** `web/src/pdf.js` posiciona observaciones en coordenadas fijas y admite hasta seis líneas; la firma comienza alrededor de la misma cota vertical.

**Reproducción:** completar observaciones/recomendaciones largas y generar la constancia.

**Corrección:** layout por flujo calculando alturas, salto de página previo a firmas y bloque indivisible para conformidad.

**Regresión:** golden PDFs con texto corto, máximo, sin firma, dos firmas e imágenes verticales/horizontales.

### OGO-FIN-019 — Margen objetivo de 0% se reemplaza por 35%

**Impacto:** medio · cálculo comercial  
**Evidencia:** normalización de presupuesto usa `Number(targetMargin) || 35`; cero es falsy.

**Reproducción:** guardar margen objetivo 0% y reabrir el presupuesto.

**Corrección:** validación explícita/nullish: usar 35 solo cuando el valor sea ausente o inválido; aceptar el rango comercial definido.

**Regresión:** `0`, `0.0`, vacío, null, negativo y 100.

### OGO-RES-020 — Consulta BCRA sin timeout ni último valor persistente

**Impacto:** medio · disponibilidad de finanzas  
**Evidencia:** `fetch` del dólar mayorista no usa `AbortController`; la caché es solo en memoria.

**Reproducción:** simular conexión BCRA que no responde y reiniciar el proceso sin red.

**Corrección:** timeout 3–5 s, circuit breaker, último valor/fecha persistido en `app_settings`, indicador de antigüedad y refresh protegido.

**Regresión:** timeout, 500, respuesta malformada, fecha no hábil y valor stale.

### OGO-SEC-021 — Rate limiting local al proceso

**Impacto:** medio · fuerza bruta y escalado horizontal  
**Evidencia:** mapas en memoria para intentos/login y solicitudes; se reinician con deploy y no se comparten entre réplicas.

**Reproducción:** alternar entre dos instancias o reiniciar y continuar intentos.

**Corrección:** Redis o limitador del proxy por IP+usuario, ventanas diferenciadas, alertas y protección del endpoint de login.

**Regresión:** concurrencia multinodo, IPv6/proxy y límites sin bloquear usuarios legítimos.

### OGO-QA-022 — Cobertura insuficiente de flujos críticos

**Impacto:** medio · regresiones silenciosas  
**Evidencia:** solo existe un archivo de pruebas con cinco casos de reglas puras. No hay pruebas de autorización, rutas/DB, transacciones, offline, UI móvil ni PDFs.

**Corrección:** pirámide de pruebas propuesta en la sección 6. La cobertura de `domainRules.js` es buena en líneas pero 68,42% en ramas y no representa la aplicación completa.

### OGO-UX-023 — Acceso de escritorio desaprovecha el espacio disponible

**Impacto:** bajo · percepción y claridad  
**Evidencia visual:** formulario estrecho alineado a la izquierda y gran vacío en 1440 × 900. En 390 × 844 no se detectó overflow.

**Corrección:** composición centrada o panel dividido con beneficios/estado del servicio; mantener el formulario a 400–480 px y jerarquía consistente.

### OGO-PWA-024 — Manifiesto sin iconos completos

**Impacto:** bajo · instalación móvil  

**Corrección:** iconos 192/512, máscara, `theme_color`, `background_color`, nombre corto, captura e instalación PWA automatizada.

## 4. Evaluación por módulo

| Módulo | Estado | Riesgo dominante | Acción prioritaria |
|---|---|---|---|
| Autenticación/equipo | Requiere corrección | Autorización por nombre y limitación multinodo | IDs inmutables y matriz de capacidades |
| Monitor Oficina | Requiere corrección | Mutaciones directas disponibles | Middleware read-only global |
| Órdenes de trabajo | Crítico | Cierre no transaccional y offline sensible | Unidad de trabajo atómica + almacenamiento seguro |
| Inventario/compras | Crítico | Ledger inconsistente y borrados sin reversión | Inventario por movimientos y anulaciones |
| Proyectos/Gantt | Requiere corrección | Grafo editable sin validación completa | Integridad referencial/ciclos |
| Presupuestos | Requiere corrección | Margen 0 y duplicación de reglas | Dominio compartido y validación decimal |
| Finanzas/IVA | Requiere corrección | Modelo fiscal simplificado | Desglose tributario y trazabilidad documental |
| Clientes | Requiere corrección | Exceso de datos por rol y huérfanos | DTO por alcance + FK |
| Reportes | Base buena, riesgo medio | Truncado silencioso/layout fijo | Paginación y pruebas visuales |
| Panel/gráficos | Funcional | JS pesado precargado | Lazy loading y datos agregados |
| PWA/offline | Crítico | Privacidad, cuota y sincronización | IndexedDB segura y telemetría de sync |

## 5. Controles de base de datos preparados

Estas consultas son de solo lectura y deben ejecutarse primero en una réplica o sesión auditora. Los nombres exactos pueden requerir adaptación al esquema desplegado.

```sql
-- IDs duplicados
SELECT 'users' AS tabla, id, COUNT(*) FROM users GROUP BY id HAVING COUNT(*) > 1;
SELECT 'orders' AS tabla, id, COUNT(*) FROM orders GROUP BY id HAVING COUNT(*) > 1;

-- Correos duplicados ignorando mayúsculas/espacios
SELECT lower(trim(data->>'email')) AS email, COUNT(*)
FROM users
GROUP BY 1 HAVING COUNT(*) > 1;

-- Nombres duplicados que hacen insegura la autorización actual
SELECT lower(trim(data->>'name')) AS nombre, COUNT(*), array_agg(id)
FROM users
WHERE coalesce(data->>'role','') = 'field'
GROUP BY 1 HAVING COUNT(*) > 1;

-- JSON nulo o incompleto
SELECT id FROM orders
WHERE data IS NULL OR data->>'clientId' IS NULL OR data->>'status' IS NULL;

-- Proyectos/clientes huérfanos referenciados desde órdenes
SELECT o.id, o.data->>'projectId' AS project_id
FROM orders o LEFT JOIN projects p ON p.id::text = o.data->>'projectId'
WHERE nullif(o.data->>'projectId','') IS NOT NULL AND p.id IS NULL;

SELECT o.id, o.data->>'clientId' AS client_id
FROM orders o LEFT JOIN clients c ON c.id::text = o.data->>'clientId'
WHERE nullif(o.data->>'clientId','') IS NOT NULL AND c.id IS NULL;

-- Stock negativo/no numérico
SELECT id, data->>'stock' AS stock
FROM parts
WHERE (data->>'stock') !~ '^-?[0-9]+([.][0-9]+)?$'
   OR (data->>'stock')::numeric < 0;

-- Conciliación de stock actual con movimientos (ajustar saldo inicial si existe)
SELECT p.id,
       (p.data->>'stock')::numeric AS stock_actual,
       coalesce(sum(sm.delta),0) AS suma_movimientos
FROM parts p
LEFT JOIN stock_movements sm ON sm.part_id = p.id
GROUP BY p.id, p.data->>'stock'
HAVING (p.data->>'stock')::numeric <> coalesce(sum(sm.delta),0);

-- Movimientos financieros huérfanos
SELECT fm.id, fm.data->>'projectId' AS project_id
FROM financial_movements fm
LEFT JOIN projects p ON p.id::text = fm.data->>'projectId'
WHERE nullif(fm.data->>'projectId','') IS NOT NULL AND p.id IS NULL;

-- Posibles duplicados financieros por referencia externa
SELECT data->>'reference' AS referencia, data->>'type' AS tipo,
       data->>'amount' AS importe, COUNT(*)
FROM financial_movements
WHERE nullif(data->>'reference','') IS NOT NULL
GROUP BY 1,2,3 HAVING COUNT(*) > 1;

-- Fechas imposibles/invertidas en tareas
SELECT id, project_id, start_at, end_at
FROM gantt_tasks
WHERE start_at IS NULL OR end_at IS NULL OR end_at < start_at;

-- Auditoría ausente frente a actividad real
SELECT COUNT(*) AS eventos_auditoria FROM audit_log;
```

Antes de corregir datos: exportar resultados, clasificar falsos positivos, tomar respaldo y aplicar migraciones idempotentes con conteos antes/después.

## 6. Suite de regresión recomendada

### P0 — Bloqueo de liberación

- Autorización: cada rol contra cada ruta y método; IDs asignados, nombres duplicados y acceso cruzado.
- Cierre OT: orden + stock + movimiento + gasto en una única transacción; rollback en cada punto.
- Compras: recepción, anulación y consumo posterior.
- Offline: usuario compartido, reintentos, duplicidad, pérdida de red, cuota y archivos grandes.
- Finanzas: presupuesto aprobado→facturado→cobrado/pagado→anulado; consistencia mensual e IVA.

### P1 — Contrato y presentación

- Contratos API con esquema por rol y ausencia de campos sensibles.
- Integridad Gantt y ciclos.
- Golden PDFs con comparación visual y extracción de textos/importes.
- UI responsiva en 360, 390, 768, 1024 y 1440 px.
- Accesibilidad: teclado, foco, etiquetas, contraste y zoom 200%.

### P2 — Rendimiento y resiliencia

- 10.000 órdenes, 1.000 proyectos, 100.000 movimientos y documentos pesados.
- Presupuesto de consultas y payload por endpoint.
- Prueba de caída BCRA, DB lenta, almacenamiento de objetos y reanudación de sync.
- Lighthouse CI y límites de bundle/headers.

## 7. Plan de corrección

### 0–72 horas

1. Bloquear mutaciones del Monitor Oficina.
2. Corregir autorización por ID y agregar pruebas de acceso horizontal.
3. Deshabilitar eliminaciones destructivas de órdenes/compras recibidas hasta implementar anulaciones.
4. Evitar completar una orden si falla cualquier descuento de stock.
5. Rotar cualquier secreto que haya aparecido en logs históricos y revisar accesos.

### 1–2 semanas

1. Transacciones de inventario/OT/finanzas y ledger reconciliable.
2. DTO y consultas por rol; dividir bootstrap y adjuntos.
3. Auditoría append-only.
4. Unificar reglas de facturación.
5. Corregir reporte truncado y layout de firmas.
6. Cache/compresión/lazy loading.

### 3–6 semanas

1. Migrar adjuntos a object storage e IndexedDB offline segura.
2. Normalizar claves relacionales y activar restricciones.
3. Modelo fiscal por alícuotas y documentos.
4. E2E completo, golden PDFs, carga y observabilidad.

## 8. Recomendaciones de operación y observabilidad

- Sentry/APM o equivalente con correlación frontend–API–DB, ocultando PII.
- Métricas: p50/p95/p99 por endpoint, tamaño de bootstrap, fallos de sync, discrepancias de stock, fallos PDF, consultas lentas y tasa de 4xx/5xx por rol.
- Alertas: stock/ledger divergente, orden completada sin `stockDeductedAt`, movimiento financiero huérfano, cotización vencida y cola offline estancada.
- Backups con restauración ensayada, RPO/RTO documentados y prueba trimestral.
- SAST, secret scanning, SBOM y auditoría de dependencias en CI; CSP con dependencias runtime versionadas y verificadas.

## 9. Evidencias

- `login-desktop.jpg`: acceso productivo en 1440 × 900; evidencia del espacio desaprovechado.
- `login-mobile.jpg`: acceso productivo en 390 × 844; sin overflow horizontal detectado.
- `reporte_estado_vt2_syngenta_clasificacion.pdf`: PDF real de tres páginas usado para validar composición y el truncado de riesgos.

## 10. Criterio de aceptación global

La aplicación estará en condición de auditoría satisfactoria cuando: no exista acceso horizontal por identidad ambigua; todos los cambios críticos sean autorizados y auditables; inventario, órdenes y finanzas confirmen de forma atómica; los saldos reconcilien; los reportes coincidan con el cálculo autoritativo; no haya datos sensibles persistentes entre sesiones; y la suite P0 pase en CI y en un entorno de staging con datos anonimizados.
