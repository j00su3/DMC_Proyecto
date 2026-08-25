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

- [x] 1.1 `git init`, add `.gitignore`; create private GitHub repo under personal account (manual/external) — git init + .gitignore done; GitHub repo creation BLOCKED, `gh` CLI not installed in this environment (pending manual step, see apply-progress)
- [x] 1.2 Root `package.json` (name `inventienda`, private, packageManager pin), `pnpm-workspace.yaml` (`apps/*`)
- [x] 1.3 `.nvmrc` (22) + `engines` in root `package.json`
- [x] 1.4 `tsconfig.base.json`, `biome.json`, `.npmrc`, `.env.example`
- [x] 1.5 Root scripts: `dev`, `build`, `typecheck`, `test`, `lint`, `format`, `contract`, `contract:check`, `db:up`, `db:migrate`

## Phase 2: API Contract Primitives (TDD)

- [x] 2.1 `apps/api/package.json`, `tsconfig.json`, `vitest.config.ts` (extends base)
- [x] 2.2 RED: `lib/errors.test.ts` — validation/AppError/unknown/404 map to `{error:{code,message,details?}}`
- [x] 2.3 GREEN: `lib/errors.ts` (AppError class + envelope mapper)
- [x] 2.4 RED: `lib/pagination.test.ts` — defaults, explicit `page`/`pageSize`, `total`
- [x] 2.5 GREEN: `lib/pagination.ts` (`pageQuerySchema`, `paginated()`)
- [x] 2.6 GREEN: `lib/env.ts` (Zod-parsed `DATABASE_URL`/`PORT`/`NODE_ENV`, fail-fast)
- [x] 2.7 `plugins/db.ts` (lazy pool per D2), `plugins/cookie.ts` (`httpOnly`, `SameSite=Lax`, no session logic)
- [x] 2.8 `app.ts` `buildApp(opts?)`: type-provider-zod, swagger (no swagger-ui), cookie/db plugins, error/404 handlers
- [x] 2.9 RED: `routes/health.test.ts` — healthy 200, DB-unreachable non-2xx via error envelope (stubbed `db`)
- [x] 2.10 GREEN: `routes/health.ts` (`GET /api/health`)
- [x] 2.11 `server.ts` (`buildApp().listen({port, host:'0.0.0.0'})`)

## Phase 3: OpenAPI/Type Generation + SPA Scaffold

- [x] 3.1 `plugins/openapi.ts` script: `buildApp()` → `ready()` → `app.swagger()` → write `apps/api/openapi.json`, `app.close()` (no `listen()`, per D1)
- [x] 3.2 Commit generated `apps/api/openapi.json`
- [x] 3.3 `apps/web/package.json`, `tsconfig.json`, `vite.config.ts` (proxy `/api`→`localhost:3000`), `index.html`
- [x] 3.4 `types:generate` script (`openapi-typescript`) → `apps/web/src/api/schema.d.ts` (generated, committed)
- [x] 3.5 RED: `api/client.test.ts` — builds `/api` URL, sends `credentials:'include'`
- [x] 3.6 GREEN: `api/client.ts`
- [x] 3.7 RED: `App.test.tsx` — renders under `QueryClientProvider`
- [x] 3.8 GREEN: `main.tsx`, `App.tsx`, `test/setup.ts`
- [x] 3.9 Verify `pnpm contract:check` passes byte-identical

## Phase 4: Drizzle/Migrations Infra

- [x] 4.1 `apps/api/drizzle.config.ts` (postgresql dialect, empty `src/db/schema.ts`)
- [x] 4.2 `src/db/client.ts` (drizzle-orm/node-postgres)
- [x] 4.3 `docker-compose.yml`: `postgres:16-alpine`, `5432:5432`, named volume, `pg_isready` healthcheck
- [x] 4.4 Run `db:generate`, commit generated `apps/api/drizzle/**` — 0 tables, empty journal (`entries: []`), no migration SQL files (schema is intentionally empty in this PR)
- [x] 4.5 Verify `db:migrate` against local Docker Postgres — applied successfully
- [x] 4.6 (user-mandated) Integration test: `health.integration.test.ts` boots the real app (real db plugin, no stub) and asserts `GET /api/health` reflects a live DB connection against real Docker Postgres, run via a separate `test:integration` vitest suite so unit tests stay Postgres-free (TDD: RED confirmed against no DB, GREEN confirmed after `docker compose up` + `db:migrate`)

## Phase 5: CI, Deployment Wiring, ADR-0010

- [x] 5.1 `.github/workflows/ci.yml`: checkout → pnpm/node22 setup → install → lint → `contract:check` → typecheck → `db:migrate` → test, with `services.postgres`
- [x] 5.2 `vercel.json` (installCommand, buildCommand, outputDirectory, `/api/:path*` rewrite placeholder, SPA fallback)
- [x] 5.3 `render.yaml` (node web service, free plan, build/start commands, `healthCheckPath: /api/health`)
- [ ] 5.4 **MANUAL (user, external account action) — not executable by the agent.** Create the Render web service (point it at this GitHub repo, `render.yaml` provides the build/start commands), wait for the first deploy to get its `*.onrender.com` URL, then edit `vercel.json`'s `rewrites[0].destination` to replace `https://RENDER-URL-PLACEHOLDER.onrender.com/api/:path*` with the real URL and commit that change. **This MUST happen before the first Vercel deploy** — see the "Orden de puesta en marcha" section in ADR-0010 (ordering trap: Vercel deployed with the placeholder will 404/fail every `/api/*` call until the next Vercel deploy).
- [ ] 5.5 **MANUAL (user, external account action) — not executable by the agent.** Create a Neon Postgres project, copy its connection string, and set it as the `DATABASE_URL` environment variable in the Render service dashboard (`render.yaml` already declares the key with `sync: false`, so Render will prompt for the value instead of trying to sync it). Then run `pnpm db:migrate` locally against that Neon `DATABASE_URL` once to apply migrations (Render's free tier has no pre-deploy command).
- [ ] 5.6 **MANUAL (user, external account action) — not executable by the agent.** Log into Vercel, import this GitHub repository as a new project, confirm the build settings match `vercel.json` (installCommand/buildCommand/outputDirectory auto-detected from the file), and trigger the deploy — only after 5.4's placeholder replacement is committed and pushed.
- [x] 5.7 `adrs/0010-despliegue-tiers-gratuitos.md` (Spanish, MADR, supersedes 0009)
- [x] 5.8 Update `adrs/0009-despliegue-local.md` status → "Reemplazado por [[0010-...]]"; update `TECH-DESIGNv2.md` deployment pointer
- [ ] 5.9 **MANUAL (user, post-deploy verification) — not executable by the agent.** After 5.4–5.6 are live, log in through the deployed Vercel URL and confirm the `Set-Cookie` response header (visible in browser devtools → Network tab on the login request) survives the Vercel→Render proxy unmodified (`httpOnly`, `SameSite=Lax`, `Secure`, no `Domain` attribute). Record the result (pass/fail + date) in ADR-0010's "Pendiente" line under Consequences.
