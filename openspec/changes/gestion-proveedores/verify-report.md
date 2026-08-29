# Verify Report: gestion-proveedores (backlog #4)

**Change**: `gestion-proveedores` | **Mode**: hybrid (OpenSpec files + Engram) | **Base**: `main` @ `f3dd9e6` (merged, working tree clean)

## Completeness

All 8 task phases in `tasks.md` are checked complete except task 8.3, which is correctly left
unchecked as an archive-phase item ("after the last slice merges, confirm the two Open Questions
... are still recorded as open"). No other unchecked tasks. PRs #46-#50 shipped S1 through S5b in
order, matching the accepted five-PR delivery decision (`exception-ok`, stacked-to-main).

## Gate Evidence (executed this session)

| Command | Result | Detail |
|---|---|---|
| `pnpm -r test` | PASS exit 0 | api: 21 files / 217 tests passed; web: 34 files / 157 tests passed |
| `pnpm typecheck` | PASS exit 0 | api + web both Done, no errors |
| `pnpm lint` (biome ci .) | PASS exit 0 | 180 files checked, no fixes needed |
| `pnpm contract:check` | PASS exit 0 | git diff --exit-code on openapi.json + schema.d.ts, no diff |
| `pnpm test:integration` | PASS exit 0 | 11 files / 84 tests passed, Docker Postgres inventienda-postgres-1 |

All five gates green, executed directly this session (not trusted from prior agent reports).

## Requirement x Scenario Compliance Matrix

10 requirements, 21 scenarios (matches spec.md exactly).

### Requirement: Role Gate -- Read/Write Split on Every Supplier-Management Route

| Scenario | Status | Test |
|---|---|---|
| Unauthenticated request | COVERED | apps/api/src/routes/proveedores.test.ts:168-180 (401 on all six routes) |
| Deposito can read suppliers | COVERED | routes/proveedores.test.ts:136-150 (fakes) + routes/proveedores.integration.test.ts:97-129 (real deposito session, real Postgres) |
| Deposito write is refused | COVERED | routes/proveedores.test.ts:152-166 (fakes) + routes/proveedores.integration.test.ts:131-192 (real session; asserts the row and auditoria are unchanged afterward, not status-code-only) |

### Requirement: Supplier Creation

| Scenario | Status | Test |
|---|---|---|
| Successful creation with contacto | COVERED | routes/proveedores.test.ts:286-301 (201 + DTO shape, fakes). Real-DB creation with contacto also exercised inside routes/proveedores.integration.test.ts:366-372 (audit test), though that call does not re-assert the 201 shape |
| contacto is optional | COVERED | routes/proveedores.test.ts:303-317 (201, contacto null, fakes). Multiple real-DB creates in the integration suite omit contacto and succeed with 201 |

### Requirement: Case-Insensitive Name Uniqueness With Original-Casing Storage

| Scenario | Status | Test |
|---|---|---|
| Duplicate name on create is refused | COVERED | routes/proveedores.integration.test.ts:209-231 (real HTTP, real Postgres, 409) + routes/proveedores.test.ts:336-353 (fakes) + proveedores/repository.integration.test.ts:163-169 + db/schema.integration.test.ts:35-49 |
| Duplicate name on update is refused | PARTIAL - WARNING | Only proven at the repository layer: proveedores/repository.integration.test.ts:179-186 (update surfaces SUPPLIER_NAME_IN_USE) calls repo.update() directly against two real rows. No test exercises PATCH /api/proveedores/:id itself with a name collision -- neither routes/proveedores.test.ts (fakes) nor routes/proveedores.integration.test.ts (real session) has a PATCH-duplicate case. The service (updateProveedor) does not catch AppError, so the repo's 409 should propagate correctly, but that propagation path -- including the Zod response map declaring 409 for PATCH -- is unverified at the HTTP boundary. A covering test belongs in routes/proveedores.integration.test.ts: create two suppliers, PATCH one to the other's (case-differing) name, assert 409 SUPPLIER_NAME_IN_USE and that neither row changed |
| Stored casing survives exactly as submitted | COVERED | db/schema.integration.test.ts:51-59 + proveedores/repository.integration.test.ts:188-194 + routes/proveedores.integration.test.ts:233-238 (real HTTP GET readback) |
| An inactive supplier's name still blocks the duplicate | PARTIAL - WARNING | Proven at db/schema.integration.test.ts:61-67 and proveedores/repository.integration.test.ts:171-177 (both real Postgres, both call the repo/schema directly). No test drives this through POST /api/proveedores -- the spec scenario explicitly names the route, but neither routes/proveedores.test.ts nor routes/proveedores.integration.test.ts has this exact case. The active-row duplicate path is proven at the HTTP layer, so route plumbing in general is not unproven -- only the inactive-row variant specifically lacks an HTTP-level assertion |

### Requirement: List Suppliers (Paginated)

| Scenario | Status | Test |
|---|---|---|
| Default pagination | COVERED | routes/proveedores.test.ts:209-223 (fakes, page=1/pageSize=20 default). Real-DB proof of the two-statement D9 pagination exists via proveedores/repository.integration.test.ts:79-118, though the >20-row default-pageSize case itself is only exercised against fakes |
| Explicit pagination | COVERED | routes/proveedores.integration.test.ts:292-323 (real HTTP + real Postgres, page=1&pageSize=2, out-of-range page=5&pageSize=2 proving the D9 windowed-count trap through the full stack) |

### Requirement: Get Supplier by Id

| Scenario | Status | Test |
|---|---|---|
| Existing supplier | COVERED | routes/proveedores.test.ts:234-247 (fakes) + routes/proveedores.integration.test.ts:122-128 (real) |
| Unknown id | COVERED | routes/proveedores.test.ts:249-262 (fakes) + routes/proveedores.integration.test.ts:245-259 (real, 404 SUPPLIER_NOT_FOUND) |

### Requirement: Update Supplier Profile

| Scenario | Status | Test |
|---|---|---|
| Successful update | COVERED | routes/proveedores.test.ts:431-445 (fakes, 200 + updated fields) + routes/proveedores.integration.test.ts:360-390 (real, asserts the actualizar audit row's diff in both directions) |
| Target not found | COVERED | routes/proveedores.test.ts:447-461 (fakes, 404) + proveedores/service.test.ts:161-173 (asserts auditoria.record NOT called before any write). No real-Postgres HTTP test for this specific 404-on-PATCH case, but the 404 mapping is already proven at the HTTP layer for GET/deactivate/reactivate, and the no-write/no-audit half is proven at the service layer |
| activo in a PATCH body is refused | COVERED | routes/proveedores.test.ts:368-387 -- asserts 400 VALIDATION_ERROR and that the handler was never reached (handlerReached flag), proving Zod .strict() rejects before any repo call -- a real schema-layer boundary, not a stubbed assumption |

### Requirement: Logical Deactivation Preserves References and History

| Scenario | Status | Test |
|---|---|---|
| Successful deactivation | COVERED | routes/proveedores.test.ts:475-488 (fakes) + routes/proveedores.integration.test.ts:392-425 (real, baja_logica audit row) |
| A deactivated supplier remains readable by id | COVERED | routes/proveedores.integration.test.ts:261-290 (real HTTP + real Postgres, 200 with activo=false, never 404) |

### Requirement: Reactivation

| Scenario | Status | Test |
|---|---|---|
| Successful reactivation | COVERED | routes/proveedores.test.ts:490-504 (fakes) + routes/proveedores.integration.test.ts:416-424 (real, reactivar audit row) |

### Requirement: Audit Obligation Per Mutation

| Scenario | Status | Test |
|---|---|---|
| One audit row per mutation | COVERED | Proven against real Postgres, not fakes: routes/proveedores.integration.test.ts:340-425 (crear/actualizar/baja_logica/reactivar, each exactly one new row per action). Note: the real-DB assertions query accion, usuario_id, datos_previos, datos_posteriores but do not SELECT entidad and re-assert 'proveedores' against the live row -- the entidad='proveedores' claim is proven instead at proveedores/service.test.ts:136-142,187-194,227-234,250-257 via toMatchObject({ entidad: 'proveedores', ... }) against the recordAudit call arguments. Combined, the requirement is COVERED, but no single test proves both the row count and the entidad column value against a live database row in the same assertion -- a SUGGESTION-level tightening, not a gap |

### Requirement: Atomic Rollback on Audit Failure

| Scenario | Status | Test |
|---|---|---|
| Failed audit write rolls back the mutation | COVERED | Proven against real Postgres, not fakes: routes/proveedores.integration.test.ts:427-471 (create case -- wraps a real createUnitOfWork(db) and overrides only auditoria.record to throw, so the INSERT is genuine and the ROLLBACK is genuine) and :473-525 (deactivate case, same technique). Both assert 500 AUDIT_WRITE_FAILED, the target row unchanged, and zero/one (correct) auditoria rows |

## Naming Convention Audit

- Types/repositories (Spanish): Proveedor, NuevoProveedor, CambiosProveedor, ProveedoresRepo, DrizzleProveedoresRepo -- confirmed in apps/api/src/proveedores/repository.ts and its imports across service.ts, service.test.ts, routes/proveedores.ts, routes/proveedores.test.ts. Consistent with the rule.
- Error factories/codes (English): supplierNotFound() -> SUPPLIER_NOT_FOUND, supplierNameInUse() -> SUPPLIER_NAME_IN_USE, confirmed at apps/api/src/lib/errors.ts:167-181 and covered by apps/api/src/lib/errors.test.ts:201-215 (wire code + toErrorEnvelope mapping). Consistent with the rule -- no deviation found.

## Open Questions Carry-Forward Check

design.md's Open Questions section still shows exactly the two items the design left unresolved
as unchecked (- [ ]), not silently dropped:
1. Wire-code language consistency -- SUPPLIER_NAME_IN_USE vs. EMAIL_ALREADY_IN_USE's
   language pattern -- still open.
2. isUniqueViolation's non-discriminating 23505 mapping (D13) -- still open.

(Two additional open items -- no updatedAt column, and the list endpoint's lack of an activo
filter -- are also still present and unchanged; not part of the two items this cycle was asked to
verify, noted for completeness.) Task 8.3 correctly remains unchecked, deferring the final
confirmation to the archive phase as designed.

## Audit Obligation and Atomic Rollback -- Real Postgres, Not Fakes

Both explicitly required. Confirmed: routes/proveedores.integration.test.ts's three describe
blocks (role gate, uniqueness and lifecycle, audit trail and atomic rollback) run against
buildApp() with no repo/uow overrides (audit obligation) and against a real
createUnitOfWork(db) with only the auditoria.record method swapped for a throwing stub
(atomic rollback) -- the supplier row write is always a genuine Postgres INSERT/UPDATE, so the
ROLLBACK proof is real, not simulated. This mirrors the documented usuarios.integration.test.ts
technique.

## Issues

### CRITICAL
None.

### WARNING
1. Duplicate name on update is refused -- no test drives this scenario through
   PATCH /api/proveedores/:id (neither fakes nor real session); only proven at the repository
   layer (proveedores/repository.integration.test.ts:179-186). Add an HTTP-level test --
   integration-layer preferred, since this is the same layer other duplicate-name and audit
   scenarios are proven at.
2. An inactive supplier's name still blocks the duplicate -- proven at schema/repository layer
   only (db/schema.integration.test.ts:61-67, proveedores/repository.integration.test.ts:171-177);
   the spec scenario explicitly names POST /api/proveedores, and no route-level test (fakes or
   real session) exercises the inactive-row variant. The active-row variant is proven at the HTTP
   layer, so this is a narrower gap than #1, but still a literal scenario-to-test mismatch.

### SUGGESTION
1. No single real-Postgres assertion in the audit-obligation tests re-selects and checks
   entidad = 'proveedores' against the live auditoria row (the row-count/verb proof is real,
   the entidad value proof is service-layer/mocked). Low priority -- the audit write path is
   shared by every entity via recordAudit's type-gated entidad argument, so the two proofs
   together are a reasonable substitute.
2. "Successful creation with contacto" has no single real-Postgres test that both submits
   contacto on POST /api/proveedores and re-reads it back via GET in the same assertion
   chain -- the shape is proven at the fake-repo HTTP layer and contacto-bearing creates do occur
   against real Postgres elsewhere in the suite, but not fused into one scenario-shaped test.

## Verdict

PASS WITH WARNINGS

19 of 21 scenarios are COVERED with test evidence at the correct layer (many with real-Postgres,
real-HTTP-boundary proof, not merely service-level fakes). 2 of 21 scenarios (both under the
Case-Insensitive Name Uniqueness requirement) are PARTIAL: proven at the repository/schema layer
but missing the HTTP-boundary test the spec scenario literally describes. Neither gap is CRITICAL
-- the underlying SQL constraint, the error mapping, and the general duplicate-name-over-HTTP path
(active row, on create) are all independently proven, so the missing tests would very likely pass
if written, not surface a defect. All five verification gates (pnpm -r test, pnpm typecheck,
pnpm lint, pnpm contract:check, pnpm test:integration) pass with real, freshly-executed output.
Both Open Questions the design left unresolved remain correctly recorded as open. Naming
conventions (Spanish types/repos, English error factories/codes) are followed with no deviation.

Recommendation: proceed to sdd-archive. The two WARNING-level gaps are appropriate follow-up
items, not archive blockers -- they can be logged as a fast-follow test-hardening note rather than
reopening the implementation.

---

## Post-Verify Resolution (PR6, 2026-08-29)

Both WARNING-level findings are **CLOSED**, plus one the verify pass raised only as a learning.
Before writing any test, each finding was probed empirically against real Postgres rather than
argued from reading the source — the behaviour was correct in all three cases, so no production
line changed. The gap was coverage, not conduct.

| Finding | Probe result | Test added |
| --- | --- | --- |
| WARNING 1 — duplicate name on `PATCH` | `409 SUPPLIER_NAME_IN_USE`, target row unchanged | `routes/proveedores.integration.test.ts` — "refuses a PATCH that takes another supplier normalized name, changing no field" |
| WARNING 2 — inactive name blocks a create | `409 SUPPLIER_NAME_IN_USE`, table still holds 1 row | same file — "lets a deactivated supplier name keep blocking a duplicate create" |
| Learning 3 — `entidad` never re-selected | stored value is literally `proveedores` | `auditRowsFor` now selects `entidad`; asserted on the `crear` row and across the full crear/baja_logica/reactivar lifecycle |

### Mutation probes — what each test actually earns

**WARNING 1's test earns its place.** Wrapping `repos.proveedores.update` in `service.ts` with a
`try { … } catch { return previo }` makes the collision silently return `200`. Under that
mutation the new route test is the **only** failure in the suite: `repository.integration.test.ts`
stays fully green at 21 passing, because it calls `repo.update()` directly and never crosses the
`changedFields` diff that sits between the HTTP request and the repository. This is the same
shape of gap `pantalla-usuarios` shipped twice.

**WARNING 2's test does not.** Recreating the unique index as
`… (lower(nombre)) WHERE activo` fails **three** tests, and two of them
(`db/schema.integration.test.ts`, `proveedores/repository.integration.test.ts`) already existed.
The new route-level test detects no defect the suite could not already detect. It is kept because
the spec scenario names `POST /api/proveedores` explicitly and the requirement is described at
that boundary — but it is redundant for defect detection, and this report says so rather than
claiming coverage it did not earn.

**Learning 3's assertion is belt-and-braces.** `AuditableEntidad = keyof typeof
FIELD_CLASSIFICATION` already makes a wrong `entidad` literal a compile error, so no realistic
mutation survives to runtime. The assertion guards the `recordAudit` → Postgres leg, which the
service tests proved only against a fake.

### Gates after PR6

- `pnpm -r test`: 217 api + 157 web, green
- `pnpm typecheck`: clean
- `pnpm lint`: clean
- `pnpm contract:check`: byte-identical
- `pnpm test:integration`: **86** (was 84)

**Revised status: `passed`.** No CRITICAL findings, no open WARNINGs. The two Open Questions
design.md left unresolved remain open by design and carry into the archive.
