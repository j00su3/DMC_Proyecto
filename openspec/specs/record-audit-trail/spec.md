# record-audit-trail Specification

## Purpose

Write-only record-change trail for `usuarios`, `proveedores`, and `productos` (creation, update,
logical deletion, reactivation) plus password changes, giving backlog #3's temporary-password flow
non-repudiation. Separate from the `movimientos` stock ledger per ADR-0012. New capability
(greenfield, no prior spec). Only `usuarios` is live in this change; `proveedores`/`productos` call
sites arrive with #4/#5 and consume this contract without being wired here.

## Requirements

### Requirement: Audit Row Identity and Snapshot Shape
The system MUST record, for each auditable action, at minimum: which entity type and instance was
affected (`entidad_id`, a `uuid` with no foreign-key constraint per ADR-0011, so the row survives
deletion of its subject), which user performed the action, when it occurred, and a snapshot of the
record's state before and after the action.

#### Scenario: entidad_id has no foreign key
- GIVEN an audited entity row is later deleted and ceases to exist
- WHEN its prior `auditoria` rows are inspected
- THEN they remain readable and their `entidad_id` still resolves to the original identifier, unconstrained by any FK

#### Scenario: Creation event has no prior snapshot
- GIVEN a new `usuarios`/`proveedores`/`productos` row is created
- WHEN the creation is audited
- THEN the audit row's prior-state snapshot reflects that no prior row existed, and the post-state snapshot reflects the created row

### Requirement: Auditable Actions Scope
The system MUST record an audit row for creation, update, logical deletion (baja lógica), and
reactivation of `usuarios`, `proveedores`, and `productos` rows, and for password changes. The
system MUST NOT record an audit row for read operations or failed login attempts.

#### Scenario: Password change is audited
- GIVEN an authenticated user successfully changes their password
- WHEN the change completes
- THEN exactly one `auditoria` row is recorded for that action

#### Scenario: A read operation produces no audit row
- GIVEN any entity is read, fetched by id, or listed
- WHEN the read completes
- THEN no `auditoria` row is created

#### Scenario: A failed login attempt produces no audit row
- GIVEN a login attempt fails (wrong password, unknown email, locked, or inactive account)
- WHEN the attempt is processed
- THEN no `auditoria` row is created

### Requirement: Atomic Write With the Business Operation
Recording an `auditoria` row MUST occur inside the same database transaction as the business write
it records. If the audit write fails, the business write MUST roll back, so the trail can never
silently miss an entry.

#### Scenario: Audit write failure rolls back the business write
- GIVEN a business write (e.g. a password change) is in progress
- WHEN the accompanying audit write fails
- THEN the entire transaction rolls back and neither the business write nor the audit row is persisted

#### Scenario: Successful pair commits together
- GIVEN a business write and its audit write both succeed
- WHEN the transaction commits
- THEN both the business write and exactly one `auditoria` row are visible to subsequent reads

### Requirement: Sensitive-Field Denylist
The audit service MUST exclude denylisted fields, headed by `hash_contrasena`, from both the
before and after snapshots it records. A denylisted field MUST NOT appear in `auditoria` under any
circumstance, even when it is the field being changed.

#### Scenario: Password hash never appears in a snapshot
- GIVEN a user's password is changed
- WHEN the resulting `auditoria` row is inspected
- THEN neither its prior-state nor post-state snapshot contains `hash_contrasena` or its value in any form

### Requirement: No-Quantity Signature and Movement Boundary
The audit service's signature MUST NOT accept a quantity/units parameter. Recording a stock
movement (`movimientos`, introduced by backlog #5/#6) MUST NOT produce any `auditoria` row. An edit
to a non-quantity field of an audited entity MUST NOT produce a `movimientos` row.

#### Scenario: Editing a record field produces an audit row and no movement
- GIVEN a user updates a non-quantity field of an audited entity (e.g. a `usuarios` row via `changePassword`, the only live call site in this change)
- WHEN the update completes
- THEN exactly one `auditoria` row is created and zero `movimientos` rows are created

#### Scenario: Recording a stock movement produces no audit row
- GIVEN a stock-movement operation records a quantity change (once `movimientos` exists, per #5/#6)
- WHEN that operation completes
- THEN it does not invoke the audit service and produces zero `auditoria` rows, because the audit service has no parameter through which a quantity could be passed

### Requirement: Write-Only Scope (No Read Path)
The system MUST NOT expose any endpoint, route, or UI to read the `auditoria` trail in v1.
`auditoria` rows are write-only from the application's perspective; retrieval is out of scope until
a future backlog item requests it.

#### Scenario: No audit read route exists
- GIVEN the API's registered routes
- WHEN they are enumerated
- THEN none of them reads or lists `auditoria` rows

### Requirement: Unbounded Retention
The system MUST NOT automatically delete, archive, or purge `auditoria` rows in v1.

#### Scenario: No retention job runs
- GIVEN the application's scheduled/background jobs, if any
- WHEN they are enumerated
- THEN none of them deletes or archives `auditoria` rows
