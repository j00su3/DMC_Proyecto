# recibo-ui Specification

## Purpose

The printable receipt route, its `@media print` presentation, and the minimal
correlativo-search affordance for revisiting a past receipt. New capability (greenfield, no
prior spec) — this is the first print/export surface in the codebase.

## Non-Goals

- A full sales-history/list/browse screen (PD-1) — future backlog item, not this one.
- Server-side PDF generation (PD-3) — the browser's native print-to-PDF satisfies
  "descargable."
- Store name/address or any store-configuration display (PD-2) — no such entity exists.
- A product-name snapshot at sale time — the receipt shows the product's current name
  (accepted drift, already settled).

## Requirements

### Requirement: Printable Receipt Route (PD-3)
A dedicated route `/ventas/:id/recibo` MUST render the receipt for the venta with that id,
showing exactly: items, importe, medio de pago, fecha, cajero, número correlativo, and
estado (PD-2). It MUST be printable via the browser's native `window.print()` with
`@media print` CSS — no modal, no server-side PDF generation, no new runtime dependency. It
MUST be reachable by sessions with `rol = encargado` or `rol = deposito` (PD-4, mirrors the
backend role gate). A nonexistent id MUST show the same generic not-found treatment as the
correlativo search (PD-5).

#### Scenario: Valid id renders the receipt
- GIVEN an existing venta id
- WHEN `/ventas/:id/recibo` is navigated to
- THEN the receipt renders with items, importe, medio de pago, fecha, cajero, número
  correlativo, and estado

#### Scenario: Nonexistent id shows a generic not-found message
- GIVEN no venta exists with the requested id
- WHEN `/ventas/:id/recibo` is navigated to
- THEN a single generic not-found message is shown, matching PD-5's search treatment

#### Scenario: Triggering print invokes the native print dialog
- GIVEN a rendered receipt
- WHEN the cashier triggers the print action
- THEN the browser's native print dialog opens via `window.print()`, with no PDF library
  involved

### Requirement: Estado Shown As Plain Text, No Visual Flag (PD-6)
The receipt MUST display `estado` (`confirmada` or `anulada`) as plain text, given the same
field treatment as the other receipt fields — no banner, watermark, or other visual
distinction for `anulada`.

#### Scenario: Anulada receipt shows plain-text estado
- GIVEN a venta with `estado = 'anulada'`
- WHEN its receipt renders
- THEN "anulada" is shown as plain text among the other fields, with no banner or watermark

#### Scenario: Confirmada receipt shows plain-text estado
- GIVEN a venta with `estado = 'confirmada'`
- WHEN its receipt renders
- THEN "confirmada" is shown the same way, with no distinct visual treatment

### Requirement: Receipt Omits Store Identity (PD-2)
The receipt MUST NOT render any store name, address, or other store-configuration element.

#### Scenario: Receipt renders with no store identity element
- GIVEN any receipt is rendered
- WHEN its content is inspected
- THEN no store name or address element is present

### Requirement: Correlativo Search (PD-1, PD-5)
A minimal search-by-`numeroCorrelativo` input MUST be reachable from the receipt area,
letting either role look up a past receipt by its exact number. A match MUST lead to that
sale's `/ventas/:id/recibo`. No match MUST show the single generic not-found message from
PD-5, with no distinction from an access-denied case. This affordance MUST NOT expand into
or link toward a full sales list/browse screen (PD-1 scope boundary). Exact placement
(dedicated landing route vs. embedded in the detail route's not-found state) is a design
decision, not specified here.

#### Scenario: Searching an existing correlativo navigates to its receipt
- GIVEN an existing venta's `numeroCorrelativo`
- WHEN it is entered into the search input
- THEN the receipt for that venta is shown

#### Scenario: Searching a nonexistent correlativo shows the generic message
- GIVEN no venta has the entered `numeroCorrelativo`
- WHEN the search is submitted
- THEN the single generic not-found message is shown, with no other distinguishing detail

#### Scenario: No sales-list affordance is offered alongside search
- GIVEN the correlativo search is displayed
- WHEN a cashier looks for a way to browse all past sales
- THEN no list/browse control is present — only the search-by-number input

### Requirement: Receipt Access Is Audit-Style, Not Per-Cajero (PD-4)
Any session with `rol = encargado` or `rol = deposito` MUST be able to view any receipt,
regardless of which cajero confirmed the underlying sale.

#### Scenario: Deposito views a receipt confirmed by a different cajero
- GIVEN a venta confirmed by an `encargado` user
- WHEN a `deposito` user opens that venta's receipt
- THEN the receipt displays normally, not blocked

## ADDED Requirements (Anulación de Venta — backlog #9)

### Requirement: Anulación Entry Point On The Venta/Receipt View (PD-3, provisional placement — see ambiguity flag above)
The system MUST provide an anulación entry point reachable from the receipt/venta-detail view
for a `confirmada` venta, visible only to a session with `rol = encargado`. This control MUST
be rendered by the route component hosting `Recibo.tsx`, not by `Recibo.tsx` itself (PD-4).
Triggering it MUST require an explicit `motivoAnulacion` input before the request can be
submitted (mirrors `point-of-sale`'s mandatory-motivo requirement, PD-1). A `rol = deposito`
session MUST NOT see or be able to reach this control — this is a UX affordance only; the
server's `403` remains the real boundary (CLAUDE.md's "Authorization is server-side" rule).

#### Scenario: Encargado sees and can trigger the anulación action
- GIVEN a `confirmada` venta's receipt/venta-detail view, session `rol = encargado`
- WHEN the view renders
- THEN an anulación control is visible and reachable

#### Scenario: Deposito does not see an anulación control
- GIVEN the same view, session `rol = deposito`
- WHEN the view renders
- THEN no anulación control is present or reachable

#### Scenario: Submission without a reason is blocked client-side
- GIVEN an encargado has opened the anulación action
- WHEN no `motivoAnulacion` is entered
- THEN the client MUST NOT submit the anulación request

#### Scenario: An already-anulada venta shows no anulación control
- GIVEN a venta with `estado = 'anulada'`
- WHEN its receipt/venta-detail view renders
- THEN no anulación control is offered, avoiding a request doomed to the backend's conflict
  refusal

#### Scenario: A successful anulación updates the view without altering Recibo.tsx's rendering contract
- GIVEN an anulación is submitted successfully
- WHEN the response returns
- THEN the view reflects `estado = 'anulada'` via `Recibo.tsx`'s existing plain-text `estado`
  field — no new banner, watermark, or per-pago marker is introduced (PD-4)

## Open Questions (not resolved by this spec — flagged for design/orchestrator, not decided here)

1. **Print CSS scope** (page size, margins) — no `@media print` precedent exists anywhere in
   the repo to copy from; left to design per the proposal's own Open Question 4.
2. **Route guard placement** (`shellLayout` vs. `encargadoLayout`) for `/ventas/:id/recibo` —
   the proposal treats the precedent (`shellLayout`, since both roles confirm sales) as
   likely but explicitly defers the confirmation to design, not this spec.

### Open Questions — Anulación requirements (backlog #9)

1. **UI placement itself** — whether the anulación entry point belongs on `/ventas/:id/recibo`
   or on the POS screen instead. This spec provisionally anchors it on the receipt view; design
   may relocate it.
2. **Whether a confirmation step (beyond entering a motivo) is required before submitting**,
   given anulación is irreversible — proposal.md does not specify this; left to design.
3. **Client-side `motivoAnulacion` length floor**, if any — mirrors `point-of-sale`'s Open
   Question 3 on the same field; not settled by any PD.
