# Delta for record-audit-trail

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Pseudonym Key Required Only When a Pseudonymized Field Is Present
The audit service MUST resolve the pseudonymization key only when the snapshot being recorded
contains at least one pseudonymized field. A snapshot with no pseudonymized field MUST be recorded
without the key being available. A snapshot that does contain a pseudonymized field (for a
`usuarios` row, `email`) MUST still require the key exactly as before: when the key is unavailable
the audit write MUST fail and no `auditoria` row is persisted. Pseudonymization of present fields
MUST be unchanged.

#### Scenario: Snapshot without a pseudonymized field records without the key
- GIVEN no pseudonymization key is available
- WHEN a `usuarios` password-reset snapshot carrying only `debeCambiarPassword`, `intentosFallidos` and `bloqueadoHasta` is recorded
- THEN an `auditoria` row is persisted and no error is raised

#### Scenario: Snapshot with an email still requires the key
- GIVEN no pseudonymization key is available
- WHEN a `usuarios` snapshot containing `email` is recorded
- THEN the audit write fails, and no `auditoria` row is persisted

#### Scenario: Snapshot with an email is pseudonymized as before
- GIVEN the pseudonymization key is available
- WHEN a `usuarios` snapshot containing `email` is recorded
- THEN the stored snapshot holds the pseudonymized value, not the plaintext email
