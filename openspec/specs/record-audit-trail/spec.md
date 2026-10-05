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
record's state before and after the action. When an action is performed by an operator-run
procedure with no authenticated actor, the row MUST record the affected user in the actor column
(the column is mandatory) and the post-action snapshot MUST carry an origin marker key naming the
procedure, so the row cannot be read as a self-service action. A snapshot MAY carry such an origin
marker in addition to the record's own columns; the marker `origen: 'rescate'` is the one defined
by `encargado-rescue`. Rows from authenticated in-app actions MUST NOT carry an origin marker.
(Previously: the requirement implied every row's actor was the user who performed the action and
the snapshot held only the record's state; it had no provision for an operator-run action recorded
under the subject's own id or for an origin marker.)

#### Scenario: entidad_id has no foreign key
- GIVEN an audited entity row is later deleted and ceases to exist
- WHEN its prior `auditoria` rows are inspected
- THEN they remain readable and their `entidad_id` still resolves to the original identifier, unconstrained by any FK

#### Scenario: Creation event has no prior snapshot
- GIVEN a new `usuarios`/`proveedores`/`productos` row is created
- WHEN the creation is audited
- THEN the audit row's prior-state snapshot reflects that no prior row existed, and the post-state snapshot reflects the created row

#### Scenario: Operator-run action records the subject as actor with a marker
- GIVEN an operator-run procedure changes a `usuarios` row and has no authenticated actor
- WHEN the action is audited
- THEN the row's actor column equals its `entidad_id` and its post-state snapshot contains the origin marker

#### Scenario: In-app actions carry no origin marker
- GIVEN an authenticated user performs an auditable in-app action (create, update, deactivate, reactivate, reset or change password)
- WHEN the resulting `auditoria` row is inspected
- THEN neither snapshot contains an origin marker key

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

### Requirement: Audit Trail Read Access
The system MUST expose exactly one endpoint, `GET /api/auditoria`, gated `roles: ['encargado']`,
returning audit rows in the standard `{ data, page, pageSize, total }` pagination envelope.
`deposito` MUST receive 403 with no `data`.

#### Scenario: Encargado retrieves paginated audit rows
- GIVEN `auditoria` rows exist
- WHEN `encargado` calls `GET /api/auditoria`
- THEN the response is 200 with `{ data, page, pageSize, total }`, `data` containing the matching rows

#### Scenario: Deposito is denied
- GIVEN a `deposito` user is authenticated
- WHEN they call `GET /api/auditoria`
- THEN the response is 403 and no `data` is returned

### Requirement: Composable Audit Filters
The system MUST support filtering audit rows by `usuarioId` and by `entidad`+`entidadId` in the
same request; when both are supplied, the query MUST AND them, not treat them as mutually
exclusive.

#### Scenario: Both filters supplied compose
- GIVEN one row matches only `usuarioId = U`, one matches only `entidad`+`entidadId = E`, and one matches both
- WHEN `encargado` requests with both `usuarioId = U` and `entidad`+`entidadId = E`
- THEN only the row matching both filters is returned

### Requirement: Row Enrichment With Human-Readable Labels
Each returned row MUST include, alongside the raw `usuarioId` and `entidadId`, a resolved
human-readable label for each. `usuarioId` resolves via `usuarios.nombre`. `entidadId` resolves
from whichever table `entidad` names: `usuarios.nombre`, `proveedores.nombre`, or `productos.nombre`
respectively. For `entidad = 'alertas'`, which has no single label column of its own, the label
MUST be the alerta's `tipo` followed by its producto's name, formatted `<tipo>: <productos.nombre>`
and resolved through the alerta's `productoId`. If the alerta resolves but its producto does not,
the label MUST be the `tipo` alone. The `tipo` is kept in the label so that two alertas on the same
producto (for example `stock_bajo` and `quiebre`) stay distinguishable. Enrichment is additive: raw
ids MUST remain present in the response alongside their labels, never replaced by them.

#### Scenario: Usuario actor enriched with name
- GIVEN an audit row recorded by usuario U with `nombre = "Ana"`
- WHEN the row is returned
- THEN it includes `usuarioId = U.id` and a resolved label `"Ana"`

#### Scenario: Entidad=alertas enriched via its linked producto
- GIVEN an audit row with `entidad = 'alertas'`, `entidadId = A.id`, and alerta A has `tipo = 'stock_bajo'` and `productoId = P.id` where `productos.nombre = "Harina"`
- WHEN the row is returned
- THEN its entidad label is `"stock_bajo: Harina"`, resolved through the alerta's linked producto, not a column on `alertas` itself

#### Scenario: Entidad=alertas whose producto cannot be resolved
- GIVEN an audit row with `entidad = 'alertas'` whose alerta A has `tipo = 'quiebre'`, but A's `productoId` matches no producto
- WHEN the row is returned
- THEN its entidad label is `"quiebre"`, the `tipo` alone

#### Scenario: Referenced row no longer exists
- GIVEN an audit row's `entidadId` no longer matches any row in its `entidad` table
- WHEN the row is returned
- THEN `entidadId` is still present and its resolved label is `null`, with no error raised

### Requirement: Batched Enrichment Lookup
Enrichment MUST resolve in a bounded number of queries per page: at most one lookup query per
distinct table represented among that page's `usuarioId` and `entidad` values, never one lookup
query per row.

#### Scenario: A mixed page resolves without a per-row query
- GIVEN a single page of audit rows spanning `entidad = 'proveedores'`, `entidad = 'productos'`, and `entidad = 'alertas'` values
- WHEN the page is enriched
- THEN the number of enrichment lookup queries issued stays flat as page size grows, bounded by the distinct tables represented on that page, not by row count

### Requirement: Read Response Projects Stored Snapshot As-Is
The read path MUST NOT apply any new filtering to `datos_previos`/`datos_posteriores`; it projects
them exactly as already stored, since `FIELD_CLASSIFICATION` denylisting already happened at write
time and stays unchanged.

#### Scenario: Snapshot fields pass through unfiltered
- GIVEN an audit row was written with `FIELD_CLASSIFICATION` already applied at write time
- WHEN the row is read back via `GET /api/auditoria`
- THEN `datos_previos`/`datos_posteriores` are returned exactly as stored, with no additional field removed

### Requirement: Unbounded Retention
The system MUST NOT automatically delete, archive, or purge `auditoria` rows in v1.

#### Scenario: No retention job runs
- GIVEN the application's scheduled/background jobs, if any
- WHEN they are enumerated
- THEN none of them deletes or archives `auditoria` rows

### Requirement: Pseudonym Key Required Only When a Pseudonymized Field Is Present
The audit service MUST resolve the pseudonymization key only when the snapshot being recorded
contains a string under at least one pseudonymized field. A snapshot with no such string MUST be
recorded without the key being available. A snapshot that does contain one (for a `usuarios` row,
`email` or `nombre`) MUST still require the key: when the key is unavailable the audit write MUST
fail, no `auditoria` row is persisted, and the enclosing transaction MUST roll back with the business
write it accompanies. Pseudonymization of present fields MUST be unchanged except that `nombre` is
now pseudonymized.
(Previously: only `email` was a pseudonymized field for `usuarios`, so only an email in the snapshot
required the key.)

#### Scenario: Snapshot without a pseudonymized field records without the key
- GIVEN no pseudonymization key is available
- WHEN a `usuarios` password-reset snapshot carrying only `debeCambiarPassword`, `intentosFallidos` and `bloqueadoHasta` is recorded
- THEN an `auditoria` row is persisted and no error is raised

#### Scenario: Deactivate, reactivate and operator rescue record without the key
- GIVEN no pseudonymization key is available
- WHEN a `usuarios` deactivation, a reactivation, or an operator rescue password change (none carrying `email` or `nombre`) is recorded
- THEN an `auditoria` row is persisted for each and no error is raised

#### Scenario: Snapshot with an email still requires the key
- GIVEN no pseudonymization key is available
- WHEN a `usuarios` snapshot containing `email` is recorded
- THEN the audit write fails, and no `auditoria` row is persisted

#### Scenario: Snapshot with a nombre requires the key
- GIVEN no pseudonymization key is available
- WHEN a `usuarios` snapshot containing `nombre` is recorded, including a rename that changes the name and not the email
- THEN the audit write fails, no `auditoria` row is persisted, and the enclosing business write is rolled back

#### Scenario: Snapshot with an email is pseudonymized as before
- GIVEN the pseudonymization key is available
- WHEN a `usuarios` snapshot containing `email` is recorded
- THEN the stored snapshot holds the pseudonymized value, not the plaintext email

#### Scenario: Snapshot with a nombre is pseudonymized
- GIVEN the pseudonymization key is available
- WHEN a `usuarios` snapshot containing `nombre` is recorded
- THEN the stored snapshot holds the pseudonymized value, not the plaintext name

### Requirement: Usuario Name Is Pseudonymized in Both Snapshots
For `usuarios` rows the audit service MUST store `nombre` only as a keyed pseudonym in both
`datos_previos` and `datos_posteriores`; the plaintext name MUST NOT appear in `auditoria`. The same
key and the same name MUST always yield the same pseudonym, and different names MUST yield different
pseudonyms, so a rename stays visible as a change. An update that does not change `nombre` MUST NOT
write an `auditoria` row for that reason, and a rename to the identical name writes no row.

#### Scenario: Creation stores a pseudonym, not the name
- GIVEN the pseudonymization key is available
- WHEN a `usuarios` row with `nombre = "Ana Pérez"` is created and audited
- THEN the post-state snapshot holds a pseudonym under `nombre` and neither snapshot contains "Ana Pérez"

#### Scenario: Rename shows two different pseudonyms
- GIVEN the key is available and a user named "Ana Pérez" exists
- WHEN the name is changed to "Ana Gómez" and audited
- THEN `datos_previos.nombre` and `datos_posteriores.nombre` are both pseudonyms, differ from each other, and neither snapshot contains either plaintext name

#### Scenario: No-op rename writes no row
- GIVEN a user named "Ana Pérez" exists
- WHEN an update sets `nombre` to "Ana Pérez" and changes nothing else
- THEN no `auditoria` row is recorded

### Requirement: Distinct Pseudonyms per Field, Email Pseudonyms Unchanged
The pseudonyms of `email` and `nombre` MUST use distinct domain separation, so the same string stored
under both fields yields different pseudonyms. For a given key and email value, the email pseudonym
MUST be identical to the one produced before this change; email pseudonyms already stored remain
valid and comparable.

#### Scenario: Same string under email and nombre differs
- GIVEN the key is available
- WHEN one snapshot holds the string "x@example.com" as `email` and another holds it as `nombre`
- THEN the two stored pseudonyms differ

#### Scenario: Email pseudonym is stable across the change
- GIVEN a fixed key and the email "ana@example.com"
- WHEN its pseudonym is computed after this change
- THEN it equals the value the pre-change behaviour produced for the same key and email

### Requirement: Rows Written Before This Change Are Not Rewritten
Pseudonymizing `nombre` MUST apply only to rows written after the change. `auditoria` rows already
stored MUST NOT be updated, rewritten, or purged by this change, so they may still hold a plaintext
`nombre`. This is a boundary, not a goal: no code path introduced here updates or deletes an
`auditoria` row.

#### Scenario: No update path to existing rows
- GIVEN the audit repository after this change
- WHEN its operations are enumerated
- THEN they are limited to recording and listing rows, and a pre-existing row with a plaintext `nombre` is returned exactly as stored

### Requirement: Proveedores Snapshots Are Unchanged
This change MUST NOT alter which `proveedores` fields are recorded or pseudonymized, and a
`proveedores` snapshot MUST NOT require the pseudonymization key.

#### Scenario: Proveedor snapshot records as before
- GIVEN no pseudonymization key is available
- WHEN a `proveedores` snapshot is recorded
- THEN an `auditoria` row is persisted with the same fields and values as before this change
