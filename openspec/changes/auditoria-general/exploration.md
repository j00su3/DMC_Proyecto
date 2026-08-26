# Exploration: auditoria-general

Backlog item **#2.2 — Sistema de auditoría general**. Depends on #2 (done). Blocks **#3**
(gestión de usuarios) and **#4** (gestión de proveedores); both list #2.2 as a dependency.

## Current State

### Decisions already closed — do NOT re-litigate

Two ADRs were written on 2026-08-26 specifically to constrain this change:

- **[ADR-0011](../../../docs/adrs/0011-claves-primarias-uuid.md)** — domain entities use `uuid`
  primary keys with `defaultRandom()`. `auditoria.entidad_id` is `uuid` and carries **no foreign
  key** (PostgreSQL has no polymorphic FKs); that is deliberate, since an audit row must survive
  its subject.
- **[ADR-0012](../../../docs/adrs/0012-frontera-auditoria-y-ledger.md)** — `auditoria` and
  `movimientos` are separate tables, bound by six rules: the decision test (units moved →
  `movimientos`, record field changed → `auditoria`), no double-writing, an audit service signature
  that accepts no quantities, a sensitive-field denylist headed by `hash_contrasena`, two boundary
  tests, and a ban on naming either table `historial`.

Those close the hard architectural questions. What remains is product scope.

### Schema and repository conventions (`apps/api`)

Only `usuarios` and `sesiones` exist in `src/db/schema.ts` today, so `auditoria` would be the
**third domain table ever created**. The repository pattern is an interface plus a `DrizzleXxxRepo`
class over `Db`, wired through `src/plugins/repos.ts` — a fastify-plugin that decorates
`app.repos` and stays overridable from tests. Migrations are Drizzle Kit; two exist so far, both
small and additive.

### No transaction precedent exists — verified

`rg "\.transaction\(" apps/api/src` returns **nothing**. `changePassword` performs
`updatePassword` and `deleteOthers` as two separately awaited calls, not atomically. Whatever this
change decides about transaction boundaries, it will be the first place the Drizzle transaction API
is exercised in this codebase, and it needs its own test coverage.

### The codebase already names this change

`src/auth/service.ts:106`, directly above `changePassword`:

> `// hook point backlog #2.2's audit change will use once immutable event rows`

Verified in place. That is the pre-flagged first call site, left by the #2.1 author.

### First consumers

`openspec/changes/gestion-usuarios/exploration.md` (explored, not yet proposed) enumerates the
`UsuariosRepo` surface #3 needs — `create`, `update`, `setActivo`, `setRol`, plus a
last-encargado guard. Every non-read operation there is an audit call-site candidate. That
exploration independently flagged the same gap #2.2 exists to close generically. `#4`
(proveedores) has no exploration yet; its call sites are inferred from the backlog line.

### Nothing asks for a read path — verified

`docs/PRD.md`, `docs/design.md` and `docs/TECH-DESIGNv2.md` were searched for
`auditor|historial|traza|rastro`. Every PRD audit requirement is **movement**-scoped ("el 100 % de
los movimientos queda registrado con fecha, usuario y motivo"). `design.md`'s only hit is a footer
note inside the movement-registration modal. `TECH-DESIGNv2.md` names `auditoria` only to draw the
ADR-0012 boundary — no columns, no endpoint, no UI.

**No product document requests a read UI or report over a record-change trail.** Whether v1 needs
a read endpoint at all is therefore undefined product scope, not an omission to be filled in
silently.

### Conventions to reuse

Error envelope via `AppError` / `toErrorEnvelope()` (`src/lib/errors.ts`), pagination via
`src/lib/pagination.ts`, the code-first Zod → `openapi.json` → `schema.d.ts` pipeline gated
byte-identically by `pnpm contract:check`, and the plugin registration order in `app.ts` (auth
plugin before route plugins).

## Affected Areas

| Area | Change |
|------|--------|
| `apps/api/src/db/schema.ts` | New `auditoria` table (uuid pk, `entidad_id uuid` with no FK per ADR-0011, jsonb snapshots) |
| `apps/api/drizzle/000X_*.sql` + `meta/` | New additive migration |
| `apps/api/src/auditoria/` (new) | Repository + service; signature admits no quantity parameter (ADR-0012 rule 3) |
| `apps/api/src/plugins/repos.ts` | Extend `Repos` with `auditoria` |
| `apps/api/src/auth/service.ts` | `changePassword` — the pre-flagged first call site |
| `apps/api/src/routes/auditoria.ts` | Only if the read-endpoint fork is scoped in |

## Approaches

### A. Write-only service for v1 (no read endpoint)

Matches the backlog wording literally, is the smallest and most reviewable slice, and is
consistent with the verified finding that no document asks for a read path.

**Against:** the non-repudiation value stays practically inert until something can read the trail.
Database-console access is an operational workaround, not a designed capability. Effort: low–medium.

### B. Write service plus a minimal internal read endpoint

`GET /api/auditoria?entidad&entidadId`, encargado-only, reusing `lib/pagination.ts`. Makes the
guarantee actually exercisable.

**Against:** expands scope past the backlog line and invents a DTO and query shape with zero
product guidance, adding a full contract-pipeline surface for consumers that do not exist yet.
Effort: medium.

Both forks are orthogonal to the transaction-boundary question.

### The denylist question, reported not reopened

ADR-0012 rule 4 binds the snapshots to a **denylist** headed by `hash_contrasena`. The codebase's
one shipped precedent for "which fields cross a boundary" is the opposite — `toDto()` in
`src/routes/auth.ts` is an explicit **allowlist**, further defended by the `usuarioDto` Zod
response schema stripping unknown keys at serialisation (verified: a field injected into `toDto`
never reaches the response).

The trade-off, for the design phase to weigh: a denylist is forward-compatible with new
non-sensitive columns but **fails open** on a future sensitive column someone forgets to list; an
allowlist **fails closed** but must be updated whenever a column is added. ADR-0012 already chose
the denylist. Recorded here so the design phase decides with the tension visible, not to reopen it.

## Recommendation

None — exploration phase. The architecture is already settled by ADR-0011/0012. The proposal
phase's real work is scoping the two forks and answering the open questions below.

## Risks

- No product doc specifies a read path, a retention policy, or an enumerated action set. More
  **product** questions remain open than technical ones.
- If the design phase misses the `changePassword` call site, the exact non-repudiation case
  ADR-0012 was written for — #3's temporary-password flow — stays unsolved even after #2.2 ships.
- No `db.transaction()` precedent exists anywhere; this change or the first #3/#4 call site is the
  first to exercise it.
- #3 and #4 both hard-depend on #2.2, so a loose schema or signature decision here is inherited by
  both.

## Open Questions for the User

1. Is a read path in scope for v1, or write-only?
2. If reads are in scope, who can read — encargado only, or depósito read-only as well?
3. Must an audit write share a database transaction with the change it records?
4. What exactly counts as an auditable action? Failed attempts? Reads? Is logical deletion its own
   `accion`, distinct from an update?
5. Retention — any purge or archival, or unbounded for v1?
6. Is the denylist one global list keyed by column name, or per entity?
7. What are `entidad_id` and `datos_previos` on a creation event, where no prior row existed?

## Ready for Proposal

Yes. ADR-0011/0012 resolve the hard architecture; `sdd-propose` needs to scope the two forks and
turn the seven questions into explicit decisions.
