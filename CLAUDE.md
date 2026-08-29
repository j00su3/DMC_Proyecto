# CLAUDE.md — InvenTienda

Working notes for an agent editing this repository. Everything here was learned by breaking
something first. Read it before writing code; most of it is not inferable from the source.

## What this is

Inventory management for a small shop. Two roles: `encargado` (manager) and `deposito` (warehouse
staff). pnpm workspace, Node 22.

| Path | What lives there |
| --- | --- |
| `apps/api` | Fastify 5 + `fastify-type-provider-zod` + Drizzle ORM over PostgreSQL 16 |
| `apps/web` | React 19 SPA — Vite, TanStack Query + Router, react-hook-form |
| `docs/` | PRD, technical design, ADRs, backlog, adversarial review |
| `openspec/` | SDD artifacts: `specs/` are promoted capabilities, `changes/` are in-flight, `changes/archive/` are closed cycles |

## Commands

```bash
pnpm -r test            # unit suites, api + web
pnpm typecheck
pnpm lint               # biome ci .
pnpm contract:check     # see "The contract pipeline" below — read it before trusting a failure
pnpm db:up              # docker compose up -d  (container: inventienda-postgres-1)
pnpm test:integration   # excluded from the default run; needs the container
```

**`pnpm` is not on the PowerShell PATH.** In a bash shell, prepend the shims first:
`export PATH="/c/Users/User/.corepack-shims:$PATH"`.

Integration tests take their `DATABASE_URL` from `apps/api/vitest.integration.config.ts`, not from
an env file.

## Never touch `.env*`

Do not read, write, move, or reference any `.env*` file in any tool call — a permission rule denies
them, and a denied call wastes a turn. When a change needs a new environment variable, report it as
a manual step for the user and stop there. To prove no secret is committed, use `.gitignore` and
`git ls-files`, never the files themselves.

## Document authority

**`docs/TECH-DESIGNv2.md` is authoritative. `docs/TECH-DESIGN.md` is superseded** — v2 line 3 says
so verbatim. v1 is still in the tree as history. If you find yourself citing v1, stop and re-read
from v2; a whole planning cycle was nearly built against the stale document.

`docs/REVISION-ADVERSARIAL.md` holds two rounds of adversarial review. The `(C1)`, `(A7)`, `(S10)`
markers scattered through the backlog and v2 point into it.

The PRD is not always where a decision lives. Supplier deletion, for example, appears in
`docs/PRD.md:179` under *casos borde a resolver* — as an open question — while the actual decision
sits in `docs/TECH-DESIGNv2.md`. Check both before concluding something is unresolved.

## Two naming families, and they do not mix

- **Spanish**: domain types, repositories, table and column names — `Usuario`, `UsuariosRepo`,
  `Proveedor`, `ProveedoresRepo`, `proveedores.nombre`.
- **English**: error factories and wire codes — `userNotFound()` / `USER_NOT_FOUND`,
  `supplierNotFound()` / `SUPPLIER_NOT_FOUND`, `supplierNameInUse()` / `SUPPLIER_NAME_IN_USE`.

`LAST_ACTIVE_ENCARGADO` is not a counter-example. `encargado` is the literal `rol` enum value, so
the Spanish noun is the correct token inside an English UPPER_SNAKE code. Use that precedent when a
new code needs a role name.

A cycle once proposed `PROVEEDOR_NOMBRE_EN_USO` and it had to be renamed before any code was
written. Settle wire codes at spec time; renaming them later is a spec delta, not a refactor.

## Envelopes

```jsonc
// errors — UPPER_SNAKE codes
{ "error": { "code": "SUPPLIER_NOT_FOUND", "message": "…", "details": {} } }

// pagination
{ "data": [], "page": 1, "pageSize": 20, "total": 0 }
```

Defined in `apps/api/src/lib/errors.ts` and `apps/api/src/lib/pagination.ts`. Reuse them; do not
invent a second shape.

## Architecture rules that are load-bearing

**Three layers per domain.** `routes/*.ts` (Fastify + Zod, `config: { roles: [...] }` per route) →
`<domain>/service.ts` (business rules) → `<domain>/repository.ts` (a port plus its Drizzle
adapter). `apps/api/src/proveedores/` is the cleanest example — copy its shape.

**Every write goes through `UnitOfWork`.** `apps/api/src/db/uow.ts`. `run()` binds every repository
into one transaction, and `recordAudit()` runs inside it. A write that files no audit row, or an
audit row without its write, is a bug by construction.

**The audit compile gate is sharper than it looks.** `entidadAuditoria` in
`apps/api/src/db/schema.ts` already lists `usuarios`, `proveedores` and `productos`, so the pgEnum
looks like it accepts anything. It does not matter:
`AuditableEntidad = keyof typeof FIELD_CLASSIFICATION` (`apps/api/src/auditoria/service.ts:8`) is
the real gate, and `recordAudit({ entidad: 'productos' })` will not compile until
`apps/api/src/auditoria/fields.ts` gains a `productos` entry. Checking the enum proves the database
would accept the value, not that the application builds. This has cost a correction once already.

**Authorization is server-side, always.** `config.roles` per route in
`apps/api/src/plugins/auth.ts`. Anything the SPA hides or disables is a UX affordance and must be
documented as such in its own docblock — the server's 403 is the boundary. `encargadoLayout.tsx`
carries the canonical wording.

**Route guards are for encargado-only subtrees.** Screens both roles can read (proveedores,
productos) go under `shellLayout`, never `encargadoLayout`, with write controls gated per component.

## The contract pipeline

Code-first Zod → `apps/api/openapi.json` → `apps/web/src/api/schema.d.ts`, regenerated by
`pnpm contract` and gated by `pnpm contract:check`.

**`contract:check` compares the working tree against the INDEX**, so regenerated files that are not
staged read as drift. If it fails, stage the regenerated artifacts and re-run before believing the
failure is real.

For a test-only change, a byte-identical result is the correct outcome, not a missed step.

## Testing

Strict TDD. Vitest 4, RTL 16, user-event 14.

- **`await router.load()` before every render in a web route test.** A test that leans on `findBy`'s
  one-second retry to cover routing plus a guard fetch plus a query passes in isolation and fails
  under full-suite load. This was diagnosed once by running a file 5× alone (green) versus in-suite
  (red).
- **Route-level coverage, not just hook-level.** Two defects shipped behind fully green hook tests.
  A mutation moving a query key out from under `lists()` keeps fifteen hook tests green while the
  screen silently stops updating — only a route test catches it.
- **`app.inject` only sends the headers a test passes.** `POST /api/auth/logout` was broken in
  production for every real browser client while three tests stayed green, because the SPA's
  `apiFetch` declared `Content-Type: application/json` on a bodyless POST and Fastify's parser
  rejected it. When a test and a browser could disagree, prove it against the browser's path.
- **Integration tests run against real Postgres** and are excluded from the default run. The audit
  trail and transactional rollback are only provable there — wrap a real `createUnitOfWork(db)` and
  override only the failing dependency, so the write stays genuine and the ROLLBACK is real. See
  `apps/api/src/routes/proveedores.integration.test.ts`.
- **Assert the database after a refusal**, not just the status code. A 403 that still writes is the
  failure mode a status-only assertion misses.
- **Mutate before trusting a test.** A test you have never seen fail is not evidence. Two findings
  that looked identical in a verify report turned out to be one real gap and one layer formality;
  only mutation probing told them apart.

## Deployment

SPA on Vercel, API on Render (`render.yaml`), Postgres on Neon. `vercel.json` rewrites `/api/*` to
the Render service so session cookies stay same-origin. Live at `https://dmc-proyecto.vercel.app`.

**Migrations against Neon are run manually from the developer's machine** (`pnpm db:migrate` with
the Neon `DATABASE_URL`) — Render's free tier has no pre-deploy command. See
`docs/adrs/0010-despliegue-tiers-gratuitos.md:71-72`. **A change that adds a table will deploy
cleanly and then 500 on every route that touches it until someone runs that migration.**

Free-tier cold start: Render suspends after ~15 minutes idle and the next request can take ~50
seconds. Neon autosuspends too. Wake the app before demoing it.

## SDD workflow

Changes move explore → propose → spec + design → tasks → apply → verify → archive, one backlog item
at a time, with the owner approving each phase. Artifacts live in `openspec/changes/<name>/` and
move to `openspec/changes/archive/<date>-<name>/` on completion, with the delta spec promoted to
`openspec/specs/<capability>/`.

`docs/BACKLOG.md` is the source of truth for what is done, in flight, and pending.

Two rules earned the hard way:

- **Spec and design run in parallel and cannot see each other.** They have contradicted each other
  once. If a design phase finds itself deciding product behaviour, it must flag the conflict rather
  than quietly resolving it.
- **Size the review budget against the raw diff**, including tests, planning artifacts and generated
  files. Every budget overrun in this project came from measuring only the part being thought about.

## The claims gate

Every closing cycle carries `openspec/changes/<cycle>/claims-report.md`: one row per
verifiable claim the cycle makes about this codebase, each `CONFIRMED`, `REFUTED`, or
`UNVERIFIABLE` and accepted on the record. It is produced by the `claims-gate` skill and
archived with the cycle. The harness lives in `harnesses/claims-gate/`.

A `PreToolUse` hook refuses `gh pr merge` while a cycle that has reached verify or archive
has no report, a report whose `Verified revision` is not `HEAD`, or any refuted or
unaccepted-unverifiable claim. Cycles still in planning are not gated. **Do not work
around a refusal** — it is reporting a false statement that is still written down. Fix the
claim or fix the code, then re-run the gate.

The rule underneath it applies whether or not the gate is running: **a claim about this
repository is proven by reading the cited lines or running the command, never by finding
it plausible.** A verify report is a claim. A ticked checkbox is a claim. "This already
works" is a claim. A cycle was once archived carrying three false ones because each of
them read as reasonable and nobody checked.

## Commits and PRs

Conventional commits. **No AI attribution and no `Co-Authored-By` trailers.** Commit messages, PR
bodies, code comments and specs are written in English; `docs/` is Spanish.
