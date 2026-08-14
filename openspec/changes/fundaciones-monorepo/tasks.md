# Tasks: Fundaciones del monorepo (InvenTienda #1)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~850–1000 authored (excl. lockfile, generated `openapi.json`/`drizzle/*`/`schema.d.ts`) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → PR2 → PR3 → PR4 → PR5 |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Workspace scaffold + tooling (config only) | PR 1 | `pnpm install && pnpm -r test` (no suites yet, expect pass/no-op) | N/A — pure config, verified by CI itself | delete `apps/`, root config files, `.git` |
| 2 | Contract primitives + Fastify app + health slice (TDD) | PR 2 | `pnpm --filter @inventienda/api test` | `app.inject()` in-process, no network/DB | revert `apps/api/src/**` |
| 3 | OpenAPI/type-gen pipeline + web scaffold | PR 3 | `pnpm contract:check && pnpm --filter @inventienda/web test` | generation script run, no server listen | revert `apps/web/**`, generated files |
| 4 | Drizzle/migrations + Docker Compose | PR 4 | `pnpm --filter @inventienda/api db:migrate` against `docker compose up -d` | Docker Postgres locally | `docker compose down -v`, revert `drizzle/**` |
| 5 | CI + deploy wiring + ADR-0010 | PR 5 | CI workflow dry-run (push to branch) | GH Actions `services.postgres` | revert `.github/workflows/ci.yml`, `vercel.json`, `render.yaml`, ADR |

## Phase 1: Workspace & Tooling (config, non-TDD)

- [ ] 1.1 `git init`, add `.gitignore`; create private GitHub repo under personal account (manual/external)
- [ ] 1.2 Root `package.json` (name `inventienda`, private, packageManager pin), `pnpm-workspace.yaml` (`apps/*`)
- [ ] 1.3 `.nvmrc` (22) + `engines` in root `package.json`
- [ ] 1.4 `tsconfig.base.json`, `biome.json`, `.npmrc`, `.env.example`
- [ ] 1.5 Root scripts: `dev`, `build`, `typecheck`, `test`, `lint`, `format`, `contract`, `contract:check`, `db:up`, `db:migrate`

## Phase 2: API Contract Primitives (TDD)

- [ ] 2.1 `apps/api/package.json`, `tsconfig.json`, `vitest.config.ts` (extends base)
- [ ] 2.2 RED: `lib/errors.test.ts` — validation/AppError/unknown/404 map to `{error:{code,message,details?}}`
- [ ] 2.3 GREEN: `lib/errors.ts` (AppError class + envelope mapper)
- [ ] 2.4 RED: `lib/pagination.test.ts` — defaults, explicit `page`/`pageSize`, `total`
- [ ] 2.5 GREEN: `lib/pagination.ts` (`pageQuerySchema`, `paginated()`)
- [ ] 2.6 GREEN: `lib/env.ts` (Zod-parsed `DATABASE_URL`/`PORT`/`NODE_ENV`, fail-fast)
- [ ] 2.7 `plugins/db.ts` (lazy pool per D2), `plugins/cookie.ts` (`httpOnly`, `SameSite=Lax`, no session logic)
- [ ] 2.8 `app.ts` `buildApp(opts?)`: type-provider-zod, swagger (no swagger-ui), cookie/db plugins, error/404 handlers
- [ ] 2.9 RED: `routes/health.test.ts` — healthy 200, DB-unreachable non-2xx via error envelope (stubbed `db`)
- [ ] 2.10 GREEN: `routes/health.ts` (`GET /api/health`)
- [ ] 2.11 `server.ts` (`buildApp().listen({port, host:'0.0.0.0'})`)

## Phase 3: OpenAPI/Type Generation + SPA Scaffold

- [ ] 3.1 `plugins/openapi.ts` script: `buildApp()` → `ready()` → `app.swagger()` → write `apps/api/openapi.json`, `app.close()` (no `listen()`, per D1)
- [ ] 3.2 Commit generated `apps/api/openapi.json`
- [ ] 3.3 `apps/web/package.json`, `tsconfig.json`, `vite.config.ts` (proxy `/api`→`localhost:3000`), `index.html`
- [ ] 3.4 `types:generate` script (`openapi-typescript`) → `apps/web/src/api/schema.d.ts` (generated, committed)
- [ ] 3.5 RED: `api/client.test.ts` — builds `/api` URL, sends `credentials:'include'`
- [ ] 3.6 GREEN: `api/client.ts`
- [ ] 3.7 RED: `App.test.tsx` — renders under `QueryClientProvider`
- [ ] 3.8 GREEN: `main.tsx`, `App.tsx`, `test/setup.ts`
- [ ] 3.9 Verify `pnpm contract:check` passes byte-identical

## Phase 4: Drizzle/Migrations Infra

- [ ] 4.1 `apps/api/drizzle.config.ts` (postgresql dialect, empty `src/db/schema.ts`)
- [ ] 4.2 `src/db/client.ts` (drizzle-orm/node-postgres)
- [ ] 4.3 `docker-compose.yml`: `postgres:16-alpine`, `5432:5432`, named volume, `pg_isready` healthcheck
- [ ] 4.4 Run `db:generate`, commit generated `apps/api/drizzle/**`
- [ ] 4.5 Verify `db:migrate` against local Docker Postgres

## Phase 5: CI, Deployment Wiring, ADR-0010

- [ ] 5.1 `.github/workflows/ci.yml`: checkout → pnpm/node22 setup → install → lint → `contract:check` → typecheck → `db:migrate` → test, with `services.postgres`
- [ ] 5.2 `vercel.json` (installCommand, buildCommand, outputDirectory, `/api/:path*` rewrite placeholder, SPA fallback)
- [ ] 5.3 `render.yaml` (node web service, free plan, build/start commands, `healthCheckPath: /api/health`)
- [ ] 5.4 Manual: create Render service, capture URL, update `vercel.json` rewrite target (must precede first Vercel deploy — ordering trap)
- [ ] 5.5 Manual: create Neon project, set `DATABASE_URL` in Render env (`sync:false`)
- [ ] 5.6 Manual: connect Vercel project to GitHub repo, deploy
- [ ] 5.7 `adrs/0010-despliegue-tiers-gratuitos.md` (Spanish, MADR, supersedes 0009)
- [ ] 5.8 Update `adrs/0009-despliegue-local.md` status → "Reemplazado por [[0010-...]]"; update `TECH-DESIGNv2.md` deployment pointer
- [ ] 5.9 Manual smoke test: Vercel→Render proxy passes `Set-Cookie`; record result in ADR-0010 consequences
