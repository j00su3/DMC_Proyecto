# Design: Fundaciones del monorepo (backlog #1)

## Technical Approach

pnpm workspace with two apps and no shared package. The only cross-app coupling is a **generated file pair**: `apps/api/openapi.json` (emitted from the Fastify instance without listening) and `apps/web/src/api/schema.d.ts` (emitted from that JSON). Both are committed; CI regenerates and fails on drift, which is what enforces ADR-0004's "spec is generated, never hand-authored".

Single-origin everywhere: all API routes live under `/api`, Vite dev proxies `/api` → `localhost:3000`, Vercel rewrites `/api/*` → Render. Dev and prod have identical origin semantics, so ADR-0007 cookies (`httpOnly`, `SameSite=Lax`, **no `Domain` attribute**) work unchanged and `@fastify/cors` is never needed.

## Repository Layout

```
inventienda/                      # private GitHub repo, personal account
  package.json                    # name "inventienda", private, packageManager pinned
  pnpm-workspace.yaml             # packages: ["apps/*"]
  tsconfig.base.json  biome.json  .npmrc  .nvmrc(22)  .gitignore  .env.example
  docker-compose.yml              # postgres only
  vercel.json   render.yaml
  .github/workflows/ci.yml
  apps/api/                       # @inventienda/api
    package.json tsconfig.json vitest.config.ts drizzle.config.ts
    openapi.json                  # GENERATED, committed
    drizzle/                      # GENERATED migrations, committed
    src/ app.ts server.ts
        lib/{env,errors,pagination}.ts
        plugins/{db,cookie,openapi}.ts
        routes/health.ts
        db/{client,schema}.ts
  apps/web/                       # @inventienda/web
    package.json tsconfig.json vite.config.ts vitest.config.ts index.html
    src/ main.tsx App.tsx api/{schema.d.ts(GENERATED),client.ts} test/setup.ts
  adrs/0010-despliegue-tiers-gratuitos.md
```

Root scripts: `dev` (`pnpm -r --parallel dev`), `build`, `typecheck`, `test` (`pnpm -r ...`), `lint`/`format` (`biome ci .` / `biome check --write .`), `contract` (api `openapi:generate` then web `types:generate`), `contract:check` (`contract` + `git diff --exit-code` on the two generated paths), `db:up` (`docker compose up -d`), `db:migrate`.

## Architecture Decisions

| # | Decision | Alternatives rejected | Rationale |
|---|---|---|---|
| D1 | OpenAPI emitted by a Node script that calls `buildApp()`, `await app.ready()`, `app.swagger()`, writes JSON, `app.close()` — never `listen()` | Boot server + curl `/openapi.json`; hand-authored spec | No port, no DB, no runtime route (per approved assumption). Forces the app factory to stay side-effect-free — a property we want anyway for `inject()` tests |
| D2 | DB pool created **lazily** inside the `db` plugin, connection only attempted on first query | Connect at module import / on `ready()` | Otherwise spec generation and unit tests would require Postgres; also lets CI generate the contract with no services |
| D3 | Both generated artifacts committed + CI drift gate | Generate on demand in CI before typecheck | Web typecheck needs `schema.d.ts` present; committing makes contract changes visible in review. Cost: generated diffs in PRs (accepted) |
| D4 | Routes registered under `/api` prefix | Root-mounted routes + path rewriting in the proxies | Vercel rewrite and Vite proxy become pure pass-throughs; Render `healthCheckPath: /api/health` matches the same URL the SPA uses |
| D5 | `drizzle-orm/node-postgres` (`pg`) driver | `postgres-js`; `@neondatabase/serverless` | Render is a persistent process, not serverless — plain TCP+TLS. `pg` is the most conservative against both local Docker and Neon (`?sslmode=require`) |
| D6 | `dotenv` as a **runtime dependency**, imported at the top of `lib/env.ts` and `drizzle.config.ts` | `node --env-file=.env` | drizzle-kit and vitest are not always launched through a node flag we control; a devDependency would break the production import. Missing `.env` is a no-op on Render |
| D7 | No `packages/*`, no TS project references | Shared `packages/contracts` | Apps never import each other; the contract travels as a generated `.d.ts`. Keeps ADR-0001's "monorepo liviano" |
| D8 | Per-app `vitest.config.ts`, no root workspace config | `vitest.workspace.ts` / `test.projects` | Different environments (node vs jsdom) and no cross-app suites. Cost: no single cross-app watch command |
| D9 | ADR-0010 written in **Spanish** | English | adrs/0001–0009 and all planning docs are Spanish; project convention wins over the default-English artifact rule for that file only |

## Fastify Composition

`app.ts` exports `buildApp(opts?: { db?: DbLike })` returning an unlistened instance:

1. `setValidatorCompiler(validatorCompiler)` + `setSerializerCompiler(serializerCompiler)` from `fastify-type-provider-zod`; every route file uses `.withTypeProvider<ZodTypeProvider>()`.
2. `@fastify/swagger` registered with `transform: jsonSchemaTransform` (OpenAPI 3.1, info/title/version from package.json). **No** `@fastify/swagger-ui`.
3. `@fastify/cookie` (`fastify-plugin`-wrapped) — registration only, no session logic.
4. `plugins/db.ts` decorates `app.db` and `app.checkDb()`; injectable via `opts.db` so route tests need no Postgres.
5. `setErrorHandler` → the single place producing `{ error: { code, message, details? } }`:
   - Zod/validation error (detected via the type provider's validation-error helper) → 400 `VALIDATION_ERROR`, `details` = flattened issues
   - `AppError` (code + status carried) → its own status/code
   - anything else → 500 `INTERNAL_ERROR`, generic message, original logged
6. `setNotFoundHandler` → 404 `NOT_FOUND` in the same envelope (Fastify's default 404 body otherwise violates ADR-0004).

`server.ts` = `buildApp()` + `listen({ port: env.PORT, host: '0.0.0.0' })` (Render requires `0.0.0.0` and injects `PORT`).

`lib/pagination.ts`: `pageQuerySchema` (`page`≥1 default 1, `pageSize` 1..100 default 20, coerced) and `paginated(data, page, pageSize, total)` → `{ data, page, pageSize, total }`.

`lib/env.ts`: Zod-parsed `DATABASE_URL` (url), `PORT` (coerced, default 3000), `NODE_ENV`; fail-fast with a readable message on boot.

`routes/health.ts`: `GET /api/health` with a Zod response schema → `{ status: 'ok'|'degraded', uptime, db: 'up'|'down' }`; combined process+DB check (`select 1`), 200 when db up, 503 + error envelope when down.

## Data Flow

```
Zod schemas (routes) ─ready()→ app.swagger() ─→ apps/api/openapi.json
                                                      │ openapi-typescript
                                                      ▼
                                        apps/web/src/api/schema.d.ts (paths)
                                                      │
        browser ─/api/*→ [Vite proxy | Vercel rewrite] ─→ Fastify ─pg→ Postgres
                                                              (Docker | Neon)
```

## Key Config Shapes

- **tsconfig.base.json**: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`, target/lib ES2023. api: `module/moduleResolution: NodeNext`, `outDir: dist`. web: `moduleResolution: Bundler`, `jsx: react-jsx`, `noEmit`, `types: ["vite/client"]`.
- **drizzle.config.ts**: `{ dialect: 'postgresql', schema: './src/db/schema.ts', out: './drizzle', dbCredentials: { url: env.DATABASE_URL } }`. Scripts `db:generate` (`drizzle-kit generate`), `db:migrate` (`drizzle-kit migrate`). `schema.ts` starts empty (no domain tables in #1).
- **docker-compose.yml**: one `postgres:16-alpine` service, `5432:5432`, `POSTGRES_USER/PASSWORD/DB=inventienda`, named volume `pgdata`, healthcheck `pg_isready`.
- **vercel.json**: `installCommand: pnpm install --frozen-lockfile`, `buildCommand: pnpm --filter @inventienda/web build`, `outputDirectory: apps/web/dist`, rewrites in order: `/api/:path*` → `https://<service>.onrender.com/api/:path*`, then `/((?!api/).*)` → `/index.html`. Vercel matches static files before rewrites, so assets are unaffected.
- **render.yaml**: `type: web, runtime: node, plan: free`, build `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @inventienda/api build`, start `node apps/api/dist/server.js`, `healthCheckPath: /api/health`, `DATABASE_URL` with `sync: false`.
- **vite.config.ts**: `server.proxy['/api'] = 'http://localhost:3000'`.

## Testing Strategy (Strict TDD)

| Layer | What | How |
|---|---|---|
| Unit (api) | error-envelope mapping (validation/AppError/unknown/404), pagination helper, env schema | pure functions + `app.inject()` with a stubbed `db` — no network, no Postgres |
| Integration (api) | `GET /api/health` against real Postgres; drizzle-kit migrate applies cleanly | Docker Postgres locally, GH Actions `services: postgres` in CI |
| Contract | `openapi.json` regenerates byte-identically; `schema.d.ts` matches | `pnpm contract:check` in CI |
| Unit (web) | api client builds correct `/api` URL and sends `credentials: 'include'`; app renders under QueryClientProvider | Vitest + jsdom + Testing Library |
| Manual (once) | Vercel→Render proxy passes `Set-Cookie` through on the vercel origin | post-deploy smoke, recorded in ADR-0010 consequences |

Pure-config files (tsconfig, compose, biome, workflows) are not TDD targets; they are verified by the CI run itself.

## CI (`.github/workflows/ci.yml`)

Single job on push+PR: checkout → `pnpm/action-setup` → `setup-node@v4` (Node 22, `cache: pnpm`) → `pnpm install --frozen-lockfile` → `lint` → `contract:check` → `typecheck` → `db:migrate` → `test`. `services.postgres:16` with health-options; `DATABASE_URL` points at it. Order is load-bearing: `contract:check` must precede `typecheck` because the web typecheck consumes the generated types.

## File Changes (summary)

~30 new files (root tooling 10, `apps/api` 14, `apps/web` 8, deploy/CI 3, ADR 1). Modified: `adrs/0009-despliegue-local.md` → Estado "Reemplazado por [[0010-despliegue-tiers-gratuitos]]"; `TECH-DESIGNv2.md` deployment section pointer.

## ADR-0010 Outline (`adrs/0010-despliegue-tiers-gratuitos.md`, Spanish, MADR)

- **Estado**: Aceptado 2026-08-13 — reemplaza a [[0009-despliegue-local]].
- **Contexto**: los criterios de éxito del PRD exigen usuarios reales; `localhost`-solo los hace inmedibles (la condición de revisión que el propio 0009 dejó escrita). Costo mensual = 0 sigue siendo requisito.
- **Decisión**: SPA en Vercel, API en Render free, Postgres gestionado en Neon. `vercel.json` reescribe `/api/*` al servicio de Render para conservar un único origen. Docker Compose queda para Postgres de desarrollo local. Migraciones con Drizzle Kit contra `DATABASE_URL` (local y Neon).
- **Alternativas**: Fly.io/Railway (no free tier real y equivalente); Render sirviendo también la SPA (pierde CDN y el build de Vercel); dominio propio + CORS con `SameSite=None` (debilita ADR-0007 y agrega costo).
- **Consecuencias**: HTTPS gratis ⇒ la cookie pasa a `Secure` (habilita ADR-0007 completo); cold start ~50 s en free tier tras 15 min de inactividad; Neon suspende cómputo (primera query lenta); backups pasan a ser gestionados por Neon, lo que reduce el alcance del item #14; **la cookie no debe llevar atributo `Domain`** o el proxy de Vercel la rompe; las migraciones en Neon se ejecutan manualmente desde la máquina del desarrollador en v1 (Render free no ofrece pre-deploy command).

## Threat Matrix

N/A — no agent routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. The `git init` + repo creation in scope is a one-time human bootstrap, not automated VCS behavior shipped by the product; the Vercel rewrite is a fixed-destination proxy, not a user-controlled route.

## Migration / Rollout

No data migration (greenfield). Rollout order: workspace + tooling → red tests for envelope/pagination → Fastify app + health → contract pipeline → Drizzle/compose → CI → deploy wiring → ADR-0010.

## Open Questions

- [ ] `fastify-type-provider-zod` major must match the installed Zod major (its v4 line targets Zod 3, its v5 line targets Zod 4). Resolve at install time and pin both explicitly; do not assume.
- [ ] Render service URL is unknown until the service exists — `vercel.json` gets a placeholder that must be replaced before the first Vercel deploy.
