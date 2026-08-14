# ADR 0004: Contrato de API — REST/JSON documentado con OpenAPI

## Estado

Aceptado

## Contexto

Con dos componentes separados (ver [[0001-monolito-api-spa]]) hace falta un contrato entre la SPA
y el backend. El PRD anticipa que la factura fiscal de etapa 2 traerá una integración externa
fuerte, y que el diseño de la venta debe poder incorporarla "sin rehacer el flujo": conviene que
el contrato de la venta y de los movimientos esté documentado de forma explícita y consumible por
un tercero. El stack es TypeScript de punta a punta (ver [[0002-stack-node-react]]).

## Decisión

La API es **REST sobre JSON**, organizada por recurso (productos, movimientos, ventas, proveedores,
alertas, reportes, usuarios), con verbos HTTP estándar. El contrato se genera **code-first**: los
esquemas de request/response se definen una sola vez en TypeScript (p. ej. con Zod) en el backend,
y de ahí se **derivan** tanto el documento OpenAPI como los tipos TS que consume la SPA. No se
escribe el OpenAPI a mano por separado: el código es el único origen de verdad, y la especificación
es un artefacto generado, no un documento a mantener sincronizado manualmente.

Dos convenciones de contrato quedan fijadas para toda la API:

- **Errores:** toda respuesta de error usa el sobre `{ error: { code, message, details? } }` con el
  status HTTP correspondiente (400/401/403/404/409...).
- **Paginación:** los endpoints de listado aceptan `?page&pageSize` y responden
  `{ data, page, pageSize, total }`, consistente con la paginación que el Design.md muestra en las
  tablas.

## Alternativas consideradas

- **tRPC (RPC tipado end-to-end)** — al ser todo TypeScript, daría llamadas tipadas de punta a
  punta sin definir un contrato aparte, muy productivo para una persona. Se descartó porque acopla
  el contrato a un cliente TypeScript: exponer la venta a la integración fiscal externa de etapa 2
  (probablemente no-TS) exigiría publicar de todos modos una capa REST/OpenAPI, perdiendo la
  ventaja.
- **GraphQL** — un endpoint donde la SPA pide exactamente los campos que necesita; útil si las
  pantallas combinaran datos de formas muy variables. Se descartó por sobre-ingeniería para un
  conjunto acotado de vistas CRUD + POS + reportes: agrega servidor, caché y manejo de N+1 que v1
  no necesita.

## Consecuencias

- Contrato explícito y estándar, documentado en OpenAPI, directamente aprovechable por la
  integración fiscal de etapa 2 y por cualquier consumidor futuro.
- Tipos TS generados desde el contrato: la SPA y el backend comparten las mismas formas de datos,
  reduciendo errores de integración.
- Al ser code-first, el OpenAPI **no puede** derivar en silencio del código: se regenera desde la
  misma fuente que valida los requests en runtime, cerrando el riesgo de que la documentación
  mienta sobre lo que el backend realmente acepta.
- **Trade-off:** REST + generación desde OpenAPI implica mantener el paso de generación (spec y
  tipos) como parte del build, un poco más de ceremonia que tRPC, donde los tipos fluyen sin
  contrato intermedio. Se acepta a cambio de la portabilidad del contrato.
- **Trade-off:** para pantallas que necesitan combinar varios recursos (p. ej. producto +
  proveedor + últimos movimientos), REST puede requerir varias llamadas o endpoints compuestos;
  se resolverá con endpoints de lectura específicos por vista cuando haga falta.
