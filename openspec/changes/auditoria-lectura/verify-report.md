# Verify Report: auditoria-lectura

**Verified revision:** `419c223152bf1b09c9066c9c76d627b388a6012e`
**Verified on:** 2026-10-01
**Status:** passed
**Tasks:** 28 of 28 ticked.

This report replaces a first version written at `b67a10d`. The claims gate refuted that version: it
miscounted the tasks (22), listed 7 requirements where the delta spec has 5, and missed that one
spec scenario disagreed with the code. `claims-report.md` records those verdicts. The fixes are in
commits `ccc446e` and `419c223`, and this report describes the result.

Delivered across 3 chained PRs, all merged to `main`: PR #185 (repository layer), PR #186
(`auditoria/service.ts::listar()`), PR #187 (`GET /api/auditoria` route, `app.ts` registration,
contract regeneration).

## Suites

Run on `419c223`. The only untracked file was `.claude/launch.json`, a local dev-server config that
is not part of this change.

| Command | Result |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm --filter @inventienda/api test` | 48 files / 624 tests passed |
| `pnpm --filter @inventienda/web test` | 94 files / 561 tests passed |
| `pnpm --filter @inventienda/api test:integration` | 23 files / 195 tests passed |
| `pnpm lint` (`biome ci .`) | exit 0, 405 files checked (404 tracked plus `.claude/launch.json`) |
| `pnpm contract:check` | exit 0, no diff |

## Requirement verdicts — `record-audit-trail` (delta)

The delta spec has 5 requirements and 9 scenarios.

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| Audit Trail Read Access (renamed and modified from "Write-Only Scope (No Read Path)") | CONFIRMED | `apps/api/src/routes/auditoria.ts:83` declares `roles: ['encargado']`; `apps/api/src/app.ts:180` registers the route. Scenarios covered by the route tests "encargado gets 200 with the paginated envelope" and "deposito gets 403 with no data key in the body". |
| Composable Audit Filters | CONFIRMED | `list()` in `apps/api/src/auditoria/repository.ts` builds one `and()` condition and passes the same object to the page query and the count query. Covered by the route test "composes all three filters into the FiltroAuditoria passed to the repo" and the integration test "list() filters by entidad+entidadId, by usuarioId, and composes both with AND". |
| Row Enrichment With Human-Readable Labels | CONFIRMED | `listar()` at `apps/api/src/auditoria/service.ts:180-275`. The alertas label is `<tipo>: <producto>`, with `tipo` alone when the producto is missing and `null` when the referent is missing. The spec was amended to this form by owner decision on 2026-09-30; it previously asked for the producto name alone. Covered by the `listar` tests for the three alertas cases, the null-referent case, and "is additive". |
| Batched Enrichment Lookup | CONFIRMED | `listar()` issues at most four `findManyByIds` lookups per page and skips empty buckets. Covered by "no-N+1 pin", "unions productos ids", and "skips the call entirely for an empty bucket". |
| Read Response Projects Stored Snapshot As-Is | CONFIRMED | The route DTO types `datosPrevios`/`datosPosteriores` as `z.record(z.string(), z.unknown())` and adds no filtering. `apps/web/src/api/schema.d.ts:4249-4254` renders them as `{ [key: string]: unknown }`, nullable for `datosPrevios`. Covered by "response carries both raw ids and resolved labels", which also asserts the snapshots. |

## Mutation probing

The claims gate mutated the code under every test this cycle added. All Phase 2 and Phase 3 tests
caught their mutation. Five Phase 1 tests did not, and were fixed in `ccc446e`:

- The four `findManyByIds` projection tests now assert the argument passed to `select()`. Each fails
  when the projection is replaced by a full-row `select()`.
- The integration test "paginates stably across pages…" now asserts id-descending order within a
  `creado_en` tie. It failed in 3 of 3 runs with the `desc(id)` tiebreaker removed.

## Issues Found

**CRITICAL:** none. **WARNING:** none. **SUGGESTION:** 3, all outside this cycle's scope.

- `docs/SECURITY.md` SEC-004 has no resolution line, although `rateLimit` configs now exist on
  routes other than login (`apps/api/src/routes/auth.ts`, `apps/api/src/routes/usuarios.ts`).
  Recording it as resolved needs its own verification.
- The comment at `apps/api/src/app.ts:136-137` says rate limiting is "currently only POST
  /api/auth/login", which those same configs make stale.
- The variable inventory in `docs/DEPLOY-PLAN.md` has no row for `PROXY_SHARED_SECRET` or
  `ALLOW_INSECURE_COOKIES`, and its `NODE_ENV` row still attributes the cookie `Secure` flag to
  `NODE_ENV`.

## Verdict

**PASS.**
