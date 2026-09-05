# Exploration: Operación local (backlog #14)

## Current state

`docs/BACKLOG.md:49`: "Verificación periódica de consistencia stock ↔ Σ(ledger); script de backup
`pg_dump` programado (Task Scheduler) hacia ubicación fuera del disco principal." Depends on #5
(archived). `openspec/changes/operacion-local/` did not exist before this exploration.

**Exact wording traced through source docs:**
- `docs/REVISION-ADVERSARIAL.md:443-466` (A5, Ronda 1) called backup/HTTPS/hosting "el hueco más
  grande de cobertura del set de ADRs" and resolved it into ADR-0009.
- `docs/adrs/0009-despliegue-local.md:31-34` (now **Reemplazado**): "un script de `pg_dump`
  programado (Task Scheduler / cron si se usa WSL) que vuelca la base ... a una ubicación distinta
  del disco principal" — written entirely in the context of local Docker Postgres.
- `docs/adrs/0010-despliegue-tiers-gratuitos.md` (current, supersedes 0009) moves Postgres to Neon
  and its Consequences section (:52-77) **never mentions backup at all**.
- Consistency-check half: `docs/REVISION-ADVERSARIAL.md:82` (C2) and `docs/TECH-DESIGNv2.md:112,
  361-362` ("se agrega una verificación periódica de consistencia (stock vs suma del ledger).
  Revisar antes de producción.").

**Critical corroboration found**: `docs/DRIFT.md:159-189` (**D-04**) already identifies this exact
ambiguity independently: "La decisión de backup quedó huérfana al reemplazar el ADR-0009, y el
backlog #14 la describe sobre un disco que ya no aloja los datos ... ejecutarlo tal como está
redactado no respaldaría nada." DRIFT.md recommends deciding and rewriting #14 for the Neon-hosted
reality, or explicitly accepting Neon's free-tier retention as the only backup. This is a
pre-existing project audit finding, not just this exploration's opinion.

## The central ambiguity, analyzed per half

**Half 1 — consistency check, server-side or local?** `render.yaml` (read in full) defines exactly
one service (`type: web`, `plan: free`) — no cron/background-worker service exists. Render Cron
Jobs require a paid tier, and ADR-0010 never evaluates them, consistent with the project's stated
zero-cost constraint. Nothing today invokes any check automatically. Options: a manual/
Task-Scheduler script hitting whichever `DATABASE_URL` is live, or a route triggered by a free
external mechanism — notably `.github/workflows/ci.yml` already exists (ADR-0010) and GitHub
Actions' `schedule:` trigger is a zero-cost mechanism already in this repo's toolchain, unlike
Render Cron.

**Half 2 — backup, local Docker or Neon prod?** ADR-0009's text is scoped to local disk and is
superseded. ADR-0010 moved data to Neon (which has its own managed backup/PITR story) but this is
never mentioned anywhere in `docs/` (confirmed by grep). `docs/DEPLOY-PLAN.md`'s existing Recovery
section (:507-554, read in full) already says "no rollback automático ... restauración desde el
historial de Neon — cuya retención en el tier gratuito hay que verificar" but has no `pg_dump`
script today — confirming this is exactly where the missing decision belongs. A literal
Task-Scheduler `pg_dump` against Neon's `DATABASE_URL` from the developer's personal machine is
mechanically possible but a fragile, single-point-of-failure production backup strategy.

## `stockActual` is a maintained running total — divergence is a bug signal, not routine drift

Confirmed at three levels: `apps/api/src/productos/repository.ts:39-42` (`CambiosProducto` has no
`stockActual` field; comment: "`aplicarDelta` is the only seam through which `stock_actual` ever
changes"), `docs/adrs/0005-update-atomico-condicional.md` (every mutation is one atomic conditional
`UPDATE` paired with a ledger insert inside `apps/api/src/db/uow.ts`'s single transaction), and
`docs/TECH-DESIGNv2.md:108-115` (C2: create/edit both forced through movimientos, edit schema
rejects `stock_actual` outright). This reframes "periodic verification" as a low-frequency
safety-net/incident-detector, not a reconciliation process expected to find routine drift.

## Reusable aggregate queries

`apps/api/src/movimientos/repository.ts` has `resumenRotacion` (30-day windowed, per-producto —
from #11) and `listByPeriodo`/`listRecientes` (row lists, no aggregation). **No existing
`SUM(cantidad) GROUP BY producto_id` all-time query exists** — a new one would be needed, likely
raw `sql\`...\`` following the `resumenRotacion` precedent.

## `scripts/` convention

No `scripts/` directory exists anywhere in the repo. Whatever #14 becomes would establish this
pattern for the first time — a real design decision (where it lives, how it's invoked, DB client
reuse vs. duplication).

## SDD-vs-deploy-pass routing (the central sizing question)

Backlog #14 is a split item:
1. **Backup** is pure infra/data-recovery with zero application code — a `deploy-pass`-shaped
   decision, exactly what DRIFT.md D-04 recommends writing into ADR-0010/DEPLOY-PLAN.md.
2. **Consistency check** has a plausible thin code slice (new aggregate query + script/route +
   tests) closer to the #6-#13 SDD pattern, but has no screen and arguably no route requirement —
   could go through a minimal SDD cycle or be folded into `deploy-pass` as a monitoring script,
   depending on the owner.

This is the first genuinely ambiguous routing case in this project's backlog history (#6-#13 all
had routes/screens and used the full SDD cycle without controversy).

## Recommendation

Do not run a single explore→propose cycle for the whole item as worded. Propose should present the
owner with the split-routing decision explicitly (backup → deploy-pass/DEPLOY-PLAN.md; consistency
check → small SDD cycle or folded into deploy-pass) rather than silently choosing, and should flag
that backlog #14's literal wording ("Task Scheduler hacia ubicación fuera del disco principal") no
longer matches ADR-0010's Neon-hosted reality.

## Risks

- Implementing #14 literally as worded would produce a backup mechanism that doesn't protect live
  Neon production data — the exact failure DRIFT.md D-04 already flagged.
- Running a full SDD cycle without resolving the split risks inflating the review budget for what
  is mostly a documentation/infrastructure decision.
- No scheduling infrastructure exists yet for either half; whichever mechanism is chosen is new
  infrastructure needing its own trade-off discussion.
- Render free tier's cold-start (~15 min idle, ~50s wake) makes an HTTP-endpoint + external-cron
  design for the consistency check unreliable unless something already keeps the service warm.

## Ready for proposal

Partially — propose can run, but its first move should be presenting the owner with the
split-routing decision (deploy-pass for backup vs. SDD-or-deploy-pass for the consistency check),
informed by the evidence above, rather than resolving it unilaterally.
