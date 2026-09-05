# Tasks: Periodic Stock Consistency Check (backlog #14, consistency-check half)

**Change**: `operacion-local` · **Artifact store**: hybrid (this file + Engram
`sdd/operacion-local/tasks`) **Inputs**: `proposal.md` (scoping decisions 1-2, ratified 2026-09-04,
including the correction that `apps/api/scripts/` already exists), `design.md` (D1-D5, File Changes,
Interfaces/Contracts, Threat Matrix), `specs/verificacion-consistencia-stock/spec.md` (5
requirements, 7 scenarios).

**Phase count: 2, not 1.** Smaller than #11 (4 files) but the repo-layer aggregate (D1) and the
script entry point (D2) are still genuinely sequential — the script's unit test fakes the repo
method's *contract*, so that contract must exist and be tested first. D3 (workflow YAML) is trivial
and folded into Phase 2 rather than given its own phase, per the orchestrator's scoping. D4 (Neon
role) is not implementation work at all — see the standalone manual task below. Strict TDD: every
behavior task is RED → GREEN.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~180-230 (repo method + `InconsistenciaStock` type + integration test ~90-110, script + unit test ~70-90, 2× one-line `package.json` scripts ~4, workflow YAML ~25-30) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk (default; not overridden) |
| Chain strategy | N/A (single PR) |

Decision needed before apply: No
Chained PRs recommended: No
400-line budget risk: Low

Rationale: 7 files total (2 new, 4 modified, 1 new workflow), no migration, no route, no frontend —
smaller than #11's 4-file precedent in behavioral surface even though the file count is comparable,
because two of the seven are one-line `package.json` script entries and the workflow file is
declarative YAML with no branching logic to review as carefully as application code. Matches #11's
single-PR precedent (unlike #12/#13, which needed chained PRs for row-level auth and a
frontend-dependent-on-route layer respectively). This change has neither.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Phases 1+2: `verificarConsistenciaStock`, `verificar-consistencia.ts`, both `package.json` scripts, workflow YAML | PR 1 (base = main) | `pnpm --filter @inventienda/api exec vitest run src/movimientos/repository.test.ts scripts/verificar-consistencia.test.ts` | `pnpm test:integration` — real Postgres, `repository.integration.test.ts`'s new describe block | Revert `verificarConsistenciaStock`/`InconsistenciaStock` from `repository.ts`, delete `scripts/verificar-consistencia.ts` and its test, remove both `"verificar:consistencia"` script entries, delete `.github/workflows/consistencia-stock.yml` — all four are additive and consumed by nothing else |

## Phase 1 — Repo aggregate query (D1)

- [x] 1.1 RED: `apps/api/src/movimientos/repository.integration.test.ts` — new describe block for
  `verificarConsistenciaStock()`. Seed a consistent producto (spec "Consistent producto reports no
  mismatch") and assert it is absent from the result. Seed a producto whose `stock_actual` is
  mutated via a direct `UPDATE` to diverge from its movimientos sum (spec "Mismatched producto is
  detected") and assert it appears in the result, identified by id/SKU (spec "Per-Producto Mismatch
  Identification" / "One of several productos mismatches"). Seed a producto created with
  `stockInicial = 0` and never touched again (spec "Zero-Movement Producto Handling" / "Producto
  never touched since creation") and assert it is treated as consistent, not flagged, not errored.
  Assert row/column values in `productos` and `movimientos` are unchanged after the call (spec
  "Read-Only Execution" / "Running the check does not alter producto or movimiento data").
- [x] 1.2 GREEN: `apps/api/src/movimientos/repository.ts` — export `InconsistenciaStock` (`{
  productoId, sku, stockActual, sumaMovimientos, delta }`) and add
  `verificarConsistenciaStock(): Promise<InconsistenciaStock[]>` per D1's exact SQL shape: `LEFT
  JOIN productos p ON m.producto_id = p.id ... GROUP BY p.id, p.sku, p.stock_actual HAVING
  p.stock_actual <> COALESCE(sum(m.cantidad), 0)`. The `COALESCE` is load-bearing (design.md Threat
  Matrix: a bare `sum()` over an empty `LEFT JOIN` group is `NULL`, and `HAVING x <> NULL` is never
  true) — this is what makes 1.1's zero-movement scenario pass without special-casing.
- [x] 1.3 Integration (real Postgres, `pnpm test:integration`): confirm 1.1's fixtures pass against
  the real `HAVING`/`COALESCE` clause, not just a mocked query builder — this SQL shape has no unit
  test of its own by design (D5: unit coverage lives at the script layer with a fake repo instead).

**Satisfies**: design D1. Spec (verificacion-consistencia-stock) "Stock-Ledger Consistency
Detection" (both scenarios), "Zero-Movement Producto Handling", "Per-Producto Mismatch
Identification", "Read-Only Execution" — all at the repository layer.

## Phase 2 — Script, wiring, and workflow (D2, D3)

Depends on: Phase 1 (`verificarConsistenciaStock()` must exist with its final signature).

- [x] 2.1 RED: `apps/api/scripts/verificar-consistencia.test.ts` — unit test calling the script's
  exported function with an injected fake repo (D5's precedent: `seed-encargado.test.ts`'s shape,
  no subprocess spawn). Assert: empty result → exit code 0, console output states zero mismatches
  (spec "Exit-Code Contract" / "No mismatches found across all productos"; design.md Threat Matrix
  "Zero productos" case: "No mismatches found. 0 productos checked."). Non-empty result → exit code
  1, console output names each mismatching producto (spec "Exit-Code Contract" / "At least one
  mismatch found"). A repo call that throws (simulated connection failure) → exit code 1, error
  logged, never swallowed (design.md Threat Matrix "Neon connection failure" case).
- [x] 2.2 GREEN: `apps/api/scripts/verificar-consistencia.ts` — entry point per D2: `tsx`, imports
  `getDb()` from `../src/db/pool.js`, main-guard + try/catch→exit shape mirroring
  `seed-encargado.ts`/`seed-demo.ts`, calls `verificarConsistenciaStock()`, logs per-mismatch output,
  sets `process.exitCode` per 2.1's branches.
- [x] 2.3 `apps/api/package.json` — add `"verificar:consistencia": "tsx
  scripts/verificar-consistencia.ts"` per design.md's File Changes table.
- [x] 2.4 root `package.json` — add `"verificar:consistencia": "pnpm --filter @inventienda/api
  verificar:consistencia"` per design.md's File Changes table.
- [x] 2.5 `.github/workflows/consistencia-stock.yml` — new workflow per D3: `schedule: cron: '0 8 *
  * 0'` (weekly, Sun 08:00 UTC — proposal scoping decision 2, ratified); steps mirror `ci.yml`
  (`actions/checkout@v4`, `pnpm/action-setup@v4`, `setup-node@v4` node 22 + pnpm cache), then `pnpm
  install --frozen-lockfile` + `pnpm --filter @inventienda/api verificar:consistencia`; env
  `DATABASE_URL` sourced from secret `NEON_READONLY_DATABASE_URL` (design.md Open Questions: name
  not owner-ratified — flag for confirmation before merge, per design.md's own open question). Low
  risk, declarative YAML — no independent test; validated by GitHub's own workflow syntax check on
  push and, per design.md's Testing Strategy, one manual trigger before merge is the only exercise
  planned (not automated).

**Satisfies**: design D2, D3. Spec (verificacion-consistencia-stock) "Exit-Code Contract" (both
scenarios). Spec's Non-Goals confirm workflow syntax/scheduling/secrets are explicitly out of the
behavioral spec — D3 is implemented here as an infrastructure task, not a spec-driven one.

---

## Manual owner action required (D4) — NOT an apply-agent task

**The apply agent cannot perform this step.** It requires the Neon SQL console and GitHub repo
secret settings, both of which are outside any tool this agent can call (no `.env*`/secret access,
per this repo's `CLAUDE.md`). This is not a checkbox the apply agent should ever tick on the owner's
behalf — it is listed here so the change's completion state is honest about what still blocks the
workflow from running for real.

**Owner action, Neon SQL console** (design.md D4):

```sql
CREATE ROLE consistencia_readonly WITH LOGIN PASSWORD '<owner-generated>';
GRANT CONNECT ON DATABASE <dbname> TO consistencia_readonly;
GRANT USAGE ON SCHEMA public TO consistencia_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO consistencia_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO consistencia_readonly;
```

`ALTER DEFAULT PRIVILEGES` is not optional: without it, the next `pnpm db:migrate` adds a table this
role cannot read, and read coverage silently narrows (design.md).

**Owner action, GitHub repo settings**: build a `NEON_READONLY_DATABASE_URL` connection string from
the role above and add it as a new GitHub Actions secret (proposal scoping decision 1, ratified) —
read-only, not the full read-write credential `pnpm db:migrate` uses. Confirm the secret name itself
(`NEON_READONLY_DATABASE_URL`) before merge — design.md flags this exact name as proposed-but-not-
owner-ratified in its Open Questions.

Per design.md's Migration/Rollout: merging Phase 2's workflow file before this manual step is safe —
the scheduled run will fail visibly (red X) until the secret exists, which is the expected,
documented state, not a defect.

---

## Dependency Graph

```
Phase 1 (verificarConsistenciaStock, InconsistenciaStock)
        │
        ▼
Phase 2 (scripts/verificar-consistencia.ts, package.json ×2, workflow YAML)

Manual owner action (D4) — no code dependency, but the workflow only
produces a real (non-failing) result once it is done; independent of
Phase 1/2's merge order.
```

## Open Questions Carried Forward

- [ ] Secret name `NEON_READONLY_DATABASE_URL` — proposal left this "TBD by design"; confirm with
  owner before merge (design.md Open Questions).
- [ ] Cron `0 8 * * 0` is a reasonable default, not owner-ratified the way the weekly cadence itself
  was (design.md Open Questions).
