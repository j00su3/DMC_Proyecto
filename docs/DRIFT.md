# Drift Report: InvenTienda

**Fecha:** 2026-09-04

**Comparado contra:** `docs/PRD.md`, `docs/TECH-DESIGNv2.md` (documento vigente; `docs/TECH-DESIGN.md`
v1 está superseded y **no** se usó como fuente de promesas), `docs/REVISION-ADVERSARIAL.md`
(Rondas 1 y 2) + los 12 ADRs de `docs/adrs/`, contra el estado actual de `apps/api/src` y
`apps/web/src`.

**Continuidad con la auditoría anterior:** existía un `docs/DRIFT.md` fechado 2026-08-29, escrito
cuando solo los ítems #1–#4 (+derivados) estaban archivados. Desde entonces se archivaron los
ítems **#5 a #14** completos (productos, movimientos, punto de venta, recibo, anulación, motor de
alertas, sugerencia de reposición, reportes, dashboard, y la mitad de consistencia del #14). Esta
pasada **re-verificó cada hallazgo anterior contra el código como está hoy** (no los reimprimió) y
buscó activamente drift nuevo introducido por todo lo que se archivó desde entonces. Los IDs
`D-01`…`D-12` se conservan **exactamente** donde el hallazgo original sigue vigente, porque
`docs/BACKLOG.md` (fila #14) y `docs/DEPLOY-PLAN.md` (Autorizaciones pendientes #11, nota
2026-09-04) ya citan `docs/DRIFT.md D-04` por ese número — renumerar habría roto esas referencias.
Los IDs `D-13`/`D-14` son hallazgos nuevos de esta pasada.

## Resumen ejecutivo

De los 12 hallazgos de la auditoría anterior, **2 se resolvieron** (D-07: el banner de superseded
ya está en `docs/TECH-DESIGN.md:1-10`; la deuda técnica del enum `entidad_auditoria` vs
`FIELD_CLASSIFICATION` ya no existe — ambos listan exactamente `usuarios`/`proveedores`/`productos`/
`alertas`) y **1 quedó sin objeto** (D-12: no hay ningún ciclo "en curso" hoy — todo está
✅ Archivado, ⬜ Pendiente o 🟡 Parcial — así que la falta del estado "en curso" no está
desinformando a nadie en este momento). **Los 9 restantes siguen abiertos**, varios con evidencia
nueva que los refuerza (D-05 y D-06 ganaron una columna/índice más sin documentar cada uno; D-10 se
replicó por tercera vez). Se encontraron **2 hallazgos nuevos**, ambos generados por el trabajo de
#13/#14: un desvío real entre la nota de trazabilidad del TECH-DESIGNv2 y de dónde lee sus KPIs el
dashboard archivado, y una entrada del registro de riesgos que quedó redactada como "pendiente de
agregar" para algo que ya se agregó y archivó.

Se verificó explícitamente, y **no es drift**, que: (a) el mecanismo `SAVEPOINT` de #10/#11 y la
heurística de `sugerencia_reposicion` implementan exactamente lo que el ADR-0008/TECH-DESIGNv2 ya
tenían escrito desde el 2026-08-13 — cero desviación; (b) la verificación de consistencia stock↔
ledger de #14 mitad A es precisamente la mitigación que el TECH-DESIGNv2 anticipaba en su registro
de riesgos (ver D-14 para el matiz de redacción); (c) el PRD **no** promete recuperación de
contraseña por email en ningún punto de su sección Alcance — el bloqueo del ítem #3.5 no es un
PRD-vs-código mismatch, porque el PRD nunca lo prometió.

| Severidad | Cantidad |
|---|---|
| Crítico | 2 |
| Advertencia | 7 |
| Sugerencia | 3 |

## Hallazgos

### D-01 — El rastro de auditoría sigue siendo de solo escritura: nadie puede leerlo desde la aplicación

- **Severidad:** Crítico
- **Tipo:** Feature fantasma
- **Estado:** Abierto (sin cambios desde el 2026-08-29).
- **Prometido:** el ADR-0012 justifica la denylist de campos sensibles precisamente por quién va a
  consultar la tabla: *"Un snapshot ingenuo de la fila de `usuarios` copiaría el hash de
  contraseña a **una tabla pensada para que el encargado la lea**"*
  (`docs/adrs/0012-frontera-auditoria-y-ledger.md:50-53`). El PRD pone la auditabilidad en sus
  criterios de éxito (`docs/PRD.md:158-159`).
- **Real:** `AuditoriaRepo` sigue exponiendo un único método, de escritura —
  `apps/api/src/auditoria/repository.ts:13-15`, `record(event)` y nada más. Las diez rutas
  registradas en `apps/api/src/app.ts:21-30,156-170` son `health`, `auth`, `usuarios`,
  `proveedores`, `productos`, `movimientos`, `ventas`, `alertas`, `reportes` y `dashboard` — ninguna
  de auditoría. Desde la auditoría anterior, el volumen de datos que nadie puede leer **creció**:
  `apps/api/src/auditoria/fields.ts:87-97` agregó `alertas` como cuarta entidad auditada (creación y
  resolución manual), así que hoy hay más filas en `auditoria` sin lector que en agosto, no menos.
- **Por qué importa:** igual que en la auditoría anterior — el no-repudio no es una propiedad de
  que la fila exista, sino de que alguien pueda exhibirla. Ningún ciclo de los archivados desde
  entonces (#5–#14) tocó este hueco, y ninguno de los backlog items pendientes lo cubre.
- **Opciones:**
  - `CORREGIR CÓDIGO` — agregar `AuditoriaRepo.list(filtros)` + `GET /api/auditoria` con
    `roles: ['encargado']`, paginado, filtrable por `entidad`+`entidad_id` y por `usuario_id` (los
    índices `auditoria_entidad_entidad_id_creado_en_idx` y `auditoria_usuario_id_creado_en_idx` ya
    existen para exactamente estas consultas).
  - `ACTUALIZAR PRD/ADR` — declarar en el ADR-0012 que en v1 la consulta del rastro es
    administrativa y fuera de la aplicación (SQL directo contra Neon), y corregir la justificación
    de la regla de la denylist para que no se apoye en un lector dentro del producto.
  - **Recomendación:** sin cambios respecto de la anterior — corregir el código. El costo de no
    resolverlo sigue creciendo con cada entidad nueva que se suma a `FIELD_CLASSIFICATION`.

### D-02 — Sigue sin existir el procedimiento de rescate del último encargado que el ADR-0007 dice documentar

- **Severidad:** Crítico
- **Tipo:** Regla omitida
- **Estado:** Abierto (sin cambios).
- **Prometido:** *"como vía de rescate si el único encargado pierde su contraseña, **se documenta
  un procedimiento administrativo manual** (resetear el hash directo en base) fuera de la
  aplicación"* (`docs/adrs/0007-sesion-cookie-rbac-propio.md:61-63`).
- **Real:** sigue sin existir el procedimiento en ningún archivo de `docs/`, `openspec/` o la raíz
  (`grep -rn "rescate\|--rescue"` no encuentra ningún runbook). Las tres vías que podrían suplirlo
  siguen cerradas: `apps/api/scripts/seed-encargado.ts:77` retorna `{ created: false }` si ya existe
  un encargado; el reset administrativo por API exige sesión de encargado
  (`apps/api/src/routes/usuarios.ts`, `roles: ['encargado']`); y el reset por email (#3.5) sigue
  bloqueado por infraestructura (`docs/BACKLOG.md:37`). `docs/SECURITY.md:205` incluso lo repite
  como recomendación #4 todavía sin resolver: *"Añadir una vía de rescate en banda para el último
  `encargado`..."*.
- **Por qué importa:** el sistema está en producción con un único encargado sembrado
  (`docs/BACKLOG.md` nota de despliegue). Sin cambios desde agosto: sigue siendo la única promesa
  de este set cuyo incumplimiento puede dejar el sistema inaccesible.
- **Opciones:**
  - `CORREGIR CÓDIGO` — escribir el runbook (archivo en `docs/` o sección del ADR-0007), o dar al
    script de seed un modo `--rescue` explícito y testeable.
  - `ACTUALIZAR PRD/ADR` — retirar la promesa del ADR-0007 y asumir el riesgo por escrito
    ("si el único encargado pierde la contraseña, se restaura desde un backup o se recrea la
    base").
  - **Recomendación:** sin cambios — corregir el código. `docs/SECURITY.md` ya lo tiene anotado como
    recomendación pendiente; cuatro ciclos SDD completos pasaron sin que nadie lo levantara.

### D-03 — El TECH-DESIGNv2 sigue describiendo un despliegue local sin HTTPS en su registro de riesgos

- **Severidad:** Advertencia
- **Tipo:** Documentación que describe el sistema de forma inexacta
- **Estado:** Abierto (sin cambios).
- **Prometido/afirmado:** *"**Despliegue local sin HTTPS:** mientras el sistema corra solo en la
  máquina del desarrollador ([ADR-0009]), ... la cookie de sesión no tiene `Secure`"*
  (`docs/TECH-DESIGNv2.md:380-382`). El riesgo A11 sigue cerrando con *"El riesgo queda abierto
  hasta que ese hito llegue y la decisión se tome"* (`docs/TECH-DESIGNv2.md:390`).
- **Real:** el despliegue local fue reemplazado el 2026-08-24 (ADR-0010) y el hito que A11 exigía
  ("primer ciclo de conteo real") ya pasó varias veces desde entonces — el sistema lleva en
  producción (Vercel+Render+Neon) desde antes de que se archivara el ítem #5. `apps/api/src/auth/session.ts`
  sigue emitiendo `secure: process.env.NODE_ENV === 'production'` y `render.yaml` fija
  `NODE_ENV: production`.
- **Por qué importa:** exactamente el mismo que en agosto — un lector que empiece por la sección de
  Riesgos concluye que la cookie viaja sin `Secure`, que es falso. El paso del tiempo (cuatro meses
  de operación real desde ADR-0010) hace la afirmación **más** obsoleta, no menos.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no aplica.
  - `ACTUALIZAR PRD/ADR` — reescribir el riesgo como cerrado por ADR-0010, redirigir los punteros
    de `Secure` del ADR-0009 al ADR-0010, marcar A11 resuelto con fecha.
  - **Recomendación:** actualizar el documento — sin cambios respecto de la recomendación anterior.

### D-04 — La decisión de backup sigue sin tomarse; ahora está explícitamente rastreada como pendiente en tres documentos distintos

- **Severidad:** Advertencia
- **Tipo:** Regla omitida
- **Estado:** Abierto, pero **con contexto mejorado** desde agosto.
- **Prometido:** la Ronda 1 elevó la ausencia de decisión de backup a *"el hueco más grande de
  cobertura del set de ADRs"* (`docs/REVISION-ADVERSARIAL.md:457`); el ADR-0009 la formalizó
  (`:31-34`) y quedó huérfana al ser reemplazado por el ADR-0010, que no menciona backup en ninguna
  de sus Consecuencias (`docs/adrs/0010-despliegue-tiers-gratuitos.md:52-77`).
- **Real:** el propietario **decidió explícitamente tratar el backup como una decisión de
  infraestructura/deploy-plan separada de SDD**, no como una feature con seguimiento de ciclo — el
  backlog #14 lo registra así: *"Mitad B, script de backup `pg_dump`... sigue sin tratar... el
  propietario decidió tratarla como una decisión de infraestructura/deploy-plan (ADR +
  `docs/DEPLOY-PLAN.md`)... ya estaba señalada como huérfana/obsoleta en `docs/DRIFT.md` D-04"*
  (`docs/BACKLOG.md:49`). `docs/DEPLOY-PLAN.md:949-950` repite la misma nota y cita este mismo
  reporte por su ID. Es decir: la decisión sigue sin tomarse, pero ya **no está perdida** — tres
  documentos (`BACKLOG.md`, `DEPLOY-PLAN.md`, y este) apuntan al mismo hueco con el mismo nombre.
- **Por qué importa:** a diferencia de agosto, esto ya no es "nadie decidió y nadie se dio cuenta"
  — es "se decidió activamente diferir, y quedó escrito que se difirió". Eso es mejor higiene de
  proceso, pero el riesgo de fondo (sin ADR ni script de backup, la única red de seguridad de los
  datos de producción es lo que Neon retenga en su tier gratuito) sigue exactamente igual que en
  agosto. Cuantos más ciclos se archiven sin resolverlo, más datos reales quedan sin un respaldo
  propio.
- **Opciones:**
  - `CORREGIR CÓDIGO` — decidir y registrar el respaldo del entorno actual (retención del tier
    gratuito de Neon, y/o `pg_dump` programado contra `DATABASE_URL` de Neon hacia una ubicación
    externa), documentado en un ADR nuevo o una actualización del ADR-0010.
  - `ACTUALIZAR PRD/ADR` — agregar al ADR-0010 una consecuencia explícita que asuma el riesgo: "en
    v1 el respaldo es el que ofrezca el tier gratuito de Neon, sin copia propia".
  - **Recomendación:** sin cambios — cualquiera de las dos, pero decidida y escrita. El "quedó
    rastreado" de esta pasada es progreso de proceso, no una resolución del riesgo de datos.

### D-05 — El modelo de datos del TECH-DESIGNv2 sigue incompleto, y el trabajo de #6/#10 le sumó columnas nuevas sin documentar

- **Severidad:** Advertencia
- **Tipo:** Documentación que describe el sistema de forma inexacta
- **Estado:** Abierto, **con evidencia nueva** (dos columnas más desde agosto).
- **Prometido/afirmado:** el modelo de datos vigente enumera **Usuario** sin `intentos_fallidos`,
  `bloqueado_hasta` ni `debe_cambiar_password` (`docs/TECH-DESIGNv2.md:92-94`, sin cambios desde
  agosto), no tiene entidad **Auditoría** propia, y describe **Movimiento** con exactamente estos
  campos: *"`id`, `producto_id`, `tipo`..., `cantidad`..., `motivo`..., `es_discrepancia`...,
  `usuario_id`, `fecha`, `venta_id`..., `stock_resultante`"* (`docs/TECH-DESIGNv2.md:123-129`) y
  **Alerta** con *"`id`, `tipo`..., `producto_id`, `creada_en`, `estado`..., `resuelta_en`,
  `resuelta_por`"* (`docs/TECH-DESIGNv2.md:164-167`).
- **Real:** además de las tres columnas de `usuarios` y la tabla `auditoria` completa ya señaladas
  en agosto (`apps/api/src/db/schema.ts:24-42,105-141`), el ciclo #6 (archivado 2026-08-31) agregó
  `movimientos.es_merma` (`apps/api/src/db/schema.ts:206`, con su propio `CHECK
  movimientos_merma_solo_salida` en `:252-255`) y el ciclo #10 (archivado más tarde) agregó
  `alertas.movimiento_id` (`apps/api/src/db/schema.ts:425-427`, FK nullable a `movimientos`). Ninguna
  de las dos aparece en las listas de campos citadas arriba, que datan del 2026-08-13 y no se
  tocaron desde entonces pese a dos ciclos completos que modificaron exactamente esas dos tablas.
- **Por qué importa:** el mismo argumento que en agosto, agravado por el tiempo transcurrido — el
  TECH-DESIGN es el documento de referencia para diseñar el ciclo siguiente, y ya lleva dos ciclos
  de atraso respecto del propio `schema.ts`. Un ciclo futuro que necesite saber si un movimiento fue
  una merma, o de qué movimiento salió una alerta, tiene que leer `schema.ts` directamente porque el
  documento que se supone lo resume no lo dice.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no aplica: las columnas responden a decisiones ya ratificadas (backlog #6
    D3 para `es_merma`, backlog #10 D4/D7 para `movimiento_id`).
  - `ACTUALIZAR PRD/ADR` — completar **Usuario**, **Movimiento** y **Alerta** con las cinco columnas
    faltantes en total, y agregar **Auditoría** como entidad propia del modelo de datos.
  - **Recomendación:** actualizar el documento, y considerar agregarlo como paso de checklist del
    propio flujo SDD ("¿tocaste una columna? actualizá el modelo de datos del TDD") — dos ciclos
    consecutivos reprodujeron el mismo tipo de omisión.

### D-06 — La unicidad case-insensitive sigue sin documentarse, y ahora aplica a dos entidades, no una

- **Severidad:** Advertencia
- **Tipo:** Feature no documentada (drift inverso)
- **Estado:** Abierto, **con evidencia nueva** (el patrón se replicó a productos).
- **Prometido/afirmado:** el TECH-DESIGNv2 describe **Proveedor** sin mencionar unicidad
  (`docs/TECH-DESIGNv2.md:98-100`) y **Producto** con *"`sku/codigo` (único → cubre 'producto
  duplicado')"* (`docs/TECH-DESIGNv2.md:101`) — "único" a secas, sin especificar sensibilidad a
  mayúsculas/minúsculas. El PRD tampoco lo especifica en ninguno de los dos casos
  (`docs/PRD.md:109`, `:178`).
- **Real:** además del índice `proveedores_nombre_lower_unique` ya señalado en agosto
  (`apps/api/src/db/schema.ts:64-67`), el ciclo #5 (productos, archivado 2026-08-30) implementó la
  **misma técnica** para SKU: `productos_sku_lower_unique` sobre `lower(sku)`
  (`apps/api/src/db/schema.ts:188`), ratificado en
  `openspec/specs/product-management/spec.md:106-108` ("Requirement: Unique SKU... enforced unique
  at the database via a unique index", con el comentario del propio schema explicitando "Same
  functional-unique-index technique as proveedores_nombre_lower_unique"). Es la misma regla de
  negocio invisible, ahora aplicada dos veces.
- **Por qué importa:** el mismo razonamiento de agosto, con el doble de superficie — dos reglas de
  negocio visibles para el usuario (un alta de "ABC-01" y "abc-01" choca en ambos casos) que solo
  viven en el esquema y en specs técnicas, no en los documentos de producto donde el próximo ciclo
  (o un cliente que pida "permitir SKUs que difieran solo en mayúsculas") las va a buscar primero.
- **Opciones:**
  - `CORREGIR CÓDIGO` — si el producto quiere nombres/SKUs que difieran solo en capitalización,
    eliminar los índices funcionales y los códigos de error asociados (`SUPPLIER_NAME_IN_USE`, y el
    equivalente de SKU).
  - `ACTUALIZAR PRD/ADR` — subir ambas reglas al TECH-DESIGNv2 junto a sus entidades respectivas, con
    la misma forma en que ya se enuncia "único" para SKU, agregando "(case-insensitive)" a las dos.
  - **Recomendación:** actualizar el documento. Ambas reglas están ratificadas, testeadas y
    desplegadas; documentarlas una sola vez, en el lugar correcto, cierra las dos a la vez.

### D-08 — El avatar del shell sigue sin distinguir color por rol

- **Severidad:** Sugerencia
- **Tipo:** Feature fantasma (implementada de forma materialmente distinta)
- **Estado:** Abierto (sin cambios).
- **Prometido:** *"tarjeta de usuario con avatar circular 30px (iniciales; **azul encargado, verde
  depósito**)"* (`docs/design.md:44`); repetido en `docs/TECH-DESIGNv2.md:94`.
- **Real:** `apps/web/src/components/ui/AppShell.module.css:99-111` sigue fijando
  `background: var(--color-accent)` en `.avatar` sin variante por rol, y
  `apps/web/src/components/ui/AppShell.tsx:119-121` sigue renderizando la misma clase única para
  ambos roles. Sin cambios pese a que el shell fue tocado en varios ciclos desde agosto (badge de
  alertas en la nav, nuevo ítem de dashboard).
- **Por qué importa:** igual que en agosto — es el único indicador visual de rol fuera del texto, y
  el costo de corregirlo sigue siendo de dos líneas.
- **Opciones:**
  - `CORREGIR CÓDIGO` — agregar una clase modificadora por rol usando el token de éxito
    (`#2f9e63`, `docs/design.md:26`) para `deposito`.
  - `ACTUALIZAR PRD/ADR` — quitar el color por rol de `docs/design.md:44` y de
    `docs/TECH-DESIGNv2.md:94`.
  - **Recomendación:** corregir el código — sin cambios respecto de la recomendación anterior.

### D-09 — La verificación del `Set-Cookie` post-deploy (tarea 5.9) sigue sin registrarse; el ADR-0010 conserva su línea "Pendiente"

- **Severidad:** Advertencia
- **Tipo:** Documentación que describe el sistema de forma inexacta
- **Estado:** Abierto (sin cambios).
- **Prometido/afirmado:** *"el ítem #1 dejó la aplicación **desplegada y verificada punta a
  punta**"* (`docs/BACKLOG.md`, nota de despliegue).
- **Real:** en `openspec/changes/archive/2026-08-24-fundaciones-monorepo/tasks.md`, las tareas 5.4,
  5.5 y 5.6 (crear servicio de Render, Neon+migración, proyecto de Vercel) **siguen sin marcar**
  (`:75-77`), igual que la 5.9 (verificar que el proxy no altera el `Set-Cookie`, `:82`) — pese a
  que el sistema lleva en producción real desde antes de esta fecha (`vercel.json` ya tiene la URL
  real de Render, no el placeholder). El ADR-0010 conserva exactamente la misma línea: *"**Pendiente:**
  registrar aquí el resultado del smoke test post-deploy (tarea 5.9...)"*
  (`docs/adrs/0010-despliegue-tiers-gratuitos.md:79-81`).
- **Por qué importa:** el mismo razonamiento que en agosto, reforzado por el tiempo — el sistema
  procesó ventas reales, alertas reales y reportes reales durante #7–#13 con esta verificación
  todavía sin registrar. El punto que la 5.9 comprueba (`Domain` ausente de la cookie) es
  precisamente el trade-off que el ADR-0010 marca como el más frágil de su propia decisión (`:68-70`).
- **Opciones:**
  - `CORREGIR CÓDIGO` — ejecutar la verificación 5.9 contra el despliegue vivo y registrar el
    resultado con fecha en el ADR-0010.
  - `ACTUALIZAR PRD/ADR` — marcar 5.4-5.6 como completadas en `tasks.md` con evidencia
    (`vercel.json`), ajustando la nota del backlog a lo que efectivamente se verificó.
  - **Recomendación:** las dos, en ese orden — sin cambios respecto de la recomendación anterior.

### D-10 — Las rutas de acción POST se apartan de la convención REST del ADR-0004 y el patrón ya se replicó una tercera vez

- **Severidad:** Advertencia *(subida desde Sugerencia — ver justificación)*
- **Tipo:** Feature no documentada (drift inverso)
- **Estado:** Abierto, **con evidencia nueva** que refuerza el hallazgo.
- **Prometido:** *"La API es **REST sobre JSON**... con **verbos HTTP estándar**"*
  (`docs/adrs/0004-rest-json-openapi.md:17-18`).
- **Real:** en agosto el patrón `POST /<recurso>/:id/<transición>` existía en `usuarios.ts` (:250-279)
  y se había replicado una vez en `proveedores.ts` (:190-218). Desde entonces el ciclo #9
  (anulación de venta, archivado) lo replicó una **tercera** vez:
  `apps/api/src/routes/ventas.ts:257-258` define `POST /ventas/:id/anular`. Las tres
  implementaciones repiten literalmente el mismo comentario de justificación ("the path names the
  transition, so the audit verb is decided by which URL was called, not inferred from a diff" en
  `usuarios.ts:247-249`, casi idéntico en `proveedores.ts:187-189`), lo que confirma que se copia
  por imitación de código, no por una convención escrita.
- **Por qué importa:** subo la severidad a Advertencia porque la premisa de agosto — "el patrón ya
  se replicó una vez... y va a replicarse otra vez"— **ya ocurrió**, exactamente como se predijo. Con
  tres dominios independientes implementando la misma excepción a la convención REST sin que el
  ADR-0004 la mencione, el costo de seguir sin escribirla solo crece con cada dominio nuevo
  (`productos` no la necesitó, pero un futuro `#15` bien podría).
- **Opciones:**
  - `CORREGIR CÓDIGO` — no recomendable: destruiría la propiedad que motivó el patrón (verbo de
    auditoría determinado por la URL, no inferido del diff).
  - `ACTUALIZAR PRD/ADR` — agregar al ADR-0004 la convención explícita: transiciones de estado
    auditadas con verbo propio se exponen como `POST /<recurso>/:id/<transición>`.
  - **Recomendación:** actualizar el ADR — sin cambios en la recomendación, pero la urgencia subió:
    ya son tres copias idénticas de una decisión no escrita.

### D-11 — El backlog sigue justificando el bloqueo del #3.5 citando Firebase Hosting

- **Severidad:** Sugerencia
- **Tipo:** Documentación que describe el sistema de forma inexacta
- **Estado:** Abierto (sin cambios).
- **Prometido/afirmado:** *"hoy no hay uno (**el `*.web.app` de Firebase Hosting tiene el DNS de
  Google**)"* (`docs/BACKLOG.md:37`).
- **Real:** el proyecto sigue sin usar Firebase Hosting — Vercel + Render (`vercel.json`,
  `render.yaml`), sin cambios desde agosto.
- **Por qué importa:** igual que en agosto — la conclusión del bloqueo se sostiene, pero la premisa
  nombra un proveedor ajeno al proyecto.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no aplica.
  - `ACTUALIZAR PRD/ADR` — reescribir la premisa en términos de Vercel (`*.vercel.app`, DNS sin
    registros propios).
  - **Recomendación:** actualizar el documento — sin cambios.

### D-13 (nuevo) — La nota de trazabilidad del TECH-DESIGNv2 dice que los KPI de quiebre/stock bajo salen de `Producto`, pero el dashboard archivado los lee de `Alerta`

- **Severidad:** Advertencia
- **Tipo:** Feature no documentada (drift inverso) / documentación que describe el sistema de forma
  inexacta
- **Prometido/afirmado:** *"Trazabilidad Design.md → datos: KPI cards y chips (quiebre/bajo) ←
  `stock_actual`/`stock_minimo`"* (`docs/TECH-DESIGNv2.md:169-171`) — una sola frase que agrupa
  "KPI cards" (el dashboard) y "chips" (la tabla de productos) como si ambos leyeran la misma
  fuente.
- **Real:** son dos fuentes distintas, y solo una coincide con la nota. Los chips de la tabla de
  productos **sí** derivan de la comparación `stock_actual` vs `stock_minimo`
  (`apps/web/src/features/productos/ProductosTable.tsx:62-67`, función `estadoStock`). Las tarjetas
  KPI "Quiebres" y "Stock bajo" del dashboard (backlog #13, archivado 2026-09-04), en cambio, **no**
  tocan `Producto` en absoluto: `apps/api/src/dashboard/service.ts:41-47` llama
  `repos.alertas.countAbiertasPorTipo('quiebre')` y `('stock_bajo')` —
  `apps/api/src/alertas/repository.ts:191-210` cuenta filas de la tabla `alertas` con
  `estado <> 'resuelta'`. La desviación fue **decidida y documentada dentro del propio ciclo**: el
  `design.md` archivado la marca explícitamente como *"Correction, flagged explicitly: proposal.md's
  literal call, `AlertasRepo.list({tipo:'quiebre', estado:'activa'})`, undercounts against either
  Alerta-table"* (`openspec/changes/archive/2026-09-04-dashboard-kpis/design.md:26-33`), y la spec
  promovida la fija como requisito: *"Neither count MUST include `discrepancia` or
  `sugerencia_reposicion` alerts, nor be derived from Producto stock columns"*
  (`openspec/specs/dashboard-ui/spec.md:29-33`), listando explícitamente *"The Producto-column KPI
  route..."* como **Non-Goal** de la spec (`:14`). Lo que nunca ocurrió es que esa decisión volviera
  a `docs/TECH-DESIGNv2.md`, que sigue diciendo lo que decía antes de que existiera el dashboard.
- **Por qué importa:** las dos fuentes no son intercambiables en la práctica — un producto puede
  estar en quiebre por `stock_actual`/`stock_minimo` (lo que ve la tabla de productos) sin tener una
  alerta `quiebre` **abierta** todavía si el evaluador aún no corrió sobre ese producto, o puede
  tener una alerta abierta que ya no refleja el estado actual del producto si algo cambió `stock_minimo`
  sin generar movimiento. El TECH-DESIGNv2 es exactamente el documento al que un ciclo futuro
  recurriría para saber "¿de dónde sale este número?", y hoy responde mal para la mitad de los
  casos que agrupa bajo la misma flecha.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no aplica: la spec `dashboard-ui` ya ratificó la fuente Alerta-table como
    la decisión correcta, con su propio razonamiento contra el undercounting de la ruta
    Producto-column.
  - `ACTUALIZAR PRD/ADR` — separar la frase de trazabilidad del TECH-DESIGNv2 en dos: "chips de la
    tabla de productos ← `stock_actual`/`stock_minimo`" y "KPI cards del dashboard (quiebre/stock
    bajo) ← conteo de `alertas` abiertas por `tipo`", citando la spec `dashboard-ui`.
  - **Recomendación:** actualizar el documento. La decisión ya está tomada y bien razonada en el
    ciclo que la tomó; falta que el documento que un lector consultaría primero deje de contradecirla.

### D-14 (nuevo) — El registro de riesgos del TECH-DESIGNv2 describe la verificación de consistencia como algo por agregar, y ya se agregó y archivó

- **Severidad:** Sugerencia
- **Tipo:** Documentación que describe el sistema de forma inexacta
- **Prometido/afirmado:** *"Mitigación: toda escritura pasa por la transacción... y **se agrega**
  una **verificación periódica de consistencia** (stock vs suma del ledger). Revisar antes de
  producción"* (`docs/TECH-DESIGNv2.md:359-362`) — tiempo verbal de intención futura/pendiente.
- **Real:** la mitad de consistencia del ítem #14 (backlog) está **cerrada y archivada** desde el
  2026-09-04: `MovimientosRepo.verificarConsistenciaStock` (agregado nuevo, raw SQL con
  `LEFT JOIN`+`GROUP BY`+`HAVING`), el script `apps/api/scripts/verificar-consistencia.ts`, y el
  workflow programado `.github/workflows/consistencia-stock.yml` (`schedule`, domingo 08:00 UTC),
  todos mergeados a `main` (`docs/BACKLOG.md` fila #14). El paso manual restante (crear el rol
  read-only de Neon y el secreto de GitHub Actions) es infraestructura pendiente, no código
  pendiente — la verificación en sí ya existe y corre semanalmente (en rojo hasta que se complete
  ese paso manual, comportamiento documentado y esperado, no un defecto).
- **Por qué importa:** es menor porque no hay ninguna decisión de producto o arquitectura en juego
  — es una sola frase que quedó en tiempo futuro después de que el trabajo que describía se
  completara. Pero es exactamente el tipo de nota que un lector futuro usaría para preguntar
  "¿esto ya se hizo?", y hoy responde que no.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no aplica.
  - `ACTUALIZAR PRD/ADR` — cambiar el tiempo verbal a "se agregó una verificación periódica de
    consistencia (backlog #14) — pendiente el rol read-only de Neon para que corra en verde, ver
    `docs/DEPLOY-PLAN.md`", y quitar "Revisar antes de producción" si ya se considera revisado.
  - **Recomendación:** actualizar el documento. Es un ajuste de una línea, sin controversia.

## Resueltos desde la auditoría anterior (2026-08-29)

- **D-07 (antes Advertencia) — `docs/TECH-DESIGN.md` no llevaba banner de superseded.** Resuelto:
  `docs/TECH-DESIGN.md:1-10` ahora abre con `> [!WARNING]` seguido de *"**Documento superseded — no
  citar como fuente de decisiones vigentes.**"*, espejando lo que el ADR-0009 ya hacía en su sección
  Estado. No se verificó si algún ciclo posterior siguió citando v1 por costumbre (no se encontró
  evidencia de eso en los ciclos #5–#14 explorados), así que se da por cerrado.
- **Deuda técnica (sin ID propio) — el `pgEnum entidad_auditoria` aceptaba `'productos'` sin que
  `FIELD_CLASSIFICATION` tuviera esa entrada.** Resuelto: `apps/api/src/db/schema.ts:98-103` y
  `apps/api/src/auditoria/fields.ts` ahora listan exactamente el mismo conjunto de cuatro valores
  (`usuarios`, `proveedores`, `productos`, `alertas`) en ambos lados — el backlog #5 agregó
  `productos` a `FIELD_CLASSIFICATION` y el ciclo de alertas agregó `alertas` a ambos a la vez,
  cerrando la divergencia en lugar de ensancharla.
- **D-12 (antes Sugerencia) — el backlog no modelaba un estado "en curso".** Sin objeto por ahora:
  no hay ningún ciclo en `openspec/changes/` fuera de `archive/` en este momento — todo lo pendiente
  (`#3.5`, y la mitad de backup del `#14`) está genuinamente detenido, no en ejecución silenciosa.
  El hueco de modelado (la columna Estado del backlog solo define ✅/⬜/🟡, no 🔄) sigue existiendo
  en la letra del documento, pero hoy no está causando ninguna afirmación falsa. Se retira de los
  hallazgos activos; si un ciclo futuro vuelve a quedar "en vuelo" sin reflejarse, el mismo
  señalamiento aplica de nuevo.

## Deuda técnica detectada

- **`apps/api/src/productos/service.ts:231`, `apps/api/src/proveedores/service.ts:124,161`,
  `apps/api/src/usuarios/service.ts:207,248`** — el doble casteo
  `previo as unknown as Record<string, unknown>` para alimentar `changedFields()` sigue presente en
  proveedores y usuarios (ya señalado en agosto) y **se extendió a productos** con el ciclo #5. Es
  el único punto de todo el camino de escritura, en tres dominios ahora, donde el compilador deja de
  proteger el valor que termina en `datos_previos`/`datos_posteriores`, justo lo que el ADR-0012
  regla 3 dice que no debería depender de la revisión de código
  (`docs/adrs/0012-frontera-auditoria-y-ledger.md:48-49`). Un `Diff` genérico sobre las claves de la
  entidad resolvería los tres casos a la vez.
- **`openspec/changes/archive/2026-08-24-fundaciones-monorepo/tasks.md:75-82`** — las mismas cuatro
  tareas manuales sin marcar señaladas en agosto (ver D-09) siguen sin marcar. Un ciclo archivado
  con tareas abiertas es un estado que ningún `sdd-verify` futuro va a volver a mirar.
- **`docs/adrs/0010-despliegue-tiers-gratuitos.md:79-81`** — la línea "Pendiente" de la migración de
  fundaciones nunca se completó (ver D-09); cuatro ciclos de producción real después, sigue
  literalmente igual.

## Features no documentadas (drift inverso)

Además de la unicidad case-insensitive doble (D-06), las rutas de acción POST (D-10) y la fuente
Alerta-table del dashboard (D-13):

- **`ACCOUNT_INACTIVE` (401) en el login** (`apps/api/src/lib/errors.ts:95-97`,
  `apps/api/src/auth/service.ts:37-40`) — un usuario dado de baja no puede iniciar sesión, y el
  orden de chequeo (después de verificar la contraseña, para no ser oráculo de enumeración de
  cuentas) sigue sin estar escrito fuera del comentario de código. Sin cambios desde agosto.
- **`Cache-Control: no-store`** en las respuestas con contraseña temporal
  (`apps/api/src/routes/usuarios.ts:202,239`) — control de seguridad real, sin respaldo en `docs/`.
  Sin cambios.
- **`proveedores.creado_en`** expuesta en el DTO (`apps/api/src/routes/proveedores.ts:23,68`) y
  volcada en el snapshot de auditoría, pero **Proveedor** en el TECH-DESIGNv2 sigue enumerando solo
  `id`, `nombre`, `contacto`, `activo` (`docs/TECH-DESIGNv2.md:98`). Sin cambios; se puede resolver
  en el mismo pase que D-06 (misma entidad).
- **Bloqueo de acciones sobre la propia cuenta en la SPA**
  (`apps/web/src/routes/usuariosDetalle.tsx:17` y usos) — sigue correctamente declarado como
  afordancia de UI en `openspec/specs/usuarios-ui/spec.md`, así que no es un hallazgo nuevo; se
  reconfirma que sigue sin aparecer en ningún documento de `docs/`.

## Alcance planificado (no es drift)

- **Recuperación de contraseña por email (#3.5)** — sigue bloqueada por infraestructura
  (`docs/BACKLOG.md:37`). Se verificó explícitamente que el PRD **no** promete este flujo en ningún
  punto de su Alcance (`docs/PRD.md:90-122`): la única mención de "contraseña" fuera de la matriz de
  permisos es la nota sobre pseudonimización del rastro de auditoría (`:203`), que no habla de
  recuperación. No hay, por lo tanto, un PRD-vs-código mismatch que reportar aquí — el bloqueo del
  #3.5 solo entra en drift a través de la premisa incorrecta que cita Firebase (D-11), no porque el
  PRD prometiera el flujo.
- **Backup programado** — mitad B del #14, explícitamente diferida (ver D-04).
- Todo lo demás que la auditoría anterior había marcado como "alcance planificado, no drift" (POS
  ya archivado, alertas ya archivadas, reportes ya archivados) **dejó de estar pendiente** y pasó a
  verificarse como código real en los hallazgos de arriba.

## Próximos pasos

Priorizados por consecuencia, no por esfuerzo:

1. **D-02 (Crítico) — decisión del dueño del producto, hoy.** Sigue siendo la única promesa
   incumplida que puede dejar el sistema desplegado sin vía de acceso; cuatro ciclos de producción
   real pasaron sin resolverla.
2. **D-01 (Crítico) — decisión de producto/arquitectura.** El volumen de datos sin lector solo
   creció (`alertas` se sumó a la auditoría desde agosto); definir si se lee desde la app o por SQL
   directo.
3. **D-04 (Advertencia) — decisión de arquitectura, ya bien rastreada.** El respaldo de Neon sigue
   sin decidirse; a diferencia de agosto, ya no requiere "encontrar" el hueco — solo cerrarlo.
4. **D-13 (Advertencia, nuevo) — corrección puntual de una línea que ya generó confusión potencial.**
   Separar la nota de trazabilidad del TECH-DESIGNv2 en chips (Producto) vs KPIs (Alerta), citando
   `dashboard-ui`.
5. **D-05, D-06 (Advertencia) — el mismo pase de documentación de agosto, ahora con más superficie.**
   Completar el modelo de datos (2 columnas más que en agosto) y subir la unicidad case-insensitive
   (ahora 2 entidades) al TECH-DESIGNv2.
6. **D-10 (Advertencia, subida de severidad) — ratificar la convención antes del próximo dominio.**
   Tres réplicas idénticas sin una línea en el ADR-0004 es una convención de facto que merece
   dejar de ser tácita.
7. **D-03, D-09 (Advertencia) — la misma pasada de higiene de agosto, todavía sin hacer.** Cerrar el
   riesgo de despliegue local y registrar el smoke test 5.9 en el ADR-0010.
8. **D-14 (Sugerencia, nuevo) — un cambio de tiempo verbal.** Marcar la verificación de consistencia
   como hecha en el registro de riesgos.
9. **D-08, D-11 (Sugerencia) — sin cambios desde agosto.** Color de avatar por rol; corregir la
   premisa de Firebase del #3.5.

Ningún archivo de `docs/` ni de `openspec/` fue modificado durante esta auditoría, salvo la
reescritura de este mismo reporte.
