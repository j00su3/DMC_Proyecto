# Proposal: Fundaciones del monorepo

## Intent
InvenTienda has zero code today — only planning docs. Every remaining backlog item (#2–#14) depends on this foundation. This change stands up the pnpm monorepo, backend/SPA scaffolding, the code-first Zod→OpenAPI→TS contract pipeline, the fixed error/pagination envelopes, migrations infra, dev Postgres, CI, and the deployment wiring (Vercel/Render/Neon) so subsequent items can build features instead of infrastructure.

## Scope

### In Scope
- pnpm workspace repo: `apps/api` (Fastify + fastify-type-provider-zod + Drizzle), `apps/web` (React + TS + TanStack Query), root tooling.
- Node 22 LTS pinned (`.nvmrc`/`engines`); Biome for lint/format.
- Error envelope `{ error: { code, message, details? } }`; pagination helper `?page&pageSize` → `{ data, page, pageSize, total }`, both test-first (Vitest).
- Zod→OpenAPI pipeline: spec generated and written to disk; `openapi-typescript` generates SPA types from it (types only, hand-written fetch client).
- Drizzle Kit migrations infra, driven by `DATABASE_URL` (works against local Docker Postgres and Neon).
- Docker Compose for local dev Postgres only; backend runs as local Node process.
- Minimal verifiable slice: health endpoint (Fastify up, DB connectivity, error/pagination shapes), built TDD-first.
- `@fastify/cookie` registered in plugin wiring (httpOnly, SameSite=Lax) — no session/auth logic yet, but foundation must not preclude it.
- Deployment config: Vercel project (SPA) + rewrites proxying `/api/*` to Render (same-origin cookies), Render service config (API, free tier), Neon connection wiring.
- Minimal GitHub Actions CI: lint + typecheck + test on push.
- `git init`, `.gitignore`, GitHub repository creation.
- New `adrs/0010-deployment-free-tiers.md` superseding ADR-0009.

### Out of Scope
- Business features (backlog #2+).
- Backup/`pg_dump` script (item #14).
- Auth/session implementation (later items) — only wiring that doesn't block it.
- Turborepo/Nx, GraphQL/tRPC, containerizing the backend.

## Capabilities
### New Capabilities
- `monorepo-scaffold`: workspace layout, tooling, CI.
- `api-contract-pipeline`: Zod→OpenAPI→TS generation, error envelope, pagination.
- `migrations-infra`: Drizzle Kit setup against DATABASE_URL.
- `deployment-wiring`: Vercel/Render/Neon config + same-origin proxy.

### Modified Capabilities
None (greenfield).

## Approach
Fastify with `fastify-type-provider-zod` validates and emits OpenAPI natively; the spec is written to disk in a build step so `openapi-typescript` can consume it for SPA types — no hand-authored spec, no duplicate types. Drizzle Kit migrations run identically against local Docker Postgres and Neon via one `DATABASE_URL` env var. Vercel rewrites give SPA+API one logical origin so the ADR-0007 cookie design (httpOnly, SameSite=Lax) survives the Vercel/Render split without weakening cookie policy. CI (lint/typecheck/test) gates the auto-deploys Render/Vercel trigger from GitHub.

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| `apps/api` | New | Fastify, Drizzle, Zod, migrations, health endpoint |
| `apps/web` | New | React SPA, TanStack Query, generated types |
| `docker-compose.yml` | New | Local dev Postgres only |
| `.github/workflows/ci.yml` | New | lint+typecheck+test |
| `vercel.json` | New | SPA build + `/api/*` rewrite to Render |
| `adrs/0010-*.md` | New | Supersedes ADR-0009 |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Render free tier cold starts hurt UX/tests | Med | Document behavior; not solved in this change |
| Vercel rewrite misconfig breaks cookie same-origin | Med | Verify with an integration check in the health-slice tests |
| Drizzle Kit behaves differently against Neon vs local Postgres | Low | Run migration smoke test against both in CI/manually before sign-off |

## Rollback Plan
Entirely greenfield, single new GitHub repo — revert by deleting/resetting the repo or reverting the initial commit(s); no production data exists yet to migrate back.

## Dependencies
- GitHub account/org for repo creation.
- Vercel, Render, Neon accounts (free tiers) for deployment wiring.

## Success Criteria
- [ ] `pnpm install && pnpm -r test` passes from a clean checkout.
- [ ] Health endpoint returns correct shape locally against Docker Postgres and against Neon.
- [ ] SPA type generation runs from the written OpenAPI spec with no manual type edits.
- [ ] CI green on push; Vercel/Render auto-deploy succeeds end-to-end with `/api/*` proxy verified.

## Proposal question round
Tooling/deployment decisions were already resolved with the user this session (see `sdd/fundaciones-monorepo/tooling-decisions`, `sdd/fundaciones-monorepo/deployment-decision`). Remaining open, lower-stakes questions for user review before spec/design:
1. Should the generated OpenAPI JSON be served at a runtime route (e.g. `/openapi.json`) in addition to being written to disk, or disk-only for the type-generation pipeline?
2. Does the health endpoint need to report DB connectivity distinctly from process liveness (useful for Render health checks), or is a single combined check sufficient for item #1?
3. Any preference on GitHub repo visibility (private/public) and org/personal account?
Assumptions made absent an answer: OpenAPI JSON is disk-only (no runtime route) for now; health endpoint checks both process and DB connectivity in one response; repo is private under the user's personal account.
