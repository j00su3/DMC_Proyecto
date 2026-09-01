# Security Pass — InvenTienda

Fecha: 2026-09-01
Alcance revisado: pase independiente y fresco. `docs/SECURITY.md` (pase previo del 2026-08-29,
con resoluciones fechadas 2026-08-30) se usó como **un insumo más**, no como verdad de partida —
cada afirmación suya que este informe repite fue reverificada leyendo el código actual, no citada
de memoria.

**Capas inspeccionadas:**

- **Producto / requisitos**: `docs/PRD.md`, `docs/TECH-DESIGNv2.md`, `docs/BACKLOG.md` (estado real
  de cada ítem de seguridad rastreado).
- **Arquitectura / ADRs**: `docs/adrs/0007-sesion-cookie-rbac-propio.md` (incluida su sección
  *Actualizado 2026-08-29*), `docs/adrs/0010-despliegue-tiers-gratuitos.md`,
  `docs/adrs/0011-claves-primarias-uuid.md`, `docs/adrs/0012-frontera-auditoria-y-ledger.md`.
- **Specs**: `openspec/specs/auth-sessions/`, `user-management/`, `recibo-ui/`, `point-of-sale/`,
  `record-audit-trail/`.
- **Código API**: `apps/api/src/auth/`, `apps/api/src/plugins/` (auth, cookie, clientIp, db, repos),
  `apps/api/src/routes/` (auth, usuarios, ventas, movimientos), `apps/api/src/usuarios/service.ts`,
  `apps/api/src/ventas/service.ts`, `apps/api/src/db/uow.ts`, `apps/api/src/db/pool.ts`,
  `apps/api/src/lib/errors.ts`, `apps/api/src/lib/pagination.ts`, `apps/api/src/productos/service.ts`
  (guarda de campo `stockMinimo`).
- **Configuración y despliegue**: `render.yaml`, `vercel.json`, `middleware.ts`,
  `.github/workflows/ci.yml`, `.gitignore`, `apps/api/package.json`.
- **Dependencias**: `pnpm audit --prod` ejecutado en este mismo pase — sin vulnerabilidades
  conocidas.
- **Historial**: `git log` para confirmar qué cambió desde el pase previo (venta con anulación,
  recibo interno — código nuevo que el pase anterior no pudo revisar).

**Lo que NO se revisó, y por qué:**

- **Ningún archivo `.env*`.** Una regla de permisos del repositorio deniega incluso leer
  `.env.example`; se confirmó denegado en este mismo pase. Todo lo dicho sobre configuración de
  entorno viene de `render.yaml`, `vercel.json`, `middleware.ts` y del código que lee `process.env`.
- **El entorno desplegado en vivo** (`https://dmc-proyecto.vercel.app`, el servicio de Render). No
  se hizo ninguna petición contra producción; en particular, **no se pudo verificar si
  `PROXY_SHARED_SECRET` está cargado en Render y Vercel** — ver S12.
- **Neon** (cifrado en reposo, backups, superficie de la consola): fuera del repositorio.
- **El motor de alertas (backlog #10)**: no tiene código todavía (`⬜ Pendiente` en
  `docs/BACKLOG.md`), así que no hay nada que auditar.
- **La totalidad de `apps/web/src`**: revisada de forma dirigida (guards de ruta, manejo del
  código 423) pero no símbolo por símbolo — el pase previo ya cubrió la SPA con más profundidad
  (ausencia de `dangerouslySetInnerHTML`/`eval`, no persistencia de la contraseña temporal) y nada
  en el historial de commits desde entonces toca esa superficie de forma relevante para seguridad.

## Resumen ejecutivo

El backend mantiene una postura de seguridad sólida para el tamaño del proyecto: autorización
server-side por defecto denegada, hash de contraseñas argon2id con parámetros OWASP, manejo de
errores disciplinado (nunca se filtra un stack trace ni un mensaje interno en un 500), sin
`dangerouslySetInnerHTML`/`eval` en toda la SPA, y sin vulnerabilidades conocidas en dependencias
de producción. Los dos hallazgos HIGH que un pase anterior había identificado —la denegación de
servicio contra el único `encargado` (bloqueo evaluado antes que la contraseña) y el
almacenamiento en claro del token de sesión— están **verificados como corregidos en el código
actual**, no solo declarados corregidos en un documento: se leyó `apps/api/src/auth/service.ts` y
`apps/api/src/auth/session.ts` directamente.

Lo que queda abierto es, en su mayoría, lo mismo que el pase anterior había dejado abierto y que
`docs/BACKLOG.md` no agenda: sin cabeceras de seguridad HTTP (`helmet` no está en
`apps/api/package.json`), sin `Cache-Control` en las respuestas autenticadas que no devuelven una
credencial, el atributo `Secure` de la cookie sigue condicionado a una única variable de entorno
sin ningún respaldo, y las rutas que ejecutan argon2 fuera del login siguen sin límite de tasa en
un plan de 512 MB. Ninguno de estos es nuevo; se reconfirmaron leyendo el código, no citando el
informe anterior.

Este pase sí encontró **una brecha nueva**, en código que no existía en el pase previo: `POST
/api/ventas` acepta arreglos `items`/`pagos` sin límite superior, y cada elemento dispara una
lectura y una escritura dentro de **una sola transacción** contra un pool de solo 10 conexiones
(`apps/api/src/db/pool.ts`) — alcanzable por **cualquier** sesión autenticada, incluida la de
`deposito`, sin ningún `rate-limit`. Es el mismo patrón de riesgo que el hallazgo ya conocido sobre
argon2 sin límite (agotamiento de recursos en un plan gratuito), en una superficie distinta.

**11 hallazgos de este pase**: 0 CRITICAL, 0 HIGH, 6 MEDIUM, 4 LOW, 1 INFO.

## Fortalezas de seguridad

Verificadas de forma independiente en el código actual — no tocar al remediar lo demás:

- **Autorización server-side por defecto denegada**, con el orden de registro de plugins
  documentado como la garantía que lo sostiene. `apps/api/src/plugins/auth.ts:39-96` exige sesión y
  rol en todo endpoint que no declare `auth: false`, y `apps/api/src/app.ts:98-100,124-126` deja
  por escrito por qué `authPlugin` debe registrarse antes que cualquier ruta.
- **La denegación de servicio contra el `encargado` está corregida, no solo documentada.**
  `apps/api/src/auth/service.ts:55-87` verifica la contraseña **antes** de evaluar
  `bloqueadoHasta`; una credencial correcta entra aunque la cuenta esté bloqueada y limpia el
  contador. Confirmado leyendo el código, y `docs/BACKLOG.md` ítem 2.3 lo marca `✅ Hecho`.
- **El token de sesión ya no es reutilizable desde una lectura de la base.**
  `apps/api/src/auth/session.ts:31-33` hashea con sha256 antes de almacenar; el texto plano viaja
  solo en la cookie. Confirmado en código, `docs/BACKLOG.md` ítem 2.4 `✅ Hecho`.
- **El bypass del rate-limit vía la URL directa de Render está cerrado con una degradación segura
  por diseño**, no con `trustProxy` a secas. `apps/api/src/plugins/clientIp.ts` solo confía en
  `X-Forwarded-For` cuando la petición trae además `PROXY_SHARED_SECRET` comparado en tiempo
  constante (`timingSafeEqual`); en cualquier otro caso cae al socket. `trustProxy` permanece
  apagado en `apps/api/src/app.ts:103-119` — la elección correcta, porque activarlo a secas
  convertiría una cabecera que el atacante controla en la clave del único freno que queda contra
  la adivinación de contraseñas tras la corrección anterior. Ver también S12: el código está
  correcto, su eficacia en producción depende de una variable de entorno no verificable desde aquí.
- **El manejo de errores no filtra información interna.** `apps/api/src/lib/errors.ts:400-408`
  mapea cualquier excepción no reconocida a `INTERNAL_ERROR` genérico sin stack trace ni mensaje
  original en el cuerpo de la respuesta; solo se loguea server-side (`app.ts:140-142`), y el logger
  está apagado fuera de producción.
- **Autorización por campo, correcta y con guarda temprana.** `stockMinimo` solo puede tocarlo un
  `encargado`: `apps/api/src/productos/service.ts:72,195` rechaza con `FIELD_RESERVED_FOR_ENCARGADO`
  antes de abrir la transacción, en ambos flujos (creación y actualización).
- **Ninguna documentación de API viva.** `apps/api/src/plugins/openapi.ts` genera `openapi.json`
  como un script de build, no registra `@fastify/swagger-ui`: no hay una ruta `/documentation`
  expuesta en el servidor desplegado.
- **Sin vulnerabilidades conocidas en dependencias de producción** (`pnpm audit --prod`, ejecutado
  en este pase).
- **La anulación de venta serializa correctamente contra un doble intento concurrente.**
  `apps/api/src/ventas/service.ts:319-338` usa el propio `UPDATE ... WHERE estado = 'confirmada'`
  como punto de serialización (0 filas ⇒ ya anulada), en vez de un `SELECT FOR UPDATE` seguido de
  un `SET` separado — evita la ventana de carrera clásica sin necesitar un lock explícito.

## Findings

### MEDIUM

---

**ID**: S01
**Title**: El código `423 ACCOUNT_LOCKED` sigue siendo un oráculo de enumeración de usuarios
**Severity**: MEDIUM
**Confidence**: HIGH
**Category**: Exposición de información sensible; contradicción entre spec e implementación
**Affected artifact**: Código (API), spec
**Location**: `apps/api/src/auth/service.ts:41-87`, `apps/api/src/lib/errors.ts:85-89`,
`openspec/specs/auth-sessions/spec.md:40`

**Description**
La corrección de la denegación de servicio (verificar la contraseña antes del bloqueo) no cerró la
vía de enumeración que compartía la misma raíz. Un correo **desconocido** siempre produce
`401 INVALID_CREDENTIALS` (línea 48-53, con verify contra `DUMMY_HASH` para igualar el tiempo). Un
correo **conocido**, con contraseña incorrecta y ya bloqueado, produce `423 ACCOUNT_LOCKED` con
`details.retryAfter` (línea 76-84). La distinción sigue siendo de código de estado, no de
temporización, así que el `DUMMY_HASH` no la cubre.

**Evidence**
- `apps/api/src/auth/service.ts:48-53` — correo desconocido → siempre `invalidCredentials()`.
- `apps/api/src/auth/service.ts:72-84` — correo conocido, password incorrecta, bloqueado →
  `accountLocked(retryAfter)`. Ninguna rama produce 423 para un correo inexistente.
- `apps/api/src/lib/errors.ts:85-89` — el 423 incluye `retryAfter`, que además delata el momento
  exacto del quinto fallo.
- `openspec/specs/auth-sessions/spec.md:40` — exige "the same shape/timing profile as a
  wrong-password response (no user enumeration)"; la vía del bloqueo sigue sin cumplirlo.
- `docs/BACKLOG.md` no tiene ningún ítem que referencie el cierre de esta vía — a diferencia de
  SEC-001/003/008/012, no está agendada.

**Attack scenario**
Cinco intentos con contraseña arbitraria contra cada correo candidato de una lista (empleados,
direcciones del dominio de la tienda). Los que responden 423 en el sexto intento existen; los que
siguen en 401 no. Seis peticiones por candidato, sin necesidad de adivinar ninguna contraseña. La
lista resultante alimenta un ataque de fuerza bruta dirigido y de phishing.

**Potential impact**
Descubrimiento fiable del padrón de correos válidos del sistema. No compromete una cuenta por sí
mismo, pero es el insumo directo de cualquier ataque posterior contra una cuenta real.

**Existing mitigation**
El `DUMMY_HASH` cierra el canal de temporización para la ruta directa; no cubre esta.

**Recommended remediation**
Decisión de spec, porque hoy ratifica tanto el 423 con `retryAfter` como la ausencia de
enumeración, y ambas no pueden sostenerse juntas. La resolución natural: devolver 401 a quien no ha
demostrado conocer la contraseña, y reservar el 423 informativo para cuando la contraseña **sí**
era correcta — el único caso en que el llamador ya sabía que la cuenta existe.

**Suggested verification**
Test que compare, byte a byte, la respuesta a un correo inexistente contra la de un correo
existente sometido al mismo número de intentos fallidos.

**Required change type**: `SPEC CHANGE`

---

**ID**: S02
**Title**: Rutas que ejecutan argon2 fuera del login no tienen límite de tasa
**Severity**: MEDIUM
**Confidence**: MEDIUM
**Category**: Agotamiento de recursos; control ausente en un sistema que lo necesita
**Affected artifact**: Código (API)
**Location**: `apps/api/src/app.ts:111-119`, `apps/api/src/routes/auth.ts:125-154`,
`apps/api/src/usuarios/service.ts:134-163,277-325`, `render.yaml:5-6`

**Description**
`@fastify/rate-limit` se registra con `global: false`; solo `POST /auth/login` opta por él
(`config.rateLimit` en `apps/api/src/routes/auth.ts:59`). `POST /auth/password` ejecuta **dos**
operaciones argon2 por petición (verify + hash) y está abierta a cualquier sesión autenticada,
incluida `deposito`, sin límite alguno. `POST /usuarios` y `POST /usuarios/:id/password-reset`
ejecutan un `hashPassword` cada una, sin límite, aunque su exposición es menor por requerir rol
`encargado`.

**Evidence**
- `apps/api/src/app.ts:111-119` — `rateLimit` registrado con `global: false`.
- `apps/api/src/routes/auth.ts:125-139` — el bloque `config` de `/auth/password` no declara
  `rateLimit`.
- `apps/api/src/auth/service.ts:145,153` — `verifyPassword` seguido de `hashPassword`, ambos con
  costo completo (`memoryCost: 19456`, verificado en `apps/api/src/auth/password.ts`).
- `render.yaml:5` — `plan: free`, contenedor de 512 MB.

**Attack scenario**
Una sesión `deposito` (o cualquiera que la haya obtenido) lanza peticiones concurrentes a
`POST /api/auth/password` con `currentPassword` incorrecta. Cada una reserva ~19 MiB durante el
verify. Unas pocas decenas de peticiones simultáneas agotan la memoria del contenedor de Render.

**Potential impact**
Caída del servicio, provocable desde el rol menos privilegiado del sistema. Solo disponibilidad;
sin pérdida de confidencialidad ni integridad.

**Existing mitigation**
El límite de 1 MiB por defecto de Fastify acota el tamaño del cuerpo, no el costo de argon2 (que
depende de sus parámetros, no de la longitud del texto). El plugin de rate-limit ya está
registrado — activarlo aquí es una línea de `config` por ruta.

**Recommended remediation**
`config.rateLimit` en `/auth/password`, `/usuarios` y `/usuarios/:id/password-reset`, indexado por
sesión o usuario (no por IP, dado que S12 deja la resolución de IP real como parcialmente
verificable). Considerar un límite global de operaciones argon2 concurrentes.

**Suggested verification**
Test por ruta que afirme `429 RATE_LIMITED` al superar el umbral, con `rateLimitMax` sobreescrito
como ya hace `apps/api/src/routes/auth.test.ts`.

**Required change type**: `CODE FIX`

---

**ID**: S03
**Title**: Ni la API ni la SPA emiten cabeceras de seguridad HTTP
**Severity**: MEDIUM
**Confidence**: HIGH
**Category**: Configuración insegura; ausencia de defensa en profundidad
**Affected artifact**: Configuración de despliegue, código (API)
**Location**: `vercel.json`, `apps/api/package.json`, `apps/api/src/app.ts:75-152`

**Description**
`vercel.json` no declara ningún bloque `headers`. `apps/api/package.json` no lista
`@fastify/helmet` entre sus dependencias, y `buildApp()` no registra ningún plugin ni hook `onSend`
que fije `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options` ni
`Referrer-Policy`.

**Evidence**
- `vercel.json` — únicamente `installCommand`, `buildCommand`, `outputDirectory`, `rewrites`.
- `apps/api/package.json:18-29` — dependencias listadas; `@fastify/helmet` ausente.
- `apps/api/src/app.ts:75-152` — secuencia completa de registro de plugins, sin ninguno de
  cabeceras.

**Attack scenario**
Sin `frame-ancestors`, un atacante embebe la SPA en un iframe transparente y superpone un señuelo;
como la sesión es una cookie `httpOnly` con `SameSite=Lax` en el propio origen, un clic del
encargado autenticado puede disparar en realidad el botón de desactivar usuario o resetear
credencial detrás del iframe. Independientemente, la ausencia de CSP significa que un XSS futuro
—hoy no hay ninguno verificado (sin `dangerouslySetInnerHTML`/`eval` en todo `apps/web/src`)—
tendría exfiltración libre.

**Potential impact**
Ejecución de operaciones administrativas destructivas sin consentimiento real, vía clickjacking; y
ausencia de la segunda línea de defensa contra un XSS futuro.

**Existing mitigation**
React escapa por defecto y no hay sinks de XSS conocidos hoy — mitiga el vector, no la ausencia del
control. El clickjacking no está mitigado en absoluto.

**Recommended remediation**
Añadir `headers` en `vercel.json` para el documento de la SPA (mínimo:
`Content-Security-Policy` con `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: same-origin`); registrar `@fastify/helmet` en `buildApp` antes de las rutas. La
CSP puede ser estricta: no hay scripts de terceros cargados en runtime.

**Suggested verification**
Test sobre `buildApp` que afirme la presencia de las cabeceras en cualquier respuesta.

**Required change type**: `CODE FIX`

---

**ID**: S04
**Title**: Las respuestas autenticadas no llevan `Cache-Control`, salvo las dos que devuelven una credencial
**Severity**: MEDIUM
**Confidence**: MEDIUM
**Category**: Exposición de datos sensibles a través de una caché intermedia
**Affected artifact**: Código (API)
**Location**: `apps/api/src/routes/auth.ts:101-123`, `apps/api/src/routes/usuarios.ts:120-161`

**Description**
`POST /usuarios` y `POST /usuarios/:id/password-reset` fijan `Cache-Control: no-store`
explícitamente (`apps/api/src/routes/usuarios.ts:187,214`) porque devuelven una contraseña
temporal. Ninguna otra respuesta lo hace. `GET /auth/me` (identidad del llamador) y `GET /usuarios`
(directorio completo con correos y roles) no fijan ninguna directiva de caché.

**Evidence**
- Búsqueda de `Cache-Control` en `apps/api/src` produce exactamente esas dos apariciones, en el
  mismo archivo.
- `apps/api/src/routes/auth.ts:114-122` — `GET /auth/me` retorna el DTO sin cabecera.
- `apps/api/src/app.ts:75-152` — sin hook `onSend` global que supla la ausencia.

**Attack scenario**
Un dispositivo compartido de mostrador (`docs/PRD.md` contempla uso móvil), o cualquier caché
intermedia que decida almacenar heurísticamente un `200 GET` sin directivas, sirve la identidad o
el directorio de un turno anterior a un segundo usuario tras un cambio de sesión.

**Potential impact**
Divulgación de identidad y del padrón de usuarios entre sesiones distintas. No permite actuar en
nombre de otro, pero alimenta S01.

**Existing mitigation**
Los navegadores aplican heurísticas conservadoras sobre respuestas con cookies de sesión, y no se
verificó el comportamiento real del proxy de Vercel desplegado — de ahí `Confidence: MEDIUM`. La
remediación es barata, así que la incertidumbre no la justifica postergar.

**Recommended remediation**
Hook `onSend` en `buildApp` que fije `Cache-Control: no-store` en toda respuesta de una ruta sin
`auth: false`, dejando `/api/health` fuera.

**Suggested verification**
Test que recorra las rutas autenticadas y afirme la cabecera en cada respuesta.

**Required change type**: `CODE FIX`

---

**ID**: S05
**Title**: El atributo `Secure` de la cookie de sesión y el rechazo del secreto de desarrollo dependen ambos de una sola variable y fallan en abierto
**Severity**: MEDIUM
**Confidence**: MEDIUM
**Category**: Modo de fallo inseguro (fail-open); configuración por defecto permisiva
**Affected artifact**: Código (API), configuración de despliegue
**Location**: `apps/api/src/auth/session.ts:44`, `apps/api/src/plugins/cookie.ts:7,24-30`,
`render.yaml:18-19`

**Description**
`secure: process.env.NODE_ENV === 'production'` (session.ts:44) y el `throw` que impide el secreto
de cookie de desarrollo (`cookie.ts:24-30`) cuelgan de la misma comparación. Si `NODE_ENV` falta,
se escribe distinto, o el servicio se despliega en una plataforma que no la fija, **ambos controles
se desactivan a la vez y en silencio**: la cookie viaja sin `Secure` y el sistema queda dispuesto a
firmar sesiones con `DEV_FALLBACK_SECRET`, una constante versionada y por tanto pública.

**Evidence**
- `apps/api/src/auth/session.ts:44` — el valor por defecto ante cualquier cadena que no sea
  exactamente `'production'`, incluido `undefined`, es `false`.
- `apps/api/src/plugins/cookie.ts:7` — `DEV_FALLBACK_SECRET` versionado en texto plano.
- `apps/api/src/plugins/cookie.ts:24-30` — el `throw` que lo hace inalcanzable en producción
  depende de la misma comparación.
- `render.yaml:18-19` — `NODE_ENV: production` fijado; es lo único que hoy sostiene ambos
  controles.

**Attack scenario**
Un cambio en el manifiesto, un despliegue manual desde la consola de Render, o una migración a otra
plataforma que olvide la variable, y el servicio arranca sirviendo cookies sin `Secure`. Un
atacante en la misma red, o que induzca una petición a `http://` hacia el origen de Render
(`.onrender.com`, sin HSTS precargado a diferencia de `.vercel.app`), captura la cookie de sesión
en claro.

**Potential impact**
Robo de sesión con los privilegios completos del usuario afectado.

**Existing mitigation**
`render.yaml:18-19` fija la variable hoy. `apps/api/src/lib/env.ts` exige `COOKIE_SECRET` de al
menos 32 caracteres en el arranque de `server.ts` con independencia de `NODE_ENV`, así que el
fallback público es inalcanzable por la vía normal de arranque — lo que mantiene esto en MEDIUM y
no en HIGH. El riesgo depende de una desviación de configuración futura, no de un defecto
observable hoy.

**Recommended remediation**
Invertir el valor por defecto de `secure` a `true`, requiriendo una variable explícita
(`ALLOW_INSECURE_COOKIES=true`) para desactivarlo deliberadamente y de forma registrada.

**Suggested verification**
Test que construya la app sin `NODE_ENV` definido y afirme que la cookie emitida lleva `Secure`.

**Required change type**: `CODE FIX`

---

**ID**: S06
**Title**: `POST /api/ventas` acepta arreglos `items`/`pagos` sin límite, cada elemento dentro de una sola transacción contra un pool de 10 conexiones
**Severity**: MEDIUM
**Confidence**: MEDIUM
**Category**: Agotamiento de recursos; límite ausente en la ruta de escritura más costosa del
sistema
**Affected artifact**: Código (API) — hallazgo nuevo, en código que no existía en el pase anterior
**Location**: `apps/api/src/routes/ventas.ts:44-49`, `apps/api/src/ventas/service.ts:113-275`,
`apps/api/src/db/pool.ts:12`

**Description**
`confirmarVentaBody` acota `motivoAnulacion` a `max(500)` y cada campo escalar tiene su propio
límite, pero `items: z.array(itemBody).min(1)` y `pagos: z.array(pagoBody).min(1)` no declaran
`.max()`. `confirmarVenta` recorre el arreglo dos veces dentro de **una** transacción
(`uow.run`): Pass A hace un `findById` por ítem, Pass B hace un `aplicarDelta` (UPDATE) y un
`movimientos.create` (INSERT) por ítem — todo secuencial, todo sosteniendo la misma conexión. El
`Pool` de `pg` se crea sin `max` explícito (`new Pool({ connectionString: ... })`), que es 10 por
defecto. La ruta no tiene `config.rateLimit` (a diferencia de `/auth/login`) y está abierta a
`['encargado', 'deposito']` — cualquier sesión autenticada, sin distinción de privilegio.

**Evidence**
- `apps/api/src/routes/ventas.ts:29-49` — `itemBody`/`pagoBody` sin `.max()` en ninguno de los dos
  arreglos del body; comparar con `motivoAnulacion: z.string().trim().min(3).max(500)` tres líneas
  más abajo, que sí lo tiene.
- `apps/api/src/ventas/service.ts:143-259` — dos bucles `for` sobre `itemsOrdenados`/
  `itemsComputados`, cada iteración con al menos un `await` a Postgres, todo dentro de
  `uow.run(async (txRepos) => { ... })`.
- `apps/api/src/db/pool.ts:12` — `new Pool({ connectionString: process.env.DATABASE_URL })`, sin
  `max` — el valor por defecto de `pg` es 10.
- `apps/api/src/routes/ventas.ts:208-224` — `config: { roles: ['encargado', 'deposito'] }`, sin
  `rateLimit`.
- Ningún body en `apps/api/src/routes/movimientos.ts` acepta un arreglo — son rutas de un solo
  movimiento, así que este patrón es exclusivo de `ventas.ts`.

**Attack scenario**
Una sesión `deposito` (el rol de más bajo privilegio con acceso a esta ruta) envía un único
`POST /api/ventas` con miles de entradas en `items` (el límite de cuerpo de 1 MiB de Fastify
permite del orden de varios miles de objetos JSON pequeños como `itemBody`). La petición mantiene
una transacción abierta ejecutando miles de UPDATE/INSERT secuenciales. Unas pocas peticiones
concurrentes de este tipo agotan las 10 conexiones del pool; toda otra escritura del sistema —
login, ventas legítimas, gestión de usuarios— queda bloqueada esperando una conexión libre en un
servicio ya al límite de un plan gratuito de 512 MB (`render.yaml:5`).

**Potential impact**
Denegación de servicio provocable por el rol menos privilegiado del sistema, con una sola petición
HTTP. Impacto exclusivamente de disponibilidad.

**Existing mitigation**
El body limit de 1 MiB de Fastify acota el ataque de forma indirecta (no elimina el riesgo, solo
lo bandas). La validación de duplicados (`duplicateSaleItem`) exige `productoId` únicos, lo que en
la práctica limita el arreglo al número de productos activos existentes — pero nada en el código
impone ese límite explícitamente, y un catálogo grande lo haría inofensivo solo por casualidad de
tamaño de negocio, no por diseño.

**Recommended remediation**
Añadir `.max(n)` a ambos arreglos (`items`, `pagos`) con un valor generoso para una venta real de
mostrador — el propio dominio (POS de tienda pequeña) sugiere que ninguna venta legítima supera
unas pocas decenas de líneas. Considerar además `config.rateLimit` en esta ruta, coherente con la
recomendación de S02.

**Suggested verification**
Test que envíe un `items` con más entradas que el límite elegido y afirme `400 VALIDATION_ERROR`
antes de que se abra ninguna transacción.

**Required change type**: `CODE FIX`

---

### LOW

---

**ID**: S07
**Title**: La protección CSRF descansa por completo en `SameSite=Lax`, sin verificación de `Origin`
**Severity**: LOW
**Confidence**: HIGH
**Category**: Control de una sola capa
**Affected artifact**: Código (API)
**Location**: `apps/api/src/plugins/cookie.ts:44-48`, `apps/api/src/routes/auth.ts:78-99`

**Description**
No existe token anti-CSRF ni comprobación de `Origin`/`Sec-Fetch-Site`. La única defensa es
`sameSite: 'lax'`. `POST /auth/logout` declara `auth: false` y resuelve la cookie por su cuenta,
siendo la ruta con estado más expuesta.

**Evidence**
- Búsqueda de `csrf`, `Origin`, `Sec-Fetch` en `apps/api/src` no produce coincidencias.
- `apps/api/src/plugins/cookie.ts:47` — `sameSite: 'lax'` es la totalidad del control.

**Attack scenario**
`SameSite=Lax` cubre el caso principal (ningún POST con estado es alcanzable por GET). El riesgo
residual son navegadores que no lo aplican por defecto, y un logout forzado como molestia.

**Potential impact**
Bajo con navegadores actuales; valor de defensa en profundidad ante un cambio futuro que debilite
el atributo.

**Existing mitigation**
`SameSite=Lax` efectivo en navegadores modernos; sin CORS permisivo.

**Recommended remediation**
Comprobación de `Origin`/`Sec-Fetch-Site` en un `preHandler` para métodos con estado.

**Suggested verification**
Test que envíe un POST con `Origin` ajeno y cookie válida, y afirme el rechazo.

**Required change type**: `CODE FIX`

---

**ID**: S08
**Title**: `.gitignore` no cubre la familia completa de archivos de entorno que Vite genera
**Severity**: LOW
**Confidence**: HIGH
**Category**: Riesgo de secretos versionados por omisión
**Affected artifact**: Configuración del repositorio
**Location**: `.gitignore:10-12`

**Description**
El bloque de entorno lista exactamente `.env` y `.env.local`. Vite resuelve además
`.env.production`, `.env.development`, `.env.[mode].local` y `.env.test`, ninguno cubierto. Hoy no
hay ningún secreto versionado (confirmado: el único archivo con ese prefijo en el índice es
`.env.example`).

**Evidence**
- `.gitignore:10-12` — exactamente dos patrones.
- `apps/api/src/lib/env.ts` — el API usa `dotenv/config`, que carga `.env` en la raíz del paquete;
  `apps/api/.env` sí queda cubierto por el patrón sin barra inicial.

**Attack scenario**
Alguien crea `apps/web/.env.production` o `apps/api/.env.production` con un valor sensible futuro,
y `git add .` lo incorpora sin resistencia.

**Potential impact**
Exposición de credenciales en el historial de Git, cuya remoción exige reescritura y rotación.

**Existing mitigation**
La regla de permisos de este agente (`CLAUDE.md`) reduce el riesgo de que un agente lo provoque;
no cubre a una persona trabajando en el repositorio.

**Recommended remediation**
Sustituir por un patrón `.env*` con negación explícita `!.env.example`.

**Suggested verification**
`git check-ignore` sobre `apps/api/.env.production` y `apps/web/.env.production`.

**Required change type**: `PROCESS / HARNESS CHANGE`

---

**ID**: S09
**Title**: El pipeline de CI no audita dependencias ni tiene actualización automatizada
**Severity**: LOW
**Confidence**: HIGH
**Category**: Riesgo de cadena de suministro
**Affected artifact**: CI/CD
**Location**: `.github/workflows/ci.yml`

**Description**
El workflow ejecuta lint, verificación de contrato, typecheck, migraciones, tests unitarios e
integración, pero ningún paso examina vulnerabilidades de dependencias. No hay
`.github/dependabot.yml` ni configuración de Renovate.

**Evidence**
- `.github/workflows/ci.yml` — seis pasos tras el checkout; ninguno es `pnpm audit` o equivalente.
- `pnpm audit --prod` ejecutado en este pase: sin vulnerabilidades — confirma que la brecha es de
  detección futura, no de exposición actual.

**Attack scenario**
Se publica una vulnerabilidad en `fastify`, `argon2`, `pg` o una transitiva; nada en el flujo de
trabajo lo señala, y `pnpm-lock.yaml` fija la versión vulnerable indefinidamente.

**Potential impact**
Ventana de exposición prolongada y desconocida en una API que maneja autenticación.

**Existing mitigation**
`pnpm install --frozen-lockfile` en CI y despliegue garantiza reproducibilidad, un control de
integridad, no de detección.

**Recommended remediation**
Paso `pnpm audit --prod --audit-level high` en el workflow; habilitar Dependabot o Renovate.

**Suggested verification**
El propio paso de CI.

**Required change type**: `PROCESS / HARNESS CHANGE`

---

**ID**: S10
**Title**: El rastro de auditoría retiene el correo del usuario de forma indefinida y la FK `restrict` bloquea el borrado real
**Severity**: LOW
**Confidence**: HIGH
**Category**: Brecha de privacidad; decisión de producto pendiente
**Affected artifact**: Esquema de base de datos, requisitos de producto
**Location**: `apps/api/src/db/schema.ts`, `apps/api/src/auditoria/fields.ts`, `docs/BACKLOG.md`
ítem 2.5

**Description**
`auditoria.usuario_id` lleva `onDelete: 'restrict'`, así que en cuanto un usuario ha realizado una
operación auditada su fila no puede eliminarse. `email` sigue en `auditableFields` de `usuarios`
sin política de retención. Este es el **mismo hallazgo** que el pase anterior (SEC-012) reportó, y
sigue **sin resolver**: `docs/BACKLOG.md` ítem 2.5 lo marca `⬜ Pendiente`, frenado a propósito
porque mover `email` a `excludedFields` deja filas de un cambio de-solo-correo con ambas
instantáneas vacías — un borde que el equipo detectó y decidió no resolver a la ligera.

**Evidence**
- `docs/BACKLOG.md` ítem 2.5 — "Evaluado el 2026-08-30 y frenado a propósito"; decisión de producto
  pendiente entre aceptar el borde o guardar un marcador redactado.
- `apps/api/src/auditoria/repository.ts` — el puerto solo expone `record`; no hay purga ni borrado.

**Attack scenario**
No es un escenario de atacante. Ante una solicitud de supresión de datos de un empleado que ya no
trabaja en la tienda, el sistema no puede satisfacerla hoy.

**Potential impact**
Imposibilidad de cumplir una solicitud de supresión; acumulación indefinida de PII. Bajo impacto
directo en un local pequeño; relevante para gobierno del dato antes de que el volumen crezca.

**Existing mitigation**
`hash_contrasena` está excluido de ambas instantáneas — el dato más sensible sí está protegido.

**Recommended remediation**
Cerrar la decisión ya evaluada en el backlog: aceptar el borde documentado como limitación conocida
(opción 1) o implementar el marcador redactado (opción 2).

**Suggested verification**
Una vez decidido, test de integración que afirme el comportamiento elegido sobre un cambio de-solo-
correo.

**Required change type**: `PRODUCT / REQUIREMENT CHANGE`

---

### INFO

---

**ID**: S11
**Title**: Ningún test compara la respuesta a un correo desconocido contra la de una cuenta bloqueada
**Severity**: INFO
**Confidence**: HIGH
**Category**: Invariante de seguridad especificada sin cobertura
**Affected artifact**: Tests
**Location**: `apps/api/src/routes/auth.test.ts`, `openspec/specs/auth-sessions/spec.md:40`

**Description**
Existe cobertura para la respuesta a un correo desconocido y para la respuesta a una cuenta
bloqueada, cada una por separado, pero ninguna las compara — que es exactamente la forma de la
propiedad "no user enumeration" que S01 documenta como incumplida.

**Evidence**
- `apps/api/src/routes/auth.test.ts` — tests aislados para cada caso, sin comparación cruzada.

**Attack scenario**
No aplica directamente; explica por qué S01/SEC-002 no fue detectado por la suite.

**Potential impact**
Un requisito de seguridad explícito de la spec puede incumplirse sin que CI lo detecte.

**Existing mitigation**
Cobertura de autorización general excelente en el resto de la suite, lo que hace notar más esta
omisión puntual.

**Recommended remediation**
Test que ejecute la misma secuencia de fallos contra un correo existente y uno inexistente, y
afirme respuestas idénticas — a escribir después de resolver S01, cuyo resultado esperado depende
de la decisión de spec.

**Required change type**: `TEST FIX`

---

## Prioridad

1. **S01** antes que nada — es lo que convierte cualquier ataque futuro contra una cuenta real en
   "el correo se averigua con seis peticiones". Se resuelve en el mismo punto de código que ya se
   tocó para SEC-001, así que es barato de encadenar con trabajo ya hecho.
2. **S11**, inmediatamente después — el test que fija lo que S01 decida; escrito antes no tendría
   resultado esperado.
3. **S02** y **S06** — ambos son "agotamiento de recursos en un plan de 512 MB sin límite de tasa",
   la misma clase de riesgo en dos superficies distintas (contraseñas, ventas). Conviene
   resolverlos juntos: mismo patrón de remediación (`config.rateLimit` + límites de payload).
4. **S03** y **S05** — cambios pequeños y acotados, independientes del resto. S03 es además la
   única defensa preparada de antemano contra un XSS futuro.
5. **S04** — barato; conviene verificar el comportamiento real del proxy de Vercel al desplegar.
6. **S07**, **S08**, **S09** — endurecimiento y proceso, cada uno de pocas líneas.
7. **S10** — ya evaluado y frenado a propósito en el backlog; requiere cerrar una decisión de
   producto ya identificada, no investigación nueva.

## Gobernanza / Decisión requerida

- **S01 — `SPEC CHANGE`.** `openspec/specs/auth-sessions/spec.md:40` ratifica hoy dos requisitos
  que no pueden sostenerse a la vez (423 informativo con `retryAfter`, y ausencia de enumeración).
  Elegir cuál cede es una decisión de spec, no de código.
- **S10 — `PRODUCT / REQUIREMENT CHANGE`.** Ya evaluada y frenada a propósito en
  `docs/BACKLOG.md` ítem 2.5 el 2026-08-30: aceptar el borde documentado o pagar el costo del
  marcador redactado. Ninguna de las dos opciones es una corrección de código por sí sola.
- **S12 (nota, no finding formal) — verificación de despliegue pendiente.** El código de S12
  referenciado en Fortalezas (`plugins/clientIp.ts`) está correcto y degrada con seguridad si
  `PROXY_SHARED_SECRET` no está configurado, pero este pase **no pudo verificar** si esa variable
  está cargada en Render y Vercel — el pase anterior documentó los pasos de despliegue como
  pendientes de ventana de verificación. Confirmar el estado real en el panel de cada plataforma
  es una acción operativa, no una decisión de arquitectura, pero determina si S02/S06 pueden
  algún día indexarse con seguridad por IP real en vez de por sesión.

**Ningún hallazgo de este pase fue marcado `ACCEPT RISK`.** Todos tienen una remediación concreta
propuesta.
