# ADR 0002: Stack por componente — Node/TypeScript en backend y React/TypeScript en frontend

## Estado

Aceptado — actualizado 2026-08-13: se fijan framework, ORM y librería de estado de servidor
(resuelve S8/S9 de la Ronda 2 de `REVISION-ADVERSARIAL.md`; ver `TECH-DESIGNv2.md`).

## Contexto

Definida la arquitectura de dos componentes (ver [[0001-monolito-api-spa]]), hay que elegir
lenguaje y framework para cada uno. La restricción real dominante es que el proyecto lo desarrolla
**una sola persona**: conviene minimizar el cambio de contexto entre backend y frontend y
maximizar la reutilización. El PRD también anticipa un motor de ML en el futuro, aunque fuera del
alcance de v1.

## Decisión

**TypeScript en todo el stack**: backend en **Node.js + TypeScript** con **Fastify** como
framework web y **Drizzle** como ORM, y frontend en **React + TypeScript** con **TanStack Query**
para el estado de servidor (fetch, cache, refetch y el polling de alertas). Los tipos del contrato
de API se comparten/generan entre ambos lados (ver [[0004-rest-json-openapi]]).

La elección de framework no era libre: estaba condicionada por el pipeline code-first
Zod → OpenAPI → tipos TS ya aceptado en [[0004-rest-json-openapi]]. **Por qué Fastify:**
`fastify-type-provider-zod` valida las requests en runtime y genera el documento OpenAPI
directamente de los mismos schemas Zod — el pipeline sale nativo, sin herramientas paralelas.
**Por qué Drizzle:** es SQL-first — el UPDATE atómico condicional de
[[0005-update-atomico-condicional]] y los savepoints de
[[0008-evaluador-de-alertas-detras-de-interfaz]] se escriben tal cual, sin pelear contra la
abstracción del ORM y sin abandonar el tipado.

## Alternativas consideradas

- **Python (FastAPI/Django) + React** — Python deja el camino más natural hacia el motor de ML
  futuro (mismo lenguaje que el ecosistema de datos). Se descartó como base de v1 porque obliga a
  trabajar en dos lenguajes distintos (Python + TS) desde el día uno, penalizando a un equipo de
  una persona; el ML de etapa 2 puede vivir como servicio aparte en su momento sin condicionar v1.
- **C# .NET + React/Blazor** — muy sólido en transacciones y tipado, cómodo en entorno Windows.
  Se descartó por ecosistema y despliegue más pesados y por no aportar un lenguaje único de punta
  a punta con el frontend elegido.
- **PHP (Laravel) + Vue/Inertia** — muy productivo para CRUD y reportes en retail. Se descartó por
  encajar peor con la separación API+SPA elegida y con la evolución hacia ML.

Dentro del ecosistema Node, para framework/ORM (decisión del 2026-08-13):

- **Express + Prisma** — el ecosistema más conocido y documentado. Se descartó porque el pipeline
  Zod → OpenAPI se arma a mano (`zod-to-openapi` + wiring propio) y el UPDATE condicional de
  [[0005-update-atomico-condicional]] requiere `$executeRaw` — Prisma no lo expresa nativamente.
- **Hono + Drizzle** — `@hono/zod-openapi` trae el pipeline integrado y es muy liviano. Se
  descartó por ecosistema más chico que Fastify para middleware de sesión y rate-limit (más
  piezas a mano en la auth propia de [[0007-sesion-cookie-rbac-propio]]).
- **NestJS + Prisma** — framework completo con DI y estructura impuesta. Se descartó porque su
  generación de OpenAPI nativa es por decoradores, no Zod (a contramano de
  [[0004-rest-json-openapi]]), y está sobredimensionado para un equipo de una persona.

## Consecuencias

- Un solo lenguaje (TypeScript) en backend y frontend: menos cambio de contexto, y los tipos del
  dominio (Producto, Movimiento, Venta) se comparten, reduciendo errores de contrato.
- Ecosistema npm amplio para todo lo necesario en v1 (validación, ORM, generación de OpenAPI).
- **Trade-off:** cuando llegue el motor de ML (etapa 2), lo más probable es que se implemente en
  Python, introduciendo un segundo lenguaje y un componente adicional. Se acepta porque el ML no
  es alcance de v1 y la interfaz de alertas ([[0008-evaluador-de-alertas-detras-de-interfaz]])
  permite integrarlo como servicio externo sin reescribir el núcleo.
- **Trade-off:** Node/TS exige disciplina de tipado y configuración (tsconfig, build) que un
  full-stack más opinado daría "de fábrica".
