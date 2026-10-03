# Drift Report: InvenTienda

**Fecha:** 2026-09-09

**Comparado contra:** `docs/PRD.md`, `docs/TECH-DESIGNv2.md` (documento vigente; `docs/TECH-DESIGN.md`
v1 está superseded y **no** se usó como fuente de promesas), `docs/REVISION-ADVERSARIAL.md`
(Rondas 1 y 2) + los 12 ADRs de `docs/adrs/`, contra el estado actual de `apps/api/src` y
`apps/web/src`. `docs/DEPLOY-PLAN.md`, `docs/BACKLOG.md` y `docs/SECURITY.md` se usaron como
evidencia de apoyo (no como fuente de promesas) donde el propio reporte anterior ya los citaba.

**Continuidad con la auditoría anterior:** existía un `docs/DRIFT.md` fechado 2026-09-04 (hallazgos
D-01 a D-14, más D-07/D-12 ya resueltos/sin objeto). Ninguno de `docs/PRD.md`, los 12 ADRs ni
`docs/TECH-DESIGNv2.md` cambió desde entonces (`git log --since=2026-09-04` sobre esos archivos no
devuelve commits), así que esta pasada **re-verificó cada hallazgo abierto contra el código como
está hoy** en vez de asumir que seguían vigentes, y buscó drift nuevo en los nueve commits mergeados
desde la auditoría anterior (PRs #176–#183: backup semanal de Neon, cuatro correcciones operativas
al workflow de backup/consistencia, y el scoping del hook de claims-gate por ciclo). Los IDs
`D-01`…`D-14` se conservan **exactamente** donde el hallazgo original sigue vigente, porque
`docs/BACKLOG.md` (fila #14) y el propio `docs/DEPLOY-PLAN.md` ya citan varios de estos IDs por
número — renumerar rompería esas referencias. `D-15`/`D-16` son hallazgos nuevos de esta pasada.

## Resumen ejecutivo

De los 12 hallazgos abiertos de la auditoría anterior, **1 se resolvió por completo** (D-04: la
decisión de backup se tomó y se implementó — ver detalle abajo) y **1 quedó con evidencia corregida
porque la auditoría anterior citó código que ya no correspondía a la realidad al momento de
escribirse** (D-03: el fix de `secure` fail-closed es del 2026-09-01, tres días *antes* de la fecha
del reporte anterior, que igual citó la versión vieja de la línea). **Los 10 restantes siguen
abiertos sin cambios de fondo.** Se encontraron **2 hallazgos nuevos**: una auto-contradicción
dentro de `docs/DEPLOY-PLAN.md` sobre el propio backup que acaba de cerrarse, y un mecanismo de
seguridad real (IP verificada por proxy para el rate-limit, más el default fail-closed de `secure`)
que existe, está probado y desplegado, pero no aparece en el ADR-0007 — que además tiene su propia
condición de revisión ("una vez corregido SEC-003") ya cumplida desde hace más de una semana sin que
nadie la haya retomado.

Se verificó explícitamente, y **no es drift**, que: (a) los nueve commits mergeados desde la
auditoría anterior son correcciones operativas sobre lo que el ciclo #14 ya había cerrado (versión
de Postgres del contenedor de backup, `set -o pipefail`, exclusión del schema `drizzle`, logging
honesto de `verificar-consistencia.ts`) y el scoping del hook `claims-gate` por ciclo — ninguno
introduce una promesa nueva del PRD/ADR que verificar; (b) el propio `harnesses/claims-gate/README.md`
ya documenta con precisión el scoping por rama que el PR #183 implementó (verificado línea por línea
contra `claims_gate.py`), así que no hay drift ahí pese a ser un cambio reciente.

| Severidad | Cantidad |
|---|---|
| Crítico | 0 |
| Advertencia | 10 |
| Sugerencia | 3 |

La tabla cuenta los hallazgos abiertos. **Actualización 2026-09-15:** D-01 se resolvió después de
esta pasada (ciclo `auditoria-lectura`, PRs #185–#187) y ya no se cuenta; ver D-01 abajo.
**Actualización 2026-10-02:** D-02 se resolvió (ciclo `rescate-encargado`, PRs #190–#194) y ya no
se cuenta; ese ciclo registró dos hallazgos nuevos, D-17 y D-18 (ambos Advertencia), que sí se
cuentan.

## Hallazgos

### D-01 — El rastro de auditoría ya se puede leer desde la aplicación: RESUELTO

- **Severidad:** ~~Crítico~~ — cerrado.
- **Estado:** **RESUELTO el 2026-09-15**, por el ciclo `auditoria-lectura` (PRs #185, #186 y #187,
  mergeados a `main`), después de la fecha de esta pasada.
- **Lo que estaba abierto:** el ADR-0012 justifica la denylist de campos sensibles precisamente por
  quién va a consultar la tabla: *"Un snapshot ingenuo de la fila de `usuarios` copiaría el hash de
  contraseña a **una tabla pensada para que el encargado la lea**"*
  (`docs/adrs/0012-frontera-auditoria-y-ledger.md:50-53`), y el PRD pone la auditabilidad en sus
  criterios de éxito (`docs/PRD.md:158-159`). Al 2026-09-09, `AuditoriaRepo` solo exponía `record`
  y ninguna ruta de la API permitía leer el rastro.
- **Lo que se verificó el 2026-10-01:**
  - `AuditoriaRepo` expone `record` y `list(filtro, page, pageSize)`
    (`apps/api/src/auditoria/repository.ts:46-56`); `list` es una consulta de solo lectura.
  - `apps/api/src/app.ts:157-180` registra once grupos de rutas; el undécimo es `auditoria`
    (`apps/api/src/app.ts:180`).
  - `GET /api/auditoria` (`apps/api/src/routes/auditoria.ts:80-105`) está restringido a
    `roles: ['encargado']`, devuelve el sobre paginado y filtra por `entidad`+`entidadId` y por
    `usuarioId`; `entidadId` sin `entidad` se rechaza (`apps/api/src/routes/auditoria.ts:16-27`).
- **Por qué se cierra:** se adoptó la opción `CORREGIR CÓDIGO` que este mismo hallazgo recomendaba,
  con la forma exacta que proponía: `AuditoriaRepo.list` + `GET /api/auditoria` solo para
  `encargado`, paginado y con esos dos filtros.

### D-02 — El procedimiento de rescate del último encargado ya existe y está probado: RESUELTO

- **Severidad:** ~~Crítico~~ — cerrado.
- **Estado:** **RESUELTO el 2026-10-02**, por el ciclo `rescate-encargado` (PRs #190 a #194,
  mergeados a `main`), después de la fecha de esta pasada.
- **Lo que estaba abierto:** el ADR-0007 promete que, *"como vía de rescate si el único encargado
  pierde su contraseña, **se documenta un procedimiento administrativo manual** (resetear el hash
  directo en base) fuera de la aplicación"* (`docs/adrs/0007-sesion-cookie-rbac-propio.md:61-63`).
  Al 2026-09-09 no existía ningún runbook, y `docs/SECURITY.md:207` listaba el rescate como
  recomendación #4 de SEC-001 sin resolver.
- **Lo que se verificó el 2026-10-02:**
  - `apps/api/package.json:17` declara el script `rescatar:encargado`
    (`tsx scripts/rescatar-encargado.ts`).
  - `apps/api/src/usuarios/rescate.ts:51-62` busca el correo normalizado y rechaza, antes de
    cualquier escritura, un correo inexistente, una cuenta que no es de encargado y una cuenta
    inactiva; sin `--confirmar` devuelve una simulación (`apps/api/src/usuarios/rescate.ts:72-78`);
    con `--confirmar` llama a `resetUsuarioPassword` con la propia cuenta como actor y la marca
    `'rescate'` (`apps/api/src/usuarios/rescate.ts:82-86`), que solo se agrega al estado posterior
    de la fila de auditoría (`apps/api/src/usuarios/service.ts:318-323`).
  - `apps/api/scripts/rescatar-encargado.ts:190` imprime la base de destino antes de cualquier
    consulta, y `apps/api/scripts/rescatar-encargado.ts:120-159` muestra la contraseña temporal solo
    en el resultado `rescatado`.
  - Runbook en `docs/DEPLOY-PLAN.md:536-637` (§ Recovery → *Rescate del último encargado*), con
    addendum en el ADR-0007 (`docs/adrs/0007-sesion-cookie-rbac-propio.md:156-178`).
- **Por qué se cierra:** se adoptó la opción `CORREGIR CÓDIGO` que este mismo hallazgo recomendaba,
  en su variante de script explícito y testeable (separado de `seed-encargado.ts`, no un modo de
  él), más el runbook.
- **Ver también:** D-17 y D-18, dos hallazgos que este ciclo encontró y registró sin resolverlos.

### D-03 — El TECH-DESIGNv2 sigue describiendo la cookie de sesión sin `Secure`; la evidencia de la auditoría anterior ya estaba desactualizada cuando se escribió

- **Severidad:** Advertencia
- **Tipo:** Documentación que describe el sistema de forma inexacta
- **Estado:** Abierto, **con evidencia corregida** (ver nota de proceso abajo).
- **Prometido/afirmado:** *"**Despliegue local sin HTTPS:** ... la cookie de sesión no tiene
  `Secure`"* (`docs/TECH-DESIGNv2.md:380-382`). El riesgo A11 sigue cerrando con *"El riesgo queda
  abierto hasta que ese hito llegue y la decisión se tome"* (`:390`).
- **Real:** `apps/api/src/auth/session.ts:45-54` (`sessionCookieOptions`) hoy emite
  `secure: process.env.ALLOW_INSECURE_COOKIES !== 'true'` — **no** `process.env.NODE_ENV ===
  'production'` como citaba el reporte del 2026-09-04. El cambio es el commit `5520779`
  ("fix(api): fail closed on cookie Secure and the dev fallback secret"), fechado **2026-09-01**,
  es decir **tres días antes** de la fecha del reporte anterior. `render.yaml:1-20` no define
  `ALLOW_INSECURE_COOKIES`, así que en producción el default fail-closed aplica sin nada que lo
  desactive: la cookie **es** `Secure` hoy, y lo es incluso en desarrollo local salvo que alguien
  active la variable explícitamente.
- **Nota de proceso:** la auditoría anterior declaró este hallazgo "sin cambios desde el 2026-08-29"
  y citó la línea vieja como si siguiera vigente el día que se escribió el reporte — pero el código
  ya había cambiado tres días antes. Esto no es una regresión del código; es una verificación que no
  se hizo, exactamente el tipo de error que `CLAUDE.md` § *La regla* le pide a este proceso que no
  cometa ("una afirmación... se prueba leyendo las líneas citadas... nunca porque suena razonable").
  Se corrige aquí con la línea leída hoy.
- **Por qué importa:** el TECH-DESIGNv2 sigue mal, y ahora de forma más clara — no solo el
  despliegue de producción tiene `Secure` (vía ADR-0010, ya señalado en agosto), sino que el propio
  código ya no depende de `NODE_ENV` para decidirlo: el default es `Secure` en cualquier entorno
  salvo opt-out explícito. El riesgo A11 describe un estado que dejó de ser cierto en dos frentes
  independientes (infraestructura y código), no solo uno.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no aplica.
  - `ACTUALIZAR PRD/ADR` — reescribir el riesgo como cerrado por ADR-0010 + el fail-closed de
    `sessionCookieOptions`, marcar A11 resuelto con fecha, y documentar `ALLOW_INSECURE_COOKIES`
    como el mecanismo de opt-out para desarrollo local (ver también D-16).
  - **Recomendación:** actualizar el documento — sin cambios en la recomendación de fondo, pero con
    la evidencia correcta esta vez.

### D-04 — La decisión de backup se tomó y se implementó: RESUELTO

- **Severidad:** ~~Advertencia~~ — cerrado.
- **Estado:** **RESUELTO el 2026-09-04**, verificado contra el código y los tres documentos que lo
  registran.
- **Lo que estaba abierto:** el ADR-0009 formalizaba un backup vía `pg_dump`/Task Scheduler sobre
  disco local que quedó huérfano cuando el ADR-0010 movió la base a Neon sin heredar esa decisión.
- **Lo que se verificó hoy:**
  - `.github/workflows/backup-neon.yml` existe, corre `schedule: '0 9 * * 0'` (domingo 09:00 UTC,
    una hora después de `consistencia-stock.yml` para no competir por la misma conexión) +
    `workflow_dispatch` para disparo manual; hace `pg_dump` dentro de un contenedor
    `postgres:18-alpine` (misma versión mayor que Neon, corregido tras una falla real de versión el
    2026-09-05) con `--no-owner --no-privileges --exclude-schema=drizzle`, comprime con `gzip` bajo
    `set -o pipefail`, y sube el resultado como GitHub Actions artifact con `retention-days: 90`.
  - `docs/BACKLOG.md` fila #14 (mitad B) documenta la decisión, la investigación previa contra la
    documentación oficial de Neon (PITR de 6 horas, sin export propio), y cita este mismo reporte
    por su ID D-04 como el hueco que cierra.
  - `docs/DEPLOY-PLAN.md:1101-1139` (entrada "2026-09-04 — Backup independiente... decisión tomada
    vía `deploy-pass`") documenta el diseño completo y la restauración.
  - Reutiliza el mismo rol/secreto read-only de `consistencia-stock.yml` (`NEON_READONLY_DATABASE_URL`)
    sin credencial nueva — el único paso manual pendiente (crear el rol en Neon + cargar el secreto)
    es infraestructura compartida con D-14, no una decisión sin tomar.
- **Por qué se cierra:** la pregunta que D-04 planteaba — "¿el propietario va a decidir Opción A o
  Opción B?" — ya tiene respuesta y código desplegado. Lo que queda pendiente (el rol de Neon) es un
  paso operativo del propietario, ya rastreado en **Autorizaciones pendientes #11** de
  `docs/DEPLOY-PLAN.md`, no una promesa incumplida de un documento de arquitectura.
- **Ver también:** D-15 — el propio `docs/DEPLOY-PLAN.md` conserva una sección anterior que sigue
  describiendo esta misma decisión como "pendiente", contradiciendo su entrada del 2026-09-04.

### D-05 — El modelo de datos del TECH-DESIGNv2 sigue incompleto

- **Severidad:** Advertencia
- **Tipo:** Documentación que describe el sistema de forma inexacta
- **Estado:** Abierto (sin cambios desde el 2026-09-04 — ningún commit tocó `schema.ts` ni
  `TECH-DESIGNv2.md` desde entonces).
- **Prometido/afirmado:** el modelo de datos vigente enumera **Usuario** sin `intentos_fallidos`,
  `bloqueado_hasta` ni `debe_cambiar_password` (`docs/TECH-DESIGNv2.md:92-94`), no tiene entidad
  **Auditoría** propia, y describe **Movimiento** (`:123-129`) y **Alerta** (`:164-167`) sin
  `es_merma` ni `movimiento_id` respectivamente.
- **Real:** re-verificado contra `apps/api/src/db/schema.ts` — `intentosFallidos` (:31),
  `bloqueadoHasta` (:32), `debeCambiarPassword` (:39), `esMerma` (:206) y `movimientoId` (:425) siguen
  presentes y sin reflejo en el TECH-DESIGNv2.
- **Opciones:** igual que la auditoría anterior — completar el modelo de datos con las columnas
  faltantes y agregar **Auditoría** como entidad propia.
- **Recomendación:** actualizar el documento — sin cambios.

### D-06 — La unicidad case-insensitive sigue sin documentarse

- **Severidad:** Advertencia
- **Tipo:** Feature no documentada (drift inverso)
- **Estado:** Abierto (sin cambios).
- **Real:** re-verificado — `proveedores_nombre_lower_unique` (`apps/api/src/db/schema.ts:64-67`) y
  `productos_sku_lower_unique` (`:188`) siguen sin mención en `docs/TECH-DESIGNv2.md:98-101`.
- **Recomendación:** actualizar el documento — sin cambios.

### D-08 — El avatar del shell sigue sin distinguir color por rol

- **Severidad:** Sugerencia
- **Tipo:** Feature fantasma (implementada de forma materialmente distinta)
- **Estado:** Abierto (sin cambios).
- **Real:** re-verificado — `apps/web/src/components/ui/AppShell.module.css:99-111` sigue con un
  único `.avatar` sin variante por rol.
- **Recomendación:** corregir el código — sin cambios.

### D-09 — La verificación del `Set-Cookie` post-deploy (tarea 5.9) sigue sin registrarse

- **Severidad:** Advertencia
- **Tipo:** Documentación que describe el sistema de forma inexacta
- **Estado:** Abierto (sin cambios).
- **Real:** re-verificado — `openspec/changes/archive/2026-08-24-fundaciones-monorepo/tasks.md:75-82`
  conserva las tareas 5.4-5.6 y 5.9 sin marcar; `docs/adrs/0010-despliegue-tiers-gratuitos.md:79`
  conserva la misma línea **"Pendiente:"** textual.
- **Recomendación:** ejecutar la verificación 5.9 y registrar el resultado; marcar 5.4-5.6 completadas
  con evidencia — sin cambios.

### D-10 — Las rutas de acción POST se apartan de la convención REST del ADR-0004; el patrón ya son cuatro instancias, no tres

- **Severidad:** Advertencia
- **Tipo:** Feature no documentada (drift inverso)
- **Estado:** Abierto, **con un conteo corregido** — la auditoría anterior contó tres replicas y
  omitió una cuarta que ya existía en esa fecha.
- **Prometido:** *"La API es **REST sobre JSON**... con **verbos HTTP estándar**"*
  (`docs/adrs/0004-rest-json-openapi.md:17-18`).
- **Real:** el patrón `POST /<recurso>/:id/<transición>` existe hoy en **cuatro** dominios, no tres:
  `apps/api/src/routes/usuarios.ts:209` (`/usuarios/:id/password-reset`),
  `apps/api/src/routes/proveedores.ts:194-195` (`/proveedores/:id/deactivate` y `/reactivate`, vía
  loop),  `apps/api/src/routes/ventas.ts:258` (`/ventas/:id/anular`), y
  **`apps/api/src/routes/alertas.ts:150`** (`/alertas/:id/resolver`) — esta última mergeada el
  **2026-09-02** (`git log`), es decir **dos días antes** de la fecha del reporte anterior
  (2026-09-04), que solo contó tres. No es drift nuevo introducido desde la auditoría anterior; es
  una instancia que ya existía y no se contó.
- **Por qué importa:** el argumento de la auditoría anterior — "el patrón se está replicando sin una
  línea escrita en el ADR-0004" — es aún más fuerte con cuatro instancias confirmadas que con tres.
- **Opciones:** igual que antes — no destruir el patrón (`CORREGIR CÓDIGO` no aplica); documentar la
  convención en el ADR-0004.
- **Recomendación:** actualizar el ADR — sin cambios en la recomendación, con el conteo corregido.

### D-11 — El backlog sigue justificando el bloqueo del #3.5 citando Firebase Hosting

- **Severidad:** Sugerencia
- **Estado:** Abierto (sin cambios). `docs/BACKLOG.md:37` sigue citando el `*.web.app` de Firebase
  Hosting; el proyecto sigue en Vercel + Render.
- **Recomendación:** actualizar el documento — sin cambios.

### D-13 — La nota de trazabilidad del TECH-DESIGNv2 sigue agrupando los KPI del dashboard (Alerta) con los chips de productos (Producto) bajo la misma flecha

- **Severidad:** Advertencia
- **Estado:** Abierto (sin cambios). Re-verificado: `apps/web/src/features/productos/ProductosTable.tsx:62-67`
  sigue derivando los chips de `stock_actual`/`stock_minimo`; `apps/api/src/dashboard/service.ts:46-47`
  sigue llamando `AlertasRepo.countAbiertasPorTipo` para las KPI cards. `docs/TECH-DESIGNv2.md:169-171`
  sigue sin separar las dos fuentes.
- **Recomendación:** actualizar el documento — sin cambios.

### D-14 — El registro de riesgos del TECH-DESIGNv2 describe la verificación de consistencia en tiempo futuro, y ya está cerrada y corriendo

- **Severidad:** Sugerencia
- **Estado:** Abierto (sin cambios de fondo; nueva evidencia de que el trabajo posterior al cierre
  fue exclusivamente de endurecimiento operativo, no de alcance). `docs/TECH-DESIGNv2.md:359-362`
  sigue en tiempo futuro ("se agrega una verificación periódica... Revisar antes de producción").
  Desde el 2026-09-04, cuatro commits corrigieron el propio mecanismo (versión de Postgres del
  contenedor de backup — que comparte cron adyacente —, `set -o pipefail`, exclusión del schema
  `drizzle`, logging honesto de conteos en `verificar-consistencia.ts`, y `workflow_dispatch` manual
  en ambos workflows), reforzando que la verificación existe y corre — no cambiando la conclusión de
  este hallazgo.
- **Recomendación:** cambiar el tiempo verbal a "se agregó" — sin cambios.

### D-15 (nuevo) — `docs/DEPLOY-PLAN.md` conserva una sección que describe el backup como "decisión pendiente", contradicha 470 líneas más abajo por su propia entrada que registra la decisión ya tomada

- **Severidad:** Advertencia
- **Tipo:** Documentación que describe el sistema de forma inexacta (auto-contradicción dentro del
  mismo documento, no PRD/ADR vs código)
- **Prometido/afirmado:** `docs/DEPLOY-PLAN.md:639` abre una sección titulada **"Backup
  independiente — decisión pendiente (backlog #14, mitad B)"** y dice textualmente: *"Dos caminos,
  ninguno adoptado todavía"* (`:537`), cerrando con *"es una decisión del dueño, no mía: confirmar
  antes de generar el workflow"* (`:549`).
- **Real:** el mismo archivo, en su entrada fechada **"2026-09-04 — Backup independiente (backlog
  #14, mitad B) — decisión tomada vía `deploy-pass`"** (`:1101-1139`), registra que **Opción B fue
  adoptada** y que el workflow **ya fue generado**: `.github/workflows/backup-neon.yml` existe en el
  repositorio (verificado arriba, D-04) con exactamente el diseño que esa segunda entrada describe.
  Las dos secciones coexisten en el mismo archivo describiendo el mismo backlog item con
  conclusiones opuestas sobre si la decisión está tomada.
- **Por qué importa:** un lector que entre a `docs/DEPLOY-PLAN.md` buscando el estado del backup y se
  detenga en la primera sección (más arriba en el archivo, dentro de "Recovery") sale creyendo que
  la decisión sigue abierta y que hay una pregunta pendiente para el propietario — exactamente lo
  contrario de lo que ya ocurrió. Es el mismo tipo de defecto que este documento le exige a los
  ADRs (D-03, D-09, D-14): una sección que quedó en el tiempo verbal de cuando se escribió, sin
  actualizarse cuando el resto del mismo archivo avanzó.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no aplica.
  - `ACTUALIZAR PRD/ADR` — no aplica en sentido estricto (no es PRD ni ADR), pero el mismo principio
    corre: reemplazar la sección `:639-655` por una referencia corta a la entrada `:1101` ("decisión
    tomada, ver más abajo"), o fusionar ambas en una sola sección fechada.
  - **Recomendación:** actualizar el documento. Es la propia inconsistencia que el ítem 3 de "Próximos
    pasos" de la auditoría anterior ya advertía en general (D-13) — este es el mismo patrón, dentro
    de un documento distinto.

### D-16 (nuevo) — El endurecimiento de seguridad del 2026-08-30/09-01 (IP verificada por proxy, `secure` fail-closed) no está en ningún ADR, y la propia condición de revisión que el ADR-0007 fijó para el bloqueo por IP ya se cumplió sin que nadie la retomara

- **Severidad:** Advertencia
- **Tipo:** Feature no documentada (drift inverso) + Regla omitida
- **Prometido/afirmado:** el ADR-0007, actualizado 2026-08-29, descarta el bloqueo por IP porque
  "hoy no hay `trustProxy`... [esto] queda disponible como refuerzo posterior, **una vez corregido
  SEC-003**" (`docs/adrs/0007-sesion-cookie-rbac-propio.md:81-84`). El ADR no vuelve a mencionar
  `trustProxy`, IP ni SEC-003 en ninguna sección posterior.
- **Real:** SEC-003 fue corregido el **2026-08-30** (`docs/SECURITY.md:385-419`, "RESUELTO el
  2026-08-30 — ambas mitades, verificado contra producción"), un día después de la fecha del propio
  ADR-0007. La corrección introdujo `apps/api/src/plugins/clientIp.ts` (nuevo, commit
  `fix(api): key the login rate limit on a proxy-verified client address`, 2026-08-30): un
  `keyGenerator` que confía en `X-Forwarded-For` **solo** cuando la petición trae el secreto
  compartido `PROXY_SHARED_SECRET` en `x-inventienda-proxy`, con `trustProxy` de Fastify
  deliberadamente **apagado** (no la ruta que el ADR-0007 había anticipado, pero sí una que
  resuelve el mismo problema de fondo: distinguir clientes reales del proxy compartido). Ninguno de
  los tres términos (`clientIp`, `PROXY_SHARED_SECRET`, `ALLOW_INSECURE_COOKIES` — el fail-closed de
  D-03) aparece en ningún ADR, en `docs/TECH-DESIGNv2.md` ni en `docs/PRD.md` — únicamente en
  `docs/SECURITY.md`, que es un reporte de auditoría de seguridad, no un documento de decisión de
  arquitectura.
- **Por qué importa:** dos cosas distintas, ambas reales. Primero, hay un mecanismo de producción
  (probado — `apps/api/src/plugins/clientIp.test.ts`, y verificado contra Render en vivo) que
  ninguna ADR describe, así que un lector que llegue al ADR-0007 buscando "¿cómo se protege el login
  contra IPs falsificadas?" no lo va a encontrar ahí. Segundo, y más concreto: el propio ADR-0007
  puso una condición explícita y verificable ("una vez corregido SEC-003") para retomar la decisión
  de bloqueo por IP, esa condición lleva **cumplida más de una semana** (SEC-003 resuelto el
  2026-08-30; esta auditoría es del 2026-09-09), y no hay evidencia en `docs/BACKLOG.md` ni en el
  propio ADR de que alguien haya vuelto a evaluarla. No es que la decisión de no bloquear por IP
  esté mal — es que el ADR se comprometió a una fecha de revisión implícita ("una vez corregido
  SEC-003") y esa fecha ya pasó sin que el documento lo refleje.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no aplica al mecanismo en sí (está probado y funcionando); si el propietario
    decide que el bloqueo por IP como refuerzo de SEC-001 ya vale la pena ahora que SEC-003 está
    resuelto, sería un cambio de código nuevo y separado.
  - `ACTUALIZAR PRD/ADR` — actualizar el ADR-0007 con una sección que documente `clientIp.ts`/
    `PROXY_SHARED_SECRET` como la forma en que SEC-003 se resolvió (sin adoptar `trustProxy` en sí),
    y registrar explícitamente si el propietario decide agregar bloqueo por IP ahora o diferirlo con
    una razón nueva — en cualquier caso, cerrar el condicional abierto en vez de dejarlo flotando.
  - **Recomendación:** actualizar el ADR-0007. Es una decisión de producto/seguridad pequeña pero
    real (¿corresponde ahora el refuerzo que el propio ADR previó?), y closing the loop cuesta un
    párrafo.

### D-17 (nuevo, 2026-10-02) — El ADR-0007 dice que una contraseña correcta da acceso aunque la cuenta esté bloqueada; el código responde `423 ACCOUNT_LOCKED`

- **Severidad:** Advertencia
- **Tipo:** Documentación que describe el sistema de forma inexacta (ADR vs código)
- **Prometido/afirmado:** *"una credencial correcta concede acceso aunque la cuenta esté bloqueada, y
  limpia el contador... quien sabe su contraseña nunca queda fuera"*
  (`docs/adrs/0007-sesion-cookie-rbac-propio.md:76-79`).
- **Real:** con la contraseña correcta y `bloqueado_hasta` en el futuro, `login` lanza
  `accountLocked(retryAfter)` (`423 ACCOUNT_LOCKED`) y no crea sesión
  (`apps/api/src/auth/service.ts:102-107`); el comentario de `apps/api/src/auth/service.ts:96-101`
  lo declara deliberado. La spec vigente lo ratifica en el escenario *"Locked account, correct
  password"* (`openspec/specs/auth-sessions/spec.md:47-50`). El cambio viene de la resolución de S01
  de `SECURITY-REPORT.md` (`SECURITY-REPORT.md:162-166`), que el comentario de
  `apps/api/src/auth/service.ts:73-81` registra como ratificada por el propietario el 2026-09-01; el
  ADR no se actualizó. La misma afirmación desactualizada se repite en `docs/SECURITY.md:218-221`
  (nota de resolución de SEC-001) y en `docs/BACKLOG.md:31` (ítem 2.3).
- **Por qué importa:** quien lea el ADR para saber qué le pasa al titular legítimo de una cuenta
  bloqueada concluye que entra; en realidad recibe `423` hasta que vence el bloqueo o hasta que
  alguien le restablece la contraseña. El comportamiento del código es el correcto (cierra un oráculo
  de enumeración); lo que está mal es el documento de decisión.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no aplica: el comportamiento actual es el que ratifica la spec.
  - `ACTUALIZAR PRD/ADR` — agregar al ADR-0007 un addendum que registre la resolución de S01: la
    contraseña se sigue verificando antes de evaluar el bloqueo, pero una contraseña correcta sobre
    una cuenta bloqueada recibe `423` con `retryAfter`, no acceso.
  - **Recomendación:** actualizar el ADR.

### D-18 (nuevo, 2026-10-02) — `seed-encargado.ts` guarda el correo sin normalizar, y el login lo busca normalizado

- **Severidad:** Advertencia
- **Tipo:** Regla omitida
- **Prometido/afirmado:** el login normaliza el correo (`trim().toLowerCase()`) antes de buscarlo
  (`apps/api/src/auth/service.ts:45-46`), y el alta de usuarios desde la aplicación lo guarda
  normalizado (`apps/api/src/usuarios/repository.ts:280`). `findByEmail` compara por igualdad exacta
  (`apps/api/src/usuarios/repository.ts:132-139`).
- **Real:** `apps/api/scripts/seed-encargado.ts:85` inserta `email: input.email` tal como llega de
  `--email` o de `SEED_ENCARGADO_EMAIL`; el esquema solo valida el formato
  (`apps/api/scripts/seed-encargado.ts:18`), no normaliza.
- **Por qué importa:** un primer encargado sembrado con mayúsculas (`Admin@Tienda.com`) nunca puede
  iniciar sesión: el login busca `admin@tienda.com` y no lo encuentra. Tampoco se puede volver a
  sembrar, porque el seed no hace nada si ya existe un encargado
  (`apps/api/scripts/seed-encargado.ts:76-78`), y el rescate de D-02 no lo repara: busca con la misma
  normalización que el login (`apps/api/src/usuarios/rescate.ts:51-53`) y responde "no encontrado".
  El runbook de `docs/DEPLOY-PLAN.md` lo documenta como fuera de su alcance.
- **Opciones:**
  - `CORREGIR CÓDIGO` — normalizar el correo en `seedEncargado` antes del `insert`, con un test que
    siembre un correo con mayúsculas y pruebe el login.
  - `ACTUALIZAR PRD/ADR` — no aplica: ningún documento promete guardar el correo tal como se escribe.
  - **Recomendación:** corregir el código.

## Resueltos desde la auditoría anterior (2026-09-04)

- **D-04 (Advertencia) — la decisión de backup seguía sin tomarse.** Resuelto: ver detalle en D-04
  arriba. Decisión tomada y workflow desplegado el mismo día que se escribió el reporte anterior
  (2026-09-04, vía `deploy-pass`, PRs #176/#177), con cuatro correcciones operativas posteriores
  (PRs #178-#182) que no cambian la conclusión, solo la endurecen.
- **D-01 (Crítico) — el rastro de auditoría no tenía lector en la aplicación.** Resuelto el
  2026-09-15, después de esta pasada: `GET /api/auditoria` (PRs #185–#187). Ver detalle en D-01
  arriba.
- **D-02 (Crítico) — no existía el procedimiento de rescate del último encargado.** Resuelto el
  2026-10-02, después de esta pasada: script `rescatar:encargado` y runbook en `docs/DEPLOY-PLAN.md`
  § Recovery → *Rescate del último encargado* (PRs #190–#194). Ver detalle en D-02 arriba.

## Corregidos desde la auditoría anterior (evidencia, no severidad)

- **D-03 — la línea de código citada como evidencia ya no era la que corría en producción al
  momento de escribir el reporte anterior.** El fix fail-closed de `secure` (commit `5520779`) es
  del 2026-09-01; el reporte anterior, fechado 2026-09-04, citó la línea pre-fix como si siguiera
  vigente. La conclusión del hallazgo (el TECH-DESIGNv2 sigue describiendo mal el riesgo) no cambia,
  pero la evidencia sí — ver D-03 arriba para el detalle y la cita corregida.
- **D-10 — el conteo de instancias del patrón POST de transición estaba subestimado.** La auditoría
  anterior contó tres (`usuarios`, `proveedores`, `ventas`); existe una cuarta (`alertas.ts:150`,
  `/alertas/:id/resolver`) mergeada el 2026-09-02, dos días antes de esa auditoría. Ver D-10 arriba.

## Deuda técnica detectada

- **`apps/api/src/productos/service.ts:231`, `apps/api/src/proveedores/service.ts:124,161`,
  `apps/api/src/usuarios/service.ts:207,248`** — re-verificado, sin cambios: el doble casteo
  `previo as unknown as Record<string, unknown>` sigue en exactamente los mismos tres dominios y
  líneas que en la auditoría anterior. Ningún commit desde entonces tocó estos archivos.
- **`openspec/changes/archive/2026-08-24-fundaciones-monorepo/tasks.md:75-82`** — las mismas cuatro
  tareas manuales sin marcar (ver D-09) siguen sin marcar.
- **`docs/adrs/0010-despliegue-tiers-gratuitos.md:79`** — la línea "Pendiente" sigue literal.

## Features no documentadas (drift inverso)

Además de la unicidad case-insensitive (D-06), las rutas de acción POST (D-10, ahora con conteo
corregido), la fuente Alerta-table del dashboard (D-13), y el mecanismo de IP verificada por proxy +
`secure` fail-closed (D-16, nuevo):

- **`ACCOUNT_INACTIVE` (401) en el login** (`apps/api/src/lib/errors.ts:96`,
  `apps/api/src/auth/service.ts:39`) — sin cambios.
- **`Cache-Control: no-store`** en las respuestas con contraseña temporal
  (`apps/api/src/routes/usuarios.ts:202,239`) — sin cambios.
- **`proveedores.creado_en`** expuesta en el DTO (`apps/api/src/routes/proveedores.ts:23,68`) —
  sin cambios.
- **Bloqueo de acciones sobre la propia cuenta en la SPA** — sin cambios, ya declarado como
  afordancia de UI en `openspec/specs/usuarios-ui/spec.md`.

## Alcance planificado (no es drift)

- **Recuperación de contraseña por email (#3.5)** — sigue bloqueada por infraestructura
  (`docs/BACKLOG.md:37`), y el PRD sigue sin prometer este flujo en su Alcance. No hay
  PRD-vs-código mismatch — el único drift asociado es la premisa de Firebase (D-11).
- Todo lo que ya se archivó como código real (backup independiente, D-04) dejó de estar en esta
  sección.

## Próximos pasos

Priorizados por consecuencia, no por esfuerzo:

1. ~~**D-02 (Crítico) — decisión del dueño del producto, hoy.**~~ Resuelto el 2026-10-02: el rescate
   del último encargado tiene script probado y runbook. Ver D-02 arriba.
2. ~~**D-01 (Crítico) — decisión de producto/arquitectura.**~~ Resuelto el 2026-09-15: el rastro se
   lee desde la app (`GET /api/auditoria`). Ver D-01 arriba.
3. **D-16 (Advertencia, nuevo) — cerrar el condicional del ADR-0007.** La condición que el propio ADR
   fijó para revisar el bloqueo por IP ya se cumplió hace más de una semana.
4. **D-15 (Advertencia, nuevo) — una edición de cinco minutos.** Reconciliar las dos secciones de
   `docs/DEPLOY-PLAN.md` sobre el backup antes de que alguien las lea por separado.
5. **D-13 (Advertencia) — sin cambios desde la auditoría anterior.** Separar la nota de trazabilidad
   del TECH-DESIGNv2 en chips (Producto) vs KPIs (Alerta).
6. **D-05, D-06 (Advertencia) — sin cambios.** Completar el modelo de datos y subir la unicidad
   case-insensitive al TECH-DESIGNv2.
7. **D-10 (Advertencia) — ratificar la convención antes del próximo dominio.** Ahora con cuatro
   réplicas confirmadas, no tres.
8. **D-03, D-09 (Advertencia) — sin cambios.** Cerrar el riesgo de despliegue local (con la
   evidencia corregida esta vez) y registrar el smoke test 5.9.
9. **D-14 (Sugerencia) — un cambio de tiempo verbal.** Sin cambios.
10. **D-08, D-11 (Sugerencia) — sin cambios.** Color de avatar por rol; corregir la premisa de
    Firebase del #3.5.
11. **D-18, D-17 (Advertencia, nuevos el 2026-10-02; agregados después de esta pasada, sin
    priorizar contra el resto).** Normalizar el correo en `seed-encargado.ts`, que hoy puede dejar un
    primer encargado que nunca inicia sesión; y registrar en el ADR-0007 la resolución de S01 sobre
    la cuenta bloqueada con contraseña correcta.

Ningún archivo de `docs/PRD.md`, ningún ADR, ni ningún archivo de código fue modificado durante esta
auditoría, salvo la reescritura de este mismo reporte.
