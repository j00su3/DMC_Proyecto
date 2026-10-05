# Delta for record-audit-trail

## ADDED Requirements

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

## MODIFIED Requirements

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
