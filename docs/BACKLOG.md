# Backlog: InvenTienda

Generado el 2026-08-13 a partir de `PRD.md` y `TECH-DESIGNv2.md` (TDD vigente, supersede a
`TECH-DESIGN.md` v1) + ADRs 0001–0009. Ordenado por **dependencia**, no por prioridad percibida:
cada ítem asume implementados los ítems de los que depende.

Actualizado el 2026-08-25: se agregaron los ítems **2.1** y **2.2**, que surgieron de la ronda de
preguntas del ítem #3 y quedan antes de él por dependencia. La numeración 1–14 no se toca a
propósito — hay specs archivadas, memoria de proyecto y PRs mergeados que referencian esos números.

Actualizado el 2026-08-27: se agregaron los ítems **3.1** (pantalla de usuarios, fast-follow de UI del
#3) y **3.5** (recuperación de contraseña por email), ambos surgidos de la ronda de decisiones de
producto previa al ciclo SDD del #3.

Actualizado el 2026-08-28 (A): el ítem **#3** queda archivado. Las siete rutas de gestión de usuarios
están en `main` y en el contrato. Quedan pendientes sus dos derivados: **3.1** (la pantalla, que es
lo que vuelve usable esta API) y **3.5** (recuperación por email, todavía bloqueado por no tener
dominio propio).

Actualizado el 2026-08-28 (B): el ítem **3.1** (Pantalla de usuarios) queda archivado. La UI de
listado/detalle/CRUD para gestión de usuarios está en `main` con cobertura completa de test
(172 api + 157 web tests, 59 integration). Las dos nuevas specs (`app-layout` y `usuarios-ui`)
están promovidas a `openspec/specs/`.

| # | Item | Alcance | Depende de | Estado |
|---|---|---|---|---|
| 1 | Fundaciones del monorepo | Monorepo con backend Fastify + Drizzle y SPA React/TS; Docker Compose para Postgres; pipeline code-first Zod → OpenAPI → tipos TS; sobre de error `{ error: { code, message, details? } }` y paginación `?page&pageSize`; infraestructura de migraciones | — | ✅ Archivado |
| 2 | Autenticación y sesiones | Tablas Usuario/Sesión; login/logout con cookie `httpOnly` + `SameSite=Lax`; hash bcrypt/argon2; rate-limit/lockout de login; bootstrap del primer encargado (seed/script); middleware RBAC por endpoint | #1 | ✅ Archivado |
| 2.1 | App shell + login | Primer ciclo con UI: instalación del router (TanStack Router) con rutas tipadas y guardas público/protegido; pantalla de login según los tokens de `design.md`; parseo del sobre de error en `apps/web/src/api/client.ts` (hoy descarta el body y pierde el `code`); contexto de sesión + logout; formularios con `react-hook-form` + resolver de `zod`; cambio de contraseña que revoca **las demás** sesiones; flag `debe_cambiar_password` con cambio obligatorio **impuesto del lado del servidor** (allowlist acotada a cambiar-contraseña, logout y `/me`) — una guarda solo en el router del SPA es evitable con la cookie en mano | #2 | ✅ Archivado |
| 2.2 | Sistema de auditoría general | Tabla y servicio de auditoría **genéricos**, diseñados una sola vez para usuarios, proveedores y productos: quién, qué, cuándo y estado previo/posterior. No duplica ni reemplaza el ledger de movimientos de stock de #5/#6, que es contabilidad de existencias, no rastro de cambios. Da el no-repudio que exige el flujo de contraseña temporal de #3: sin rastro, un encargado que conoce la contraseña de un empleado hace que el registro no pruebe nada | #2 | ✅ Archivado |
| 2.3 | Bloqueo de login: verificar contraseña antes de rechazar | Cierra **SEC-001** (HIGH). Hoy el bloqueo se evalúa **antes** de `verifyPassword`, así que cualquiera que conozca el correo del encargado lo deja fuera indefinidamente con cinco peticiones cada cinco minutos — muy por debajo del límite de 10/min de la ruta. Mover el chequeo después de verificar: una contraseña correcta concede acceso aunque la cuenta esté bloqueada, y limpia el contador. Decisión cerrada en el ADR-0007 § Actualizado 2026-08-29. Descartado el bloqueo por IP mientras no exista `trustProxy` (ver 2.6), porque hoy todos los clientes comparten la IP del proxy de Vercel. Test: tras cinco fallos, el titular con la contraseña correcta entra | #2 | ✅ Hecho |
| 2.4 | Token de sesión almacenado como `sha256` | Cierra **SEC-008** (LOW, defensa en profundidad). Hoy el valor de la cookie **es** la clave primaria de `sesiones`, guardada en claro: una lectura de la base entrega sesiones vivas. Almacenar `sha256(token)`; `findValid` hashea antes de buscar; el token en claro viaja sólo en la cookie. Decisión cerrada en el ADR-0007 § Actualizado 2026-08-29 — la justificación original ('no hay un segundo secreto que sincronizar') se conserva, porque un hash no es un secreto. Invalida las sesiones activas al desplegar. Test de integración: `sesiones.id` **no** coincide con la cookie emitida y la sesión resuelve igual | #2 | ✅ Hecho |
| 2.5 | Seudonimizar el correo en las instantáneas de auditoría | Cierra **SEC-012** (LOW, gobierno del dato). Quitar `email` de los `auditableFields` de `usuarios` en `apps/api/src/auditoria/fields.ts`: la identidad del actor ya vive en `auditoria.usuario_id`, un UUID sin significado propio que basta para el no repudio. Decisión de producto cerrada en `PRD.md` § Supuestos y riesgos abiertos: rastro **permanente y sin datos personales**, descartada la ventana de retención con purga porque le pondría vencimiento al no repudio. Conviene hacerlo **antes de que el volumen del rastro crezca**. **Evaluado el 2026-08-30 y frenado a propósito**: mover `email` a `excludedFields` deja las filas de un cambio de-solo-correo con ambas instantáneas vacías — registran que algo cambió sin poder decir qué. Decisión de producto pendiente entre aceptar ese borde o guardar un marcador redactado; ver SEC-012 en `docs/SECURITY.md` | #2.2 | ⬜ Pendiente |
| 2.6 | `trustProxy` en la API y rate-limit por IP real | Cierra **SEC-003** (MEDIUM). El rate-limit de login usa `request.ip` y no hay `trustProxy` en ninguna parte de `apps/api/src`, así que detrás del rewrite de `vercel.json` todos los usuarios legítimos comparten un único balde de 10/min mientras un atacante que pega directo a Render obtiene uno privado por IP — exactamente al revés de lo que la spec ratificó. Habilita además el bloqueo por IP que el ADR-0007 dejó como refuerzo posterior de 2.3. **Cerrado el 2026-08-30**: `keyGenerator` con secreto compartido y `trustProxy` deliberadamente apagado, más el `middleware.ts` de Vercel que presenta el secreto. Verificado contra producción — doce peticiones directas a Render con `X-Forwarded-For` forjados distintos caen en un solo balde (401 x10, luego 429), y el login sigue funcionando a través de Vercel — ver SEC-003 en `docs/SECURITY.md` | #2 | ✅ Hecho |
| 3 | Gestión de usuarios | CRUD de usuarios y roles por el encargado; 403 a depósito; baja lógica de usuario; alta con contraseña temporal + cambio obligatorio en el primer ingreso; guarda que impide desactivar o degradar al último encargado activo | #2, #2.1, #2.2 | ✅ Archivado |
| 3.1 | Pantalla de usuarios | Fast-follow de UI para el #3: pantalla de listado/detalle de usuarios sobre el shell que ya dejó el #2.1 (router, formularios, contexto de sesión). Sale aparte porque el #3 es CRUD de backend según la letra del backlog, porque no hay wireframe aprobado (`Wireframes.dc.html`, citado por `design.md`, no está en el repo) y porque juntar API + UI arriesga el presupuesto de revisión en un cambio que ya toca la guarda de último encargado | #3 | ✅ Archivado |
| 3.5 | Recuperación de contraseña por email | Flujo propio de reset por correo: tabla de tokens con hash, expiración y un solo uso; endpoint de pedido con rate-limit y respuesta idéntica exista o no el mail (para no filtrar qué cuentas existen); endpoint de confirmación; puerto de mailer con fake para tests; dos pantallas. **Bloqueado por infraestructura, no por esfuerzo**: enviar a una dirección arbitraria exige un dominio cuyo DNS pueda llevar SPF/DKIM, y hoy no hay uno (el `*.web.app` de Firebase Hosting tiene el DNS de Google). Descartado adoptar Firebase Authentication: reemplaza el modelo cookie + `sesiones` que fija el ADR-0007 y deja huérfana la FK `auditoria.usuario_id` | #3, dominio propio | ⬜ Pendiente — bloqueado |
| 4 | Gestión de proveedores — backend | CRUD por el encargado, solo-lectura para depósito; baja lógica que preserva referencias e historial; **vista maestro-detalle diferida a 4.1** | #2, #2.1, #2.2 | ✅ Archivado |
| 4.1 | Proveedores — vista maestro-detalle (UI) | Fast-follow de UI para el #4 backend: selector maestro/detalle de proveedores con selección stateful y deep-linking; debe sentarse bajo `shellLayout` con gates de RBAC por componente (no `encargadoLayout`, que cierra el árbol); se integra con `NAV_ITEMS` en `AppShell.tsx`. Sale aparte porque el #4 es CRUD de backend según la letra del backlog, porque no hay wireframe aprobado para esta pantalla (la letra del backlog nombraba CRUD + vista juntas, pero `design.md:94-95` cita la vista como bloque y admite diseño responsive pendiente), y porque es la única UI genuinamente nueva sin precedente en el codebase — el costo driver es implementar patrón maestro/detalle de cero, no agregar campos | #4, #2.1 | ⬜ Pendiente |
| 5 | Productos + ledger base | Tablas Producto y Movimiento con CHECKs (signo↔tipo, `es_discrepancia` solo en ajustes); CRUD con SKU único; stock inicial vía movimiento `ajuste` en la misma transacción (C2); edición sin `stock_actual` en el schema; permiso por campo `stock_minimo` — 403 `campo_reservado_encargado` (A7); baja lógica reservada al encargado; chips quiebre/bajo derivados | #2, #2.2, #4 | ✅ Archivado |
| 6 | Movimientos de inventario | Entradas/salidas/ajustes con UPDATE atómico condicional (`stock >= :n AND activo = true`); motivo obligatorio en ajustes y mermas; marca `es_discrepancia` al registrar ajustes; `stock_resultante` en la misma transacción; historial auditable por producto; flujo de alta en ≤ 3 pasos (modal 3 pasos del design.md). **Cerrado el 2026-08-30** en nueve rebanadas apiladas (PRs #90 a #99) y **archivado el 2026-08-31** (PRs #100 a #103). Dos precisiones que el ciclo dejó por escrito: la **merma es un motivo sobre una `salida`, no un `tipo`** — se persiste en la columna `es_merma`, y no se agregó ningún valor al enum, que ya había sido rechazado en el #5; y el rechazo de ajuste a `deposito` es un **`403 FORBIDDEN`** de `config.roles`, no un código propio, porque el `preHandler` no admite override por ruta. La migración `0005` fue la primera del proyecto que no era aditiva libre de riesgo: exigió un conteo previo contra Neon antes de aplicarse | #5 | ✅ Archivado |
| 7 | Punto de venta | Tablas Venta/ItemVenta/Pago (`NUMERIC(12,2)`); venta multi-ítem en una única transacción con orden determinístico por `producto_id`; `numero_correlativo` por secuencia (huecos documentados); validación de pago (medio obligatorio, monto ≥ total, cálculo de vuelto); carrito en `localStorage` que sobrevive recargas; layout POS del design.md (catálogo + carrito); venta típica ≤ 1 minuto. **Cerrado y archivado el 2026-08-31** en diez rebanadas apiladas a `main` (PRs #105 a #114). Cobertura: 403 api unit + 375 web unit + 144 integration tests, todos en verde; claims-gate 50/50 confirmados, 0 refutados. Specs (`point-of-sale` y `pos-ui`) promovidas a `openspec/specs/`. Precisión que el ciclo dejó por escrito: la migración `0006_magical_mandarin.sql` (tablas `ventas`/`items_venta`/`pagos` y la secuencia `ventas_numero_correlativo_seq`) se aplica a mano contra Neon antes de confiar en `/api/ventas*` en producción, igual que el patrón que el #6 dejó documentado | #6 | ✅ Archivado |
| 8 | Recibo interno | Documento derivado on-demand de Venta+ItemVenta+Pago (sin tabla propia); imprimible/descargable en cualquier momento; hereda el estado `anulada`; sin validez fiscal | #7 | ✅ Archivado |
| 9 | Anulación de venta | Solo encargado; movimientos tipo `anulacion` (positivos, exentos de `activo = true` — A8); `Pago.estado → revertido` (revierte caja); marca de anulada con usuario/fecha/motivo; solo anulación total en v1 | #7 | ✅ Archivado |
| 10 | Motor de alertas | Tabla Alerta; interfaz `EvaluadorDeAlertas` + `ReglasUmbral` dentro de la transacción del movimiento protegido por `SAVEPOINT` (C1); creación por cruce de umbral, de-duplicación por producto+tipo, auto-resolución de stock_bajo/quiebre, resolución manual de discrepancia (A10); alerta de discrepancia desde ajustes marcados (A9); vista de alertas + polling del conteo en la SPA | #6, #7 | ⬜ Pendiente |
| 11 | Sugerencia de reposición | Heurística dentro de `ReglasUmbral`: promedio diario de salidas de 30 días, cobertura < 14 días, mínimo 7 días de historia, promedio 0 nunca sugiere (S7); resolución manual por el encargado | #10 | ⬜ Pendiente |
| 12 | Reportes | Stock actual, bajo mínimo, movimientos por período y discrepancias globales para el encargado; depósito solo reportes operativos con filtrado por dueño (`WHERE usuario_id = :actor`) y sin discrepancias globales; estados vacíos explícitos; paginación | #6, #7 | ⬜ Pendiente |
| 13 | Dashboard / KPIs | Pantalla de inicio con KPI cards del design.md (quiebres, stock bajo, actividad reciente, alertas activas); chips de estado; navegación por rol con 🔒 | #6, #10 | ⬜ Pendiente |
| 14 | Operación local | Verificación periódica de consistencia stock ↔ Σ(ledger); script de backup `pg_dump` programado (Task Scheduler) hacia ubicación fuera del disco principal | #5 | ⬜ Pendiente |

**Nota sobre contexto extra:** ningún ítem requiere documentación de reglas de negocio externa —
todo lo especializado (heurística de reposición, ciclo de vida de alertas, política de stock
nunca-negativo, matriz de permisos) ya está definido en `PRD.md` y `TECH-DESIGNv2.md`. La única
área que traería reglas de dominio externas (normativa de facturación fiscal) es **etapa 2** y
queda fuera de este backlog.

**Nota sobre el despliegue:** el ítem #1 dejó la aplicación desplegada y verificada punta a punta
(SPA en Vercel, API en Render, Postgres en Neon, todo en capa gratuita — ver `ADR-0010`). El primer
encargado ya está sembrado por el script de bootstrap del ítem #2. Los ítems siguientes se despliegan
solos al mergear a `main`.

Actualizado el 2026-08-29: el ítem **#4** (backend de gestión de proveedores) queda archivado. La
API de CRUD de proveedores está en `main` con cobertura completa (217 api + 157 web unit + 86
integration tests). Las specs (`supplier-management`) está promovida a `openspec/specs/`. La
**vista maestro-detalle** fue diferida como ítem **4.1** (depende de #4 backend, no bloqueador
del #5 de productos que solo requiere `proveedor_id` FK).

Actualizado el 2026-08-30: el ítem **#5** (Productos + ledger base) queda archivado. Tablas
`productos` y `movimientos` con CHECKs, CRUD con SKU único, stock inicial vía movimiento `ajuste`
en transacción atómica (ADR-0003), permiso por campo `stock_minimo` (A7), baja lógica, UI completa
con chips quiebre/bajo. API 275 unit + 117 integration, Web 194 unit tests, todos en verde. Specs
(`product-management` y `productos-ui`) promovidas a `openspec/specs/`. Desplegado: SPA en Vercel,
API en Render, Postgres en Neon; 12 productos de demo con 4 proveedores sembrados.

Actualizado el 2026-08-31: el ítem **#8** (Recibo interno) queda archivado. GET `/api/ventas/:id` y
GET `/api/ventas/numero/:numeroCorrelativo` en backend; ruta `/ventas/:id/recibo` imprimible con
`window.print()` + `@media print` en frontend; entrada de búsqueda por correlativo con navegación
a recibo. Cobertura: API 420 unit + 30 integration, Web 408 unit tests, todos en verde. Specs
(`point-of-sale`, `pos-ui`, `recibo-ui`) promovidas a `openspec/specs/`. Nota: PROD-F (impresión
de pagos revertidos) explícitamente diferido al #9.

## Cómo usar este backlog

Cada ítem es una spec independiente. Al implementarlo, arrancá un ciclo de Spec-Driven
Development (`sdd-new` o el flujo equivalente de tu harness) usando este ítem como el
"change" — no el proyecto completo.

Referencias por ítem: los códigos entre paréntesis (C1, C2, A7–A11, S6–S10) apuntan a las
resoluciones de la Ronda 2 en `REVISION-ADVERSARIAL.md`, detalladas en `TECH-DESIGNv2.md`.
