# Security Pass — InvenTienda

Fecha: 2026-08-29
Modo: análisis únicamente. Ningún archivo del proyecto fue modificado; este documento es la única
salida del pase.

## Alcance revisado

**Capas inspeccionadas:**

- **Producto / requisitos**: `docs/PRD.md`, `docs/TECH-DESIGNv2.md` (autoritativo) y su registro de
  riesgos.
- **Arquitectura / ADRs**: `docs/adrs/0007-sesion-cookie-rbac-propio.md`,
  `docs/adrs/0010-despliegue-tiers-gratuitos.md`, `docs/adrs/0011-claves-primarias-uuid.md`,
  `docs/adrs/0012-frontera-auditoria-y-ledger.md`.
- **Specs**: `openspec/specs/auth-sessions/`, `user-management/`, `supplier-management/`,
  `password-change/`, `record-audit-trail/`, `usuarios-ui/`.
- **Código API**: la totalidad de `apps/api/src/` (auth, plugins, rutas, repositorios, servicios,
  esquema Drizzle, auditoría, unit of work) y `apps/api/scripts/seed-encargado.ts`.
- **Código SPA**: `apps/web/src/api/`, `apps/web/src/routes/` (guards), `apps/web/src/features/`,
  `apps/web/index.html`, `apps/web/vite.config.ts`.
- **Configuración y despliegue**: `render.yaml`, `vercel.json`, `docker-compose.yml`,
  `.github/workflows/ci.yml`, `.gitignore`, manifiestos de dependencias.
- **Tests**: inventario de casos en las suites de `auth`, `usuarios`, `proveedores` y del plugin de
  RBAC, para determinar qué propiedades de seguridad ya están verificadas.
- **Dependencias**: `pnpm audit --prod` ejecutado sobre el árbol de producción — **sin
  vulnerabilidades conocidas**.

**Lo que NO se revisó, y por qué:**

- **Ningún archivo `.env*`.** Una regla de permisos del repositorio los deniega. La ausencia de
  secretos versionados se verificó por `git ls-files` (solo `.env.example` está en el índice; ningún
  `.env` real lo está) y por `.gitignore`, nunca leyendo su contenido. Todo lo que este informe dice
  sobre configuración de entorno se deriva de `render.yaml`, `vercel.json`, `docker-compose.yml`,
  `.github/workflows/ci.yml` y del código que lee `process.env`.
- **El entorno desplegado en vivo.** No se ejecutó ninguna prueba contra
  `https://dmc-proyecto.vercel.app` ni contra el servicio de Render. Las conclusiones sobre cabeceras
  HTTP, comportamiento del proxy de Vercel y caché son inferencias a partir de la configuración
  versionada; donde eso limita la certeza, el hallazgo lo declara en su campo `Confidence`.
- **La instancia de Postgres en Neon**: cifrado en reposo, política de respaldos, rotación de
  credenciales y superficie de acceso a la consola quedan fuera del repositorio y no son observables
  desde él.
- **Capacidades aún no implementadas.** `openspec/changes/productos-ledger-base/` (productos y
  ledger de stock) está en vuelo y sin código; no se revisó como implementación, solo se consideró
  su spec al evaluar la extensibilidad de los controles existentes.

## Resumen ejecutivo

La postura de seguridad del backend es considerablemente mejor que la de un proyecto típico de este
tamaño: la autorización es server-side y por defecto denegada, el hash de contraseñas es argon2id con
parámetros OWASP, la sesión se revoca de forma inmediata y verificable, y el aislamiento del hash
respecto de las respuestas HTTP está defendido en dos capas independientes y cubierto por tests. No
hay secretos versionados ni dependencias con vulnerabilidades conocidas.

Los riesgos reales están en otra parte: en lo que el sistema hace bajo **abuso deliberado**, no bajo
uso incorrecto. El más serio es que cualquier persona no autenticada que conozca el correo del único
`encargado` puede mantenerlo bloqueado de forma indefinida con cinco peticiones cada cinco minutos, y
la única vía de rescate documentada es editar el hash directamente en la base de datos. Ese mismo
mecanismo de bloqueo convierte el código `423 ACCOUNT_LOCKED` en un oráculo de enumeración de
usuarios que anula la defensa de temporización que el diseño construyó a propósito para evitarla.
Además, el rate-limit de login está indexado por una IP que, detrás del reescritor de Vercel, es la
del proxy y no la del atacante: la promesa "rate-limited by IP" de la spec no se cumple en la forma
desplegada.

Nada de esto es un fallo de implementación descuidada — el código hace exactamente lo que las specs y
los ADRs describen. Son huecos en el modelo de amenaza: el diseño consideró el error del usuario
legítimo y la concurrencia, pero no un adversario que ataque la disponibilidad del rol privilegiado.

**12 hallazgos**: 1 HIGH, 6 MEDIUM, 4 LOW, 1 INFO. Ninguno CRITICAL.

## Fortalezas de seguridad

Estos controles ya funcionan y no deberían tocarse al remediar lo demás:

- **Autorización server-side por defecto denegada.** `apps/api/src/plugins/auth.ts:39-70` exige
  sesión en toda ruta que no declare `auth: false` explícitamente, y el comentario de
  `apps/api/src/app.ts:94-96` documenta la restricción de orden de registro que sostiene la garantía.
  El plugin está cubierto por once tests dedicados (`apps/api/src/plugins/auth.test.ts:49-213`),
  incluida la ruta no emparejada que debe seguir dando 404 y no un 401 falso.
- **La frontera cliente/servidor está documentada como tal, no confundida.**
  `apps/web/src/routes/encargadoLayout.tsx:9-16` y `openspec/specs/usuarios-ui/spec.md:116-118`
  declaran explícitamente que los guards de la SPA son conveniencia de UX y que el 403 del servidor
  es el control real; la spec incluso exige un escenario que prueba que el backend permite lo que la
  pantalla se niega a ofrecer (`openspec/specs/usuarios-ui/spec.md:121-124`).
- **Revocación de sesión inmediata y con doble refuerzo.**
  `apps/api/src/auth/repository.ts:33-47` filtra por `usuarios.activo = true` en el propio JOIN, y
  `apps/api/src/usuarios/service.ts:256-263` además borra las filas de sesión al dar de baja. El
  comentario de `apps/api/src/auth/repository.ts:79-83` explica por qué ambas cosas, y no una,
  son necesarias.
- **El hash nunca sale por una respuesta HTTP.** Proyección explícita sin la columna
  (`apps/api/src/usuarios/repository.ts:84-92`), tipo de retorno sin el campo
  (`apps/api/src/usuarios/repository.ts:28-36`), esquema Zod de respuesta que descarta claves
  desconocidas (`apps/api/src/routes/usuarios.ts:30-38`) y denylist en la auditoría
  (`apps/api/src/auditoria/fields.ts:10,33`). El comentario de `apps/api/src/routes/usuarios.ts:21-29`
  documenta que la redundancia fue medida, no supuesta.
- **Defensa contra enumeración por temporización en el login.**
  `apps/api/src/auth/service.ts:48-53` verifica contra un hash señuelo fijo para un correo
  desconocido, y `apps/api/src/auth/service.ts:71-73` comprueba `activo` **después** del verify para
  que `ACCOUNT_INACTIVE` no sea un oráculo. (El hallazgo SEC-002 documenta la vía que sí queda
  abierta, por otro camino.)
- **Toda escritura pasa por una transacción con su fila de auditoría.**
  `apps/api/src/db/uow.ts:9-21` entrega repositorios ya ligados a la transacción y nunca el ejecutor
  crudo, de modo que un servicio no puede eludir la frontera. El repositorio de auditoría solo expone
  `record` (`apps/api/src/auditoria/repository.ts:13-15`): no hay ruta de código que modifique o borre
  una fila del rastro.
- **La contraseña temporal se trata como credencial de un solo uso.** Sale por una única respuesta
  con `Cache-Control: no-store` (`apps/api/src/routes/usuarios.ts:187,214`), en un DTO deliberadamente
  disjunto del de lectura (`apps/api/src/routes/usuarios.ts:57-65`), y la SPA se niega a copiarla al
  portapapeles del sistema (`apps/web/src/features/usuarios/CredentialDialog.tsx:16-25`). Hay tests
  que afirman que no aterriza en `localStorage` ni `sessionStorage`
  (`apps/web/src/features/usuarios/useCrearUsuario.test.ts:91-92`).
- **El script de bootstrap se niega a aceptar la contraseña por argumento de CLI**
  (`apps/api/scripts/seed-encargado.ts:33-40`) y nunca la registra en un log
  (`apps/api/scripts/seed-encargado.ts:101-102`).
- **Sin secretos versionados.** `git ls-files` no lista ningún `.env` real; las únicas cadenas con
  forma de secreto en el árbol son marcadores de test declarados como tales y el fallback de
  desarrollo etiquetado en `apps/api/src/plugins/cookie.ts:5-7`. `COOKIE_SECRET` se genera en la
  plataforma (`render.yaml:22-23`) y `DATABASE_URL` está marcado `sync: false` (`render.yaml:20-21`).
- **Sin sinks de XSS.** No hay `dangerouslySetInnerHTML`, `innerHTML`, `eval` ni `new Function` en
  todo `apps/web/src` ni en `apps/api/src`. Toda consulta pasa por Drizzle con parámetros ligados,
  incluido el único `sql` crudo (`apps/api/src/usuarios/repository.ts:128-137`), que interpola el id
  como parámetro y no como texto.
- **Sin CORS permisivo.** No hay `@fastify/cors` registrado, de modo que el navegador bloquea por
  defecto toda lectura con credenciales desde otro origen. Es la postura correcta para esta
  arquitectura y conviene no relajarla.
- **Sin vulnerabilidades conocidas en dependencias de producción** (`pnpm audit --prod`).

## Findings

### HIGH

---

**ID**: SEC-001
**Title**: Un atacante no autenticado puede mantener bloqueada indefinidamente la cuenta del único `encargado`
**Severity**: HIGH
**Confidence**: HIGH
**Category**: Abuso de lógica de negocio / denegación de servicio dirigida; brecha de disponibilidad no considerada en los requisitos
**Affected artifact**: Código (API), ADR, spec
**Location**: `apps/api/src/auth/service.ts:55-69`, `apps/api/src/usuarios/repository.ts:127-149`,
`openspec/specs/auth-sessions/spec.md:98`, `docs/adrs/0007-sesion-cookie-rbac-propio.md:52-58`

**Description**
El bloqueo por intentos fallidos se aplica **a la cuenta**, se dispara con cinco fallos consecutivos
y lo puede activar cualquier persona no autenticada que solo conozca el correo. Como el sistema tiene
un único rol privilegiado y la invariante `LAST_ACTIVE_ENCARGADO` garantiza que siempre haya al menos
un `encargado` activo, esa cuenta es un punto único de fallo: quien la bloquee de forma sostenida
deja al sistema sin capacidad administrativa. Ninguna gestión de usuarios, alta de proveedores ni
reset de contraseña es posible mientras dure.

**Evidence**
- `apps/api/src/auth/service.ts:55-60` — el bloqueo se evalúa al inicio de `login`, antes de verificar
  la contraseña, y lanza `accountLocked` para cualquier intento posterior.
- `apps/api/src/usuarios/repository.ts:132-135` — al alcanzar `intentos_fallidos >= 5` se fija
  `bloqueado_hasta = now() + interval '5 minutes'`. El contador solo se reinicia con un login
  **exitoso** (`apps/api/src/auth/service.ts:75`), que el titular legítimo no puede realizar mientras
  esté bloqueado.
- `apps/api/src/auth/service.ts:66-69` — `registerFailedAttempt` se invoca en toda contraseña
  incorrecta contra un usuario existente, sin requerir autenticación previa alguna.
- `docs/adrs/0007-sesion-cookie-rbac-propio.md:52-53` — el ADR especifica el bloqueo "por usuario y/o
  IP"; lo implementado es exclusivamente por usuario.
- `docs/adrs/0007-sesion-cookie-rbac-propio.md:56-58` — la única vía de rescate documentada cuando el
  único `encargado` pierde el acceso es "resetear el hash directo en base", un procedimiento manual
  fuera de la aplicación. No hay ruta de auto-servicio.
- `apps/api/src/usuarios/repository.ts:300-304` — reactivar un usuario deja deliberadamente intactos
  `intentos_fallidos` y `bloqueado_hasta`, de modo que un segundo `encargado` tampoco puede
  desbloquear a un colega por esa vía; solo `resetPassword` limpia el bloqueo
  (`apps/api/src/usuarios/repository.ts:319-331`), y eso exige una sesión de `encargado` que quizá ya
  no exista.

**Attack scenario**
El correo del encargado es adivinable o conocido (aparece en facturas, en el dominio de la tienda, o
se descubre por SEC-002). El atacante envía cinco POST a `/api/auth/login` con ese correo y
contraseñas arbitrarias. La cuenta queda bloqueada cinco minutos. Un script repite el ciclo cada
cinco minutos: cinco peticiones cada trescientos segundos, un ritmo que ni siquiera se acerca al
límite de diez por minuto de `apps/api/src/routes/auth.ts:59`. El encargado queda fuera del sistema
de forma permanente hasta que alguien con acceso a la consola de Neon edite la fila a mano.

**Potential impact**
Pérdida total y sostenida de la capacidad administrativa del sistema con recuperación únicamente
manual y fuera de banda. En un local con un solo encargado, es una parada operativa completa de la
gestión de usuarios, proveedores y —cuando se implemente— del ledger de stock. El coste para el
atacante es despreciable y no requiere ninguna credencial.

**Existing mitigation**
Parcial e insuficiente. El límite de diez peticiones por minuto de
`apps/api/src/routes/auth.ts:59` no estorba a un ataque que necesita cinco peticiones cada cinco
minutos. La invariante `LAST_ACTIVE_ENCARGADO`
(`apps/api/src/usuarios/service.ts:104-111`) protege contra la eliminación *administrativa* de la
capacidad de administrar, pero no contra su negación por bloqueo. Un segundo `encargado` activo
mitigaría el impacto, pero nada en el sistema lo exige ni lo sugiere.

**Recommended remediation**
La decisión pertenece al ADR-0007, que hoy dice "por usuario y/o IP" y dejó la elección abierta. Las
opciones que cierran el hueco, para que el propietario elija:
1. Añadir un bloqueo **por IP** además del de cuenta, y no bloquear la cuenta cuando los fallos
   provienen de una única fuente — el patrón que distingue "atacante externo" de "usuario que olvidó
   su contraseña".
2. Aplicar **backoff exponencial por cuenta con techo** en lugar de un bloqueo duro, de modo que el
   titular legítimo conserve una ventana de acceso aunque degradada.
3. Exceptuar del bloqueo la combinación correo + contraseña **correcta**: verificar la contraseña
   antes de rechazar por bloqueo y permitir el acceso si es válida, convirtiendo el bloqueo en una
   defensa contra adivinación y no en una negación de servicio. (Requiere evaluar el coste de argon2
   en la ruta bloqueada; ver SEC-004.)
4. Añadir una vía de rescate en banda para el último `encargado`, de modo que la recuperación no
   dependa de acceso directo a la base.

**Suggested verification**
Un test de integración que, tras cinco fallos contra un `encargado`, afirme que el titular con la
contraseña **correcta** obtiene el resultado que la política decida —y que ese resultado no sea una
negación indefinida—. Y un test que afirme que los fallos originados desde una única IP no producen
el mismo efecto que fallos distribuidos, si se adopta la opción 1.

**Required change type**: `DESIGN / ADR CHANGE`

**Resuelto el 2026-08-30 — opción 3.** Se verifica la contraseña **antes** de evaluar el bloqueo
(`apps/api/src/auth/service.ts:55-82`), según la resolución ya ratificada en el ADR-0007
§ *Actualizado 2026-08-29*. Una credencial correcta concede acceso aunque la cuenta esté bloqueada y
limpia el contador; quien adivina mal sigue recibiendo `423`. La opción 1 (bloqueo por IP) queda
descartada mientras no exista `trustProxy` (SEC-003), porque hoy todos los clientes legítimos
comparten la IP del proxy de Vercel.

Dos tests afirmaban la vulnerabilidad y fueron reescritos, no adaptados:
`auth/service.test.ts` decía *"rejects a locked account without evaluating the password hash"*, y
`routes/auth.integration.test.ts` hacía cinco fallos, reiniciaba la app y esperaba `423` usando la
contraseña **correcta**. El segundo ahora prueba la persistencia del contador con una contraseña
incorrecta, que es lo que realmente la demuestra.

Verificación, la que este mismo informe pedía: `routes/auth.integration.test.ts` — tras cinco fallos
contra Postgres real, el titular con la contraseña correcta entra, y la fila queda con
`bloqueado_hasta = null` e `intentos_fallidos = 0`. Se afirma la base después del éxito, no solo el
código de estado.

**Costo asumido, en el registro.** `argon2.verify` pasa a ejecutarse también sobre cuentas
bloqueadas, así que el bloqueo por cuenta **ya no limita el ritmo de adivinación**: el único freno
que queda es el rate-limit de la ruta. Eso convierte a **SEC-003** en carga estructural y no en
cosmética — hoy, sin `trustProxy`, ese límite agrupa a todos los usuarios legítimos en un solo balde
mientras un atacante que pegue directo a Render obtiene el suyo propio.

Efecto colateral corregido de paso: `argon2.verify` **lanza** ante un hash ilegible y
`verifyPassword` no lo capturaba, de modo que una fila con hash corrupto devolvía `500` en el login
— y un `500` para un correo concreto es en sí mismo una señal legible. Ahora falla cerrado
(`apps/api/src/auth/password.ts:15-30`).

---

### MEDIUM

---

**ID**: SEC-002
**Title**: El código `423 ACCOUNT_LOCKED` es un oráculo de enumeración de usuarios que anula la defensa de temporización
**Severity**: MEDIUM
**Confidence**: HIGH
**Category**: Exposición de información sensible; requisito de spec contradicho por la implementación
**Affected artifact**: Código (API), spec
**Location**: `apps/api/src/auth/service.ts:48-60`, `apps/api/src/lib/errors.ts:85-89`,
`openspec/specs/auth-sessions/spec.md:37-40`, `openspec/specs/auth-sessions/spec.md:47-50`

**Description**
La spec exige explícitamente que un correo desconocido produzca una respuesta indistinguible de una
contraseña incorrecta, "no user enumeration", y el código implementa esa promesa con cuidado mediante
un hash señuelo. Pero el estado de bloqueo la rompe por otra puerta: un correo **existente** puede
llegar a responder `423`, y un correo **inexistente** nunca puede. La distinción no es de
temporización sino de código de estado, así que la defensa del `DUMMY_HASH` no la cubre.

**Evidence**
- `apps/api/src/auth/service.ts:48-53` — un correo desconocido siempre lanza `invalidCredentials()`
  (401); no hay rama alguna que pueda producir 423 para él.
- `apps/api/src/auth/service.ts:55-60` — un correo conocido con `bloqueado_hasta` en el futuro lanza
  `accountLocked()` (423) para **cualquier** contraseña, incluidas las incorrectas.
- `apps/api/src/lib/errors.ts:85-89` — la respuesta 423 incluye además `details.retryAfter`,
  confirmando no solo la existencia sino el momento exacto del quinto fallo.
- `openspec/specs/auth-sessions/spec.md:40` — "THEN the response is `401 ... INVALID_CREDENTIALS` with
  the same shape/timing profile as a wrong-password response (no user enumeration)". La
  implementación cumple esta letra para la ruta directa y la incumple para la ruta a través del
  bloqueo.
- `apps/web/src/features/auth/errorMessages.ts:16-17,23-28` — la SPA traduce el 423 a un mensaje que
  confirma al usuario la existencia de la cuenta ("La cuenta está bloqueada temporalmente").

**Attack scenario**
El atacante toma una lista de correos candidatos (empleados de la tienda, direcciones del dominio) y
envía cinco intentos con contraseña arbitraria a cada uno. Los correos que en el sexto intento
responden `423 ACCOUNT_LOCKED` corresponden a cuentas reales; los que siguen respondiendo `401` no
existen. El coste es de seis peticiones por candidato y no requiere adivinar ninguna contraseña. La
lista resultante alimenta directamente SEC-001.

**Potential impact**
Descubrimiento fiable del padrón de correos válidos del sistema, que es el insumo del ataque de
denegación de SEC-001 y de cualquier campaña de phishing dirigida al personal. El daño no es la
enumeración en sí, sino que convierte SEC-001 de "hay que conocer el correo" en "el correo se
averigua".

**Existing mitigation**
Ninguna para esta vía. El `DUMMY_HASH` de `apps/api/src/auth/password.ts:27-28` cierra únicamente el
canal de temporización.

**Recommended remediation**
Es una decisión de spec porque la spec ratifica hoy tanto el 423 con `retryAfter`
(`openspec/specs/auth-sessions/spec.md:50`) como la ausencia de enumeración
(`openspec/specs/auth-sessions/spec.md:40`), y ambas no pueden sostenerse a la vez. La resolución
natural es que la spec elija: devolver `401 INVALID_CREDENTIALS` a un llamador que no ha demostrado
conocer la contraseña, y reservar el `423` con `retryAfter` para el caso en que la contraseña **sí**
era correcta —el único en el que el llamador ya sabía que la cuenta existe, así que no se le revela
nada nuevo—. Eso preserva el mensaje útil de la SPA para el usuario legítimo y lo retira del
atacante. Nótese que esta remediación es compatible con la opción 3 de SEC-001 y conviene decidirlas
juntas.

**Suggested verification**
Un test que ejecute el mismo número de intentos fallidos contra un correo existente y contra uno
inexistente, y afirme que las respuestas resultantes son idénticas en código de estado y en cuerpo.
Hoy no existe (ver SEC-012).

**Required change type**: `SPEC CHANGE`

---

**ID**: SEC-003
**Title**: El rate-limit de login se indexa por la IP del proxy de Vercel, no por la del llamador
**Severity**: MEDIUM
**Confidence**: HIGH
**Category**: Control de límites ineficaz; brecha de disponibilidad; promesa de spec no cumplida en la forma desplegada
**Affected artifact**: Código (API), configuración de despliegue, spec
**Location**: `apps/api/src/app.ts:74-76`, `apps/api/src/app.ts:99-100`,
`apps/api/src/routes/auth.ts:59`, `vercel.json:5-9`, `openspec/specs/auth-sessions/spec.md:52-55`

**Description**
`@fastify/rate-limit` deriva su clave de `request.ip` por defecto. Fastify solo resuelve `request.ip`
a partir de `X-Forwarded-For` cuando la instancia se construye con `trustProxy`, y `buildApp` no lo
hace. Como `vercel.json` reescribe todo `/api/*` al servicio de Render, cada petición del SPA llega a
Fastify con la IP de la infraestructura de Vercel: **todos los usuarios legítimos comparten un único
cubo de diez peticiones por minuto**, mientras que un atacante que golpee la URL de Render
directamente obtiene un cubo propio por cada IP que controle.

**Evidence**
- `apps/api/src/app.ts:74-76` — la instancia se construye con `Fastify({ logger })` y ninguna opción
  `trustProxy`. Una búsqueda sobre todo `apps/api/src` no encuentra `trustProxy` ni ninguna lectura
  de `X-Forwarded-For`.
- `node_modules/.pnpm/@fastify+rate-limit@11.2.0/.../index.js:58` —
  `const defaultKeyGenerator = (req, ipv6Subnet) => normalizeIP(req.ip, ipv6Subnet)`; y la línea 249
  confirma que se usa el generador por defecto cuando la ruta no aporta uno. `apps/api/src/routes/auth.ts:59`
  no aporta ninguno.
- `vercel.json:5-9` — `"source": "/api/:path*"` reescribe a `https://inventienda-api.onrender.com/api/:path*`,
  de modo que Render nunca ve la IP del navegador.
- `render.yaml:1-9` — el servicio queda publicado en su propia URL, alcanzable sin pasar por Vercel.
- `openspec/specs/auth-sessions/spec.md:52-55` — el escenario ratificado se llama "Rate-limited by IP"
  y presupone "the caller's IP". En la forma desplegada, esa propiedad no se cumple.

**Attack scenario**
Dos consecuencias, ambas reales. (a) *Denegación*: un atacante envía diez peticiones a
`/api/auth/login` a través del dominio de Vercel; durante el resto de ese minuto, cualquier empleado
que intente iniciar sesión recibe `429 RATE_LIMITED`, porque comparten la clave del cubo. Repetido,
es un bloqueo del login para toda la tienda que no requiere conocer ningún correo. (b) *Evasión*: un
atacante que apunte a `inventienda-api.onrender.com` en lugar de al dominio de Vercel recibe su
propio cubo de diez por minuto, y con unas pocas IPs de salida multiplica su tasa de intentos.

**Potential impact**
El control que la spec designa como la defensa de tasa del login no protege contra el adversario que
pretende frenar y sí degrada a los usuarios legítimos. Combinado con SEC-001, un atacante dispone de
dos palancas independientes de denegación sobre la autenticación.

**Existing mitigation**
El bloqueo por cuenta (`apps/api/src/usuarios/repository.ts:132-135`) sigue limitando la adivinación
de contraseñas contra una cuenta concreta con independencia de la IP, así que el ataque de fuerza
bruta *vertical* está contenido. Lo que queda descubierto es la disponibilidad y el barrido
horizontal sobre muchas cuentas.

**Recommended remediation**
Configurar `trustProxy` en `buildApp` acotado a los rangos del proxy que realmente está delante, o
bien definir un `keyGenerator` explícito en la ruta de login que lea la cabecera reenviada de forma
deliberada. Cualquiera de las dos exige decidir además qué hacer con el origen de Render expuesto
directamente: aceptar `X-Forwarded-For` sin restringir el origen convierte la cabecera en un valor
que el atacante controla y empeora la situación. La opción robusta es combinar `trustProxy` acotado
con un secreto compartido o una restricción de red entre Vercel y Render, de modo que la URL de
Render deje de ser una puerta alternativa.

**Suggested verification**
Un test que construya la app, inyecte dos peticiones con `X-Forwarded-For` distintos y el mismo
socket, y afirme el comportamiento de conteo que la configuración elegida promete. Hoy
`apps/api/src/routes/auth.test.ts:177` verifica que el límite dispara, pero no sobre qué clave lo
hace.

**Required change type**: `CODE FIX`

**Parcialmente resuelto el 2026-08-30 — mitad de la API, hecha; mitad del despliegue, pendiente.**

Evidencia obtenida, no supuesta:

```
GET  https://inventienda-api.onrender.com/api/health          → 200
POST https://inventienda-api.onrender.com/api/auth/login
     con X-Forwarded-For: 203.0.113.99 forjado                → 401
```

El origen de Render responde directo, sin pasar por Vercel, y procesa una cabecera reenviada que el
llamante inventó. Eso confirma lo que esta misma remediación advertía: **activar `trustProxy` a
secas empeoraría el sistema**, porque convertiría un valor que el atacante controla en la clave del
rate-limit — y tras cerrar SEC-001 ese límite es el único freno que queda contra la adivinación de
contraseñas.

*Hecho* (`apps/api/src/plugins/clientIp.ts`). `trustProxy` queda **apagado**. El rate-limit usa un
`keyGenerator` que toma `X-Forwarded-For` **solo si** la petición trae además el secreto compartido
`PROXY_SHARED_SECRET` en la cabecera `x-inventienda-proxy`, comparado en tiempo constante. En
cualquier otro caso —sin secreto configurado, sin cabecera, con secreto incorrecto, sin
`X-Forwarded-For`— cae a la dirección del socket, que es el comportamiento actual. **El cambio no
puede tirar el sitio**: si el secreto nunca se configura, o Vercel deja de mandarlo, el límite sigue
funcionando como hoy en lugar de rechazar tráfico.

Verificación, la que este informe pedía textualmente: `routes/auth.test.ts` inyecta dos peticiones
con `X-Forwarded-For` distintos sobre el mismo socket y afirma que **caen en un solo balde** (la
segunda recibe `429`); otro test afirma que, con el secreto presentado, cada cliente reenviado
obtiene el suyo. `plugins/clientIp.test.ts` cubre además el secreto incorrecto de la misma longitud.

*Pendiente — decisión y acción del propietario.* Mientras Vercel no presente el secreto, el
`keyGenerator` cae siempre al socket y los usuarios legítimos siguen compartiendo un balde. Cerrarlo
requiere dos pasos que no son código de este repo y **no se hicieron aquí a propósito**: un
`middleware.ts` en Vercel es la única vía para agregar una cabecera de petición (`rewrites` no lo
permite y `headers` es para respuestas), y un archivo con ese nombre en la raíz lo toma el despliegue
automáticamente — mal configurado, `/api/*` deja de rutear. Eso es una caída, no una degradación, y
merece un despliegue que alguien pueda mirar.

Pasos, cuando haya ventana para verificarlos:

1. Generar un secreto (`openssl rand -base64 32`).
2. Cargarlo como `PROXY_SHARED_SECRET` en Render, y como variable de entorno del proyecto en Vercel.
3. Crear `middleware.ts` en la raíz del repo:

```ts
import { rewrite } from '@vercel/edge';

export const config = { matcher: '/api/:path*' };

export default function middleware(request: Request) {
  const url = new URL(request.url);
  return rewrite(
    `https://inventienda-api.onrender.com${url.pathname}${url.search}`,
    {
      headers: {
        'x-inventienda-proxy': process.env.PROXY_SHARED_SECRET ?? '',
      },
    },
  );
}
```

4. Quitar de `vercel.json` el rewrite de `/api/:path*`, que el middleware reemplaza.
5. Verificar tras el despliegue: `/api/health` a través de Vercel sigue en `200`, y una petición
   directa a Render con `X-Forwarded-For` forjado **no** obtiene un balde propio.

Queda además abierto que la URL de Render siga siendo una puerta alternativa para todo lo demás: el
secreto sólo decide a quién se le cree la cabecera, no cierra el origen.

---

**ID**: SEC-004
**Title**: Las rutas que ejecutan argon2 no tienen límite de tasa, en un plan con 512 MB de memoria
**Severity**: MEDIUM
**Confidence**: MEDIUM
**Category**: Agotamiento de recursos; ausencia de un control que este sistema necesita
**Affected artifact**: Código (API)
**Location**: `apps/api/src/app.ts:97-100`, `apps/api/src/routes/auth.ts:125-139`,
`apps/api/src/auth/password.ts:4-9`, `apps/api/src/auth/service.ts:127-135`,
`apps/api/src/routes/health.ts:14-24`, `render.yaml:4-5`

**Description**
El rate-limit está registrado con `global: false` y solo `POST /api/auth/login` lo activa. Sin
embargo, otras tres rutas ejecutan argon2id con `memoryCost: 19456` (19 MiB por operación) y no
tienen límite alguno. `POST /api/auth/password` es la peor: ejecuta **dos** operaciones argon2 por
petición (un verify y un hash) y está abierta a cualquier sesión autenticada, incluida la de un
usuario `deposito` sin privilegios.

**Evidence**
- `apps/api/src/app.ts:97-99` — `await app.register(rateLimit, { global: false })`, con el comentario
  que confirma que solo el login opta por él.
- `apps/api/src/routes/auth.ts:125-139` — el bloque `config` de `POST /auth/password` declara
  `allowPasswordChangePending` y ningún `rateLimit`.
- `apps/api/src/auth/service.ts:127-135` — `verifyPassword` seguido de `hashPassword`, ambos fuera de
  la transacción y ambos con el coste completo.
- `apps/api/src/auth/password.ts:4-9` — `memoryCost: 19456` (19 MiB), `parallelism: 1`.
- `apps/api/src/usuarios/service.ts:138-139` y `apps/api/src/usuarios/service.ts:281-282` —
  `POST /api/usuarios` y `POST /api/usuarios/:id/password-reset` ejecutan cada una un `hashPassword`
  sin límite de tasa; requieren rol `encargado`, así que su exposición es menor.
- `apps/api/src/routes/health.ts:16,24` — `/api/health` es público (`auth: false`), sin límite de
  tasa, y ejecuta una consulta contra Postgres en cada llamada.
- `render.yaml:4-5` — `plan: free`, cuyo contenedor dispone de 512 MB de memoria.

**Attack scenario**
Un empleado con rol `deposito` —o cualquiera que haya obtenido una sesión suya— lanza peticiones
concurrentes a `POST /api/auth/password` con una contraseña actual incorrecta. Cada una reserva
19 MiB durante el verify. Unas pocas decenas de peticiones simultáneas agotan la memoria del
contenedor de Render y el proceso muere; el reinicio en el plan gratuito arrastra además el arranque
en frío de ~50 segundos que documenta `CLAUDE.md`. En paralelo, `/api/health` sin límite permite a un
anónimo forzar consultas contra Neon, que también autosuspende.

**Potential impact**
Caída del servicio provocada desde dentro por el rol menos privilegiado, o desde fuera de forma
anónima. No hay pérdida de confidencialidad ni de integridad; el impacto es exclusivamente de
disponibilidad, y es lo que justifica MEDIUM y no HIGH.

**Existing mitigation**
Fastify limita el cuerpo de la petición a 1 MiB por defecto, lo que acota el tamaño de la entrada
pero no el coste de argon2, que depende de sus parámetros y no de la longitud del texto. El plugin de
rate-limit ya está registrado, de modo que activarlo en estas rutas es una línea de `config` por
ruta.

**Recommended remediation**
Añadir `config.rateLimit` a `POST /api/auth/password` (indexado por la sesión o el usuario, no por la
IP, dado SEC-003), a `POST /api/usuarios` y a `POST /api/usuarios/:id/password-reset`, y un límite
generoso a `/api/health` que no interfiera con el `healthCheckPath` de Render
(`render.yaml:10`). Considerar además un límite global de peticiones concurrentes que ejecuten
argon2, que es el recurso realmente escaso.

**Suggested verification**
Un test por ruta que afirme el `429 RATE_LIMITED` al superar el umbral, siguiendo el patrón que ya
usa `apps/api/src/routes/auth.test.ts:177` con `rateLimitMax` sobreescrito a 1.

**Required change type**: `CODE FIX`

---

**ID**: SEC-005
**Title**: Ni la SPA ni la API emiten cabeceras de seguridad HTTP
**Severity**: MEDIUM
**Confidence**: HIGH
**Category**: Configuración insegura; ausencia de defensa en profundidad frente a XSS y clickjacking
**Affected artifact**: Configuración de despliegue, código (API)
**Location**: `vercel.json:1-15`, `apps/api/package.json:17-29`, `apps/api/src/app.ts:71-108`,
`apps/web/index.html:1-12`

**Description**
`vercel.json` no declara ningún bloque `headers`, y la API no registra `@fastify/helmet` ni establece
cabecera de seguridad alguna. En consecuencia, ni el documento de la SPA ni las respuestas de la API
llevan `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options` ni
`Referrer-Policy`.

**Evidence**
- `vercel.json:1-15` — el archivo contiene únicamente `installCommand`, `buildCommand`,
  `outputDirectory` y `rewrites`. No hay clave `headers`.
- `apps/api/package.json:17-29` — las dependencias son `@fastify/cookie`, `@fastify/rate-limit`,
  `@fastify/swagger`, `argon2`, `dotenv`, `drizzle-orm`, `fastify`, `fastify-plugin`,
  `fastify-type-provider-zod`, `pg` y `zod`. No figura `@fastify/helmet`.
- `apps/api/src/app.ts:81-108` — la secuencia de registro de plugins no incluye ninguno de cabeceras
  ni ningún hook `onSend` que las añada.
- `apps/web/index.html:3-7` — el `<head>` no lleva ninguna `<meta http-equiv>` que supla la ausencia.

**Attack scenario**
Sin `frame-ancestors`, un atacante embebe `https://dmc-proyecto.vercel.app` en un iframe transparente
sobre su propia página y superpone un señuelo. Como la cookie es `SameSite=Lax` y el iframe navega a
un documento del propio sitio con la sesión activa, el encargado autenticado que hace clic en el
señuelo dispara en realidad el botón de desactivar usuario o el de restablecer contraseña de la
pantalla de usuarios. La confirmación es un `POST` que la propia SPA emite desde su origen, así que
ni `SameSite` ni la ausencia de CORS lo impiden. De forma independiente, la ausencia de CSP significa
que cualquier XSS futuro —hoy no hay ninguno— tendría exfiltración libre.

**Potential impact**
Ejecución de operaciones administrativas destructivas (baja de usuario, reset de credencial) sin
consentimiento real del encargado, mediante redirección de interfaz. Y ausencia total de la segunda
línea de defensa que contiene el daño de un XSS.

**Existing mitigation**
Ninguna cabecera. Mitiga parcialmente el hecho de que no existan sinks de XSS en el código actual y
de que React escape por defecto, pero eso protege contra el vector, no contra la ausencia del
control. El clickjacking no está mitigado en absoluto.

**Recommended remediation**
Añadir un bloque `headers` en `vercel.json` para el documento de la SPA con, como mínimo,
`Content-Security-Policy` (incluyendo `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff` y
`Referrer-Policy: same-origin`. En la API, registrar `@fastify/helmet` en `buildApp` antes de las
rutas. La CSP puede ser estricta sin fricción: la SPA no carga scripts de terceros y la única fuente
externa es `@fontsource/public-sans`, que Vite empaqueta localmente.

**Suggested verification**
Un test sobre `buildApp` que afirme la presencia de las cabeceras en una respuesta cualquiera, y una
verificación manual de las cabeceras del documento servido por Vercel tras el despliegue.

**Required change type**: `CODE FIX`

---

**ID**: SEC-006
**Title**: Las respuestas autenticadas no declaran `Cache-Control`, salvo las dos que devuelven una credencial
**Severity**: MEDIUM
**Confidence**: MEDIUM
**Category**: Exposición de datos sensibles a través de una caché intermedia
**Affected artifact**: Código (API)
**Location**: `apps/api/src/routes/auth.ts:101-123`, `apps/api/src/routes/usuarios.ts:120-161`,
`apps/api/src/routes/proveedores.ts:90-131`, `vercel.json:5-9`, `apps/api/src/routes/usuarios.ts:187,214`

**Description**
El código demuestra conocer el problema: las dos rutas que devuelven una contraseña temporal fijan
`Cache-Control: no-store` de forma explícita. Ninguna otra respuesta lo hace. `GET /api/auth/me`
devuelve la identidad del llamador y `GET /api/usuarios` el directorio completo de usuarios con sus
correos y roles, ambas sin ninguna directiva de caché, y ambas atravesando el reescritor de Vercel
antes de llegar al navegador.

**Evidence**
- `apps/api/src/routes/usuarios.ts:187` y `apps/api/src/routes/usuarios.ts:214` —
  `reply.header('Cache-Control', 'no-store')` en las rutas de creación y de reset, con el comentario
  de `apps/api/src/routes/usuarios.ts:185-186` que nombra explícitamente al proxy y a la CDN como
  destinatarios de la prohibición.
- `apps/api/src/routes/auth.ts:101-123` — el handler de `GET /auth/me` devuelve el DTO del usuario sin
  fijar ninguna cabecera.
- `apps/api/src/routes/usuarios.ts:120-138` — `GET /usuarios` devuelve el sobre paginado sin fijar
  ninguna cabecera.
- Una búsqueda de `Cache-Control` en todo `apps/api/src` produce exactamente esas dos apariciones, y
  ambas en el mismo archivo.
- `vercel.json:5-9` — todas las respuestas de la API pasan por el reescritor de Vercel.
- `apps/api/src/app.ts:71-108` — no hay hook `onSend` global que supla la ausencia por defecto.

**Attack scenario**
Si el proxy de Vercel —o cualquier caché compartida en el camino: un proxy corporativo, un caché de
navegador compartido en un dispositivo de mostrador— almacena heurísticamente una respuesta `200` de
`GET` sin directivas de caché, la identidad de un usuario o el directorio completo puede servirse a
un segundo usuario. En un contexto de tienda con dispositivos compartidos
(`docs/PRD.md:140` contempla el uso desde móvil), el escenario más plausible es el caché del propio
navegador sirviendo `/api/auth/me` del turno anterior tras un cambio de usuario.

**Potential impact**
Divulgación de identidad y del padrón de usuarios entre sesiones distintas. No permite actuar en
nombre de otro —la cookie sigue siendo la autoridad— pero sí revela datos que la SPA usa para decidir
qué mostrar, y alimenta la enumeración de SEC-002.

**Existing mitigation**
Vercel no cachea por defecto las respuestas de una reescritura hacia un destino externo, y los
navegadores aplican heurísticas conservadoras sobre respuestas sin `Cache-Control` que llevan cookies
de sesión. Por eso el `Confidence` es MEDIUM y no HIGH: **no se verificó el comportamiento real del
proxy desplegado**, que es exactamente la información que falta para elevar la confianza. La
remediación es barata, así que la incertidumbre no justifica postergarla.

**Recommended remediation**
Añadir un hook `onSend` en `buildApp` que fije `Cache-Control: no-store` en toda respuesta de una
ruta que no declare `auth: false`, dejando `/api/health` fuera. Es una regla por defecto que hace
innecesarias —aunque compatibles— las dos cabeceras explícitas actuales.

**Suggested verification**
Un test que recorra las rutas autenticadas y afirme la cabecera en cada respuesta, y una
comprobación de las cabeceras reales que devuelve el dominio de Vercel para `/api/auth/me` tras
desplegar.

**Required change type**: `CODE FIX`

---

**ID**: SEC-007
**Title**: El atributo `Secure` de la cookie de sesión depende de una única variable de entorno y falla en abierto
**Severity**: MEDIUM
**Confidence**: MEDIUM
**Category**: Modo de fallo inseguro (fail-open); configuración por defecto permisiva
**Affected artifact**: Código (API), configuración de despliegue
**Location**: `apps/api/src/auth/session.ts:23`, `apps/api/src/plugins/cookie.ts:5-7`,
`apps/api/src/plugins/cookie.ts:24-30`, `render.yaml:18-19`

**Description**
Dos controles de seguridad —el atributo `Secure` de la cookie y el rechazo del secreto de firma de
desarrollo— cuelgan ambos de la comparación `process.env.NODE_ENV === 'production'`. Si esa variable
falta, se escribe mal o el servicio se despliega en una plataforma que no la fija, ambos controles se
desactivan a la vez y en silencio: la cookie de sesión viaja sin `Secure` y el sistema queda
dispuesto a firmar sesiones con un secreto que está publicado en el repositorio. El diseño falla en
abierto donde debería fallar en cerrado.

**Evidence**
- `apps/api/src/auth/session.ts:23` — `secure: process.env.NODE_ENV === 'production'`. El valor por
  defecto ante cualquier otra cadena, incluida `undefined`, es `false`.
- `apps/api/src/plugins/cookie.ts:5-7` — `DEV_FALLBACK_SECRET` es una constante versionada y por tanto
  de conocimiento público para cualquiera que vea el repositorio.
- `apps/api/src/plugins/cookie.ts:24-30` — el `throw` que impide usar ese fallback está condicionado a
  la misma comparación; con `NODE_ENV` ausente, `resolveCookieSecret` devuelve la constante pública.
- `render.yaml:18-19` — `NODE_ENV: production` está fijado en el manifiesto, que es lo que hoy hace
  que ambos controles funcionen. Es la única cosa que los sostiene.

**Attack scenario**
Un cambio en el manifiesto de Render, un despliegue manual desde la consola, una migración a otra
plataforma o una prueba de staging que olvide la variable bastan para que el servicio arranque
sirviendo cookies sin `Secure`. Un atacante en la misma red que consiga degradar una conexión a HTTP
—o simplemente inducir una petición a `http://` hacia el origen— captura la cookie de sesión en
claro y obtiene la sesión completa por hasta doce horas.

**Potential impact**
Robo de sesión con los privilegios completos del usuario afectado. Si ese usuario es el `encargado`,
implica control total sobre la gestión de usuarios y proveedores.

**Existing mitigation**
Real y sustancial, que es lo que mantiene esto en MEDIUM. `render.yaml:18-19` fija la variable, y
`apps/api/src/lib/env.ts:10` exige `COOKIE_SECRET` con al menos 32 caracteres en el arranque de
`server.ts` con independencia de `NODE_ENV`, de modo que el fallback público de `cookie.ts` es
inalcanzable por la vía normal de arranque. El `Confidence` es MEDIUM porque el riesgo depende
enteramente de una desviación de configuración futura, no de un defecto observable hoy en producción.
Nótese que el dominio `.vercel.app` pertenece a un TLD con HSTS precargado en los navegadores, lo que
mitiga el vector para el origen de la SPA pero no para el origen de Render en `.onrender.com`.

**Recommended remediation**
Invertir el valor por defecto: que `secure` sea `true` salvo que una variable explícita del tipo
`ALLOW_INSECURE_COOKIES=true` lo desactive, de modo que el modo inseguro requiera una acción
deliberada y quede registrado. En paralelo, mover la resolución del secreto a `lib/env.ts` o replicar
allí la validación de longitud mínima, para que no exista ninguna ruta de construcción de la app en
la que el fallback público sea alcanzable.

**Suggested verification**
Un test que construya la app sin `NODE_ENV` definido y afirme que la cookie emitida lleva `Secure`, y
otro que afirme que `resolveCookieSecret` lanza cuando no hay `COOKIE_SECRET`, sea cual sea el
`NODE_ENV`.

**Required change type**: `CODE FIX`

---

### LOW

---

**ID**: SEC-008
**Title**: Los tokens de sesión se almacenan en claro y son directamente reutilizables desde la base de datos
**Severity**: LOW
**Confidence**: HIGH
**Category**: Manejo inseguro de tokens; dato sensible sin protección en reposo
**Affected artifact**: Esquema de base de datos, ADR
**Location**: `apps/api/src/db/schema.ts:68-84`, `apps/api/src/auth/session.ts:4-12`,
`apps/api/src/auth/service.ts:80-85`, `docs/adrs/0007-sesion-cookie-rbac-propio.md:11-14`

**Description**
El valor de la cookie **es** la clave primaria de la fila de sesión, guardada tal cual. Cualquiera que
obtenga lectura sobre la tabla `sesiones` obtiene tokens portadores vivos y puede usarlos
inmediatamente: no hay un paso de derivación que separe "lo que el cliente presenta" de "lo que la
base almacena". Es la diferencia entre una fuga de base de datos que expone metadatos de sesión y una
que entrega las sesiones mismas.

**Evidence**
- `apps/api/src/db/schema.ts:71` — `id: text('id').primaryKey()`, sin transformación.
- `apps/api/src/auth/session.ts:4-5` — el comentario lo declara: "The session cookie value IS the
  sesiones.id primary key".
- `apps/api/src/auth/service.ts:80-85` — el token generado se inserta como `id` y se devuelve al
  llamador sin más.
- `apps/api/src/routes/auth.ts:73` — ese mismo valor se fija en la cookie.
- `docs/adrs/0007-sesion-cookie-rbac-propio.md:11-14` — el ADR ratifica la decisión de forma
  explícita, con su justificación: "no hay un segundo secreto de sesión que mantener sincronizado con
  la fila".

**Attack scenario**
Una fuga de `DATABASE_URL`, un respaldo de Neon mal custodiado, un acceso indebido a la consola de
Neon o una futura inyección SQL en una capacidad todavía no escrita entregan al atacante la columna
`sesiones.id`. Cada valor es una sesión utilizable durante lo que reste de sus doce horas, sin
necesidad de contraseña y sin disparar el bloqueo por intentos fallidos.

**Potential impact**
Escalada de una lectura de base de datos a suplantación completa de todos los usuarios con sesión
activa. Acota el daño la ventana de doce horas
(`apps/api/src/auth/session.ts:8`) y el hecho de que el cifrado en reposo de Neon reduce la
exposición del respaldo. La severidad es LOW porque exige un compromiso previo que ya sería grave por
sí mismo; el hallazgo es de defensa en profundidad.

**Existing mitigation**
El token se firma con `COOKIE_SECRET` (`apps/api/src/auth/session.ts:22`), lo que impide falsificar
una cookie sin el secreto — pero **no** ayuda aquí, porque quien roba el `id` de la base todavía
necesitaría la firma, salvo que también disponga del secreto del servicio. La firma sí eleva el
listón: el atacante necesita base **y** secreto. Eso, junto con la ventana de 12 h, es lo que
mantiene el hallazgo en LOW.

**Recommended remediation**
Es una decisión de ADR porque `docs/adrs/0007-sesion-cookie-rbac-propio.md:11-14` ratificó
expresamente lo contrario. La alternativa estándar es almacenar `sha256(token)` como clave primaria y
enviar el token en claro solo en la cookie: `findValid` pasa a hashear el valor recibido antes de
buscar, el coste es despreciable frente a argon2, y una lectura de la base deja de rendir
credenciales utilizables. El argumento del ADR ("no hay un segundo secreto que sincronizar") se
conserva íntegro, porque un hash no es un secreto.

**Suggested verification**
Un test de integración que, tras un login, afirme que el valor almacenado en `sesiones.id` **no**
coincide con el valor de la cookie emitida, y que la sesión sigue resolviendo correctamente.

**Required change type**: `DESIGN / ADR CHANGE`

---

**ID**: SEC-009
**Title**: La protección CSRF descansa por completo en `SameSite=Lax`, sin verificación de origen
**Severity**: LOW
**Confidence**: HIGH
**Category**: Control de seguridad de una sola capa; el propio diseño declara la mitigación como parcial
**Affected artifact**: Código (API), documento de diseño
**Location**: `apps/api/src/auth/session.ts:17-25`, `apps/api/src/routes/auth.ts:78-99`,
`docs/TECH-DESIGNv2.md:376-379`

**Description**
No existe token anti-CSRF ni comprobación de las cabeceras `Origin` o `Sec-Fetch-Site` en ninguna
parte del código. La única defensa es el atributo `SameSite=Lax` de la cookie. El documento de diseño
lo reconoce y lo califica de mitigación parcial, y cierra el párrafo con "Revisar checklist de
seguridad antes de producción" — una revisión que, con el sistema ya desplegado y en vivo, no consta
realizada.

**Evidence**
- `apps/api/src/auth/session.ts:19-20` — `sameSite: 'lax'` es la totalidad del control.
- Una búsqueda de `csrf`, `Origin` y `Sec-Fetch` sobre `apps/api/src` no produce ninguna
  coincidencia.
- `docs/TECH-DESIGNv2.md:377-379` — "protección CSRF (mitigada **en gran parte** con `SameSite=Lax`
  desde v1 — S10) ... Revisar checklist de seguridad antes de producción".
- `apps/api/src/routes/auth.ts:79-81` — `POST /auth/logout` declara `config: { auth: false }` y
  resuelve la cookie por su cuenta, de modo que es la ruta con estado más expuesta del sistema.

**Attack scenario**
`SameSite=Lax` cubre correctamente el caso principal: el navegador no adjunta la cookie a un `POST`
originado en otro sitio, y la API no tiene ninguna operación con estado accesible por `GET`, así que
el hueco clásico de Lax no aplica. El riesgo residual es real pero acotado: navegadores antiguos que
no aplican Lax por defecto, y un cierre de sesión forzado contra `POST /auth/logout` como molestia.
Es esta contención la que justifica LOW y no MEDIUM.

**Potential impact**
Bajo con los navegadores actuales. El valor de remediarlo es de defensa en profundidad: hoy un único
atributo de cookie separa al sistema de una CSRF completa sobre operaciones administrativas
destructivas, y nada avisaría si un cambio futuro lo debilitara.

**Existing mitigation**
`SameSite=Lax`, efectivo en los navegadores modernos. La ausencia de CORS permisivo refuerza el
cuadro para las lecturas.

**Recommended remediation**
Añadir una comprobación de `Origin`/`Sec-Fetch-Site` en un hook `preHandler` para todos los métodos
con estado, rechazando lo que no provenga del origen esperado. Es una segunda capa barata que no
requiere gestionar tokens. Y dar por cumplido —o registrar formalmente como pendiente— el "checklist
de seguridad antes de producción" que `docs/TECH-DESIGNv2.md:379` dejó abierto; este informe puede
servir de insumo.

**Suggested verification**
Un test que envíe un `POST` con `Origin` ajeno y una cookie válida, y afirme el rechazo.

**Required change type**: `CODE FIX`

---

**ID**: SEC-010
**Title**: `.gitignore` solo cubre dos de los nombres de archivo de entorno que las herramientas del stack generan
**Severity**: LOW
**Confidence**: HIGH
**Category**: Riesgo de secretos versionados por omisión de configuración
**Affected artifact**: Configuración del repositorio
**Location**: `.gitignore:10-12`

**Description**
La sección de entorno de `.gitignore` lista exactamente `.env` y `.env.local`. Vite —que este proyecto
usa— resuelve además `.env.production`, `.env.development`, `.env.[mode].local` y `.env.test`, y
ninguno de esos nombres está ignorado. Hoy no hay ningún secreto versionado; el hallazgo es
preventivo.

**Evidence**
- `.gitignore:10-12` — el bloque completo es `# Environment`, `.env`, `.env.local`.
- `git ls-files` confirma que el único archivo con ese prefijo actualmente en el índice es
  `.env.example`, de modo que **ningún secreto está hoy comprometido**.
- `apps/web/package.json:34` — el proyecto usa Vite, cuya resolución por modo genera los nombres no
  cubiertos.
- `apps/api/src/lib/env.ts:1` — el API carga `dotenv/config`, que consume `.env` en la raíz del
  paquete: `apps/api/.env` sí queda cubierto por el patrón sin barra inicial.

**Attack scenario**
Alguien crea `apps/web/.env.production` con la URL de la API y cualquier valor sensible que se añada
en el futuro, o `apps/api/.env.production` con el `DATABASE_URL` de Neon, y `git add .` lo incorpora
sin resistencia. El repositorio termina con credenciales de producción en su historial, del que
retirarlas exige reescritura y rotación.

**Potential impact**
Exposición de credenciales de producción en el historial de Git. La probabilidad es la que la
convierte en LOW: exige que alguien cree uno de esos archivos, algo que hoy no ha ocurrido.

**Existing mitigation**
La regla de permisos del agente que deniega tocar cualquier `.env*` (`CLAUDE.md`, sección "Never touch
`.env*`") reduce el riesgo de que un agente lo provoque, pero no cubre a una persona trabajando en el
repositorio.

**Recommended remediation**
Sustituir las dos líneas por un patrón que cubra la familia completa con una excepción explícita para
el ejemplo, en el estilo `.env*` seguido de una negación para `!.env.example`.

**Suggested verification**
Comprobar con `git check-ignore` que `apps/api/.env.production` y `apps/web/.env.production` quedan
ignorados y que `.env.example` sigue siendo rastreable.

**Required change type**: `PROCESS / HARNESS CHANGE`

---

**ID**: SEC-011
**Title**: El pipeline de CI no tiene puerta de vulnerabilidades de dependencias ni actualización automatizada
**Severity**: LOW
**Confidence**: HIGH
**Category**: Riesgo de cadena de suministro
**Affected artifact**: CI/CD
**Location**: `.github/workflows/ci.yml:30-62`

**Description**
El workflow ejecuta lint, verificación del contrato, typecheck, migraciones, tests unitarios y tests
de integración —una puerta de calidad sólida— pero ningún paso examina las dependencias en busca de
vulnerabilidades conocidas. Tampoco hay configuración de Dependabot ni de Renovate en el repositorio.
Hoy el árbol está limpio, así que esto es una brecha de proceso y no un defecto presente.

**Evidence**
- `.github/workflows/ci.yml:46-62` — los seis pasos posteriores al checkout y la instalación son
  `Lint`, `Check generated contract is up to date`, `Typecheck`, `Run database migrations`,
  `Unit tests` e `Integration tests`. No hay `pnpm audit` ni equivalente.
- `git ls-files` muestra que el único archivo bajo `.github/` es `workflows/ci.yml`: no existe
  `.github/dependabot.yml`.
- `pnpm audit --prod` ejecutado durante este pase devuelve "No known vulnerabilities found", lo que
  confirma que la brecha es de detección futura y no de exposición actual.

**Attack scenario**
Una vulnerabilidad se publica en `fastify`, `argon2`, `pg` o cualquier transitiva. Nada en el flujo de
trabajo la señala: el equipo se entera cuando alguien lo mira a mano. Con `pnpm-lock.yaml` fijando
versiones, el árbol permanece en la versión vulnerable indefinidamente.

**Potential impact**
Ventana de exposición prolongada y desconocida ante vulnerabilidades publicadas en la superficie de
dependencias de una API que maneja autenticación.

**Existing mitigation**
`pnpm install --frozen-lockfile` en CI y en ambos manifiestos de despliegue garantiza builds
reproducibles y descarta la sustitución silenciosa de una dependencia — un control real, pero de
integridad, no de detección.

**Recommended remediation**
Añadir un paso `pnpm audit --prod --audit-level high` al workflow, y habilitar Dependabot o Renovate
para actualizaciones de seguridad. Decidir de forma explícita si el paso rompe el build o solo avisa;
para un proyecto de este tamaño, romper ante severidad alta es sostenible.

**Suggested verification**
El propio paso de CI es la verificación.

**Required change type**: `PROCESS / HARNESS CHANGE`

---

**ID**: SEC-012
**Title**: El rastro de auditoría retiene datos personales de forma indefinida y hace estructuralmente imposible borrar un usuario
**Severity**: LOW
**Confidence**: HIGH
**Category**: Brecha de privacidad; operación irreversible sin salvaguarda declarada
**Affected artifact**: Esquema de base de datos, requisitos de producto
**Location**: `apps/api/src/db/schema.ts:113-115`, `apps/api/src/auditoria/fields.ts:20-34`,
`apps/api/src/usuarios/service.ts:215-222`, `openspec/specs/record-audit-trail/spec.md:7`

**Description**
Dos propiedades combinadas producen un efecto que ningún documento del proyecto declara. Primera: las
instantáneas de auditoría almacenan el correo del usuario en JSONB, sin política de retención ni ruta
de purga en ninguna parte del código. Segunda: la columna del actor lleva una clave foránea con
`onDelete: 'restrict'`, de modo que en cuanto un usuario ha realizado **una** operación auditada su
fila ya no puede eliminarse de la base. El sistema solo ofrece baja lógica; el borrado real es
inalcanzable por diseño, y esa consecuencia no está escrita en ninguna spec ni ADR.

**Evidence**
- `apps/api/src/db/schema.ts:113-115` — `usuarioId ... .references(() => usuarios.id, { onDelete: 'restrict' })`.
- `apps/api/src/auditoria/fields.ts:23-32` — `email` figura entre los `auditableFields` de `usuarios`,
  y `excludedFields` contiene únicamente `hashContrasena` (`apps/api/src/auditoria/fields.ts:33`).
- `apps/api/src/usuarios/service.ts:215-222` — cada actualización escribe el diff en `datosPrevios` y
  `datosPosteriores`; un cambio de correo deja ambos valores registrados de forma permanente.
- `apps/api/src/auditoria/repository.ts:13-15` — el puerto expone únicamente `record`: no hay
  operación de borrado ni de purga en toda la capa.
- `openspec/specs/record-audit-trail/spec.md:7` — la capacidad se justifica por "non-repudiation",
  objetivo legítimo que sin embargo no aborda la retención.

**Attack scenario**
No es un escenario de atacante sino de cumplimiento y de superficie de datos. Ante una solicitud de
supresión de datos de un empleado que ya no trabaja en la tienda, el sistema no puede satisfacerla:
la baja lógica conserva la fila y la clave foránea impide el borrado. En paralelo, el volumen de
datos personales retenidos crece de forma monótona y sin límite, ampliando el daño de cualquier fuga
futura de la base.

**Potential impact**
Imposibilidad de cumplir una solicitud de supresión y acumulación indefinida de datos personales. El
impacto directo de seguridad es bajo —un contexto de tienda pequeña con pocos usuarios— y por eso el
hallazgo es LOW; su relevancia es de gobierno del dato y conviene decidirla antes de que el volumen
crezca.

**Existing mitigation**
El hash de contraseña está excluido de ambas instantáneas
(`apps/api/src/auditoria/fields.ts:33`), y `apps/api/src/auditoria/service.ts:49-58` aplica la
denylist en tiempo de ejecución. Es decir, el dato más sensible sí está protegido; lo que falta es la
política sobre el resto.

**Recommended remediation**
Requiere una decisión de producto sobre dos preguntas que hoy nadie ha respondido: cuánto tiempo debe
conservarse el rastro, y qué debe ocurrir cuando se solicite la supresión de un usuario. Opciones
razonables: una ventana de retención con purga programada; o seudonimizar el correo en las
instantáneas conservando el `entidad_id`, que ya es un UUID sin significado y basta para el objetivo
de no repudio que la spec persigue.

**Suggested verification**
Una vez decidida la política, un test de integración que afirme que las filas de auditoría anteriores
al horizonte de retención dejan de contener datos personales.

**Required change type**: `PRODUCT / REQUIREMENT CHANGE`

---

### INFO

---

**ID**: SEC-013
**Title**: El requisito de "no enumeración de usuarios" no tiene ningún test que compare las dos respuestas que debe igualar
**Severity**: INFO
**Confidence**: HIGH
**Category**: Invariante de seguridad especificada pero sin cobertura
**Affected artifact**: Tests
**Location**: `apps/api/src/routes/auth.test.ts:120`, `apps/api/src/routes/auth.test.ts:154`,
`apps/api/src/auth/service.test.ts:95`, `openspec/specs/auth-sessions/spec.md:40`

**Description**
La suite es notablemente completa en autorización, y esta ausencia concreta es lo que dejó pasar
SEC-002. Existe un test para la respuesta ante un correo desconocido y otro para la respuesta ante una
cuenta bloqueada, pero ninguno que las **compare** entre sí, que es exactamente la forma que tiene la
propiedad "no user enumeration". Cada test está verde por separado, y el hueco vive justo entre los
dos.

**Evidence**
- `apps/api/src/routes/auth.test.ts:120` — "returns 401 INVALID_CREDENTIALS for an unknown email (same
  shape as wrong password)": compara correo desconocido contra contraseña incorrecta.
- `apps/api/src/routes/auth.test.ts:154` — "returns 423 ACCOUNT_LOCKED with details.retryAfter for a
  locked account": afirma el 423 de forma aislada, sin contrastarlo con la respuesta para un correo
  inexistente sometido al mismo número de intentos.
- `apps/api/src/auth/service.test.ts:95` — cubre únicamente la dimensión de temporización, mediante el
  hash señuelo.
- `openspec/specs/auth-sessions/spec.md:40` — el requisito que debería estar cubierto.

**Attack scenario**
No aplica directamente; este hallazgo describe por qué SEC-002 pasó desapercibido y qué hace falta
para que una regresión futura no vuelva a hacerlo.

**Potential impact**
Un requisito de seguridad explícito de la spec puede incumplirse sin que la CI lo detecte, como
efectivamente ocurre hoy.

**Existing mitigation**
La cobertura de autorización es en general excelente —once tests dedicados al plugin de RBAC en
`apps/api/src/plugins/auth.test.ts:49-213`, más pruebas de rol por ruta en las suites de `usuarios` y
`proveedores`—, lo que hace que esta omisión concreta destaque más de lo que sería habitual.

**Recommended remediation**
Añadir un test que ejecute la misma secuencia de intentos fallidos contra un correo existente y contra
uno inexistente y afirme que ambas respuestas son idénticas en estado y cuerpo. Debe escribirse
después de resolver SEC-002, porque su resultado esperado depende de la política que la spec elija.
Conviene aplicar la disciplina que `CLAUDE.md` ya exige — mutar la implementación para ver el test en
rojo — porque un test de indistinguibilidad es fácil de escribir de forma que nunca pueda fallar.

**Required change type**: `TEST FIX`

---

## Prioridad

El orden de severidad y el orden de atención no coinciden, porque hay dependencias entre hallazgos.

1. **SEC-002** (MEDIUM) antes que **SEC-001** (HIGH). Es contraintuitivo pero correcto: SEC-002 es lo
   que convierte a SEC-001 de "hay que conocer el correo del encargado" en "el correo se averigua con
   seis peticiones". Además, ambos se resuelven en el mismo punto del código —el orden de
   comprobaciones en `login`— y la opción 3 de SEC-001 depende de haber decidido primero qué responde
   una cuenta bloqueada. Decidirlos juntos y aplicarlos en un solo cambio.
2. **SEC-001** (HIGH). Requiere decisión del propietario sobre el ADR-0007 antes de tocar código.
   Mientras esa decisión se toma, una mitigación operativa inmediata y sin código: mantener **un
   segundo `encargado` activo** con un correo que no se publique, de modo que el bloqueo de uno no
   deje al sistema sin administración.
3. **SEC-013** (INFO), inmediatamente después de 1 y 2. Es el test que fija lo que se acaba de
   decidir; escrito antes, no tendría un resultado esperado.
4. **SEC-003** (MEDIUM) y **SEC-004** (MEDIUM), en ese orden. SEC-003 primero porque define **sobre
   qué clave** debe indexarse un límite de tasa; añadir los límites de SEC-004 antes significaría
   añadirlos sobre una clave que se sabe equivocada. Ambos afectan a la disponibilidad del login, que
   es lo que SEC-001 ya compromete por otra vía.
5. **SEC-005** (MEDIUM) y **SEC-007** (MEDIUM). Independientes entre sí y del resto; son cambios
   pequeños y acotados que pueden ir en cualquier momento. SEC-005 tiene el beneficio adicional de
   ser la única defensa preparada de antemano contra un XSS futuro.
6. **SEC-006** (MEDIUM). Barato de aplicar; conviene además verificar el comportamiento real del
   proxy de Vercel al desplegarlo, ya que es la información que hoy falta para cerrar su `Confidence`.
7. **SEC-009**, **SEC-010**, **SEC-011** (LOW). Endurecimiento y proceso. SEC-010 y SEC-011 son cada
   uno un cambio de pocas líneas y pueden entrar de inmediato con cualquier otro trabajo.
8. **SEC-008** y **SEC-012** (LOW). Requieren decisión de arquitectura y de producto respectivamente,
   sin urgencia. **SEC-012 conviene decidirlo antes de que el volumen del rastro crezca**, porque la
   seudonimización retroactiva de un historial grande es bastante más costosa que fijar la política
   ahora.

## Gobernanza / Decisión requerida

Los siguientes hallazgos **no podían resolverse sin una decisión humana**. Este pase no tenía
autoridad para cambiar arquitectura, ADRs, alcance de producto ni para aceptar un riesgo en nombre
del propietario, así que quedaron abiertos de forma deliberada.

> **Cerrados el 2026-08-29 por el propietario.** Las tres decisiones están tomadas y registradas en
> los documentos que las gobiernan; abajo se conserva el planteo original de cada una, seguido de la
> resolución. La **implementación** de SEC-001 y SEC-008 es trabajo pendiente, anotado en
> `docs/BACKLOG.md`: la decisión está cerrada, el código todavía no.

- **SEC-001 — `DESIGN / ADR CHANGE`.** `docs/adrs/0007-sesion-cookie-rbac-propio.md:52-53` dejó
  explícitamente abierta la elección entre bloqueo "por usuario y/o IP", y la implementación tomó solo
  una de las dos ramas. Cerrar el hueco exige elegir entre cuatro políticas de bloqueo con
  compensaciones reales y distintas entre sí —seguridad frente a adivinación contra disponibilidad de
  la cuenta administrativa—, y esa elección pertenece al ADR, no a un informe de seguridad. Además,
  la mitigación operativa propuesta (mantener un segundo `encargado` activo) es una decisión de
  operación de la tienda.
- **SEC-008 — `DESIGN / ADR CHANGE`.** `docs/adrs/0007-sesion-cookie-rbac-propio.md:11-14` ratificó de
  forma expresa que el `id` de la fila de sesión sea el valor que viaja en la cookie, con una
  justificación explícita. Cambiarlo por un hash almacenado es revertir una decisión ratificada y
  requiere una actualización del ADR, no un parche.
- **SEC-012 — `PRODUCT / REQUIREMENT CHANGE`.** Ni el PRD ni la spec de `record-audit-trail`
  establecen un plazo de retención ni una política de supresión de datos personales. Elegir cuánto
  tiempo se conserva el rastro y qué ocurre ante una solicitud de supresión es una decisión de
  producto —con implicaciones legales que dependen de la jurisdicción del negocio— y no puede tomarse
  desde el código.

**Ningún hallazgo de este pase fue marcado `ACCEPT RISK`.** Todos tienen una remediación concreta
propuesta; ninguno se cerró declarándolo tolerable por cuenta de este análisis.

### Resoluciones (2026-08-29)

| Hallazgo | Decisión | Registrada en |
| --- | --- | --- |
| SEC-001 | Verificar la contraseña **antes** de rechazar por bloqueo: una credencial correcta concede acceso aunque la cuenta esté bloqueada, y limpia el contador. Descartado el bloqueo por IP mientras no exista `trustProxy` (SEC-003), porque hoy todos los clientes comparten la IP del proxy de Vercel. | `docs/adrs/0007-sesion-cookie-rbac-propio.md` § Actualizado 2026-08-29 |
| SEC-008 | Almacenar `sha256(token)` como clave primaria de `sesiones`; el token en claro viaja sólo en la cookie. La justificación original del ADR se conserva: un hash no es un secreto, así que no hay nada que sincronizar. | `docs/adrs/0007-sesion-cookie-rbac-propio.md` § Actualizado 2026-08-29 |
| SEC-012 | Rastro permanente **sin datos personales**: las instantáneas seudonimizan el correo y la identidad del actor queda en el UUID `auditoria.usuario_id`. Una supresión limpia el dato en `usuarios` y el rastro sobrevive. Descartada la ventana de retención con purga, que le pondría vencimiento al no repudio. | `docs/PRD.md` § Supuestos y riesgos abiertos |

**SEC-001 y SEC-008 siguen sin implementar.** Esta sección registra decisiones, no código. Ningún
hallazgo de este pase quedó cerrado declarándolo tolerable.

