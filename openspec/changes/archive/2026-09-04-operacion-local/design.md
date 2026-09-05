# Design: Periodic Stock Consistency Check (backlog #14, consistency-check half)

## Technical Approach

One raw-SQL aggregate added to `MovimientosRepo`, run by a `tsx` script colocated with the
existing `apps/api/scripts/` seed-script convention, invoked weekly by a new GitHub Actions
`schedule` workflow against a read-only Neon credential. No route, no write path.

## Correction to ratified scope (flag for orchestrator, not a product decision)

Proposal/exploration both state `scripts/` would be a **repo-root** directory and "first use of
this convention." Codebase fact: `apps/api/scripts/{seed-encargado,seed-demo}.ts` (+ their
`.test.ts` files) already exist, wired through `apps/api/package.json` and root `package.json`'s
`pnpm --filter` delegation. D2 below follows this *existing* convention instead of inventing a
second, redundant top-level location — an architecture fact, but it contradicts the ratified
wording and should be corrected upstream.

## Architecture Decisions

| # | Decision | Choice | Alternatives | Rationale |
|---|---|---|---|---|
| D1 | Query location/shape | New `MovimientosRepo.verificarConsistenciaStock()`, one raw `sql` query: `LEFT JOIN productos p ON m.producto_id=p.id ... GROUP BY p.id,p.sku,p.stock_actual HAVING p.stock_actual <> COALESCE(sum(m.cantidad),0)` | (a) inline query in script; (b) fetch both datasets, diff in JS | Follows `resumenRotacion` precedent; keeps `vitest.integration.config.ts`'s `src/**/*.integration.test.ts` glob valid with zero config change; `HAVING` filters server-side, one round trip; (b) needs two full-table reads plus app-side matching |
| D2 | Script location/runtime/DB client | `apps/api/scripts/verificar-consistencia.ts`, `tsx`, `getDb()` from `../src/db/pool.js` | Repo-root `scripts/`; standalone `pg` client | Mirrors `seed-encargado.ts`/`seed-demo.ts` (dotenv/config, main-guard, try/catch→exit); reuses the one pool `db/pool.ts` already gates to |
| D3 | Workflow | `.github/workflows/consistencia-stock.yml`, `schedule: cron: '0 8 * * 0'` (Sun 08:00 UTC, pre-dawn ART); steps mirror `ci.yml` (`actions/checkout@v4`, `pnpm/action-setup@v4`, `setup-node@v4` node 22 + pnpm cache) then `pnpm install --frozen-lockfile` + `pnpm --filter @inventienda/api verificar:consistencia`; secret `NEON_READONLY_DATABASE_URL` → `DATABASE_URL` env | Daily cron (rejected, cost); reusing `ci.yml`'s ephemeral Postgres service (wrong DB) | A failed step is a red X plus GitHub's default failure email to the repo owner — proposal ruled out new notification infra; this default already satisfies it with zero new code |
| D4 | Read-only enforcement | Neon read-only Postgres role, manual owner step (agent cannot touch secrets/`.env*`) | Trusting script logic/review only | Mechanical enforcement: a buggy script cannot `INSERT`/`UPDATE` even in principle |
| D5 | Testing | Unit: fake-`Db` test on `verificarConsistenciaStock`; Integration: extend `movimientos/repository.integration.test.ts` (seed mismatch via direct `UPDATE`, assert detected, assert row counts unchanged after); Script: unit test calling the exported function with an injected fake repo, asserting the exit-code branch directly | Subprocess spawn to check exit code | Matches `seed-encargado.test.ts`'s exact precedent; direct invocation is simpler and already proven here |

## Manual step required before real wiring (D4) — owner-only, Neon SQL console

```sql
CREATE ROLE consistencia_readonly WITH LOGIN PASSWORD '<owner-generated>';
GRANT CONNECT ON DATABASE <dbname> TO consistencia_readonly;
GRANT USAGE ON SCHEMA public TO consistencia_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO consistencia_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO consistencia_readonly;
```

`ALTER DEFAULT PRIVILEGES` matters: a plain `GRANT SELECT ON ALL TABLES` only covers tables that
exist today — without it, the next `pnpm db:migrate` adds a table this role can't read, and
coverage silently narrows. Build `NEON_READONLY_DATABASE_URL` from this role; the agent cannot do
this (no secret/`.env*` access).

## Data Flow

    cron(weekly) → GH runner → pnpm install → tsx script → getDb(readonly URL)
        → verificarConsistenciaStock() → [] | [InconsistenciaStock]
        → console output + exit(0|1) → GH Actions pass/fail (+ owner email on fail)

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/src/movimientos/repository.ts` | Modify | Add `InconsistenciaStock`, `verificarConsistenciaStock()` |
| `apps/api/src/movimientos/repository.integration.test.ts` | Modify | New describe block, seeded mismatch |
| `apps/api/scripts/verificar-consistencia.ts` | Create | Entry point, console output, exit code |
| `apps/api/scripts/verificar-consistencia.test.ts` | Create | Unit test, fake repo |
| `apps/api/package.json` | Modify | `"verificar:consistencia": "tsx scripts/verificar-consistencia.ts"` |
| `package.json` | Modify | `"verificar:consistencia": "pnpm --filter @inventienda/api verificar:consistencia"` |
| `.github/workflows/consistencia-stock.yml` | Create | Weekly schedule workflow |

## Interfaces / Contracts

```ts
export interface InconsistenciaStock {
  productoId: string;
  sku: string;
  stockActual: number;
  sumaMovimientos: number;
  delta: number; // stockActual - sumaMovimientos
}
// MovimientosRepo gains:
verificarConsistenciaStock(): Promise<InconsistenciaStock[]>;
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Row→output formatting; exit branch (0 empty / 1 nonempty) | Fake repo, direct call, no subprocess |
| Integration | Real mismatch detected; call is read-only | Seed via direct `UPDATE`, assert row/count unchanged after |
| E2E | N/A — no UI/route | Workflow exercised once manually before merge, not automated |

## Threat Matrix

N/A for the routing/shell/subprocess/VCS-automation matrix — no subprocess, no PR automation, no
executable-file classification. Domain edge cases instead:

| Case | Expected behavior | Why |
|---|---|---|
| Zero productos | Exit 0, "No mismatches found. 0 productos checked." | Empty `GROUP BY` result, no error path |
| Producto with zero movimientos ever | No false positive | `crearProducto` (`productos/service.ts`) only skips the paired `ajuste` movimiento when `stockInicial === 0`; `productos.stock_actual` defaults to `0` (`db/schema.ts:169`) in that exact case, so `COALESCE(sum,0)=0` matches. `COALESCE` is load-bearing: a bare `sum()` over an empty `LEFT JOIN` group is `NULL`, and `HAVING x <> NULL` is never true, so a real mismatch on an untouched producto would go undetected without it |
| Neon connection failure | Exit 1, error logged | Same try/catch→exit(1) shape as `seed-encargado.ts`'s `main()`; never swallowed |

## Migration / Rollout

No schema migration. Requires the owner's manual Neon role creation (D4) and secret wiring before
the workflow can run for real; merging the workflow file first is safe — it will fail visibly
(expected) if triggered before the secret exists.

## Open Questions

- [ ] Secret name `NEON_READONLY_DATABASE_URL` — proposal left this "TBD by design"; confirm with
      owner before merge.
- [ ] Cron `0 8 * * 0` is a reasonable default, not owner-ratified the way cadence itself was.
