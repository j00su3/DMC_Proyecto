# Exploration: Fundaciones del monorepo (BACKLOG.md #1)

### Current State
Greenfield project. No code, no package.json, not a git repository. Only planning docs exist:
PRD.md, TECH-DESIGN.md (v1, superseded), TECH-DESIGNv2.md (current, dated 2026-08-13), REVISION-ADVERSARIAL.md,
BACKLOG.md, design.md, and adrs/0001–0009. BACKLOG.md item #1 "Fundaciones del monorepo" is the
first item, has no dependencies, and every other item (#2–#14) transitively depends on it — it is
the foundation all subsequent SDD changes build on. Getting its structural decisions wrong (folder
layout, package manager, migration tooling) has the highest blast radius of any item in the backlog.

### Decisions the docs ALREADY make (do not relitigate — record and follow)

**Monorepo shape** (ADR-0001, TECH-DESIGNv2 "Arquitectura de componentes"):
- Two components in one "lightweight monorepo": backend API + frontend SPA. Single deployable
  backend process. No separate alerts worker (rejected deliberately — evaluated in-transaction).

**Backend stack** (ADR-0002, ADR-0004, TECH-DESIGNv2):
- Node.js + TypeScript backend.
- **Fastify** as web framework, specifically with **`fastify-type-provider-zod`** — chosen because
  it validates requests at runtime AND generates the OpenAPI doc from the same Zod schemas natively
  (no parallel tooling). This was compared against Express+Prisma (rejected: Zod→OpenAPI pipeline
  would be manual, `$executeRaw` needed for the atomic UPDATE), Hono+Drizzle (rejected: smaller
  ecosystem for session/rate-limit middleware), NestJS+Prisma (rejected: decorator-based OpenAPI,
  not Zod-based; oversized for a one-person team).
- **Drizzle** as ORM — SQL-first, chosen specifically so the atomic conditional UPDATE
  (`stock >= :n AND activo = true`, ADR-0005) and SAVEPOINT-wrapped transactions (ADR-0008) can be
  written as raw-ish SQL without fighting ORM abstraction.
- **`@fastify/cookie`** + a custom session store (session table in Postgres) — no external auth
  provider (ADR-0007). **`@fastify/rate-limit`** for login rate-limiting/lockout.
- Cookie: `httpOnly` + `SameSite=Lax` (Secure conditioned on deployment — not needed for item #1
  itself but the cookie plugin belongs in the foundation's plugin wiring).

**Frontend stack** (ADR-0002, TECH-DESIGNv2):
- React + TypeScript SPA.
- **TanStack Query** for server state (fetch/cache/refetch, alert polling). Not required to be
  wired to real endpoints in item #1 (auth/data endpoints come later), but the dependency and
  a basic API client scaffold are reasonable foundation output.

**API contract pipeline** (ADR-0004):
- REST/JSON, resource-organized, standard HTTP verbs.
- **Code-first**: Zod schemas defined once in the backend → OpenAPI document generated from them
  (via `fastify-type-provider-zod` + its OpenAPI generation, e.g. `@fastify/swagger` +
  `fastify-type-provider-zod`'s `createJsonSchemaTransform`) → TS types consumed by the SPA are
  derived from that same contract (not hand-duplicated). The OpenAPI spec is a generated artifact,
  never hand-authored/edited.
- Explicitly rejected: tRPC (couples contract to a TS client, blocks future non-TS fiscal
  integration), GraphQL (over-engineering for this endpoint set).
- **Error envelope, fixed for the whole API**: `{ error: { code, message, details? } }` with the
  matching HTTP status (400/401/403/404/409...).
- **Pagination, fixed for the whole API**: list endpoints accept `?page&pageSize` and respond
  `{ data, page, pageSize, total }`.

**Database** (ADR-0003, ADR-0009):
- **PostgreSQL**, relational. Rejected alternatives: event-sourced/derived stock (costly reads),
  SQLite (single-writer, insufficient for POS concurrency model).
- Local deployment: **Postgres via Docker/Docker Compose** specifically so the environment is
  reproducible/portable for a later move to another machine or hosting — this is a stated reason
  for Docker over native Postgres install, not an incidental choice. No HTTPS, `localhost`-only
  access in v1 (ADR-0009). Backend itself runs as a local Node process (NOT necessarily
  containerized — ADR-0009 says "Postgres vía Docker + backend Node como proceso local"). This
  means item #1's Docker Compose scope is Postgres-only; the backend does not need a Dockerfile/
  compose service for v1, though nothing in the docs forbids adding one.
- Migration strategy is NOT named explicitly, but "infraestructura de migraciones" is explicitly in
  scope for item #1 (BACKLOG row), and Drizzle is the fixed ORM — the natural/implied tool is
  **Drizzle Kit** (`drizzle-kit generate` + a migrate script), since introducing a second migration
  tool alongside Drizzle would contradict the SQL-first rationale in ADR-0002. This is an inference,
  not an explicit doc decision — flag it as a proposal-stage decision, low-risk given Drizzle is
  fixed.

**Testing** (external context, not in docs): Strict TDD Mode is enabled project-wide per the SDD
context; Vitest is the recommended (unconfirmed) test runner. TECH-DESIGNv2 does not mention a test
runner at all — this is entirely an orchestrator/project-level constraint, not a design-doc
decision. Item #1 must set up the test runner (Vitest recommended) for both backend and frontend
packages since it is the foundational package.json/tooling item, and Strict TDD means the
foundational scaffolding itself (Fastify plugin registration, error envelope, pagination helper,
Drizzle client wiring, Zod→OpenAPI generation) should be built test-first where testable (e.g. a
health check endpoint, error envelope shape, pagination response shape) rather than purely
scaffolded by hand.

**Deployment posture** (ADR-0009): local single-developer machine, no CI/CD is mandated or implied
by any ADR. Backup via `pg_dump` script (Task Scheduler) is scoped to a LATER backlog item (#14
"Operación local"), not item #1 — item #1 only needs the migrations infra and Compose file, not the
backup script.

### Open questions the docs do NOT answer (proposal-stage decisions needed)

1. **Package manager**: pnpm vs npm workspaces vs yarn — not mentioned anywhere. pnpm workspaces is
   the common pairing with Fastify/Drizzle/Vite monorepos and is disk-efficient, but this is an
   unconstrained choice.
2. **Monorepo build/task orchestration tool**: plain npm/pnpm workspaces vs Turborepo/Nx — not
   mentioned. Given "monorepo liviano" (lightweight monorepo) is the explicit qualifier in ADR-0001,
   a heavier tool like Nx would arguably contradict the stated intent; Turborepo is lighter-weight
   but still adds a caching/pipeline layer that isn't obviously needed for a 2-package repo. Plain
   workspace scripts may be the most consistent choice with "liviano," but this needs an explicit
   proposal-stage call.
3. **Exact folder/package names**: not specified (e.g. `apps/api` + `apps/web`, or `backend`/
   `frontend`, or `packages/*`). No naming convention given in any doc.
4. **Node.js version**: not pinned anywhere (no `.nvmrc`, no engines field mentioned, no LTS
   version stated in any ADR or design doc).
5. **OpenAPI generation tooling specifics**: ADR-0004/ADR-0002 name `fastify-type-provider-zod` as
   the mechanism but do not name the companion doc-serving package (commonly `@fastify/swagger` +
   `@fastify/swagger-ui`, or `fastify-type-provider-zod`'s own JSON Schema transform helpers). Also
   unspecified: whether the OpenAPI JSON is written to disk as a build artifact (for the SPA's
   type-generation step) or served only at runtime — this matters for the Zod→OpenAPI→TS types
   pipeline mechanics (e.g., using `openapi-typescript` against a generated spec file requires the
   spec to exist as a file, not just be served dynamically).
6. **TS type generation tool for the SPA**: not named. Common choices given a generated OpenAPI doc:
   `openapi-typescript` (types only) or `openapi-typescript-codegen`/`orval` (types + client). Docs
   only say "de la que se generan los tipos TS de la SPA" — mechanism unspecified.
7. **Linting/formatting**: no ESLint/Prettier/Biome mention anywhere in PRD, TECH-DESIGNv2, or ADRs.
8. **CI**: no GitHub Actions or any CI pipeline mentioned in any doc — ADR-0009 is exclusively about
   local single-machine deployment. CI is very likely out of scope for item #1 given the "local
   dev, one person" framing, but this is a silence, not an explicit exclusion, so the proposal
   should state the assumption explicitly (recommend: skip CI in item #1, revisit if desired later).
9. **Migration runner specifics**: Drizzle Kit is implied (see above) but not named; also unspecified
   whether migrations run manually (`drizzle-kit migrate`) or via an npm script wired into a
   Compose-adjacent bootstrap step.
10. **Health-check / bootstrap endpoint**: not mentioned but is a reasonable, low-risk TDD-first
    first slice to prove the whole pipeline (Fastify up, error envelope, Drizzle connects to the
    Compose Postgres) before item #2 (auth) begins.

### Git repository state
Confirmed: the project directory is NOT a git repository yet (`git rev-parse --show-toplevel`
context states "NOT a git repository yet"). `git init` (plus an initial `.gitignore` for
node_modules/dist/.env) must happen as part of or immediately before this change — no prior repo
to reconcile with (TECH-DESIGNv2 explicitly calls this "Greenfield — se construye desde cero, sin
repos previos que reconciliar").

### Approaches (only where docs are silent)

1. **Package manager + orchestration: pnpm workspaces, no Turborepo/Nx** — plain `pnpm-workspace.yaml`
   with root scripts (`pnpm -r build`, `pnpm --filter api test`, etc.)
   - Pros: matches "monorepo liviano" intent exactly; zero extra tool to learn/configure; pnpm is
     fast and disk-efficient; fully sufficient for a 2-package repo.
   - Cons: no build caching or task graph if the repo grows; cross-package scripts must be wired by
     hand in root package.json.
   - Effort: Low

2. **Package manager + orchestration: pnpm workspaces + Turborepo** — adds `turbo.json` pipelines for
   build/test/lint caching across packages.
   - Pros: caching pays off once test/build times grow; nice DX for running "test everything changed";
     easy to add later without restructuring.
   - Cons: extra config file and concept to maintain for a repo currently at 2 packages; arguably
     contradicts "liviano" framing this early; another dependency surface.
   - Effort: Low-Medium

   **Recommendation**: Option 1 (pnpm workspaces, no orchestration tool) for item #1. Turborepo can
   be added later non-destructively if build times become a pain point — nothing in the ADRs commits
   to it either way, and starting minimal is consistent with ADR-0001's explicit "monorepo liviano"
   and ADR-0002's one-person-team framing.

3. **OpenAPI → TS types tool: `openapi-typescript`** (types-only, generate a `.d.ts`/`.ts` file from
   the OpenAPI JSON, SPA calls its own thin `fetch` wrapper using those types) vs **`orval`**
   (generates both types AND a typed client/TanStack Query hooks from the OpenAPI spec).
   - `openapi-typescript`: Pros — minimal, unopinionated, easy to reason about, plays well with a
     hand-written fetch wrapper around TanStack Query. Cons — no generated client, some boilerplate
     per endpoint.
   - `orval`: Pros — can generate TanStack Query hooks directly, less boilerplate as the API grows.
     Cons — heavier tool, more generated surface to keep in sync, another config file.
   - Effort: Low for either at this scale.

   **Recommendation**: `openapi-typescript` for item #1 — it's the minimal piece that satisfies
   "tipos TS de la SPA" from ADR-0004 without over-committing to a client-generation tool before any
   real endpoints exist (auth is item #2, first real domain data is item #4/#5). Revisit `orval` once
   there are enough endpoints that hand-written client boilerplate hurts.

### Risks
- Node version and package manager are unconstrained; picking them at proposal time is a one-way
  door for every later backlog item (all 13 remaining items build on this monorepo) — get explicit
  sign-off before sdd-tasks/sdd-apply, not silently in code.
- The Zod→OpenAPI→TS pipeline has multiple viable wiring approaches (spec written to disk vs served
  only at runtime); item #1 must decide this concretely since automated TS type generation for the
  SPA depends on it, and no ADR pins the mechanism.
- Migration tooling (Drizzle Kit) is inferred, not stated — confirm during proposal rather than
  assuming.
- Docker Compose scope: ADR-0009 says Postgres runs in Docker but backend runs as a local Node
  process (not containerized) in v1 — a proposal that containerizes the backend too would go beyond
  what the ADRs currently commit to; flag as an explicit scope decision if considered.
- Backup script (`pg_dump`/Task Scheduler) belongs to backlog item #14, not item #1 — do not pull it
  into this change's scope.
- Strict TDD + a foundations item is an unusual combination (most of item #1 is scaffolding, not
  business logic); the proposal should identify which specific pieces are meaningfully testable
  test-first (error envelope shape, pagination helper, a health endpoint, Drizzle connection) versus
  pieces that are pure configuration (tsconfig, workspace wiring, Docker Compose file) where TDD
  does not meaningfully apply.

### Ready for Proposal
Yes. The design docs (TECH-DESIGNv2.md, ADR-0001/0002/0003/0004/0009) fix every architecturally
significant decision for this item: monorepo shape, backend framework (Fastify+
fastify-type-provider-zod), ORM (Drizzle), database (Postgres via Docker Compose), API contract
style (REST/JSON, code-first Zod→OpenAPI→TS), error envelope, and pagination contract. The
remaining gaps (package manager, exact folder names, Node version, OpenAPI-to-TS tool, lint/format
tooling, CI) are conventional/tooling choices with low architectural risk that sdd-propose should
resolve explicitly and record, not defer further. Recommend surfacing the package-manager/
orchestration-tool and OpenAPI-to-TS-tool choices to the user as explicit proposal decisions since
they affect every subsequent backlog item.
