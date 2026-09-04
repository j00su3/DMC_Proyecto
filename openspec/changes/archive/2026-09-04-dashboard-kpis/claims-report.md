# Claims Report: dashboard-kpis

**Verified revision:** `25f97ba`
**Verified on:** 2026-09-04
**Sources:** verify-report.md, archive-report.md, tasks.md, PR #170, PR #171, docs/BACKLOG.md,
openspec/specs/dashboard-ui/spec.md, openspec/specs/inventory-movements/spec.md

Verified retroactively, same convention as every prior cycle this session: the `claims-gate`
`PreToolUse` hook is configured in `inventienda/.claude/settings.json`, but this session's project
root is the parent `DCM_Proyecto` directory, so the hook never loaded and never gated PRs
#170/#171. This report closes that gap after the fact. Steps 3-5 of the gate procedure were
delegated cold to an isolated `general-purpose` agent carrying the `claims-verifier` persona
verbatim, since the project-scoped `claims-verifier` subagent type is unavailable in this session
for the same project-root reason. Claim 21 (the `countAbiertasPorTipo` predicate) required the
verifier to genuinely re-perform mutation probing — deliberately redundant with the same probe
already done once during apply/verify, since this is the single most semantically important
correctness property in the cycle (the whole reason design.md's D2 correction existed).

Note: before this gate ran, the orchestrator caught and fixed a real self-contradiction in
`verify-report.md` — its verdict read "PASS WITH WARNINGS" while its own Issues Found section
listed zero WARNING findings (only SUGGESTIONs). Corrected to plain PASS before archive; recorded
in `archive-report.md`'s Final State Authority section. This is exactly the class of defect the
claims-gate discipline exists to catch, caught here before the gate even ran.

| # | Claim (verbatim) | Source | How it was proven | Verdict |
| --- | --- | --- | --- | --- |
| 1 | "pnpm --filter api test exits 0, 596/596 passed, 43 files" | verify-report.md | Ran the command: 596/596, exit 0 | CONFIRMED |
| 2 | "pnpm --filter web test exits 0, 561/561 passed, 94 files" | verify-report.md | Ran the command: 561/561, exit 0 | CONFIRMED |
| 3 | "pnpm test:integration exits 0, 188/188 passed, 23 files (real Docker Postgres)" | verify-report.md | Ran against the live container: 188/188, exit 0 | CONFIRMED |
| 4 | "pnpm typecheck, pnpm lint, pnpm contract:check all exit 0, zero diff" | verify-report.md | Ran all three: exit 0, no diff | CONFIRMED |
| 5 | "countAbiertasPorTipo composes BOTH estado<>'resuelta' AND tipo equality, distinct from list()" | verify-report.md R3 | Read both method bodies — no shared code path | CONFIRMED |
| 6 | "listRecientes(limit) has no usuarioId parameter anywhere in signature/interface" | verify-report.md R5 | Read the interface and implementation | CONFIRMED |
| 7 | "countAbiertas() has no tipo predicate at all — spans every tipo by construction" | verify-report.md R4 | Read the method; confirmed unmodified via git log -p across the cycle | CONFIRMED |
| 8 | "obtenerResumen calls exactly 4 methods via Promise.all: countAbiertasPorTipo×2, countAbiertas, listRecientes(10)" | verify-report.md D2 | Read the lines | CONFIRMED |
| 9 | "the dashboard route has both-role config.roles, no querystring schema, no requireActor" | verify-report.md D4 | Read the full route file | CONFIRMED |
| 10 | "ACTIVIDAD_RECIENTE_LIMIT=10 is a module constant, not request-derived" | verify-report.md D4/R5 | Read the constant and its call site | CONFIRMED |
| 11 | "AppShell's ENCARGADO_ONLY_LABELS does not include 'Panel general'" | verify-report.md app-layout section | Read the Set literal | CONFIRMED |
| 12 | "index.tsx renders the 4 KpiCards in the exact ratified left-to-right order" | verify-report.md R2 | Read the JSX source order | CONFIRMED |
| 13 | "git diff --stat across the cycle's commits against apps/api/drizzle/ is empty" | verify-report.md Migration check | Ran the command: empty output | CONFIRMED |
| 14 | "docs/BACKLOG.md's row for #13 reads '✅ Archivado'" | archive-report.md | Read the line | CONFIRMED |
| 15 | "openspec/specs/dashboard-ui/spec.md exists with exactly 6 requirements and 15 scenarios" | archive-report.md Spec Sync | Counted headings directly | CONFIRMED |
| 16 | "openspec/changes/dashboard-kpis/ no longer exists; the archived folder exists with all named files" | archive-report.md Archive Move | Globbed both locations | CONFIRMED |
| 17 | "inventory-movements' Non-Goals no longer contains the stale backlog #12 cross-product line verbatim" | archive-report.md Non-Goals reconciliation | Grepped for the exact string — no match | CONFIRMED |
| 18 | "PRs #170 and #171 both merged into main" | archive-report.md | git log + ancestor checks on both | CONFIRMED |
| 19 | "all 17 numbered tasks in the archived tasks.md are marked [x]" | archive-report.md | Counted checkbox lines — 17/17, all [x] (1 separate unchecked box exists under a distinct "Open Questions" section, non-blocking, not one of the 17 tasks) | CONFIRMED |
| 20 | "the corrected test comment (1 open stock_bajo) matches the actual seed data and assertion" | archive-report.md Final State Authority | Read the comment and the seed rows immediately below it | CONFIRMED |
| 21 | "the countAbiertasPorTipo unit test would fail if either half of its composed predicate were dropped" | verify-report.md R3 | Live-mutated both halves independently; each mutation failed the same test; reverted, re-ran green, confirmed clean git status | CONFIRMED |

**Confirmed:** 21 · **Refuted:** 0 · **Unverifiable:** 0
**Accepted unverifiable:** 0

No refuted claims. This is the second consecutive cycle (after #12) where every extracted claim
held on first cold verification, including a genuine re-run of this cycle's single most
load-bearing mutation probe.
