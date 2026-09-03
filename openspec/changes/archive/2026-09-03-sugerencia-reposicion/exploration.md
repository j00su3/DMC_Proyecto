# Exploration: sugerencia-reposicion (backlog #11)

## Current state

Backlog #11 depends on #10 (motor de alertas, archived 2026-09-02,
`openspec/changes/archive/2026-09-02-motor-alertas/`). Its infrastructure —
`EvaluadorDeAlertas`/`ReglasUmbral`, `AlertasRepo`, the `alertas` table, the SAVEPOINT
isolation mechanism, and the `alerta_tipo` pgEnum (already including
`sugerencia_reposicion`) — is live on `main`. #11's job is narrow: implement the one
alert type #10 deliberately left unproduced (its own `archive-report.md:239` names #11
as the direct successor).

## The S7 decision (verbatim, `docs/REVISION-ADVERSARIAL.md:225-239`)

> ### S7. Heurística de reposición ambigua
>
> **Afecta a:** ADR-0008.
>
> "Stock < N × promedio de salidas/ventas de 30 días" no define la unidad del promedio
> (¿promedio *diario*? ¿total del período?) ni qué pasa con productos con menos de 30
> días de historia o sin ventas (promedio 0 → nunca sugiere). Tal como está, dos
> implementadores producirían dos reglas distintas.
>
> **Resolución (2026-08-13):** ADR-0008 fijó la definición operativa única:
> `promedio_diario` = unidades salidas (`venta` + `salida`) de los últimos 30 días ÷ 30
> (**unidades/día**); `cobertura_dias` = `stock_actual` ÷ `promedio_diario`; se sugiere
> cuando `cobertura_dias < 14` (N fijo, configurable a futuro). Productos con menos de 7
> días de historia no se evalúan (entre 7 y 30, el promedio usa los días disponibles);
> `promedio_diario = 0` **nunca** sugiere — los sin rotación quedan cubiertos por
> `stock_bajo`/`quiebre`. Criterio (S7) agregado en Alertas.

S3 (`docs/REVISION-ADVERSARIAL.md:529-550`) is the companion marker: confirms
`sugerencia_reposicion` is explicit v1 PRD scope and names the exact architectural
tension this rule creates — it needs historical movimientos, not just the triggering
movement.

## The exact heuristic

`ADR-0008` lines 45-60 and `TECH-DESIGNv2.md:208-220` (authoritative doc, per
`CLAUDE.md`) restate it identically:

- `promedio_diario` = (venta+salida units, last 30 days) ÷ 30
- `cobertura_dias` = `stock_actual` ÷ `promedio_diario`
- suggest when `cobertura_dias < 14`
- <7 days of product history → don't evaluate
- 7-30 days of history → average over available days
- `promedio_diario = 0` → never suggest
- resolution is manual-only (encargado), per A10

## Affected areas

- `apps/api/src/alertas/repository.ts:10-15` — `TipoAlertaEvaluada = Exclude<TipoAlerta,
  'sugerencia_reposicion'>` is a deliberate D5 compile gate; `AlertasRepo.create()` is
  typed against it and currently cannot insert this tipo.
- `apps/api/src/alertas/service.ts:90-92` — `TIPOS_MANUALMENTE_RESOLVIBLES: readonly
  TipoAlertaEvaluada[] = ['discrepancia']` — same exclusion, second gate; unfixed,
  `resolver()` throws 409 for every `sugerencia_reposicion`.
- `apps/api/src/alertas/evaluador.ts:32-35` — `EvaluadorRepos = { alertas, auditoria }`
  has no movimientos access; the heuristic needs a new aggregate query dependency.
- `apps/api/src/movimientos/repository.ts:34-41` — `MovimientosRepo` only has
  `create()`/`listByProducto()`, no aggregate method for "sum of salida+venta over N
  days, first-movimiento date."
- `apps/api/src/db/schema.ts:410-437` — `alertas` table has no column for a suggested
  reorder quantity.
- Already correct, no change needed: `apps/api/src/db/schema.ts:397-402` (enum),
  `:444-446` (dedup index), `apps/api/src/movimientos/repository.ts` /
  `schema.ts:227-236` (date index + sign-per-tipo CHECK).
- `apps/api/src/alertas/service.ts:35-41` `registrarSiCorresponde()` — the 4 call sites
  (movimientos/service.ts, productos/service.ts::crearProducto,
  ventas/service.ts::confirmarVenta/anularVenta) are where the new rule must get wired
  in.

## Trigger mechanism (the framed "open question" — actually already decided)

1. **(a) Synchronous, in-transaction, on every movimiento (reuse #10's SAVEPOINT
   infra).** ADR-0008 lines 109-112 names this trade-off explicitly ("necesita leer
   movimientos históricos... con el volumen de un local único no debería pesar"), and
   TECH-DESIGNv2.md:181-183 names the SAVEPOINT as explicitly covering "error en la
   consulta del promedio de 30 días." This is the inherited decision, not a fresh one.
   - Pros: no new infra, reuses SAVEPOINT error isolation, consistent with every other
     alert rule's lifecycle/dedup/audit path.
   - Cons: adds a real query per relevant movimiento; needs a new evaluator dependency.
   - Effort: Low-Medium (mostly wiring, two type-gate fixes, one new repo method).
2. **(b) Compute-on-read/on-poll.** Never proposed anywhere in the docs; would break
   `AlertasRepo.list()`/`countAbiertas()`'s pre-materialized-row contract and bypass the
   create/dedup/audit path every other alert type uses. Effort: High, not aligned with
   existing contracts.
3. **(c) New scheduled job.** No scheduler exists anywhere (`render.yaml` has one `type:
   web` free-tier service, no cron; zero cron/node-cron/setInterval job infra found).
   Backlog #14 separately lists periodic verification/backup scheduling as still `⬜
   Pendiente` — confirming this project has never built that infra. Effort: High,
   requires inventing infra a free-tier Render deployment doesn't support without
   upgrading.

**Recommendation:** go with (a), stated in the proposal as inherited scope rather than a
fresh decision.

## Open questions for the proposal phase

1. Widen the two `TipoAlertaEvaluada`-based compile gates (repository.ts, service.ts) to
   include `sugerencia_reposicion`.
2. Define the new movimientos-aggregate port (sum of `venta`+`salida` units over the
   last 30 days, plus first-movimiento date, per producto).
3. Decide whether a suggested-quantity column is in scope for #11, or deferred — if in
   scope, it's a Neon migration that must be run manually before deploy (per
   `CLAUDE.md`'s deployment note).
4. Decide which movimiento tipos re-trigger evaluation of this rule (affects
   `stock_actual` even when they don't affect `promedio_diario`, e.g. an `entrada`).
5. No wireframe exists for `sugerencia_reposicion` in the Alertas screen beyond the
   generic table (backlog #13, still pending) — UI shape (with/without quantity) is
   undefined.

## Risks

- The `TIPOS_MANUALMENTE_RESOLVIBLES` gate (service.ts:90-92) compiles fine today and
  gives no signal until a real alert hits `resolver()` and is wrongly rejected with
  409 — easy to fix, easy to forget as a separate task from the repository/evaluator-
  layer gate.
- No suggested-quantity column exists; if design decides one is needed, that's a Neon
  migration that must be run manually before deploy.
- This is the first alert rule reading a table other than its triggering row inside the
  transaction — worth a dedicated index-usage acceptance criterion rather than assuming
  "shouldn't matter at this scale" is validated.
- No specific UI/wireframe found for `sugerencia_reposicion` beyond the generic Alertas
  screen (backlog #13, still pending) — UI shape (with/without quantity) is undefined.

## Ready for proposal

Yes.
