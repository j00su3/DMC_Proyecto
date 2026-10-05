# Drift Report: InvenTienda

**Fecha:** 2026-10-04

**Comparado contra:** `docs/PRD.md`, `docs/TECH-DESIGNv2.md` (documento vigente; `docs/TECH-DESIGN.md`
v1 está superseded y **no** se usó como fuente de promesas) + los 12 ADRs de `docs/adrs/`, contra el
estado de `apps/api` y `apps/web` en `main` a la altura de `9c80bdb`. `docs/BACKLOG.md`,
`docs/DEPLOY-PLAN.md`, `docs/SECURITY.md`, `SECURITY-REPORT.md` y `openspec/specs/` se usaron como
evidencia de apoyo, no como fuente de promesas.

**Continuidad con la pasada anterior:** la última refrescada completa es del 2026-09-09, con
actualizaciones parciales el 2026-09-15, 2026-10-02 y 2026-10-03. El mensaje del commit `537865c`
(2026-09-09) afirma que cerró D-03, D-05, D-06, D-10, D-11, D-13, D-14, D-15 y "la mitad
documentable" de D-16, pero el reporte seguía marcándolos abiertos. **Esta pasada no tomó ese
mensaje como evidencia:** para cada hallazgo abierto se releyó lo que el hallazgo decía que estaba
mal, se abrió el documento o el código citado tal como está hoy, y se decidió RESUELTO (con la cita
que lo prueba) o sigue abierto (con la cita actual). Varios quedaron **resueltos solo en parte**: en
esos casos el hallazgo sigue abierto con el alcance reducido a lo que falta, y la severidad se bajó
cuando lo que falta pesa menos que lo original (D-03, D-15, D-16). Los IDs `D-NN` se conservan
exactamente — `docs/BACKLOG.md`, `docs/DEPLOY-PLAN.md` y el ADR-0007 los citan por número. D-07 y
D-12 se cerraron en la pasada del 2026-09-04 y no se reutilizan. Los hallazgos nuevos toman los IDs
D-19 a D-25. **Actualización 2026-10-05:** D-26 se agregó después de esta pasada, al cerrar D-22
(ver el Resumen ejecutivo).

## Resumen ejecutivo

Se re-verificaron los 16 IDs presentes en el reporte anterior (D-01 a D-18, sin D-07 ni D-12) y se
buscó drift nuevo en ambas direcciones, con foco en lo entregado desde el 2026-09-09: la ruta de
lectura `GET /api/auditoria` (ciclo `auditoria-lectura`), el script `rescatar:encargado` y su
addendum en el ADR-0007 (ciclo `rescate-encargado`), la clave diferida de seudonimización, los
rate-limits por sesión de las rutas de gestión de usuarios y el harness `claims-gate`.

**Pre-existentes:** 9 resueltos (D-01, D-02, D-04 ya lo estaban; D-05, D-06, D-10, D-11, D-13 y D-14
se confirman resueltos hoy, por el commit `537865c`) y 7 siguen abiertos (D-03, D-08, D-09, D-15,
D-16, D-17, D-18), tres de ellos reducidos. **Nuevos:** 7 (D-19 a D-25). Los dos más relevantes:
la tabla `auditoria` guarda en claro el **nombre** de los usuarios aunque el PRD afirma que el rastro
"no conserva datos personales" (D-22), y la Venta no tiene los campos fiscales reservados que el
ADR-0003 y el TECH-DESIGNv2 dan por existentes (D-19). No hay hallazgos críticos: el drift que queda
es casi todo documentación que se quedó atrás de decisiones ya tomadas, más dos reglas (D-18, D-22)
que piden una decisión del propietario.

**Actualización 2026-10-05:** D-22 quedó RESUELTO por el ciclo `nombre-seudonimizado`: las
instantáneas seudonimizan el nombre de los usuarios desde ese día, y las filas escritas antes lo
conservan en claro. El caso de `proveedores.contacto`, que D-22 señalaba de paso, sale de ese
hallazgo y queda registrado como **D-26** (Sugerencia), fuera del alcance de aquel ciclo por
decisión del propietario del 2026-10-04. D-21 se amplió: rotar `COOKIE_SECRET` ahora también cambia
los seudónimos del nombre.

| Severidad | Cantidad |
|---|---|
| Crítico | 0 |
| Advertencia | 5 |
| Sugerencia | 9 |

La tabla cuenta **exactamente los 14 hallazgos que este reporte deja abiertos al 2026-10-05**:
Advertencia — D-09, D-17, D-18, D-19, D-24; Sugerencia — D-03, D-08, D-15, D-16, D-20, D-21, D-23,
D-25, D-26. Los resueltos (D-01, D-02, D-04, D-05, D-06, D-10, D-11, D-13, D-14, D-22) no se
cuentan.

### Estado de cada hallazgo pre-existente

| ID | Estado al 2026-10-04 | Evidencia en una línea |
|---|---|---|
| D-01 | RESUELTO (2026-09-15) | `GET /api/auditoria`, solo encargado (`apps/api/src/routes/auditoria.ts:80-105`) |
| D-02 | RESUELTO (2026-10-02) | script `rescatar:encargado` (`apps/api/package.json:17`) + runbook |
| D-03 | Sigue abierto, reducido → Sugerencia | el riesgo ya describe `Secure` fail-closed, pero `TECH-DESIGNv2.md:100-102` y `ADR-0007:34-36` siguen atándolo a ADR-0009 |
| D-04 | RESUELTO (2026-09-04) | `.github/workflows/backup-neon.yml` |
| D-05 | RESUELTO (2026-09-09) | `TECH-DESIGNv2.md:92-98`, `:137-139`, `:177-179`, `:182-190` |
| D-06 | RESUELTO (2026-09-09) | `TECH-DESIGNv2.md:105-111` |
| D-08 | Sigue abierto | `AppShell.module.css:99-111` sigue con un único `.avatar` |
| D-09 | Sigue abierto | `tasks.md:77-79,82` sin marcar; `ADR-0010:79-81` sigue "Pendiente" |
| D-10 | RESUELTO (2026-09-09) | excepción escrita en `ADR-0004:32-43` (enumeración incompleta → D-20) |
| D-11 | RESUELTO (2026-09-09) | `BACKLOG.md:37` ya no cita Firebase Hosting |
| D-13 | RESUELTO (2026-09-09) | `TECH-DESIGNv2.md:192-193` separa las dos fuentes |
| D-14 | RESUELTO (2026-09-09) | `TECH-DESIGNv2.md:383-387` en pasado y con rutas reales |
| D-15 | Sigue abierto, reducido → Sugerencia | nota agregada, pero el título `DEPLOY-PLAN.md:639` sigue diciendo "decisión pendiente" |
| D-16 | Sigue abierto, reducido → Sugerencia | mecanismo documentado en `ADR-0007:100-116`; la decisión sobre bloqueo por IP sigue sin tomarse (`:118-122`) |
| D-17 | Sigue abierto | `ADR-0007:76-79` (y ahora también `TECH-DESIGNv2.md:95-97`) vs `auth/service.ts:102-107` |
| D-18 | Sigue abierto | `seed-encargado.ts:85` inserta el correo sin normalizar |

## Hallazgos

### D-01 — El rastro de auditoría ya se puede leer desde la aplicación: RESUELTO

- **Severidad:** ~~Crítico~~ — cerrado.
- **Estado:** **RESUELTO el 2026-09-15**, por el ciclo `auditoria-lectura` (PRs #185, #186 y #187).
- **Lo que estaba abierto:** el ADR-0012 justifica la denylist de campos sensibles por quién va a
  consultar la tabla: *"una tabla pensada para que el encargado la lea"*
  (`docs/adrs/0012-frontera-auditoria-y-ledger.md:50-53`). Al 2026-09-09, `AuditoriaRepo` solo
  exponía `record` y ninguna ruta permitía leer el rastro.
- **Re-verificado el 2026-10-04:**
  - `AuditoriaRepo` expone `record` y `list(filtro, page, pageSize)`
    (`apps/api/src/auditoria/repository.ts:46-56`).
  - `apps/api/src/app.ts:157-180` registra once grupos de rutas; el undécimo es `auditoria`
    (`apps/api/src/app.ts:180`).
  - `GET /api/auditoria` (`apps/api/src/routes/auditoria.ts:80-105`) está restringido a
    `roles: ['encargado']`, devuelve el sobre paginado y filtra por `entidad`+`entidadId` y por
    `usuarioId`; `entidadId` sin `entidad` se rechaza (`apps/api/src/routes/auditoria.ts:16-27`).
- **Ver también:** D-22 — lo que esta ruta devuelve incluye datos personales que el PRD dice que el
  rastro no conserva.

### D-02 — El procedimiento de rescate del último encargado ya existe y está probado: RESUELTO

- **Severidad:** ~~Crítico~~ — cerrado.
- **Estado:** **RESUELTO el 2026-10-02**, por el ciclo `rescate-encargado` (PRs #190 a #194).
- **Lo que estaba abierto:** el ADR-0007 promete que *"como vía de rescate si el único encargado
  pierde su contraseña, se documenta un procedimiento administrativo manual"*
  (`docs/adrs/0007-sesion-cookie-rbac-propio.md:61-63`), y no existía.
- **Re-verificado el 2026-10-04:**
  - `apps/api/package.json:17` declara `rescatar:encargado` (`tsx scripts/rescatar-encargado.ts`).
  - `apps/api/src/usuarios/rescate.ts:51-62` busca el correo normalizado y rechaza, antes de
    cualquier escritura, un correo inexistente, una cuenta que no es de encargado y una cuenta
    inactiva; sin `--confirmar` devuelve una simulación (`apps/api/src/usuarios/rescate.ts:72-78`);
    con `--confirmar` llama a `resetUsuarioPassword` con la propia cuenta como actor y la marca
    `'rescate'` (`apps/api/src/usuarios/rescate.ts:82-86`), que solo se agrega al estado posterior
    de la fila de auditoría (`apps/api/src/usuarios/service.ts:318-323`).
  - `apps/api/scripts/rescatar-encargado.ts:190` imprime la base de destino antes de ejecutar, y
    `apps/api/scripts/rescatar-encargado.ts:120-159` arma la salida por resultado.
  - Runbook en `docs/DEPLOY-PLAN.md:536-637` (§ Recovery → *Rescate del último encargado*), con
    addendum en `docs/adrs/0007-sesion-cookie-rbac-propio.md:156-178`.

### D-03 — Quedan dos lugares que atan `Secure` al despliegue local, y el riesgo A11 sigue "abierto" contra lo que dicen el ADR-0009 y el propio TECH-DESIGNv2

- **Severidad:** Sugerencia (bajada desde Advertencia: lo central se corrigió).
- **Tipo:** Documentación que describe el sistema de forma inexacta.
- **Estado:** **Sigue abierto, con alcance reducido.**
- **Lo que se resolvió:** el registro de riesgos ya no dice que la cookie carece de `Secure`:
  `docs/TECH-DESIGNv2.md:407-415` describe el fail-closed y `ALLOW_INSECURE_COOKIES`, y coincide con
  `apps/api/src/auth/session.ts:45-54` (`secure: process.env.ALLOW_INSECURE_COOKIES !== 'true'`,
  `:51`). Esa era la queja original.
- **Lo que sigue mal hoy:**
  - `docs/TECH-DESIGNv2.md:100-102` (entidad **Sesión**): *"`Secure` queda condicionado al
    despliegue, ver ADR-0009"*. `docs/adrs/0007-sesion-cookie-rbac-propio.md:34-36` repite la misma
    frase. El código no condiciona `Secure` a ningún despliegue, y el ADR-0009 está reemplazado.
  - `docs/TECH-DESIGNv2.md:405-407` sigue titulando el riesgo *"Despliegue local sin HTTPS: mientras
    el sistema corra solo en la máquina del desarrollador (ADR-0009)"*.
  - El riesgo **(A11)** cierra con *"El riesgo queda abierto hasta que ese hito llegue y la decisión
    se tome"* (`docs/TECH-DESIGNv2.md:416-423`), mientras el mismo documento dice que el despliegue
    del ADR-0010 *"resuelve la condición de revisión de producto agregada en v2 (A11)"*
    (`docs/TECH-DESIGNv2.md:63-65`) y el ADR-0009 se declara reemplazado precisamente porque esa
    condición *"se resolvió con el nuevo despliegue"* (`docs/adrs/0009-despliegue-local.md:5-8`).
  - Fuera de PRD/ADR, la misma idea vieja aparece en `docs/DEPLOY-PLAN.md:151` (*"`production`
    activa el flag `Secure` de la cookie"*) y en el comentario de `render.yaml:14-15` (*"Gates the
    cookie's Secure flag"* sobre `NODE_ENV`).
- **Por qué importa:** quien llega a la entidad Sesión o al ADR-0007 para saber cuándo la cookie es
  `Secure` recibe una respuesta que ya no es cierta, y el TECH-DESIGNv2 se contradice sobre si A11
  está abierto.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no aplica.
  - `ACTUALIZAR PRD/ADR` — reemplazar la frase de `TECH-DESIGNv2.md:100-102` y `ADR-0007:34-36` por
    una referencia al fail-closed; retitular el riesgo de despliegue local y marcar A11 resuelto con
    fecha, coherente con `:63-65` y con el ADR-0009.
  - **Recomendación:** actualizar los documentos.

### D-04 — La decisión de backup se tomó y se implementó: RESUELTO

- **Severidad:** ~~Advertencia~~ — cerrado.
- **Estado:** **RESUELTO el 2026-09-04.**
- **Lo que estaba abierto:** el backup del ADR-0009 (`pg_dump` vía Task Scheduler a disco local)
  quedó huérfano cuando el ADR-0010 movió la base a Neon.
- **Re-verificado el 2026-10-04:** `.github/workflows/backup-neon.yml` corre `cron: '0 9 * * 0'`
  (`:11`) más `workflow_dispatch` (`:12`), hace `pg_dump` dentro de `postgres:18-alpine` con
  `--no-owner --no-privileges --exclude-schema=drizzle` bajo `set -o pipefail` (`:40-42`) y sube el
  artefacto con `retention-days: 90` (`:50`). La decisión está registrada en
  `docs/DEPLOY-PLAN.md:1101-1139`. Queda pendiente un paso operativo del propietario (rol read-only de
  Neon), rastreado en `docs/DEPLOY-PLAN.md` § Autorizaciones pendientes #11 (`:891`), no una promesa
  incumplida.

### D-05 — El modelo de datos del TECH-DESIGNv2 ya lista las columnas y la entidad que faltaban: RESUELTO

- **Severidad:** ~~Advertencia~~ — cerrado.
- **Estado:** **RESUELTO el 2026-09-09** (commit `537865c`), verificado hoy.
- **Lo que estaba abierto:** **Usuario** sin `intentos_fallidos`/`bloqueado_hasta`/
  `debe_cambiar_password`, **Movimiento** sin `es_merma`, **Alerta** sin `movimiento_id`, y sin
  entidad **Auditoría**.
- **Evidencia:** `docs/TECH-DESIGNv2.md:92-98` (Usuario con las tres columnas), `:137-139`
  (`es_merma` y `CHECK movimientos_merma_solo_salida`), `:177-179` (`movimiento_id` nulo), `:182-190`
  (entidad Auditoría). Coinciden con `apps/api/src/db/schema.ts:31`, `:32`, `:39`, `:206`, `:253-255`,
  `:425-427` y `:105-141`.
- **Nota:** la línea que se agregó a Usuario (`TECH-DESIGNv2.md:95-97`) trajo consigo la afirmación
  desactualizada sobre la cuenta bloqueada — ver D-17. Y el modelo de **Venta** tiene su propio
  desajuste — ver D-19.

### D-06 — La unicidad case-insensitive ya está documentada: RESUELTO

- **Severidad:** ~~Advertencia~~ — cerrado.
- **Estado:** **RESUELTO el 2026-09-09** (commit `537865c`), verificado hoy.
- **Evidencia:** `docs/TECH-DESIGNv2.md:105-111` nombra `proveedores_nombre_lower_unique` y
  `productos_sku_lower_unique` como índices funcionales sobre `lower(...)`, que es lo que definen
  `apps/api/src/db/schema.ts:64-66` y `:188`.

### D-08 — El avatar del shell sigue sin distinguir color por rol

- **Severidad:** Sugerencia
- **Tipo:** Feature fantasma (implementada de forma materialmente distinta).
- **Estado:** Sigue abierto, sin cambios.
- **Prometido:** *"(El Design.md muestra avatar con iniciales y color por rol: azul encargado, verde
  depósito.)"* (`docs/TECH-DESIGNv2.md:99`).
- **Real:** `apps/web/src/components/ui/AppShell.module.css:99-111` define un único `.avatar` con
  `background: var(--color-accent)`, y `apps/web/src/components/ui/AppShell.tsx:119` lo aplica sin
  variante por rol.
- **Por qué importa:** menor; el rol ya se muestra como texto (`AppShell.tsx:124`).
- **Opciones:**
  - `CORREGIR CÓDIGO` — agregar una variante de `.avatar` por rol.
  - `ACTUALIZAR PRD/ADR` — quitar la nota del TECH-DESIGNv2 si el color por rol dejó de ser intención.
  - **Recomendación:** corregir el código — sin cambios.

### D-09 — La verificación del `Set-Cookie` post-deploy (tarea 5.9) sigue sin registrarse

- **Severidad:** Advertencia
- **Tipo:** Documentación que describe el sistema de forma inexacta.
- **Estado:** Sigue abierto, sin cambios.
- **Prometido:** *"**Pendiente:** registrar aquí el resultado del smoke test post-deploy (tarea 5.9
  de `fundaciones-monorepo`)"* (`docs/adrs/0010-despliegue-tiers-gratuitos.md:79-81`).
- **Real:** `openspec/changes/archive/2026-08-24-fundaciones-monorepo/tasks.md:77-79` (5.4-5.6) y
  `:82` (5.9) siguen sin marcar, aunque 5.4 está hecha de hecho: `vercel.json:8` ya apunta a
  `https://inventienda-api.onrender.com`. `docs/DEPLOY-PLAN.md:466-469` también dice *"Sigue
  pendiente"*.
- **Por qué importa:** la única verificación que confirma que el proxy de Vercel no altera la cookie
  de sesión no tiene resultado registrado; el ADR la sigue declarando pendiente.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no aplica; es una verificación manual.
  - `ACTUALIZAR PRD/ADR` — ejecutar 5.9, registrar el resultado en `ADR-0010:79-81` y marcar 5.4-5.6
    con evidencia.
  - **Recomendación:** ejecutar y registrar — sin cambios.

### D-10 — La convención `POST /<recurso>/:id/<transición>` ya está escrita en el ADR-0004: RESUELTO

- **Severidad:** ~~Advertencia~~ — cerrado.
- **Estado:** **RESUELTO el 2026-09-09** (commit `537865c`), verificado hoy.
- **Evidencia:** `docs/adrs/0004-rest-json-openapi.md:32-43` acepta explícitamente el patrón *"para
  acciones de cambio de estado"*. Todas las rutas de transición con `:id` del código caen dentro de
  esa regla general.
- **Nota:** la enumeración que acompaña la regla es incompleta, y el conteo de "cuatro" que traía este
  hallazgo también lo era. Se registra aparte como D-20.

### D-11 — El backlog ya no justifica el bloqueo del #3.5 con Firebase Hosting: RESUELTO

- **Severidad:** ~~Sugerencia~~ — cerrado.
- **Estado:** **RESUELTO el 2026-09-09** (commit `537865c`), verificado hoy.
- **Evidencia:** `docs/BACKLOG.md:37` ahora dice *"el proyecto corre en Vercel (SPA) + Render (API) +
  Neon (Postgres), y ninguno de los tres da un dominio propio con ese control de DNS"*; Firebase solo
  aparece como alternativa descartada.

### D-13 — La trazabilidad del TECH-DESIGNv2 ya separa KPIs (Alerta) de chips (Producto): RESUELTO

- **Severidad:** ~~Advertencia~~ — cerrado.
- **Estado:** **RESUELTO el 2026-09-09** (commit `537865c`), verificado hoy.
- **Evidencia:** `docs/TECH-DESIGNv2.md:192-193` asigna las KPI cards a `Alerta` y los chips a
  `stock_actual`/`stock_minimo` calculados en el cliente. Coincide con
  `apps/api/src/dashboard/service.ts:46-48` (`countAbiertasPorTipo`, `countAbiertas`) y
  `apps/web/src/features/productos/ProductosTable.tsx:62-67`.

### D-14 — El registro de riesgos describe la verificación de consistencia como ya hecha: RESUELTO

- **Severidad:** ~~Sugerencia~~ — cerrado.
- **Estado:** **RESUELTO el 2026-09-09** (commit `537865c`), verificado hoy.
- **Evidencia:** `docs/TECH-DESIGNv2.md:383-387` dice *"se agregó una verificación periódica de
  consistencia"* y nombra `apps/api/scripts/verificar-consistencia.ts` y
  `.github/workflows/consistencia-stock.yml`; ambos archivos existen.

### D-15 — `docs/DEPLOY-PLAN.md` conserva el título "decisión pendiente" sobre el backup, y la nota que lo corrige describe mal lo que sigue

- **Severidad:** Sugerencia (bajada desde Advertencia).
- **Tipo:** Documentación que describe el sistema de forma inexacta (no es PRD/ADR).
- **Estado:** **Sigue abierto, con alcance reducido.**
- **Lo que se resolvió:** el texto que decía *"Dos caminos, ninguno adoptado todavía"* se eliminó, y
  una nota aclara que la decisión ya se tomó (`docs/DEPLOY-PLAN.md:641-645`). Un lector ya no sale
  creyendo que la decisión sigue abierta.
- **Lo que sigue mal hoy:**
  - El título sigue siendo *"Backup independiente — decisión pendiente (backlog #14, mitad B)"*
    (`docs/DEPLOY-PLAN.md:639`).
  - La nota dice que *"Lo que sigue describe el estado antes de decidir"* (`:641-642`), pero lo que
    sigue (`:647-676`) es guía de recuperación vigente (la asimetría código/datos y el primer
    diagnóstico ante un incidente), no contexto histórico.
  - La nota remite a la entrada del 2026-09-04 *"más abajo (sección Recovery)"* (`:643-644`), pero esa
    entrada (`:1101`) está bajo `## Registro de ejecución y verificación` (`:896`), no bajo Recovery.
- **Por qué importa:** poco, pero un lector puede saltarse guía de incidentes vigente creyéndola
  histórica.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no aplica.
  - `ACTUALIZAR PRD/ADR` — no aplica en sentido estricto; retitular la sección (p. ej. "Recuperación
    ante incidentes") y corregir la nota y su referencia.
  - **Recomendación:** actualizar el documento.

### D-16 — El mecanismo de IP verificada ya está en el ADR-0007; la revisión del bloqueo por IP que el propio ADR prometió sigue sin hacerse

- **Severidad:** Sugerencia (bajada desde Advertencia).
- **Tipo:** Regla omitida (revisión comprometida y no realizada).
- **Estado:** **Sigue abierto, con alcance reducido.**
- **Lo que se resolvió:** la mitad de "feature no documentada". `docs/adrs/0007-sesion-cookie-rbac-propio.md:100-116`
  documenta `apps/api/src/plugins/clientIp.ts`, `PROXY_SHARED_SECRET` y `trustProxy` apagado, y
  `docs/TECH-DESIGNv2.md:407-415` documenta `ALLOW_INSECURE_COOKIES`.
- **Lo que sigue abierto:** el ADR-0007 dejó el bloqueo por IP *"disponible como refuerzo posterior,
  una vez corregido SEC-003"* (`:81-84`). SEC-003 se corrigió el 2026-08-30, y el addendum del
  2026-09-09 registra explícitamente que *"nadie volvió a evaluar"* esa decisión y que *"queda para el
  propietario"* (`:118-122`). A la fecha sigue sin evaluarse: ningún documento posterior la retoma, y
  `docs/BACKLOG.md:34` sigue diciendo que 2.6 *"Habilita además el bloqueo por IP"* sin decisión. Un
  dato nuevo para esa decisión: el código ya considera la resolución de IP real *"only partially
  verifiable"* detrás de Render + Vercel (`apps/api/src/plugins/sessionRateLimit.ts:6-9`).
- **Por qué importa:** ya no engaña a nadie (el ADR dice honestamente que está abierto), pero es un
  condicional de seguridad que el propio ADR se comprometió a cerrar.
- **Opciones:**
  - `CORREGIR CÓDIGO` — si el propietario decide que el refuerzo vale la pena, sería un cambio nuevo.
  - `ACTUALIZAR PRD/ADR` — registrar en el ADR-0007 la decisión de no agregarlo (p. ej. con el
    argumento de `sessionRateLimit.ts:6-9`) o de diferirlo con una condición nueva.
  - **Recomendación:** que el propietario decida y el ADR lo registre; cualquiera de las dos opciones
    cierra el hallazgo.

### D-17 — El ADR-0007 (y ahora también el TECH-DESIGNv2) dice que una contraseña correcta da acceso aunque la cuenta esté bloqueada; el código responde `423 ACCOUNT_LOCKED`

- **Severidad:** Advertencia
- **Tipo:** Documentación que describe el sistema de forma inexacta (ADR vs código).
- **Estado:** Sigue abierto, **y se extendió**: el commit `537865c` copió la misma afirmación al
  TECH-DESIGNv2.
- **Prometido/afirmado:** *"una credencial correcta concede acceso aunque la cuenta esté bloqueada, y
  limpia el contador... quien sabe su contraseña nunca queda fuera"*
  (`docs/adrs/0007-sesion-cookie-rbac-propio.md:76-79`). El TECH-DESIGNv2 lo repite en la entidad
  Usuario: *"una credencial correcta concede acceso y limpia el contador"*
  (`docs/TECH-DESIGNv2.md:95-97`).
- **Real:** con la contraseña correcta y `bloqueado_hasta` en el futuro, `login` lanza
  `accountLocked(retryAfter)` y no crea sesión (`apps/api/src/auth/service.ts:102-107`); el comentario
  de `:96-101` lo declara deliberado, y el de `:73-81` registra la resolución de S01
  (`SECURITY-REPORT.md:161-165`), ratificada por el propietario el 2026-09-01. La spec vigente lo
  fija en el escenario *"Locked account, correct password"*
  (`openspec/specs/auth-sessions/spec.md:47-50`). La afirmación vieja sigue además en
  `docs/SECURITY.md:218-221` y `:1214`, y en `docs/BACKLOG.md:31`. El propio encabezado de `login`
  en el código quedó desactualizado: *"lockout is checked before the password verify"*
  (`apps/api/src/auth/service.ts:36-40`).
- **Por qué importa:** quien consulte el ADR o el modelo de datos para saber qué le pasa al titular
  legítimo de una cuenta bloqueada concluye que entra; en realidad recibe `423` hasta que vence el
  bloqueo o alguien le restablece la contraseña.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no aplica: el comportamiento actual es el que ratifica la spec.
  - `ACTUALIZAR PRD/ADR` — addendum en el ADR-0007 con la resolución de S01, y corregir
    `TECH-DESIGNv2.md:95-97`.
  - **Recomendación:** actualizar el ADR y el TECH-DESIGNv2.

### D-18 — `seed-encargado.ts` guarda el correo sin normalizar, y el login lo busca normalizado

- **Severidad:** Advertencia
- **Tipo:** Regla omitida.
- **Estado:** Sigue abierto, sin cambios.
- **Prometido/afirmado:** el login normaliza el correo antes de buscarlo
  (`apps/api/src/auth/service.ts:32-34` y `:45`), el alta desde la aplicación lo guarda normalizado
  (`apps/api/src/usuarios/repository.ts:280`), y `findByEmail` compara por igualdad exacta
  (`apps/api/src/usuarios/repository.ts:132-139`).
- **Real:** `apps/api/scripts/seed-encargado.ts:85` inserta `email: input.email` tal como llega; el
  esquema solo valida el formato (`apps/api/scripts/seed-encargado.ts:18`).
- **Por qué importa:** un primer encargado sembrado con mayúsculas nunca puede iniciar sesión. No se
  puede volver a sembrar (`apps/api/scripts/seed-encargado.ts:76-78` no hace nada si ya existe un
  encargado), y el rescate de D-02 tampoco lo repara: busca con la misma normalización
  (`apps/api/src/usuarios/rescate.ts:51-53`) y responde "no encontrado".
- **Opciones:**
  - `CORREGIR CÓDIGO` — normalizar el correo en `seedEncargado` antes del `insert`, con un test que
    siembre un correo con mayúsculas y pruebe el login.
  - `ACTUALIZAR PRD/ADR` — no aplica: ningún documento promete guardar el correo tal como se escribe.
  - **Recomendación:** corregir el código.

### D-19 (nuevo) — La Venta no tiene los campos fiscales reservados que el ADR-0003 y el TECH-DESIGNv2 dan por existentes

- **Severidad:** Advertencia
- **Tipo:** Feature fantasma (decisión de modelo de datos no implementada).
- **Prometido:** el ADR-0003 fija como consecuencia que *"El modelo de la venta se diseña... con
  campos reservados para la futura factura fiscal (etapa 2), sin implementarla en v1"*
  (`docs/adrs/0003-postgres-stock-guardado-ledger.md:55-56`). El TECH-DESIGNv2 los nombra: *"Campos
  reservados para etapa 2 (factura fiscal), no usados en v1: `tipo_comprobante`, `cae`,
  `numero_fiscal`"* (`docs/TECH-DESIGNv2.md:153-156`), y su registro de riesgos los cuenta como
  puerta ya abierta: *"los campos fiscales reservados en Venta... reducen el costo futuro"*
  (`docs/TECH-DESIGNv2.md:424-427`). El PRD pide tenerlo *"en cuenta en el modelo de datos de la venta
  desde v1"* (`docs/PRD.md:198-200`).
- **Real:** la tabla `ventas` (`apps/api/src/db/schema.ts:293-331`) tiene `id`, `numero_correlativo`,
  `usuario_id`, `estado`, `total`, `creado_en`, `anulada_por`, `anulada_en` y `motivo_anulacion` —
  ninguno de los tres campos reservados. La spec del POS solo excluye el `numero_fiscal` como contador
  futuro (`openspec/specs/point-of-sale/spec.md:20-21`); no registra la decisión de no reservar las
  columnas. Desajuste menor en la misma entidad: el TECH-DESIGNv2 la llama `fecha` y el esquema
  `creado_en` (`apps/api/src/db/schema.ts:305`).
- **Por qué importa:** el TECH-DESIGNv2 presenta como mitigación de riesgo de etapa 2 algo que no
  existe. El costo técnico real de agregarlas después es bajo (columnas nulas, migración aditiva), así
  que lo que está mal es más la promesa que el código.
- **Opciones:**
  - `CORREGIR CÓDIGO` — agregar `tipo_comprobante`, `cae` y `numero_fiscal` nulos a `ventas` (una
    migración aditiva más, aplicada a mano contra Neon).
  - `ACTUALIZAR PRD/ADR` — registrar que los campos se agregarán en etapa 2 con una migración
    aditiva, y quitar la afirmación de `TECH-DESIGNv2.md:424-427`. Justificable: reservar columnas
    sin uso no ahorra nada que una migración aditiva no dé.
  - **Recomendación:** actualizar los documentos; reservar columnas vacías no tiene valor propio.

### D-20 (nuevo) — La enumeración del ADR-0004 omite rutas de transición que ya existían, y `POST /alertas/marcar-vistas` no encaja en la forma documentada

- **Severidad:** Sugerencia
- **Tipo:** Feature no documentada (drift inverso).
- **Prometido/afirmado:** *"El patrón se asentó de forma independiente en cuatro dominios"*: usuarios
  (`password-reset`), proveedores (`deactivate`, `reactivate`), ventas (`anular`) y alertas
  (`resolver`) (`docs/adrs/0004-rest-json-openapi.md:32-37`). La excepción aceptada tiene la forma
  `POST /<recurso>/:id/<transición>` (`:32`).
- **Real:**
  - `POST /productos/:id/deactivate` y `/reactivate` (`apps/api/src/routes/productos.ts:223-228`,
    desde el 2026-08-29, commit `d431d7b`) — un quinto dominio.
  - `POST /usuarios/:id/deactivate` y `/reactivate` (`apps/api/src/routes/usuarios.ts:275-280`, desde
    el 2026-08-28, commit `67cb657`) — no figuran en la lista de usuarios.
  - `POST /alertas/marcar-vistas` (`apps/api/src/routes/alertas.ts:178-179`, desde el 2026-09-02,
    commit `e80a125`) es una acción sobre la colección, sin `:id`: no cae dentro de la forma que el
    ADR acepta.
  - Las tres existían antes del addendum del 2026-09-09, y antes de la pasada que contó "cuatro
    instancias".
- **Por qué importa:** las rutas con `:id` ya están cubiertas por la regla general, así que es solo
  una lista inexacta. `marcar-vistas` es distinto: es una segunda forma de acción no-CRUD sin ninguna
  línea que la autorice.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no recomendable; cambiar rutas publicadas rompe el contrato.
  - `ACTUALIZAR PRD/ADR` — completar la enumeración (o quitarla y dejar solo la regla), y decidir si
    las acciones sobre colección (`POST /<recurso>/<acción>`) son una excepción aceptada.
  - **Recomendación:** actualizar el ADR-0004.

### D-21 (nuevo) — La seudonimización del correo y del nombre usa `COOKIE_SECRET` como clave, y ningún documento de decisión ni de operación lo registra

- **Severidad:** Sugerencia
- **Tipo:** Feature no documentada (drift inverso).
- **Prometido/afirmado:** el PRD decide que *"Las instantáneas `datos_previos` / `datos_posteriores`
  seudonimizan el correo y el nombre"* (`docs/PRD.md:202-205`), sin fijar el mecanismo. Ningún ADR,
  ni el PRD, ni el TECH-DESIGNv2 mencionan `COOKIE_SECRET` como clave de nada que no sea la cookie.
  `docs/DEPLOY-PLAN.md:150` describe `COOKIE_SECRET` solo como *"Firma de la cookie de sesión"*, y
  documenta que rotarlo *"invalida todas las sesiones activas"* (`:176-179`, también `:891`).
- **Real:** `recordAudit` reemplaza el correo y, desde el 2026-10-05 (ciclo `nombre-seudonimizado`,
  que cerró D-22), también el nombre por un HMAC-SHA256 con una etiqueta de dominio por campo
  (`apps/api/src/auditoria/fields.ts:28-31`; `apps/api/src/auditoria/service.ts:80-96`) cuya clave
  es `process.env.COOKIE_SECRET` (`apps/api/src/auditoria/service.ts:106-126`). Desde el 2026-10-02
  (commit `aabed0d`, PR #191) la clave se resuelve solo cuando una instantánea contiene un string a
  seudonimizar (`apps/api/src/auditoria/service.ts:77-79`, `:116-117`), y eso permite que el script
  de rescate corra sin `COOKIE_SECRET`. Solo `docs/BACKLOG.md:33` (ítem 2.5), `:51` (ítem 16) y
  `:52` (ítem 17) lo cuentan, y `render.yaml:22-23` genera el secreto automáticamente
  (`generateValue: true`).
- **Por qué importa:** rotar `COOKIE_SECRET` (el procedimiento de incidente de
  `DEPLOY-PLAN.md:891`), o recrear el servicio de Render, que genera un valor nuevo, también cambia
  los seudónimos: el mismo correo produce un valor distinto antes y después de la rotación, y desde
  el 2026-10-05 lo mismo vale para el nombre. Se pierde la propiedad que justificó seudonimizar en
  vez de omitir ("el mismo correo siempre produce el mismo seudónimo", `BACKLOG.md:33`). Hoy ese
  efecto no figura en ninguna parte donde lo vea quien rota la clave.
- **Opciones:**
  - `CORREGIR CÓDIGO` — usar un secreto propio para la seudonimización, separado de la cookie.
  - `ACTUALIZAR PRD/ADR` — registrar el mecanismo (clave compartida, resolución diferida) en el
    ADR-0012 o en una nota del PRD, y agregar el efecto sobre los seudónimos a la fila de rotación de
    `docs/DEPLOY-PLAN.md`.
  - **Recomendación:** actualizar los documentos; la reutilización de la clave fue una decisión
    explícita del ítem 2.5, lo que falta es su consecuencia operativa.

### D-22 — El rastro de auditoría ya no guarda en claro el nombre de los usuarios: RESUELTO

- **Severidad:** ~~Advertencia~~ — cerrado.
- **Estado:** **RESUELTO el 2026-10-05**, por el ciclo `nombre-seudonimizado`.
- **Lo que estaba abierto:** el PRD decide que el rastro de auditoría es permanente pero *"no
  conserva datos personales"* (`docs/PRD.md:202-204`). Para `usuarios`, sin embargo, solo `email`
  estaba en `pseudonymizedFields`: el alta y cada cambio de nombre escribían el nombre completo en
  claro en el rastro permanente, y la supresión que el PRD da por satisfecha no lo alcanzaba. El
  propietario eligió la opción de código: seudonimizar `nombre`, sin reescribir las filas ya
  escritas.
- **Re-verificado el 2026-10-05:**
  - `PSEUDONYM_DOMAIN_TAGS` asigna a cada campo su propia etiqueta de dominio: `email` conserva
    `audit-email-pseudonym:` y `nombre` usa `audit-nombre-pseudonym:`
    (`apps/api/src/auditoria/fields.ts:28-31`); `usuarios` declara
    `pseudonymizedFields: ['email', 'nombre']` (`apps/api/src/auditoria/fields.ts:74`).
  - `pseudonymizeWith` busca la etiqueta de cada campo y calcula el HMAC sobre
    `PSEUDONYM_DOMAIN_TAGS[field] + value` (`apps/api/src/auditoria/service.ts:89-90`), así que el
    mismo texto guardado como `email` y como `nombre` no produce el mismo seudónimo.
  - El test de integración *"stores no plaintext name in the audit rows after a create then a
    rename"* (`apps/api/src/routes/usuarios.integration.test.ts:626`) hace un alta y un cambio de
    nombre reales contra Postgres y comprueba que ninguna de las dos instantáneas guardadas contiene
    el nombre anterior ni el nuevo.
  - Las filas escritas antes del cambio conservan el nombre en claro y no se reescriben, por
    decisión del propietario; `GET /api/auditoria` las devuelve tal como están
    (`apps/api/src/routes/usuarios.integration.test.ts:696`).
- **Ver también:** D-26 — `proveedores.contacto`, que este hallazgo señalaba de paso, quedó fuera
  del ciclo y se registra aparte.

### D-23 (nuevo) — Tres rutas autenticadas tienen rate-limit por sesión, y los documentos de decisión solo conocen el del login

- **Severidad:** Sugerencia
- **Tipo:** Feature no documentada (drift inverso).
- **Prometido/afirmado:** el ADR-0007 habla de rate-limit/lockout del login (`:57-58`) y acota el
  costo de argon2 *"por el rate-limit de la ruta de login"* (`:86-87`); el TECH-DESIGNv2 nombra solo
  *"rate-limit de login con `@fastify/rate-limit`"* (`docs/TECH-DESIGNv2.md:51`).
- **Real:** desde el 2026-09-01 (commit `d82dca0`, S02 de `SECURITY-REPORT.md`), `POST
  /auth/password`, `POST /usuarios` y `POST /usuarios/:id/password-reset` llevan un rate-limit con
  clave = id del usuario autenticado, no IP (`apps/api/src/plugins/sessionRateLimit.ts:1-26`;
  `apps/api/src/routes/auth.ts:127-145`; `apps/api/src/routes/usuarios.ts:165-179` y `:209-219`). El
  comentario de `apps/api/src/app.ts:136-137` sigue diciendo *"currently only POST /api/auth/login"*.
- **Por qué importa:** es un control de seguridad real (limita el costo de argon2 que puede disparar
  cualquier sesión, incluso `deposito`) y una decisión de diseño (clave por sesión porque la IP no es
  confiable) que no está donde se buscan esas decisiones.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no aplica al mecanismo; solo el comentario de `app.ts:136-137`.
  - `ACTUALIZAR PRD/ADR` — un párrafo en el ADR-0007 con las tres rutas y el criterio de clave por
    sesión.
  - **Recomendación:** actualizar el ADR-0007.

### D-24 (nuevo) — El código de error del permiso por campo es `FIELD_RESERVED_FOR_ENCARGADO`; el ADR-0007 y el TECH-DESIGNv2 siguen prometiendo `campo_reservado_encargado`

- **Severidad:** Advertencia
- **Tipo:** Decisión de arquitectura violada (desvío aprobado, no registrado en el ADR).
- **Prometido:** *"la operación responde 403 con código `campo_reservado_encargado`"*
  (`docs/adrs/0007-sesion-cookie-rbac-propio.md:50-53`); el TECH-DESIGNv2 lo repite en el modelo
  (`docs/TECH-DESIGNv2.md:129-131`), en el criterio de aceptación A7 (`:259-261`) y en la tabla de
  cambios (`:435`), y `docs/BACKLOG.md:40` también.
- **Real:** `fieldReservedForEncargado()` devuelve `'FIELD_RESERVED_FOR_ENCARGADO'`
  (`apps/api/src/lib/errors.ts:208-214`), y la spec vigente lo usa
  (`openspec/specs/product-management/spec.md:21`). El comentario de `apps/api/src/lib/errors.ts:205-207`
  lo declara *"Owner-approved deviation"*, registrada en la propuesta del ciclo, y cita
  `docs/TECH-DESIGNv2.md:235`, una línea que hoy no contiene ese texto.
- **Por qué importa:** es un código de contrato. Un consumidor que se guíe por el ADR (la integración
  fiscal de etapa 2 es el consumidor externo que el ADR-0004 anticipa) compararía contra un código que
  la API nunca devuelve. `CLAUDE.md` advierte que renombrar códigos después es un cambio de spec.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no recomendable: revertiría una decisión aprobada y rompería la SPA y el
    contrato.
  - `ACTUALIZAR PRD/ADR` — registrar el código real en el ADR-0007 y en el TECH-DESIGNv2 (las cuatro
    menciones), con la razón (convención de códigos en inglés UPPER_SNAKE), y corregir la cita del
    comentario de `errors.ts`.
  - **Recomendación:** actualizar los documentos.

### D-25 (nuevo) — Ningún punto del sistema avisa que un producto sin `stock_minimo` no va a generar alertas

- **Severidad:** Sugerencia
- **Tipo:** Regla omitida.
- **Prometido:** *"Un producto sin `stock_minimo` definido se guarda, y el sistema indica que **no**
  generará alertas de stock bajo hasta definirlo (no lanza falsos disparos)"*
  (`docs/TECH-DESIGNv2.md:275-276`), en respuesta al caso borde *"Datos incompletos"* del PRD
  (`docs/PRD.md:185`).
- **Real:** la mitad de "se guarda y no lanza falsos disparos" se cumple
  (`openspec/specs/product-management/spec.md:158-161`). La mitad de "el sistema indica" no aparece en
  ningún lado: el formulario muestra el campo sin ninguna leyenda, salvo el candado de depósito
  (`apps/web/src/features/productos/ProductoForm.tsx:107-120`), y la tabla no muestra ningún chip
  cuando el mínimo es nulo (`apps/web/src/features/productos/ProductosTable.tsx:62-67`, ratificado en
  `openspec/specs/productos-ui/spec.md:31-33`). Tampoco la API devuelve ningún aviso.
- **Por qué importa:** un producto sin mínimo queda fuera de las alertas sin que nadie lo note, que es
  justo el riesgo que el TECH-DESIGNv2 deja abierto (*"validar con la operación si conviene forzar un
  mínimo al alta"*, `docs/TECH-DESIGNv2.md:388-389`).
- **Opciones:**
  - `CORREGIR CÓDIGO` — una leyenda en el formulario y/o un indicador en la tabla cuando
    `stock_minimo` es nulo.
  - `ACTUALIZAR PRD/ADR` — quitar "el sistema indica" del criterio si la ausencia de chip se considera
    aviso suficiente.
  - **Recomendación:** corregir el código; es una leyenda.

### D-26 (nuevo, 2026-10-05) — `proveedores.contacto` se audita en claro

- **Severidad:** Sugerencia
- **Tipo:** Regla omitida.
- **Prometido:** el PRD decide que el rastro de auditoría *"no conserva datos personales"*
  (`docs/PRD.md:202-204`), y nombra como seudonimizados solo el correo y el nombre
  (`docs/PRD.md:204-206`).
- **Real:**
  - Para `proveedores`, `contacto` está entre los `auditableFields` y `pseudonymizedFields` está
    vacío (`apps/api/src/auditoria/fields.ts:79`, `:85`). La columna es texto libre
    (`apps/api/src/db/schema.ts:55`).
  - El alta escribe la fila entera como estado posterior
    (`apps/api/src/proveedores/service.ts:101-108`), y una edición guarda el valor anterior y el
    nuevo de cada campo cambiado (`apps/api/src/proveedores/service.ts:132-139`).
  - `contacto` puede contener el nombre o el teléfono de una persona; se señala, sin afirmar que lo
    contenga.
- **Origen:** D-22 lo señalaba de paso como un caso parecido y menos claro. El propietario decidió
  el 2026-10-04 dejarlo fuera del alcance del ciclo que cerró D-22 y registrarlo aquí como hallazgo
  propio.
- **Por qué importa:** si un proveedor es una persona física, o si el contacto nombra a una persona,
  el rastro permanente conserva ese dato aunque se limpie en `proveedores`.
- **Opciones:**
  - `CORREGIR CÓDIGO` — agregar `contacto` a `pseudonymizedFields` de `proveedores`, con su propia
    etiqueta de dominio en `PSEUDONYM_DOMAIN_TAGS` (las filas ya escritas seguirían en claro).
  - `ACTUALIZAR PRD/ADR` — acotar la decisión del PRD a los datos de `usuarios` y aceptar por
    escrito que `contacto` es un dato de negocio que el rastro conserva.
  - **Recomendación:** decisión del propietario (gobierno del dato).

## Deuda técnica detectada

- **`apps/api/src/productos/service.ts:231`, `apps/api/src/proveedores/service.ts:124,161`,
  `apps/api/src/usuarios/service.ts:207,248`** — re-verificado: el doble casteo
  `previo as unknown as Record<string, unknown>` sigue en los mismos tres dominios y líneas. Lo que
  se audita (el diff de `changedFields`) depende de una forma que el compilador ya no comprueba.
- **Comentarios de código que contradicen el código en decisiones documentadas** — no es una
  promesa rota, pero vuelven a sembrar el drift de los documentos:
  `apps/api/src/auth/service.ts:36-40` (bloqueo "antes" de la contraseña; ver D-17),
  `apps/api/src/app.ts:136-137` (rate-limit "solo" en login; ver D-23), `render.yaml:14-15`
  (`NODE_ENV` controla `Secure`; ver D-03), `apps/api/src/lib/errors.ts:205-207` (cita
  `TECH-DESIGNv2.md:235`; ver D-24), y `apps/api/src/auditoria/service.ts:21` (*"Entries today:
  'usuarios', 'proveedores', 'productos'"*, aunque `fields.ts:114` ya tiene `alertas`).
- **`openspec/changes/archive/2026-08-24-fundaciones-monorepo/tasks.md:77-79,82`** y
  **`docs/adrs/0010-despliegue-tiers-gratuitos.md:79-81`** — ver D-09.
- No hay `TODO`/`FIXME`/`HACK` en `apps/api/src`, `apps/api/scripts` ni `apps/web/src`.

## Features no documentadas (drift inverso)

Además de los hallazgos D-20 (rutas de acción fuera de la enumeración del ADR-0004), D-21 (clave de
seudonimización) y D-23 (rate-limit por sesión):

- **`ACCOUNT_INACTIVE` (401) en el login** (`apps/api/src/lib/errors.ts:96`, lanzado en
  `apps/api/src/auth/service.ts:109-111`) — sin cambios; ningún ADR lo menciona.
- **`Cache-Control: no-store`** en las respuestas con contraseña temporal
  (`apps/api/src/routes/usuarios.ts:202`, `:239`) — sin cambios.
- **`proveedores.creado_en`** expuesta en el DTO (`apps/api/src/routes/proveedores.ts:23`, `:68`),
  no listada en la entidad Proveedor (`docs/TECH-DESIGNv2.md:103`) — sin cambios.
- **Bloqueo de acciones sobre la propia cuenta en la SPA** — declarado como afordancia de UI en
  `openspec/specs/usuarios-ui/spec.md:102-103`; sin cambios.

Verificado explícitamente, y **no es drift**:

- **`GET /api/auditoria`** — lo respalda el ADR-0012 (*"una tabla pensada para que el encargado la
  lea"*, `:50-53`) y el ítem 15 de `docs/BACKLOG.md:50`; restringirlo a `encargado` es coherente con
  la matriz del PRD. Lo que devuelve es materia de D-22, no la ruta en sí.
- **`rescatar:encargado`** — documentado en el addendum del ADR-0007 (`:156-178`); se verificó que lo
  que el addendum afirma coincide con el código (simulación sin `--confirmar`, rechazos sin escritura,
  `origen: 'rescate'`, sesiones cerradas en `apps/api/src/usuarios/service.ts:303`).
- **Harness `claims-gate`** (`harnesses/claims-gate/`) — es tooling del proceso de desarrollo, fuera
  del alcance del PRD/ADR, documentado en `CLAUDE.md` y en su propio README; sin commits desde el
  2026-09-05, después de los cuales la pasada del 2026-09-09 ya lo verificó.

## Alcance planificado (no es drift)

- **Recuperación de contraseña por email (#3.5)** — sigue bloqueada por infraestructura
  (`docs/BACKLOG.md:37`), y el PRD no la promete en su Alcance; el ADR-0007 la deja fuera de v1
  (`:61-62`).

## Próximos pasos

Priorizados por consecuencia, no por esfuerzo:

1. **D-22 — RESUELTO el 2026-10-05** por el ciclo `nombre-seudonimizado`: las instantáneas nuevas
   seudonimizan el nombre; las filas escritas antes lo conservan en claro por decisión del
   propietario. El caso de `proveedores.contacto` sigue abierto como D-26 (punto 9).
2. **D-18 (Advertencia) — corregir el código.** Normalizar el correo en `seed-encargado.ts`; el fallo
   deja un primer encargado que no puede entrar y que ni el seed ni el rescate reparan.
3. **D-24, D-17 (Advertencia) — actualizar ADR-0007 y TECH-DESIGNv2.** Las dos son desvíos ya
   aprobados que el ADR contradice; D-17 ya se propagó una vez a un documento nuevo.
4. **D-19 (Advertencia) — decisión de arquitectura.** Agregar las columnas fiscales o reescribir la
   promesa del ADR-0003/TECH-DESIGNv2.
5. **D-09 (Advertencia) — una verificación manual.** Ejecutar 5.9 y registrar el resultado en el
   ADR-0010.
6. **D-16 (Sugerencia) — decisión del propietario.** Cerrar el condicional del bloqueo por IP en el
   ADR-0007.
7. **D-03, D-15, D-20, D-21, D-23 (Sugerencia) — ediciones de documentación.** Cada una es un
   párrafo; D-21 incluye una línea en la fila de rotación de `docs/DEPLOY-PLAN.md`.
8. **D-08, D-25 (Sugerencia) — cambios chicos de UI.** Color de avatar por rol; aviso de producto sin
   mínimo.
9. **D-26 (Sugerencia) — decisión del propietario, gobierno del dato.** Seudonimizar
   `proveedores.contacto` o aceptar por escrito que el rastro lo conserva.

Esta pasada solo modificó `docs/DRIFT.md`: no se tocaron `docs/PRD.md`, los ADRs, el TECH-DESIGNv2 ni
el código.
