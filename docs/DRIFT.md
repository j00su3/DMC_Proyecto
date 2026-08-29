# Drift Report: InvenTienda

**Fecha:** 2026-08-29
**Comparado contra:** `docs/PRD.md`, `docs/TECH-DESIGNv2.md` (documento vigente; `docs/TECH-DESIGN.md`
v1 está superseded y **no** se usó como fuente de promesas), `docs/REVISION-ADVERSARIAL.md`
(Rondas 1 y 2) + los 12 ADRs de `docs/adrs/`.

**Alcance de la auditoría:** los **siete ítems archivados** del backlog — #1 (fundaciones), #2
(auth y sesiones), #2.1 (app shell + login), #2.2 (auditoría general), #3 (gestión de usuarios),
#3.1 (pantalla de usuarios) y #4 (proveedores backend). El trabajo abiertamente pendiente
(#4.1, #5–#14 y #3.5, bloqueado) **no es drift**: es trabajo planificado. Lo poco que había que
decir sobre él está aislado en la sección [Alcance planificado](#alcance-planificado-no-es-drift).

**Nota metodológica:** el repositorio no tiene índice de CodeGraph (`.codegraph/` ausente) y esta
pasada es de solo análisis, así que no se inicializó uno; la exploración se hizo con herramientas
de sistema de archivos. Se ejecutaron las suites unitarias para verificar afirmaciones numéricas
del backlog (217 API + 157 web, ambas en verde). Las suites de integración requieren el contenedor
de Postgres y no se ejecutaron.

## Resumen ejecutivo

Se extrajeron 63 afirmaciones verificables de los documentos de promesa (matriz de permisos,
criterios de aceptación por flujo, decisiones y consecuencias de los 12 ADRs, convenciones de
contrato y modelo de datos) y se contrastaron contra el código de `apps/api` y `apps/web`. **51
coinciden**: el sobre de error, la paginación, el RBAC por endpoint con default-deny, la cookie
`httpOnly`+`SameSite=Lax`+`Secure` en producción, argon2id, el lockout de 5 intentos/5 minutos, el
bootstrap fuera de la API, las claves UUID del ADR-0011, la frontera `auditoria`/`movimientos` del
ADR-0012 (incluida la firma sin cantidades y la denylist de `hashContrasena`), la baja lógica de
usuarios y proveedores, la guarda del último encargado activo con bloqueo de conjunto, el pipeline
code-first Zod → OpenAPI → tipos, y la separación entre guardas de UI y la frontera real del 403
están implementados tal como se decidieron. **La implementación no contradice ninguna decisión de
arquitectura.**

El drift real es de otro tipo y se concentra en dos lugares: **una promesa operativa que nadie
implementó ni programó** (leer el rastro de auditoría; rescatar al último encargado) y **un bloque
de documentación que quedó congelado en el mundo anterior al ADR-0010** (despliegue local sin
HTTPS, backup en disco propio, condición de revisión ya resuelta). Hay 12 hallazgos, y en 9 de
ellos la resolución honesta es corregir el documento, no el código.

| Severidad | Cantidad |
|---|---|
| Crítico | 2 |
| Advertencia | 6 |
| Sugerencia | 4 |

## Hallazgos

### D-01 — El rastro de auditoría es de solo escritura: nadie puede leerlo desde la aplicación

- **Severidad:** Crítico
- **Tipo:** Feature fantasma
- **Prometido:** el ADR-0012 justifica la lista de exclusión de campos sensibles precisamente por
  quién va a consultar la tabla: *"Un snapshot ingenuo de la fila de `usuarios` copiaría el hash de
  contraseña a **una tabla pensada para que el encargado la lea**"*
  (`docs/adrs/0012-frontera-auditoria-y-ledger.md:50-53`). La tabla de la Decisión registra la
  frecuencia de consulta esperada — *"Baja, ante una sospecha"* (`:39`) — es decir, una consulta que
  ocurre. Y el propio backlog fija la razón de ser del ítem #2.2, ya archivado: *"Da el no-repudio
  que exige el flujo de contraseña temporal de #3"* (`docs/BACKLOG.md:30`).
- **Real:** el puerto de auditoría expone **un solo método, de escritura**:
  `apps/api/src/auditoria/repository.ts:13-15` declara `AuditoriaRepo` con `record(event)` y nada
  más. No existe ningún endpoint que consulte `auditoria`: los cuatro plugins de rutas registrados
  son `health`, `auth`, `usuarios` y `proveedores` (`apps/api/src/app.ts:102-108`), y las 14 rutas
  del contrato generado (`apps/api/openapi.json`) no incluyen ninguna de auditoría. Tampoco hay
  pantalla en la SPA ni ítem de backlog que lo agregue: el #12 (Reportes) cubre stock, bajo mínimo,
  movimientos por período y discrepancias — todo eso sale del ledger de `movimientos`, no de
  `auditoria` (`docs/BACKLOG.md:43`).
- **Por qué importa:** el no-repudio no es una propiedad de que la fila exista, sino de que alguien
  pueda exhibirla. Hoy, ante la sospecha que el ADR-0012 anticipa, la única vía es abrir una consola
  SQL contra Neon. El ítem #2.2 está archivado, así que esta brecha **no tiene dueño ni fecha**:
  ningún ciclo futuro la va a levantar por sí solo. Además, todo el costo de diseño de la denylist,
  del `CHECK` de `datos_previos` y de los dos índices de consulta
  (`apps/api/src/db/schema.ts:123-137`) se pagó para una lectura que no ocurre.
- **Opciones:**
  - `CORREGIR CÓDIGO` — agregar el lado de lectura: `AuditoriaRepo.list(filtros)` más
    `GET /api/auditoria` con `roles: ['encargado']`, paginado con el sobre estándar, filtrable por
    `entidad`+`entidad_id` y por `usuario_id` (los dos índices que ya existen dicen exactamente qué
    consultas se anticiparon). La pantalla puede diferirse; el endpoint es lo que vuelve auditable
    el sistema.
  - `ACTUALIZAR PRD/ADR` — declarar en el ADR-0012 que en v1 la consulta del rastro es
    **administrativa y fuera de la aplicación** (SQL directo contra la base), y corregir la
    justificación de la regla 4 para que no se apoye en un lector dentro del producto. Es defendible
    en un proyecto de un solo local operado por su propio desarrollador, pero hay que decirlo: hoy
    el documento afirma lo contrario.
  - **Recomendación:** corregir el código. El PRD pone la auditabilidad en sus criterios de éxito
    (`docs/PRD.md:158-159`) y el ADR-0012 gastó su decisión más cara — no fusionar auditoría con
    ledger — en nombre de un lector. Degradar el documento sería barato, pero deja al ítem #2.2
    archivado sin entregar aquello por lo que existió.

### D-02 — No existe el procedimiento de rescate del último encargado que el ADR-0007 dice documentar

- **Severidad:** Crítico
- **Tipo:** Regla omitida
- **Prometido:** *"El reset de contraseña vía flujo propio (email) queda fuera de v1; como vía de
  rescate si el único encargado pierde su contraseña, **se documenta un procedimiento administrativo
  manual (resetear el hash directo en base) fuera de la aplicación**"*
  (`docs/adrs/0007-sesion-cookie-rbac-propio.md:56-58`). La Ronda 1 lo registra como parte de la
  resolución de A6: *"y un procedimiento administrativo manual como vía de rescate si el único
  encargado pierde su contraseña"* (`docs/REVISION-ADVERSARIAL.md:489-491`).
- **Real:** el procedimiento no existe en ningún archivo del repositorio (`docs/`, `openspec/`,
  raíz). Y las tres vías que podrían suplirlo están cerradas por construcción: el script de
  bootstrap **rehúsa actuar** si ya existe un encargado —
  `apps/api/scripts/seed-encargado.ts:69-78` retorna `{ created: false }` cuando la consulta por
  `rol = 'encargado'` devuelve una fila —; el reset administrativo por API exige una sesión de
  encargado autenticada (`apps/api/src/routes/usuarios.ts:193-197`,
  `config: { roles: ['encargado'] }`); y el reset por correo del ítem #3.5 está **bloqueado por
  infraestructura sin fecha** (`docs/BACKLOG.md:33`).
- **Por qué importa:** el sistema está desplegado y en uso con un único encargado sembrado
  (`docs/BACKLOG.md:53-56`). Si esa contraseña se pierde, no hay ninguna vía documentada de volver a
  entrar, y la que el ADR promete —editar el hash en la base— exige, para ser ejecutable sin riesgo,
  saber que la columna es `usuarios.hash_contrasena`, que el hash es argon2id con
  `memoryCost=19456, timeCost=2, parallelism=1`, que hay que poner `debe_cambiar_password = true` y
  que conviene limpiar `intentos_fallidos`/`bloqueado_hasta`. Nada de eso está escrito en un solo
  lugar. Es la única promesa de este set cuyo incumplimiento puede dejar el sistema inaccesible.
- **Opciones:**
  - `CORREGIR CÓDIGO` — escribir el runbook que el ADR promete (un archivo en `docs/`, o una
    sección en el propio ADR-0007), o darle al script de seed un modo explícito de rescate
    (`--rescue`, que sí actúe con un encargado existente, exigiendo confirmación) para que el
    procedimiento sea ejecutable y testeable en vez de una nota en prosa.
  - `ACTUALIZAR PRD/ADR` — quitar la promesa del ADR-0007 y de la resolución de A6, y asumir
    explícitamente el riesgo "si el único encargado pierde la contraseña, se restaura desde un
    backup o se recrea la base".
  - **Recomendación:** corregir el código (escribir el procedimiento). Retirar la promesa deja
    abierto un modo de falla sin salida en un sistema ya desplegado, y el costo de escribirlo es de
    una página. La opción del `--rescue` es preferible al runbook en prosa: convierte el rescate en
    algo que un test puede ejercitar.

### D-03 — El TECH-DESIGNv2 y el ADR-0007 siguen describiendo un despliegue local sin HTTPS

- **Severidad:** Advertencia
- **Tipo:** Documentación que describe el sistema de forma inexacta
- **Prometido / afirmado:** el registro de riesgos del documento vigente todavía dice *"**Despliegue
  local sin HTTPS:** mientras el sistema corra solo en la máquina del desarrollador ([ADR-0009]),
  la integridad de los datos depende de un backup manual/programado fuera del disco principal, y la
  cookie de sesión no tiene `Secure`"* (`docs/TECH-DESIGNv2.md:380-382`). El modelo de datos remite
  al mismo ADR reemplazado: *"`Secure` queda condicionado al despliegue, ver ADR-0009"*
  (`docs/TECH-DESIGNv2.md:96-97`), igual que la Decisión del ADR-0007
  (`docs/adrs/0007-sesion-cookie-rbac-propio.md:29-31`). Y el riesgo A11 cierra con *"El riesgo queda
  abierto hasta que ese hito llegue y la decisión se tome"* (`docs/TECH-DESIGNv2.md:390`).
- **Real:** el despliegue local fue reemplazado el 2026-08-24 (`docs/adrs/0010-despliegue-tiers-gratuitos.md:5`)
  y el código ya lo refleja: `apps/api/src/auth/session.ts:23` emite
  `secure: process.env.NODE_ENV === 'production'`, y `render.yaml:18-19` fija
  `NODE_ENV: production` en el servicio desplegado. El origen único que evita CORS está commiteado
  con la URL real de Render, no con el placeholder (`vercel.json:8`). El "hito de producto" del A11
  ya fue resuelto por el propio ADR-0010, que lo declara en su Contexto (`:9-13`).
- **Por qué importa:** el mismo documento afirma dos cosas incompatibles — su sección de
  Arquitectura describe Vercel+Render+Neon con `Secure` habilitado (`docs/TECH-DESIGNv2.md:59-65`) y
  su sección de Riesgos describe `localhost` sin HTTPS. Un lector que empiece por Riesgos concluye
  que la cookie viaja sin `Secure`, que es exactamente el tipo de conclusión falsa que ya hizo que
  este proyecto casi construyera un ciclo entero contra el documento equivocado.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no aplica: el código está del lado correcto de esta discrepancia.
  - `ACTUALIZAR PRD/ADR` — reescribir el riesgo "Despliegue local sin HTTPS" como cerrado por el
    ADR-0010, redirigir los dos punteros de `Secure` del ADR-0009 al ADR-0010, y marcar el riesgo
    A11 como resuelto con la fecha del ADR-0010.
  - **Recomendación:** actualizar el documento. Es el caso puro de documentación rancia: la decisión
    cambió, se registró en un ADR nuevo, y los punteros del documento anterior no se siguieron
    hasta el final.

### D-04 — La decisión de backup quedó huérfana al reemplazar el ADR-0009, y el backlog #14 la describe sobre un disco que ya no aloja los datos

- **Severidad:** Advertencia
- **Tipo:** Regla omitida
- **Prometido:** la Ronda 1 elevó la ausencia de decisión de backup a *"el hueco más grande de
  cobertura del set de ADRs"* (`docs/REVISION-ADVERSARIAL.md:457`), y la resolución fue concreta:
  *"backup programado (`pg_dump`) a una ubicación **distinta del disco principal**"*
  (`docs/REVISION-ADVERSARIAL.md:462-465`), formalizada en
  `docs/adrs/0009-despliegue-local.md:31-34`.
- **Real:** el ADR-0009 está **Reemplazado** (`:5-8`), y el ADR-0010, que lo sustituye, **no menciona
  backup en ninguna línea** de sus Consecuencias (`docs/adrs/0010-despliegue-tiers-gratuitos.md:52-77`);
  su único trade-off de datos es el autosuspend de Neon. La base ya no vive en un disco del
  desarrollador sino en un servicio gestionado cuya cadena de conexión se inyecta con `sync: false`
  (`render.yaml:20-21`). Pese a eso, el backlog #14 sigue describiendo el mundo anterior: *"script de
  backup `pg_dump` programado (Task Scheduler) hacia ubicación fuera del disco principal"*
  (`docs/BACKLOG.md:45`).
- **Por qué importa:** la mitigación que cerró el mayor hueco del set de ADRs desapareció junto con
  el ADR que la contenía, sin que ninguna decisión la reemplazara. Nadie decidió que el tier
  gratuito de Neon fuera respaldo suficiente; simplemente el tema dejó de estar escrito. Y el único
  ítem que todavía lo nombra (#14) apunta a un Task Scheduler sobre un disco que ya no es la fuente
  de verdad, así que ejecutarlo tal como está redactado no respaldaría nada.
- **Opciones:**
  - `CORREGIR CÓDIGO` — decidir y registrar el respaldo del entorno actual: retención del tier
    gratuito de Neon, y/o un `pg_dump` programado contra el `DATABASE_URL` de Neon hacia una
    ubicación fuera del proveedor. Reescribir el ítem #14 en esos términos.
  - `ACTUALIZAR PRD/ADR` — agregar al ADR-0010 una consecuencia explícita que asuma el riesgo:
    "en v1 el respaldo es el que ofrezca el tier gratuito de Neon, sin copia propia", y actualizar
    el #14 para que no prometa un script que ya no aplica.
  - **Recomendación:** cualquiera de las dos, pero **decidida y escrita**. Lo que no puede quedar es
    el estado actual, donde la decisión no está tomada y el backlog describe una que ya no
    corresponde. Dado que hay datos reales en juego, la primera opción es la prudente.

### D-05 — El modelo de datos del TECH-DESIGNv2 omite tres columnas y una tabla completa que ya están en producción

- **Severidad:** Advertencia
- **Tipo:** Documentación que describe el sistema de forma inexacta
- **Prometido / afirmado:** el modelo de datos vigente describe **Usuario** como *"`id`, `nombre`,
  `email/usuario`, `hash_contraseña`, `rol` (`encargado` | `deposito`), `activo`, `creado_en`"*
  (`docs/TECH-DESIGNv2.md:92-94`) y enumera las entidades principales del sistema; la tabla
  `auditoria` solo aparece nombrada de pasada dentro de la descripción de **Movimiento**
  (`docs/TECH-DESIGNv2.md:130-133`), sin columnas.
- **Real:** `apps/api/src/db/schema.ts:29-39` agrega a `usuarios` tres columnas que el modelo no
  menciona — `intentos_fallidos`, `bloqueado_hasta` (el lockout del ADR-0007) y
  `debe_cambiar_password` (el flujo de contraseña temporal del ítem #3) — y `:88-138` define una
  tabla `auditoria` completa con dos `pgEnum` propios (`accion_auditoria` con cinco valores,
  `entidad_auditoria` con tres), dos columnas `jsonb`, dos índices y un `CHECK`
  (`auditoria_datos_previos_solo_en_crear`). Sus columnas están especificadas únicamente en
  `openspec/specs/record-audit-trail/` y en el ADR-0012, que fija la frontera pero no el esquema.
- **Por qué importa:** el TECH-DESIGN es el documento al que se recurre para diseñar el ciclo
  siguiente — el propio ciclo de proveedores lo cita línea por línea para derivar su tabla. Un
  modelo de datos que omite una tabla entera y tres columnas de la entidad más consultada obliga a
  cada ciclo nuevo a redescubrirlas leyendo `schema.ts`, y es la vía más directa a un diseño que
  duplique algo que ya existe.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no aplica: las tres columnas y la tabla responden a decisiones ratificadas
    (ADR-0007 para el lockout, backlog #3 para la contraseña temporal, ADR-0012 para la auditoría).
  - `ACTUALIZAR PRD/ADR` — completar la entidad **Usuario** del TECH-DESIGNv2 con las tres columnas
    y agregar **Auditoría** como entidad propia del modelo de datos, con sus columnas y su `CHECK`,
    remitiendo al ADR-0012 para la frontera con el ledger.
  - **Recomendación:** actualizar el documento. Es el único lado que puede moverse.

### D-06 — La unicidad case-insensitive del nombre de proveedor es una regla de negocio que ningún documento de producto enuncia

- **Severidad:** Advertencia
- **Tipo:** Feature no documentada (drift inverso)
- **Prometido / afirmado:** el TECH-DESIGNv2 describe **Proveedor** como *"`id`, `nombre`,
  `contacto`, `activo`"* y solo resuelve el caso borde de la baja lógica
  (`docs/TECH-DESIGNv2.md:98-100`). El criterio de aceptación del flujo de proveedores exige alta,
  edición, 403 a depósito y baja lógica — nada sobre unicidad (`docs/TECH-DESIGNv2.md:350-355`). En
  el PRD, la única unicidad enunciada es la del SKU de producto (`docs/PRD.md:178`); la sección de
  proveedores (`docs/PRD.md:109`) no menciona ninguna.
- **Real:** existe una regla de unicidad **case-insensitive** impuesta en la base:
  `apps/api/src/db/schema.ts:62-64` crea el índice funcional
  `proveedores_nombre_lower_unique` sobre `lower(nombre)`, y el 23505 que dispara se traduce a un
  error de negocio con código propio en `apps/api/src/lib/errors.ts:167-173`
  (`SUPPLIER_NAME_IN_USE`, 409). El comportamiento está ratificado en
  `openspec/specs/supplier-management/spec.md:66-77`, pero esa promoción de capacidad no subió al
  TDD ni al PRD.
- **Por qué importa:** es una regla que el usuario ve — un encargado que carga "Distribuidora Norte"
  dos veces con distinta capitalización recibe un 409 — y que restringe el dominio (dos sucursales
  del mismo proveedor no pueden llamarse igual). Una regla de negocio visible que solo vive en el
  esquema y en una spec técnica es la clase de cosa que el ciclo de productos (#5) va a replicar o
  contradecir sin saber que fue una decisión.
- **Opciones:**
  - `CORREGIR CÓDIGO` — si el producto quiere permitir nombres repetidos (razonable si "Norte" y
    "norte" pueden ser dos entradas distintas del mismo proveedor), eliminar el índice y el código
    de error.
  - `ACTUALIZAR PRD/ADR` — subir la regla al TECH-DESIGNv2 junto a la entidad Proveedor, con la
    misma forma con que ahí se enuncia la del SKU de producto (*"`sku/codigo` (único → cubre
    'producto duplicado')"*), y agregar el criterio de aceptación correspondiente.
  - **Recomendación:** actualizar el documento. La regla es correcta y ya está ratificada,
    testeada y desplegada; lo que falta es que aparezca donde el próximo ciclo la va a buscar.

### D-07 — El ciclo archivado del ítem #4 fundamentó sus decisiones citando el TECH-DESIGN v1, que está superseded y no lo declara en su encabezado

- **Severidad:** Advertencia
- **Tipo:** Documentación que describe el sistema de forma inexacta
- **Prometido / afirmado:** *"**Versión:** 2 — 2026-08-13. Supersede a `TECH-DESIGN.md` (v1)"*
  (`docs/TECH-DESIGNv2.md:3`), y la regla operativa del repositorio: *"If you find yourself citing
  v1, stop and re-read from v2; a whole planning cycle was nearly built against the stale document"*
  (`CLAUDE.md:44-46`).
- **Real:** los artefactos del ciclo archivado de proveedores citan v1 por archivo y línea, no v2:
  `openspec/changes/archive/2026-08-29-gestion-proveedores/proposal.md:6` (*"the entity exists only
  in `docs/TECH-DESIGN.md:69-71`"*), `:126`, `:133`;
  `.../exploration.md:73`, `:79`, `:141`; y `.../design.md:60`, `:167`. La causa está a la vista:
  `docs/TECH-DESIGN.md:1-6` **no lleva ningún encabezado que lo declare reemplazado** — su primera
  línea es un título idéntico en forma al de v2 y su bloque de metadatos ("Tipo de proyecto",
  "Design.md disponible") es el mismo, así que abierto por su cuenta el archivo se lee como vigente.
- **Por qué importa:** en este caso concreto no hubo consecuencia funcional — el texto de v1 sobre
  proveedores (`docs/TECH-DESIGN.md:68-70`) es literalmente idéntico al de v2
  (`docs/TECH-DESIGNv2.md:98-100`), así que el ciclo llegó a la decisión correcta por un camino
  equivocado. Pero eso es suerte del área elegida: las secciones que **sí** cambiaron entre v1 y v2
  son justamente las de los próximos ítems (C2 en alta/edición de producto, A7 en `stock_minimo`,
  A8 en anulación, A9/A10 en alertas). El mismo hábito de citación aplicado al ciclo #5 produce el
  error que `CLAUDE.md` dice que casi ocurrió.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no aplica.
  - `ACTUALIZAR PRD/ADR` — poner en `docs/TECH-DESIGN.md:1` un encabezado inequívoco
    ("**SUPERSEDED por `TECH-DESIGNv2.md`** — se conserva como referencia histórica; no citar"),
    espejando lo que ya hace el ADR-0009 en su sección Estado, y reanclar a v2 las citas de los
    artefactos archivados del #4.
  - **Recomendación:** actualizar el documento, y priorizar el encabezado por sobre el reanclado de
    citas. El banner es lo que impide la repetición; corregir las citas archivadas es higiene.

### D-08 — El avatar del shell usa el mismo color para ambos roles; la especificación de diseño pide azul para encargado y verde para depósito

- **Severidad:** Sugerencia
- **Tipo:** Feature fantasma (implementada de forma materialmente distinta)
- **Prometido:** *"tarjeta de usuario con avatar circular 30px (iniciales; **azul encargado, verde
  depósito**)"* (`docs/design.md:44`). El TECH-DESIGNv2 lo repite al describir la entidad Usuario:
  *"(El Design.md muestra avatar con iniciales y color por rol: azul encargado, verde depósito.)"*
  (`docs/TECH-DESIGNv2.md:94`).
- **Real:** `apps/web/src/components/ui/AppShell.module.css:73-77` fija
  `background: var(--color-accent)` en `.avatar`, sin variante por rol, y
  `apps/web/src/components/ui/AppShell.tsx:83-85` renderiza el avatar con esa única clase — el
  `rol` del usuario solo se usa para elegir la etiqueta de texto (`:88`) y para el candado de
  Usuarios (`:77`). Un usuario de depósito ve un avatar azul. La spec promovida
  `openspec/specs/app-layout/spec.md` no menciona el color del avatar, así que la omisión tampoco
  fue una postergación declarada.
- **Por qué importa:** es el único indicador visual de rol que el diseño puso fuera del texto, y su
  propósito es que quien mira la pantalla sepa de un vistazo con qué cuenta está operando — un dato
  relevante en un local donde varias personas comparten un mismo equipo de caja. El costo de
  corregirlo es una regla CSS y un modificador.
- **Opciones:**
  - `CORREGIR CÓDIGO` — agregar una clase modificadora por rol en `AppShell.module.css` usando el
    token de éxito (`#2f9e63`, ya definido en `docs/design.md:26`) para `deposito`, y aplicarla
    desde `AppShell.tsx`.
  - `ACTUALIZAR PRD/ADR` — quitar el color por rol de `docs/design.md:44` y de
    `docs/TECH-DESIGNv2.md:94`, declarando que la línea de rol en texto es suficiente.
  - **Recomendación:** corregir el código. La razón que motivó la regla sigue vigente y el arreglo
    es de dos líneas; degradar el documento cuesta lo mismo y pierde la señal.

### D-09 — El backlog afirma que el ítem #1 dejó la aplicación "verificada punta a punta", pero su propio ciclo archivado deja cuatro tareas sin marcar y el ADR-0010 conserva una línea "Pendiente"

- **Severidad:** Advertencia
- **Tipo:** Documentación que describe el sistema de forma inexacta
- **Prometido / afirmado:** *"el ítem #1 dejó la aplicación **desplegada y verificada punta a punta**
  (SPA en Vercel, API en Render, Postgres en Neon, todo en capa gratuita — ver `ADR-0010`)"*
  (`docs/BACKLOG.md:53-56`).
- **Real:** en el ciclo archivado que produjo ese despliegue, las cuatro tareas manuales siguen sin
  marcar: `openspec/changes/archive/2026-08-24-fundaciones-monorepo/tasks.md:75` (5.4, crear el
  servicio de Render y reemplazar el placeholder), `:76` (5.5, Neon + `DATABASE_URL` + migración),
  `:77` (5.6, proyecto de Vercel) y `:82` (5.9, verificar que el proxy no altera el `Set-Cookie`).
  El ADR-0010 conserva la línea correspondiente: *"**Pendiente:** registrar aquí el resultado del
  smoke test post-deploy (tarea 5.9…)"* (`docs/adrs/0010-despliegue-tiers-gratuitos.md:79-81`). Las
  tres primeras **sí se ejecutaron** en la realidad — `vercel.json:8` lleva la URL real
  `https://inventienda-api.onrender.com`, no el placeholder que el ADR describe (`:34-35`) — pero
  la 5.9 no dejó rastro en ninguna parte.
- **Por qué importa:** el `Set-Cookie` que la 5.9 verificaba es exactamente el punto donde el
  ADR-0010 concentra su riesgo — su propio trade-off dice que un atributo `Domain` agregado por
  descuido *"rompe la cookie de sesión"* (`:68-70`). Que el backlog declare "verificada punta a
  punta" mientras esa verificación específica no está registrada convierte una afirmación
  comprobable en una suposición. Y las tres tareas ejecutadas pero sin marcar hacen que el estado
  del ciclo archivado mienta en la dirección contraria.
- **Opciones:**
  - `CORREGIR CÓDIGO` — ejecutar la verificación 5.9 contra el despliegue vivo (login desde
    `https://dmc-proyecto.vercel.app`, inspeccionar el `Set-Cookie` de la respuesta) y registrar el
    resultado con fecha donde el ADR-0010 lo pide.
  - `ACTUALIZAR PRD/ADR` — marcar 5.4–5.6 como completadas en `tasks.md` con la evidencia
    (`vercel.json:8`), y ajustar la afirmación del backlog a lo que efectivamente se verificó.
  - **Recomendación:** las dos, en ese orden. Es la única de las cuatro tareas que todavía no
    ocurrió, y cuesta un login.

### D-10 — Las rutas de acción (`/deactivate`, `/reactivate`, `/password-reset`) se apartan de la convención REST del ADR-0004 sin que ningún documento registre la excepción

- **Severidad:** Sugerencia
- **Tipo:** Feature no documentada (drift inverso)
- **Prometido:** *"La API es **REST sobre JSON**, organizada por recurso (productos, movimientos,
  ventas, proveedores, alertas, reportes, usuarios), con **verbos HTTP estándar**"*
  (`docs/adrs/0004-rest-json-openapi.md:17-18`).
- **Real:** cinco de las catorce rutas del contrato son sub-recursos de acción invocados con POST:
  `apps/api/src/routes/usuarios.ts:250-279` genera `POST /usuarios/:id/deactivate` y
  `/reactivate` en un bucle, `:193-217` define `POST /usuarios/:id/password-reset`, y
  `apps/api/src/routes/proveedores.ts:190-218` replica el mismo patrón para proveedores. La razón
  está escrita y es buena — *"the path names the transition, so the audit verb is decided by which
  URL was called, not inferred from a diff"* (`apps/api/src/routes/usuarios.ts:247-249`) — pero vive
  en un comentario de código y en los `design.md` de los ciclos archivados, no en el ADR que fija la
  convención.
- **Por qué importa:** el patrón ya se replicó una vez (de usuarios a proveedores) y va a
  replicarse otra vez en cuanto el ítem #5 necesite dar de baja un producto o el #9 anular una
  venta. Una convención que se aplica por imitación y no por decisión escrita es la que termina
  aplicándose de tres formas distintas.
- **Opciones:**
  - `CORREGIR CÓDIGO` — reemplazar las rutas de acción por `PATCH` con `activo` en el cuerpo. No es
    recomendable: destruiría exactamente la propiedad que las motivó (el verbo de auditoría
    determinado por la URL en vez de inferido del diff), y ese razonamiento está corroborado por el
    `.strict()` que rechaza `activo` en el PATCH (`apps/api/src/routes/usuarios.ts:78-87`).
  - `ACTUALIZAR PRD/ADR` — agregar al ADR-0004 la excepción como convención explícita: las
    transiciones de estado que deben quedar auditadas con un verbo propio se exponen como
    `POST /<recurso>/:id/<transicion>`, y el `PATCH` del recurso rechaza esos campos.
  - **Recomendación:** actualizar el ADR. El código tomó la decisión correcta; lo que falta es
    convertirla en convención antes de que el tercer dominio la reinvente.

### D-11 — El backlog justifica el bloqueo del ítem #3.5 citando Firebase Hosting, una infraestructura que el proyecto no usa

- **Severidad:** Sugerencia
- **Tipo:** Documentación que describe el sistema de forma inexacta
- **Prometido / afirmado:** *"enviar a una dirección arbitraria exige un dominio cuyo DNS pueda
  llevar SPF/DKIM, y hoy no hay uno (**el `*.web.app` de Firebase Hosting tiene el DNS de Google**)"*
  (`docs/BACKLOG.md:33`).
- **Real:** el proyecto no usa Firebase Hosting. La SPA se sirve desde Vercel y la API desde Render
  (`docs/adrs/0010-despliegue-tiers-gratuitos.md:17-19`), con el rewrite a
  `https://inventienda-api.onrender.com` commiteado en `vercel.json:5-9`, y el sitio vive en
  `https://dmc-proyecto.vercel.app` (`CLAUDE.md:147`).
- **Por qué importa:** la conclusión del bloqueo sigue siendo correcta —un dominio `*.vercel.app`
  tampoco permite publicar SPF/DKIM propios—, pero la premisa nombra un proveedor ajeno. Un lector
  que quiera desbloquear el #3.5 empieza por verificar una cuenta de Firebase que no existe, y de
  paso queda la duda de si el ítem se escribió antes del ADR-0010 y nadie lo revisó desde entonces.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no aplica.
  - `ACTUALIZAR PRD/ADR` — reescribir la premisa en términos del despliegue real: el dominio
    `*.vercel.app` es de Vercel y su DNS no admite registros propios, de modo que el bloqueo se
    levanta el día que se registre un dominio propio.
  - **Recomendación:** actualizar el documento. Es un error factual de una línea con una conclusión
    que se sostiene.

### D-12 — El backlog se declara fuente de verdad de lo que está "en curso", pero no refleja el ciclo en vuelo del ítem #5

- **Severidad:** Sugerencia
- **Tipo:** Documentación que describe el sistema de forma inexacta
- **Prometido / afirmado:** *"`docs/BACKLOG.md` is the source of truth for what is done, in flight,
  and pending"* (`CLAUDE.md:164`).
- **Real:** el ítem #5 figura como *"⬜ Pendiente"* (`docs/BACKLOG.md:36`), sin distinguirse de los
  ocho ítems que nadie tocó, pero su ciclo SDD ya está abierto con propuesta, diseño y **dos** specs
  delta: `openspec/changes/productos-ledger-base/proposal.md`, `design.md`,
  `specs/product-management/spec.md` y `specs/productos-ui/spec.md`. El backlog tampoco tiene un
  estado que exprese "en curso": su columna Estado solo usa ✅ Archivado y ⬜ Pendiente.
- **Por qué importa:** es menor mientras haya un solo ciclo abierto y una sola persona, pero el
  documento afirma cubrir tres estados y solo modela dos. La aparición de una segunda spec
  (`productos-ui`) dentro del mismo cambio también sugiere que el #5 creció respecto de la letra del
  backlog, que lo describe como backend + chips derivados.
- **Opciones:**
  - `CORREGIR CÓDIGO` — no aplica.
  - `ACTUALIZAR PRD/ADR` — agregar el estado 🔄 En curso al backlog y aplicarlo al #5, con una nota
    de actualización como las que ya lleva el documento (`docs/BACKLOG.md:15-23`, `:58-62`);
    aprovechar para verificar si `productos-ui` corresponde al #5 o merece un derivado propio, como
    se hizo con el #3.1 y el #4.1.
  - **Recomendación:** actualizar el documento, y decidir explícitamente lo de `productos-ui`. Este
    proyecto ya separó dos veces la UI del backend por razones de presupuesto de revisión; que la
    tercera aparezca dentro del mismo cambio sin quedar registrada en el backlog repite el patrón
    que las dos separaciones anteriores existieron para evitar.

## Deuda técnica detectada

- **`apps/api/src/db/schema.ts:96-100` vs `apps/api/src/auditoria/fields.ts:20-41`** — el `pgEnum`
  `entidad_auditoria` acepta `'productos'`, pero `FIELD_CLASSIFICATION` no tiene esa entrada, y el
  tipo real que gobierna qué se puede auditar es `AuditableEntidad = keyof typeof
  FIELD_CLASSIFICATION` (`apps/api/src/auditoria/service.ts:8`). La base promete un valor que la
  aplicación no puede producir. Está documentado en `CLAUDE.md:93-98`, así que no es una trampa
  oculta, pero son dos declaraciones del mismo conjunto que ya divergen y que hay que mantener
  sincronizadas a mano cuando llegue el ítem #5.
- **`openspec/changes/archive/2026-08-24-fundaciones-monorepo/tasks.md:75-82`** — cuatro tareas sin
  marcar dentro de un cambio archivado (ver D-09). Un ciclo archivado con tareas abiertas es un
  estado que el flujo SDD no puede representar y que ningún `sdd-verify` volverá a mirar.
- **`apps/api/src/proveedores/service.ts:124-126` y `:161`, `apps/api/src/usuarios/service.ts:206-209`**
  — el doble casteo `previo as unknown as Record<string, unknown>` para alimentar `changedFields()`
  desactiva el chequeo de tipos justo sobre el valor que termina en el snapshot de auditoría. Es el
  único punto de todo el camino de escritura donde el compilador deja de proteger la carga que
  llega a `datos_previos`/`datos_posteriores`, y el ADR-0012 apoya explícitamente su regla 3 en que
  *"la frontera la impone el compilador, no la revisión de código"*
  (`docs/adrs/0012-frontera-auditoria-y-ledger.md:48-49`). Un `Diff` genérico sobre las claves de la
  entidad devolvería la garantía.

## Features no documentadas (drift inverso)

Además de la unicidad de nombre de proveedor (D-06) y de las rutas de acción (D-10):

- **`proveedores.creado_en`** (`apps/api/src/db/schema.ts:55-57`) — expuesta en el DTO público
  (`apps/api/src/routes/proveedores.ts:23`) y volcada en el snapshot de auditoría
  (`apps/api/src/proveedores/service.ts:107`), pero la entidad **Proveedor** del TECH-DESIGNv2
  enumera solo `id`, `nombre`, `contacto`, `activo` (`docs/TECH-DESIGNv2.md:98`). Vale documentarla:
  es un campo que la futura vista maestro-detalle del #4.1 va a querer para ordenar.
- **`ACCOUNT_INACTIVE` (401) en el login** (`apps/api/src/auth/service.ts:71-73`,
  `apps/api/src/lib/errors.ts:95-97`) — un usuario dado de baja lógicamente no puede iniciar sesión.
  Es la lectura natural de "baja lógica de usuario" del backlog #3, pero ni el PRD ni los criterios
  de RBAC del TECH-DESIGNv2 lo enuncian, y el orden en que se comprueba (**después** de verificar la
  contraseña, para que el código no funcione como oráculo de enumeración de cuentas) es una decisión
  de seguridad deliberada que merece estar escrita fuera del comentario de código.
- **`Cache-Control: no-store` en las dos respuestas que llevan contraseña temporal**
  (`apps/api/src/routes/usuarios.ts:187` y `:214`) — control de seguridad real, sin respaldo en
  ningún documento de `docs/`.
- **Bloqueo de acciones sobre la propia cuenta en la SPA**
  (`apps/web/src/routes/usuariosDetalle.tsx:98`, `:106`, `:114`) — el encargado no puede
  desactivarse, degradarse ni restablecerse la contraseña a sí mismo desde la pantalla, pero el
  servidor sí acepta esas operaciones (no hay guarda equivalente en
  `apps/api/src/usuarios/service.ts`). Está correctamente declarado como afordancia de UI en
  `openspec/specs/usuarios-ui/spec.md:102-117`, así que **no es un hallazgo**; se anota solo porque
  es una restricción visible para el usuario que no aparece en ningún documento de `docs/`.

## Alcance planificado (no es drift)

Se verificó explícitamente que lo siguiente **no** constituye drift, sino trabajo abiertamente
pendiente en `docs/BACKLOG.md`, y por eso no figura entre los hallazgos:

- **Punto de venta, pagos, recibo interno y anulación** (`docs/PRD.md:100-108`, `:160-163`) — ítems
  #7, #8 y #9, pendientes. La ausencia de `ventas`, `items_venta` y `pagos` en `schema.ts` es
  esperada.
- **Productos, movimientos y ledger** (`docs/PRD.md:95-99`) — ítems #5 y #6, pendientes; el #5 está
  en curso (ver D-12).
- **Motor de alertas, `SAVEPOINT` del evaluador, heurística de reposición** (ADR-0008, criterios C1,
  A9, A10, S7) — ítems #10 y #11, pendientes. Ninguna de esas decisiones puede violarse todavía
  porque no hay camino de escritura de stock que las invoque.
- **Reportes y filtrado por dueño (`WHERE usuario_id = :actor`)** (ADR-0007, resolución de A6) —
  ítem #12, pendiente.
- **Permiso por campo `stock_minimo` / `campo_reservado_encargado`** (A7) — parte del ítem #5.
- **Vista maestro-detalle de proveedores** (`docs/design.md:94`) — ítem #4.1, diferido de forma
  explícita y registrada en `docs/BACKLOG.md:34-35`.
- **Recuperación de contraseña por email** — ítem #3.5, bloqueado por infraestructura (aunque la
  redacción del bloqueo tiene un error factual: ver D-11).
- **Verificación periódica stock ↔ Σ(ledger) y backup programado** — ítem #14, pendiente (la parte
  de backup sí tiene un problema propio: ver D-04).

## Próximos pasos

Priorizados por consecuencia, no por esfuerzo:

1. **D-02 (Crítico) — decisión del dueño del producto, hoy.** Escribir el procedimiento de rescate
   del último encargado, o retirar la promesa del ADR-0007 asumiendo el riesgo por escrito. Es el
   único hallazgo que puede dejar el sistema desplegado sin vía de acceso.
2. **D-01 (Crítico) — decisión de producto/arquitectura.** Definir si el rastro de auditoría se lee
   desde la aplicación (endpoint `GET /api/auditoria` para encargado) o si la consulta es
   administrativa por SQL. Si es lo segundo, el ADR-0012 debe decirlo, porque hoy afirma lo
   contrario.
3. **D-04 (Advertencia) — decisión de arquitectura.** Recuperar la decisión de backup que se perdió
   al reemplazar el ADR-0009: registrarla en el ADR-0010 y realinear el ítem #14.
4. **D-03, D-05, D-07 (Advertencias) — pasada de documentación sobre el TECH-DESIGNv2.** Cerrar el
   riesgo de despliegue local, redirigir los punteros del ADR-0009 al 0010, completar el modelo de
   datos con `auditoria` y las tres columnas de `usuarios`, y poner el banner de superseded en
   `docs/TECH-DESIGN.md:1`. Las cuatro cosas son un solo pase sobre dos archivos.
5. **D-06, D-10 (Advertencia/Sugerencia) — ratificación de convenciones.** Subir al TDD la unicidad
   de nombre de proveedor y al ADR-0004 la convención de rutas de transición, **antes** de que el
   ciclo #5 tenga que decidir ambas cosas por imitación.
6. **D-09 (Advertencia) — acción operativa.** Ejecutar la verificación del `Set-Cookie` sobre el
   despliegue vivo y registrarla en el ADR-0010; marcar 5.4–5.6 con su evidencia.
7. **D-08 (Sugerencia) — corrección de código.** Color de avatar por rol; dos líneas.
8. **D-11, D-12 (Sugerencias) — higiene del backlog.** Corregir la premisa del #3.5 y agregar el
   estado "en curso"; de paso, decidir si `productos-ui` es parte del #5 o un derivado propio.

Ningún archivo de `docs/` ni de `openspec/` fue modificado durante esta auditoría, salvo la
creación de este mismo reporte.
