# Verificación de Consistencia de Stock Specification

## Purpose

Detect divergence between each producto's `stockActual` and the sum of its recorded
`movimientos.cantidad`. Every stock write is expected to keep these two values equal (ADR-0005);
a divergence signals a bug or data corruption, not routine drift. This capability is a low-frequency,
read-only safety-net check, not a reconciliation or correction process.

## Requirements

### Requirement: Stock-Ledger Consistency Detection

The system MUST compare, for each producto, `stockActual` against `SUM(movimientos.cantidad)` for
that producto, and MUST classify the producto as consistent when the two values are equal and as
mismatched when they are not.

#### Scenario: Consistent producto reports no mismatch

- GIVEN a producto whose `stockActual` equals the sum of its movimientos' `cantidad`
- WHEN the consistency check runs
- THEN the producto is reported as consistent
- AND no mismatch is recorded for it

#### Scenario: Mismatched producto is detected

- GIVEN a producto whose `stockActual` does NOT equal the sum of its movimientos' `cantidad`
  (an intentionally introduced test fixture, since this divergence should never occur in normal
  operation)
- WHEN the consistency check runs
- THEN the producto is reported as mismatched
- AND the mismatch is included in the check's output

### Requirement: Zero-Movement Producto Handling

The system MUST correctly evaluate a producto that has zero recorded movimientos (e.g. created with
`stockInicial = 0` and never touched again) as consistent when `stockActual` is also zero, without
raising an error or falsely reporting a mismatch.

#### Scenario: Producto never touched since creation

- GIVEN a producto with no movimientos ever recorded and `stockActual` equal to 0
- WHEN the consistency check runs
- THEN the comparison treats the empty sum as 0
- AND the producto is reported as consistent, not as an error or a mismatch

### Requirement: Per-Producto Mismatch Identification

When checking multiple productos, the system MUST identify each mismatching producto individually
by its id or SKU, rather than only reporting that a mismatch exists somewhere in aggregate.

#### Scenario: One of several productos mismatches

- GIVEN multiple productos are checked, and exactly one of them has a `stockActual`/ledger-sum
  mismatch
- WHEN the consistency check runs
- THEN the check's output names the specific mismatching producto's id or SKU
- AND the other, consistent productos are not listed as mismatched

### Requirement: Exit-Code Contract

The check MUST communicate its outcome to its caller through a process exit code: exit code 0 when
no mismatch is found across all productos checked, and a non-zero exit code when at least one
mismatch is found.

#### Scenario: No mismatches found across all productos

- GIVEN every checked producto's `stockActual` equals its ledger sum
- WHEN the consistency check runs to completion
- THEN the process exits with code 0

#### Scenario: At least one mismatch found

- GIVEN at least one checked producto has a `stockActual`/ledger-sum mismatch
- WHEN the consistency check runs to completion
- THEN the process exits with a non-zero code

### Requirement: Read-Only Execution

The check MUST NOT create, update, or delete any row in the `productos` or `movimientos` tables,
under any outcome (match or mismatch).

#### Scenario: Running the check does not alter producto or movimiento data

- GIVEN a real Postgres instance seeded with fixture data that includes at least one intentional
  producto/ledger mismatch
- WHEN the consistency check runs against that instance
- THEN every row and value in `productos` and `movimientos` is identical before and after the run

## Non-Goals

- GitHub Actions workflow syntax, scheduling mechanics, or secret configuration — infrastructure,
  not a behavioral requirement of this capability.
- Alerting via email, Slack, webhook, or any other notification channel — this repo has no such
  infrastructure; the exit code is the sole outcome signal.
- The backup/`pg_dump` half of backlog #14 — handled separately, out of scope here.
- Any new UI, screen, or route — this is read-only tooling with no product-facing surface.
- Automatic correction or remediation of a detected mismatch — this capability only detects and
  reports; fixing the underlying bug or data is a separate, manual concern.
