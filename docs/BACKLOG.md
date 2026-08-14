# Backlog: InvenTienda

Generado el 2026-08-13 a partir de `PRD.md` y `TECH-DESIGNv2.md` (TDD vigente, supersede a
`TECH-DESIGN.md` v1) + ADRs 0001–0009. Ordenado por **dependencia**, no por prioridad percibida:
cada ítem asume implementados los ítems de los que depende.

| # | Item | Alcance | Depende de | Contexto extra requerido |
|---|---|---|---|---|
| 1 | Fundaciones del monorepo | Monorepo con backend Fastify + Drizzle y SPA React/TS; Docker Compose para Postgres; pipeline code-first Zod → OpenAPI → tipos TS; sobre de error `{ error: { code, message, details? } }` y paginación `?page&pageSize`; infraestructura de migraciones | — | — |
| 2 | Autenticación y sesiones | Tablas Usuario/Sesión; login/logout con cookie `httpOnly` + `SameSite=Lax`; hash bcrypt/argon2; rate-limit/lockout de login; bootstrap del primer encargado (seed/script); middleware RBAC por endpoint | #1 | — |
| 3 | Gestión de usuarios | CRUD de usuarios y roles por el encargado; 403 a depósito; baja lógica de usuario | #2 | — |
| 4 | Gestión de proveedores | CRUD por el encargado, solo-lectura para depósito; baja lógica que preserva referencias e historial; vista maestro-detalle | #2 | — |
| 5 | Productos + ledger base | Tablas Producto y Movimiento con CHECKs (signo↔tipo, `es_discrepancia` solo en ajustes); CRUD con SKU único; stock inicial vía movimiento `ajuste` en la misma transacción (C2); edición sin `stock_actual` en el schema; permiso por campo `stock_minimo` — 403 `campo_reservado_encargado` (A7); baja lógica reservada al encargado; chips quiebre/bajo derivados | #2, #4 | — |
| 6 | Movimientos de inventario | Entradas/salidas/ajustes con UPDATE atómico condicional (`stock >= :n AND activo = true`); motivo obligatorio en ajustes y mermas; marca `es_discrepancia` al registrar ajustes; `stock_resultante` en la misma transacción; historial auditable por producto; flujo de alta en ≤ 3 pasos (modal 3 pasos del design.md) | #5 | — |
| 7 | Punto de venta | Tablas Venta/ItemVenta/Pago (`NUMERIC(12,2)`); venta multi-ítem en una única transacción con orden determinístico por `producto_id`; `numero_correlativo` por secuencia (huecos documentados); validación de pago (medio obligatorio, monto ≥ total, cálculo de vuelto); carrito en `localStorage` que sobrevive recargas; layout POS del design.md (catálogo + carrito); venta típica ≤ 1 minuto | #6 | — |
| 8 | Recibo interno | Documento derivado on-demand de Venta+ItemVenta+Pago (sin tabla propia); imprimible/descargable en cualquier momento; hereda el estado `anulada`; sin validez fiscal | #7 | — |
| 9 | Anulación de venta | Solo encargado; movimientos tipo `anulacion` (positivos, exentos de `activo = true` — A8); `Pago.estado → revertido` (revierte caja); marca de anulada con usuario/fecha/motivo; solo anulación total en v1 | #7 | — |
| 10 | Motor de alertas | Tabla Alerta; interfaz `EvaluadorDeAlertas` + `ReglasUmbral` dentro de la transacción del movimiento protegido por `SAVEPOINT` (C1); creación por cruce de umbral, de-duplicación por producto+tipo, auto-resolución de stock_bajo/quiebre, resolución manual de discrepancia (A10); alerta de discrepancia desde ajustes marcados (A9); vista de alertas + polling del conteo en la SPA | #6, #7 | — |
| 11 | Sugerencia de reposición | Heurística dentro de `ReglasUmbral`: promedio diario de salidas de 30 días, cobertura < 14 días, mínimo 7 días de historia, promedio 0 nunca sugiere (S7); resolución manual por el encargado | #10 | — |
| 12 | Reportes | Stock actual, bajo mínimo, movimientos por período y discrepancias globales para el encargado; depósito solo reportes operativos con filtrado por dueño (`WHERE usuario_id = :actor`) y sin discrepancias globales; estados vacíos explícitos; paginación | #6, #7 | — |
| 13 | Dashboard / KPIs | Pantalla de inicio con KPI cards del design.md (quiebres, stock bajo, actividad reciente, alertas activas); chips de estado; navegación por rol con 🔒 | #6, #10 | — |
| 14 | Operación local | Verificación periódica de consistencia stock ↔ Σ(ledger); script de backup `pg_dump` programado (Task Scheduler) hacia ubicación fuera del disco principal | #5 | — |

**Nota sobre contexto extra:** ningún ítem requiere documentación de reglas de negocio externa —
todo lo especializado (heurística de reposición, ciclo de vida de alertas, política de stock
nunca-negativo, matriz de permisos) ya está definido en `PRD.md` y `TECH-DESIGNv2.md`. La única
área que traería reglas de dominio externas (normativa de facturación fiscal) es **etapa 2** y
queda fuera de este backlog.

## Cómo usar este backlog

Cada ítem es una spec independiente. Al implementarlo, arrancá un ciclo de Spec-Driven
Development (`sdd-new` o el flujo equivalente de tu harness) usando este ítem como el
"change" — no el proyecto completo. Si la columna "Contexto extra requerido" tiene algo,
compartilo como contexto al generar la spec de ese ítem.

Referencias por ítem: los códigos entre paréntesis (C1, C2, A7–A11, S6–S10) apuntan a las
resoluciones de la Ronda 2 en `REVISION-ADVERSARIAL.md`, detalladas en `TECH-DESIGNv2.md`.
