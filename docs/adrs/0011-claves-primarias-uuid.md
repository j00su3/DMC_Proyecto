# ADR 0011: Claves primarias UUID para las entidades de dominio

## Estado

Aceptado

## Contexto

El TECH-DESIGN no fija ninguna convención de clave primaria. La que existe hoy es **de facto**:
al implementar el backlog #2 (autenticación y sesiones), `usuarios` quedó con
`uuid('id').primaryKey().defaultRandom()` y nadie escribió por qué. Las tablas que faltan
—`proveedores` (#4), `productos` y `movimientos` (#5), `ventas` (#7)— todavía no están diseñadas,
así que hoy la convención se puede fijar barata; una vez creadas, cambiarla cuesta migrar tablas
con datos y reescribir cada referencia.

Hay además un requisito concreto que fuerza la decisión ahora. El backlog #2.2 (sistema de
auditoría general) necesita una tabla única con una columna `entidad_id` **polimórfica**, capaz de
apuntar a un usuario, un proveedor o un producto según el valor de `entidad`. Una columna sola no
puede tener dos tipos: **todas las entidades auditadas deben compartir el tipo de su clave
primaria**. Si `usuarios` usa `uuid` y `productos` terminara usando `serial`, la auditoría genérica
deja de ser posible y hay que volver al diseño que #2.2 existe para evitar.

Existe una excepción ya en el código que conviene explicar antes de que alguien la tome como
precedente: `sesiones.id` es `text`, no `uuid`. No es una inconsistencia. La clave primaria de esa
tabla **es el valor de la cookie de sesión**, generado con `randomBytes(32).toString('base64url')`
(ver ADR-0007). Es un token opaco, no un identificador de entidad de dominio.

## Decisión

Toda **entidad de dominio** usa clave primaria `uuid` generada por la base con `defaultRandom()`
(UUID v4):

```ts
id: uuid('id').primaryKey().defaultRandom()
```

Consecuencias directas de esta decisión:

- `proveedores`, `productos`, `movimientos`, `ventas`, `items_venta`, `pagos`, `alertas` y
  `auditoria` siguen esta convención cuando se creen.
- La columna `entidad_id` de la tabla de auditoría (#2.2) es `uuid`.
- Esa columna **no lleva `FOREIGN KEY`**: PostgreSQL no soporta claves foráneas polimórficas. En
  auditoría eso además es deseable —si un registro desapareciera, su rastro debe sobrevivir— pero
  se deja dicho para que nadie lo lea como un olvido.

**Excepción única y no generalizable:** `sesiones.id` permanece `text` porque su clave primaria es
el token de la cookie, no un identificador de dominio. Cualquier tabla futura que quiera apartarse
de `uuid` necesita una justificación equivalente y explícita.

## Alternativas consideradas

- **`serial` / `bigserial` (enteros secuenciales)** — índice más compacto y con mejor localidad de
  escritura. Se descartó por dos razones. Primero, los identificadores viajan en las URLs de la SPA
  y un entero secuencial es **enumerable**: revela cuántos usuarios o productos existen y permite
  sondear registros ajenos cambiando un número a mano. Segundo, obliga a esperar el `INSERT` para
  conocer el identificador, lo que complica las operaciones que arman varias filas relacionadas en
  una misma transacción (por ejemplo la venta multi-ítem de #7).
- **UUID v7 o ULID almacenados como `text`** — ordenables por tiempo, con mejor localidad de índice
  que el v4 aleatorio. Es la alternativa técnicamente más interesante y se descartó por costo, no
  por mérito: PostgreSQL 16 (la versión fijada en `docker-compose.yml`) no genera UUID v7 de forma
  nativa, así que exigiría una extensión o generarlos en la aplicación, perdiendo el
  `defaultRandom()` de la base. El volumen de una tienda única no justifica esa complejidad.
  Reevaluable si el volumen creciera lo suficiente como para que la fragmentación del índice
  se note.
- **Clave natural (por ejemplo el SKU como clave primaria de `productos`)** — se descartó porque el
  SKU es un dato del negocio y es corregible: un SKU mal cargado se edita. Una clave primaria no
  debe cambiar nunca, y menos si otras tablas la referencian.

## Consecuencias

- La tabla de auditoría genérica de #2.2 es viable, y con ella el diseño único que evita repetir
  tres veces la misma decisión en #3, #4 y #5.
- Los identificadores son seguros de exponer en URLs y respuestas de la API sin filtrar el tamaño
  del catálogo ni del padrón de usuarios.
- **Trade-off:** un `uuid` ocupa 16 bytes contra los 4 de un `serial`, y todos los índices que lo
  incluyan crecen en proporción. A la escala de una tienda única es irrelevante.
- **Trade-off:** el UUID v4 es aleatorio, así que las inserciones caen en páginas dispersas del
  índice en vez de agregarse al final. Produce más fragmentación que un secuencial. Aceptable en
  este contexto; es el precio de no ser enumerable.
- **Trade-off:** son incómodos de leer y comparar a mano al depurar o al mirar la base
  directamente. Se asume.
- **Trade-off:** esta decisión **no** resuelve la falta de clave foránea en la columna polimórfica
  de auditoría. Esa limitación es de PostgreSQL y vale con cualquier tipo de clave; la integridad
  de esa columna queda a cargo de la aplicación y de sus tests.
