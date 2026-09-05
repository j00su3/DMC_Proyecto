# Proposal: Periodic Stock Consistency Check (backlog #14, consistency-check half only)

## Intent

Backlog #14 was split (see `exploration.md`): the backup half is orphaned/stale (written for
local-disk Postgres, superseded by ADR-0010's Neon migration, already flagged as `docs/DRIFT.md`
D-04) and is handled separately via `docs/DEPLOY-PLAN.md` + an ADR update — not by this change.
This proposal covers only the other half: a periodic check that `producto.stockActual` matches
`SUM(movimientos.cantidad)` per producto. Since every stock write goes through `aplicarDelta`
inside `UnitOfWork` (ADR-0005), a divergence signals a bug or data corruption, not routine drift —
this is a low-frequency safety-net, not a reconciliation job expected to find anything.

## Scope

### In Scope
- One new aggregate query: `SUM(cantidad) GROUP BY producto_id` across all movimientos, compared
  against `productos.stock_actual`, following `resumenRotacion`'s raw-SQL precedent.
- A standalone script under `apps/api/scripts/` (correction, design phase: this directory already
  exists — `seed-encargado.ts`/`seed-demo.ts` — this is not a new convention, contra this
  paragraph's original wording) that runs the query, logs any mismatch, and exits non-zero if one
  is found.
- A new GitHub Actions workflow (`schedule:` trigger) that runs the script against Neon production
  **weekly**. Rationale: this detects corruption, not drift — a bug would surface and persist across
  a week's runs, so daily cadence buys detection speed the project doesn't need at 7x the run cost.
- Tests for the query and the mismatch/exit-code logic.

### Out of Scope
- The backup/`pg_dump` half of #14 — tracked separately via `docs/DEPLOY-PLAN.md`/ADR update, not
  application code, not this change's concern.
- Any new UI/screen/route — this is read-only tooling, not a product feature.
- Any change to how `movimientos`/`stockActual` are written — read-only, per the pattern already
  established by #12/#13.

## Capabilities

### New Capabilities
- `verificacion-consistencia-stock`: the aggregate query, the script, and the scheduled workflow
  that together detect stock/ledger divergence.

### Modified Capabilities
None.

## Approach

The script reuses `apps/api`'s existing Drizzle connection/schema (pnpm workspace import) rather
than duplicating a DB client — it is not served through Fastify and needs no route. On mismatch,
the script exits non-zero, failing the workflow run (visible red X) — no email/Slack/webhook, since
this repo has no such infrastructure today.

## Scoping decisions (ratified by the owner, 2026-09-04)

1. **New GitHub Actions secret, confirmed**: `.github/workflows/ci.yml` today only ever talks to an
   ephemeral local Postgres container — it has no Neon `DATABASE_URL` wired in. The owner confirmed
   adding the real Neon connection string as a new GitHub Actions secret **using a read-only Neon
   role/credential**, not the full read-write connection string used by `pnpm db:migrate` — defense
   in depth in case the workflow, a third-party Action it depends on, or the script itself is ever
   compromised or buggy. A `schedule`-triggered workflow only ever runs the code already merged to
   the default branch (never attacker-controlled PR code), so the public-repo exposure the owner
   asked about does not apply the way it would for a `pull_request`-triggered workflow — but the
   read-only-credential mitigation stands regardless, as ordinary defense in depth.
2. **Cadence, confirmed**: weekly, as proposed.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/movimientos/repository.ts` | Modified | New all-time SUM-by-producto query |
| `apps/api/scripts/` (existing dir) | New file | Consistency-check script |
| `.github/workflows/` (new file) | New | Scheduled workflow, weekly cron |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| New Neon secret in GitHub Actions widens prod-credential exposure | Medium | Owner must explicitly approve; scope secret read-only if Neon supports it |
| Weekly cadence delays detection of a corruption bug | Low | Bug persists across writes until fixed, so a week's delay is acceptable for this scale |

## Rollback Plan

Delete the workflow file to stop scheduled runs; the script and query are read-only and additive,
so no data or behavior reverts are needed.

## Dependencies

- #5 (productos) — satisfied, archived, live on main.

## Success Criteria

- [ ] Query correctly flags a manually-introduced mismatch in a test fixture.
- [ ] Workflow runs on schedule against Neon and exits non-zero on a real mismatch.
