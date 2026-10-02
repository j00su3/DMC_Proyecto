# Archive Report: auditoria-lectura (backlog #15)

**Cycle:** auditoria-lectura
**Closes:** drift finding D-01 (`docs/DRIFT.md`), recorded as backlog item 15
**Archived on:** 2026-10-01
**Archived from:** `main` at `adf542b` (merge of PR #188)
**Status:** passed, same as `verify-report.md`

## What the cycle delivered

`GET /api/auditoria`: a read endpoint over the audit trail, restricted to `encargado`, paginated,
filterable by `entidad`+`entidadId` and by `usuarioId` (combinable). Each row carries the actor's
name and a readable label for the entity, resolved in batches. API only; no screen.

| PR | Content | Merge commit |
| --- | --- | --- |
| #185 | Repository layer: `AuditoriaRepo.list()` and four `findManyByIds` ports | `fd5658f` |
| #186 | `auditoria/service.ts::listar()`, batched enrichment | `2de578b` |
| #187 | Route, `app.ts` registration, contract regeneration | `b67a10d` |
| #188 | Test fixes, spec amendment, docs corrections, verify and claims reports | `adf542b` |

## Artifacts in this folder

`proposal.md`, `design.md` (decisions D1-D7), `tasks.md`, `specs/record-audit-trail/spec.md` (the
delta), `verify-report.md`, `claims-report.md`, and this report. The folder was moved with
`git mv` from `openspec/changes/auditoria-lectura/`.

## Tasks

`tasks.md` has 28 tasks, all checked: 11 in Phase 1, 6 in Phase 2, 7 in Phase 3, 2 in Phase 4, and
2 in Phase 5.

## Verification

`verify-report.md` (verified at `419c223`): **PASS**. CRITICAL: none. WARNING: none.
SUGGESTION: 3. Its suite results: api 624 tests, web 561, integration 195, with typecheck, lint and
`contract:check` clean.

## Claims gate

The gate ran twice. `claims-report.md` in this folder is the second pass.

- **First pass, at `e7f3da4`:** 94 claims; 59 confirmed, 34 refuted, 1 unverifiable. That report is
  preserved in commit `7f143a3`.
- **What was fixed:** one spec scenario disagreed with the code (the alertas label; the owner kept
  the code's `<tipo>: <producto>` form and the spec was amended); five tests could not fail and now
  can; the first verify report miscounted tasks and requirements and was rewritten; stale and false
  citations in `docs/SECURITY.md`, `docs/DRIFT.md` and `docs/DEPLOY-PLAN.md` were corrected.
- **Second pass, verified at `e772c24`:** 75 confirmed, 0 refuted, 0 unverifiable.

No production code changed between the two passes; the fixes touched tests, docs and this folder.

## Spec sync

The delta has 5 requirements and 9 scenarios. It was merged into
`openspec/specs/record-audit-trail/spec.md`:

- "Write-Only Scope (No Read Path)" was renamed to "Audit Trail Read Access" and its text replaced.
  Its single scenario was replaced by two.
- Four requirements were added: Composable Audit Filters, Row Enrichment With Human-Readable
  Labels, Batched Enrichment Lookup, and Read Response Projects Stored Snapshot As-Is, with seven
  scenarios between them.

The promoted spec went from 7 requirements and 12 scenarios to 11 requirements and 20 scenarios.
No "Write-Only Scope" heading remains. The other six requirements are unchanged.

## Docs

`docs/BACKLOG.md` row 15 is marked `✅ Archivado`. `README.md`'s "Estado del proyecto" lists the
backlog as archived through #15.

## Deploy impact

No migration and no schema change. The endpoint reads the existing `auditoria` table through
indexes that already existed.

## Carried forward

The three suggestions from `verify-report.md`, all outside this cycle:

- `docs/SECURITY.md` SEC-004 has no resolution line, although `rateLimit` configs now exist on
  routes other than login.
- The comment at `apps/api/src/app.ts:136-137` still says rate limiting applies only to login.
- The variable inventory in `docs/DEPLOY-PLAN.md` lacks `PROXY_SHARED_SECRET` and
  `ALLOW_INSECURE_COOKIES`, and its `NODE_ENV` row attributes the cookie `Secure` flag to
  `NODE_ENV`.

The other findings `docs/DRIFT.md` lists as open (D-02 among them) were never part of this cycle.

## Timeline (commit dates)

- 2026-09-11: proposal, spec and design committed (`6ab9c1d`).
- 2026-09-12: PRs #185 and #186 merged.
- 2026-09-15: PR #187 merged; first verify report (`e7f3da4`).
- 2026-09-30: first claims pass (`7f143a3`); test and spec fixes (`ccc446e`).
- 2026-10-01: docs fixes, verify report rewritten, second claims pass, PR #188 merged, archive.
