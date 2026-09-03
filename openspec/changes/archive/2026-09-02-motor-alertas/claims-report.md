# Claims Report: motor-alertas

**Verified revision:** `a1f68d08510ab53c0bcdba894272810e9a417d1b`
**Verified on:** 2026-09-02
**Sources:** verify-report.md, archive-report.md, tasks.md, PR #153-#158, docs/BACKLOG.md, docs/DEPLOY-PLAN.md

Verified retroactively: the `claims-gate` `PreToolUse` hook is configured in
`inventienda/.claude/settings.json`, but this session's project root is the parent `DCM_Proyecto`
directory, so the hook never loaded and never gated any of this cycle's six merges (#153-#158).
This report closes that gap after the fact, matching the convention established for
`anulacion-venta` earlier this session. Steps 3-5 of the gate procedure (reading cited lines,
running commands, mutating tests) were delegated cold to an isolated `general-purpose` agent
carrying the `claims-verifier` persona verbatim, since the project-scoped `claims-verifier`
subagent type is unavailable in this session for the same project-root reason. Three claims (12,
15, 22) required the verifier to independently re-perform mutation-probing already done once by
the orchestrator directly (during archive prep) — deliberately redundant, since these are the
single most load-bearing correctness proofs of the entire change.

| # | Claim (verbatim) | Source | How it was proven | Verdict |
| --- | --- | --- | --- | --- |
| 1 | "pnpm --filter api test exits 0, 552/552 passed, 39 files" | verify-report.md:51-52 | Ran the command: 552/552, exit 0 | CONFIRMED |
| 2 | "pnpm --filter web test exits 0, 525/525 passed, 83 files" | verify-report.md:55-56 | Ran the command: 525/525, exit 0 | CONFIRMED |
| 3 | "pnpm test:integration exits 0, 159/159 passed, 18 files (real Docker Postgres)" | verify-report.md:61-62 | Ran against the live container: 159/159, exit 0 | CONFIRMED |
| 4 | "pnpm typecheck, pnpm lint, pnpm contract:check all exit 0, zero diff" | verify-report.md:36-45 | Ran all three: exit 0, no diff | CONFIRMED |
| 5 | "movimientos/service.ts:140 calls registrarSiCorresponde at the SEAM inside registrarMovimiento" | verify-report.md:100 | Read the cited lines | CONFIRMED |
| 6 | "productos/service.ts:126 calls registrarSiCorresponde inside crearProducto's stockInicial > 0 branch" | verify-report.md:101 | Read the cited lines | CONFIRMED |
| 7 | "productos/service.ts:256-260 guards autoResolve(stock_bajo) on stockMinimo→null, no savepoint" | verify-report.md:102 | Read — block actually starts line 255, same substance | CONFIRMED |
| 8 | "ventas/service.ts:265 calls registrarSiCorresponde inside confirmarVenta's per-item Pass B loop" | verify-report.md:103 | Read — inside the `for` loop opened at line 240 | CONFIRMED |
| 9 | "ventas/service.ts:398 calls registrarSiCorresponde inside anularVenta's item loop, no anulacion special case" | verify-report.md:104 | Read the full function, confirmed no such branch | CONFIRMED |
| 10 | "evaluador.ts:97-158 has the exact quiebreCruzo guard on both stock_bajo branches" | verify-report.md:112-119 | Read the cited lines verbatim | CONFIRMED |
| 11 | "repository.ts:74-88 uses onConflictDoNothing on a partial unique index, not read-then-insert" | verify-report.md:130-132 | Read + corroborated by claim 12's mutation | CONFIRMED |
| 12 | "the dedup-under-concurrency test genuinely proves the ON CONFLICT DO NOTHING dedup mechanism" | verify-report.md:133-136 | Removed `.onConflictDoNothing()`; test went red with a real Postgres 23505 unique-violation; reverted, re-ran green | CONFIRMED |
| 13 | "routes/alertas.ts's 4 routes have the exact RBAC roles claimed, resolver is the only encargado-only one" | verify-report.md:147-151 | Read the cited lines | CONFIRMED |
| 14 | "service.ts's resolver() classifies stock_bajo/quiebre as not-manually-resolvable in the SERVICE, before the repository" | verify-report.md:159-160 | Read — the guard runs before `manualResolve()` is called | CONFIRMED |
| 15 | "the C1 test is a genuine real-Postgres proof, not mocked" | verify-report.md:91-92; archive-report.md:155-158 | Removed `ROLLBACK TO SAVEPOINT` from uow.ts; both C1 tests went red with a real Postgres 25P02 error; reverted, re-ran green | CONFIRMED |
| 16 | "the injected failure reaches the SAME raw executor/connection the transaction is bound to, not a JS-level throw" | verify-report.md:72-78 | Read `rawExecutorFrom()` and its use — real 42P01 error, throw is dead code | CONFIRMED |
| 17 | "docs/BACKLOG.md line 45 reads '✅ Archivado' for item #10" | archive-report.md:121-125 | Read the line | CONFIRMED |
| 18 | "openspec/specs/alertas/spec.md and specs/alertas-ui/spec.md both exist as promoted capability files" | archive-report.md:194-198 | `ls` confirmed both exist | CONFIRMED |
| 19 | "docs/DEPLOY-PLAN.md has a dated entry stating migration 0008 is unapplied to Neon and names the 500-causing routes" | archive-report.md:133-145 | Read the exact entry, matches verbatim | CONFIRMED |
| 20 | "PRs #153-#157 all merged to main, archive PR #158 landed after, working tree clean" | archive-report.md:8 | `git log` + `git status` | CONFIRMED |
| 21 | "sugerencia_reposicion exists in the DB pgEnum but is excluded from the TypeScript union used by application code" | verify-report.md:213 | Read schema.ts's pgEnum and repository.ts's `TipoAlertaEvaluada` | CONFIRMED |
| 22 | "uow.test.ts has a specific unit test proving the ROLLBACK TO SAVEPOINT + RELEASE SAVEPOINT sequence on failure" | archive-report.md:165-168 | Removed the RELEASE call after ROLLBACK TO; that specific test went red (call-count assertion), others stayed green; reverted, re-ran green | CONFIRMED |
| 23 | "PR #157 fixed productoB's dead-code stockMinimo: null bug; the current file no longer has it" | archive-report.md:171 | Read the current fixture: `stockMinimo: 5`, with an explanatory comment | CONFIRMED |
| 24 | "ventas/service.test.ts has mock-call-count assertions proving per-item, not per-sale, savepoint invocation" | verify-report.md:199 | Read the two assertions (`toHaveBeenCalledTimes(2)` and `(3)` for 2- and 3-item sales) | CONFIRMED |

**Confirmed:** 24 · **Refuted:** 0 · **Unverifiable:** 0
**Accepted unverifiable:** 0

No refuted claims. This is the first cycle this session where every extracted claim held on first
cold verification — including three independent re-runs of the mutation-probing the orchestrator
had already performed once during archive prep, all reproducing the same result.
