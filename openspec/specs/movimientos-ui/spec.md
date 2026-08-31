# movimientos-ui Specification

## Purpose

The 3-step movement-registration modal (`docs/design.md`'s styling tokens: 18px radius,
header with divider and a circular close, numbered uppercase steps, a 12px muted centred
audit-note footer) and its trigger from the product screen, calling `inventory-movements`'s
write endpoint. New capability (greenfield, no prior spec; no prior wireframes exist for
steps 2-3, so this spec defines their observable behavior, not their layout).

## Non-Goals

- Movement history display / reports UI (backlog #12).
- `venta`/`anulacion` UI (#7, #9).
- Alert/threshold configuration UI (#10).

## Requirements

### Requirement: Step 1 Offers Four Operator-Facing Choices Mapped To Three Wire Types
Step 1 MUST present exactly four choices — Entrada, Salida, Salida por merma, Ajuste.
Selecting "Salida por merma" MUST submit `tipo: 'salida'` with `esMerma: true`; the other
three MUST map one-to-one to their wire `tipo` value with `esMerma` omitted or `false`. (PD-5)

#### Scenario: Selecting "Salida por merma" produces the merma wire shape
- GIVEN step 1 is showing its four choices
- WHEN the operator selects "Salida por merma", completes the flow, and submits
- THEN the request sent has `tipo: 'salida'` and `esMerma: true`

#### Scenario: Selecting Ajuste produces the ajuste wire shape
- GIVEN step 1 is showing its four choices
- WHEN the operator selects "Ajuste", completes the flow, and submits
- THEN the request sent has `tipo: 'ajuste'` and no merma indicator set

### Requirement: Ajuste Option Hidden For Deposito Is UX Convenience, Not Access Control
For a `deposito` session, the modal SHOULD hide or disable the "Ajuste" choice in step 1.
This is UX convenience only, NOT the enforcement mechanism — the server's `403 FORBIDDEN`
from `config.roles` (see `inventory-movements` spec, and its 2026-08-30 correction note) is
the actual boundary and MUST be enforced regardless of what the client shows or hides.

#### Scenario: Deposito does not see Ajuste as a selectable step-1 option
- GIVEN a `deposito` session opens the modal
- WHEN step 1 renders
- THEN "Ajuste" is not presented as a selectable choice

### Requirement: Step 2 Refuses To Progress When Motivo Or Quantity Rules Are Violated
Before allowing progression past step 2, the form MUST refuse to submit when: `motivo` is
blank or whitespace-only for `ajuste` or "Salida por merma"; or the entered quantity is `0`
for `ajuste`. Ordinary Entrada/Salida MUST NOT require `motivo`. (PD-2, PD-4)

#### Scenario: Ajuste with zero quantity is refused before submit
- GIVEN "Ajuste" is selected in step 1
- WHEN the operator enters quantity `0` in step 2 and attempts to proceed
- THEN the form shows a validation error and no request is sent

#### Scenario: Merma salida with blank motivo is refused before submit
- GIVEN "Salida por merma" is selected in step 1
- WHEN the operator leaves `motivo` blank and attempts to proceed
- THEN the form shows a validation error and no request is sent

#### Scenario: Ordinary salida needs no motivo to proceed
- GIVEN "Salida" is selected in step 1
- WHEN the operator enters a valid quantity and leaves `motivo` blank
- THEN the form allows progression to step 3

### Requirement: Step 3 Confirms And Submits, Surfacing Server Refusals To Either Role
Step 3 MUST show a summary of the entered movement and submit it on confirmation. An
`INSUFFICIENT_STOCK` or `PRODUCT_INACTIVE` response MUST be displayed as a readable error
inside the modal, without closing it, for both `encargado` and `deposito` sessions —
including the available-quantity figure from `INSUFFICIENT_STOCK`'s `details.available`.

#### Scenario: Insufficient-stock refusal is shown with the available quantity
- GIVEN a salida request that exceeds current stock
- WHEN the server responds `409 INSUFFICIENT_STOCK` with `details.available = 5`
- THEN the modal stays open and displays a message that includes "5"

#### Scenario: Successful submission closes the modal and reflects the new stock
- GIVEN a valid movement is confirmed in step 3
- WHEN the server responds successfully
- THEN the modal closes and the product's displayed stock reflects the new value

### Requirement: The Modal Is Triggered From The Product Screen, Available To Both Roles When The Product Is Active
A trigger to open the modal MUST be reachable from the product detail/list screen for both
`encargado` and `deposito` sessions when the target product is active. An inactive product's
trigger MUST be disabled or absent, mirroring the server's `PRODUCT_INACTIVE` refusal.

#### Scenario: Trigger is available for an active product
- GIVEN an active product is displayed
- WHEN either role views it
- THEN a control to open the movement modal is present and enabled

#### Scenario: Trigger is unavailable for an inactive product
- GIVEN an inactive product is displayed
- WHEN either role views it
- THEN the control to open the movement modal is absent or disabled
