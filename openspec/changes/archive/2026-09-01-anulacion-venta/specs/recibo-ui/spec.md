# Delta for recibo-ui

Adds the UI entry point for triggering anulación (PD-3). `Recibo.tsx` itself is NOT modified
(PD-4) — the existing "Estado Shown As Plain Text, No Visual Flag" requirement already covers
how an `anulada` venta displays and continues to apply unchanged; no requirement in this delta
touches it.

> **Ambiguity flag, NOT resolved here**: proposal.md's Capabilities section explicitly leaves
> the exact UI placement (receipt/venta-detail view vs. POS screen) to `design.md`, and this
> spec runs in parallel with design without visibility into its decision (per this project's
> "spec and design cannot see each other" rule). The requirement below provisionally anchors
> the entry point on the receipt/venta-detail view (`/ventas/:id/recibo`) because it is the
> existing screen where a `confirmada` venta's state is already visible for an encargado's
> judgment call. **This is a provisional stance, not a settled decision.** If `design.md`
> places the entry point on the POS screen instead, this requirement MUST move to `pos-ui`'s
> spec at archive time rather than being duplicated across both capabilities.

## ADDED Requirements

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

1. **UI placement itself** — see the ambiguity flag above. Not resolved by this spec.
2. **Whether a confirmation step (beyond entering a motivo) is required before submitting**,
   given anulación is irreversible — proposal.md does not specify this; left to design.
3. **Client-side `motivoAnulacion` length floor**, if any — mirrors `point-of-sale`'s Open
   Question 3 on the same field; not settled by any PD.
