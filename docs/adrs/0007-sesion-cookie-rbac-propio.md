# ADR 0007: Autenticación y autorización — Sesión con cookie httpOnly y RBAC propio

## Estado

Aceptado — actualizado 2026-08-13: se agregan el permiso por campo de `stock_minimo` y
`SameSite=Lax` en la cookie de sesión (resuelve A7 y S10 de la Ronda 2 de
`REVISION-ADVERSARIAL.md`; ver `TECH-DESIGNv2.md`).

Actualizado 2026-08-24: implementado el hash de contraseña con **argon2id** (parámetros base
OWASP: `memoryCost=19456`, `timeCost=2`, `parallelism=1`) sobre la alternativa bcrypt mencionada
en la Decisión original. La sesión no usa un token separado: el `id` de la fila `sesiones`
(aleatorio, `base64url(randomBytes(32))`) es directamente el valor firmado que viaja en la cookie
`httpOnly`, y `@fastify/cookie` valida la firma antes de resolverlo contra el store; no hay un
segundo secreto de sesión que mantener sincronizado con la fila. Ver `openspec/changes/auth-sesiones/design.md`.

## Contexto

El PRD define un sistema multiusuario con login por cuenta individual y **dos roles**
(encargado/administrador y personal de depósito), con una **matriz de permisos** detallada:
operaciones sensibles (anular/devolver ventas, baja de productos, ajustes, configuración de
umbrales, gestión de usuarios) reservadas al encargado, y ajustes del personal "directos
auditados" con motivo obligatorio. El Design.md refuerza que "lo que el rol no puede hacer se marca
con 🔒, no se oculta": la SPA muestra los permisos, pero el control real debe estar en el backend.
La gestión de usuarios la hace el encargado dentro del sistema.

## Decisión

Autenticación propia con **usuario/contraseña**, contraseña almacenada con **hash fuerte**
(bcrypt/argon2), y **sesión en cookie `httpOnly` + `SameSite=Lax`** (protegida contra lectura por
JavaScript; `SameSite=Lax` cierra desde v1 la mayor parte del riesgo CSRF de usar cookies —
`Secure` queda condicionado al despliegue, ver [[0009-despliegue-local]]). La
autorización es un **RBAC propio en el backend**: un middleware valida, en **cada endpoint**, el
rol del usuario contra la matriz de permisos del PRD. La SPA usa el rol solo para mostrar/ocultar u
marcar con 🔒, pero la decisión de autorización es siempre del servidor.

El middleware de rol cubre autorización **a nivel de endpoint** (¿puede este rol pegarle a esta
ruta?), pero no alcanza para el caso de la matriz donde el permiso depende también del **dueño del
dato** — p. ej. el personal de depósito ve "sus propios movimientos" en reportes, no los de todos.
Ese filtrado es responsabilidad de la capa de servicio/consulta (un `WHERE usuario_id = :actor`
explícito cuando el rol es depósito), no del middleware de RBAC.

Hay además un caso de autorización **a nivel de campo** que ni el middleware por endpoint ni el
filtrado por dueño cubren: la matriz del PRD permite a depósito dar de alta/editar productos, pero
le niega "configurar umbrales de stock/alertas" — y `stock_minimo`, que es el umbral por producto,
es un campo del propio formulario de producto. La regla vive explícitamente en la **capa de
servicio de producto**: si el actor es rol `deposito` y el payload setea o modifica
`stock_minimo`, la operación responde 403 con código `campo_reservado_encargado`; la SPA muestra
el campo con 🔒. Es el **único** permiso por campo del sistema; si aparece un segundo caso, se
generaliza (p. ej. una lista de campos reservados por rol) — hoy una regla explícita es más simple
que un framework.

Login y cuentas incluyen además: **rate-limit/lockout** ante intentos fallidos repetidos (p. ej. 5
intentos → bloqueo temporal de ~5 minutos, por usuario y/o IP), y un mecanismo de **bootstrap** del
primer usuario encargado — se crea fuera de la API (seed/script o variable de entorno al desplegar,
ver [[0009-despliegue-local]]), ya que la API de gestión de usuarios requiere estar autenticado
como encargado para usarla. El reset de contraseña vía flujo propio (email) queda fuera de v1; como
vía de rescate si el único encargado pierde su contraseña, se documenta un procedimiento
administrativo manual (resetear el hash directo en base) fuera de la aplicación.

## Alternativas consideradas

- **JWT stateless + RBAC** — token firmado que el front envía en cada request, sin estado de sesión
  en el servidor. Se descartó porque revocar un usuario o cambiarle el rol "en caliente" es difícil
  (el token sigue válido hasta expirar), y en un sistema donde el encargado gestiona usuarios y
  permisos esa capacidad de revocación inmediata importa. La sesión en servidor la da naturalmente.
- **Proveedor externo (Auth0/Clerk)** — menos código de seguridad propio y features listas (reset,
  MFA). Se descartó por sumar dependencia y costo externos y por dejar la "gestión de usuarios por
  el encargado" parcialmente fuera del sistema, cuando el PRD la pide adentro; para un local único
  con dos roles, el RBAC propio es suficiente.

## Consecuencias

- Todos los datos de usuarios y permisos viven en el propio sistema; el encargado los gestiona sin
  depender de un tercero, y la revocación/cambio de rol es inmediata (sesión en servidor).
- La matriz de permisos del PRD se traduce directamente en el middleware de autorización, con la
  autorización centralizada en el backend (la SPA no es la fuente de verdad).
- **Trade-off:** hay que implementar y mantener piezas de seguridad propias (hashing, manejo de
  sesión, protección CSRF por usar cookies, futuro reset de contraseña) que un proveedor externo
  daría hechas. Se asume como responsabilidad del proyecto y se cubre con prácticas estándar.
- **Trade-off:** la sesión en servidor requiere un almacén de sesiones (en Postgres o similar),
  un componente de estado que el enfoque stateless no tendría.
- **Trade-off:** el filtrado por dueño de dato (reportes "propios" del depósito) vive fuera del
  middleware de RBAC, repartido en cada consulta que lo necesite; hay que mantenerlo disciplinado
  para no filtrar de más por descuido en un endpoint nuevo.
- **Trade-off:** el permiso por campo de `stock_minimo` es una tercera capa de autorización
  (endpoint → fila → campo) implementada ad hoc en el servicio de producto; aceptable mientras sea
  un único campo, a revisar si la matriz de permisos crece en esa dirección.
- **Trade-off:** rate-limit/lockout y el bootstrap manual del primer encargado son piezas de
  seguridad más para mantener a mano, coherente con haber elegido auth propia en vez de un
  proveedor externo (ver alternativas).
