# Delta for pos-ui

## MODIFIED Requirements

### Requirement: Cart Clears On Confirmed Sale Or Explicit Empty Action, Success State Follows Confirmation (PD-9, PD-7)

The cart MUST clear automatically after a sale is confirmed successfully. An explicit
"empty cart" control MUST also be available and MUST clear the cart without requiring a sale
to be confirmed.

On a successful confirmation, the POS screen MUST show a post-confirmation success state
(see the new "Post-Confirmation Success State" requirement in this delta) rather than
returning directly to the catalog/cart view. The success state MUST remain visible until the
cashier takes the explicit "nueva venta" action — no auto-dismiss, no timeout (PD-7).

(Previously: the cart cleared automatically and the POS screen returned directly to an empty
cart/catalog view after a successful confirmation — no success state existed.)

#### Scenario: Successful confirmation clears the cart
- GIVEN a non-empty cart
- WHEN the sale is confirmed successfully
- THEN the cart is empty afterward

#### Scenario: Explicit empty action clears the cart without confirming a sale
- GIVEN a non-empty cart
- WHEN the cashier triggers the explicit "empty cart" action
- THEN the cart is empty and no sale was submitted

#### Scenario: Success state persists until explicit dismissal
- GIVEN a sale was just confirmed successfully
- WHEN no action is taken by the cashier
- THEN the success state remains displayed indefinitely, with no automatic return to the
  cart/catalog view

## ADDED Requirements

### Requirement: Post-Confirmation Success State (PD-1, PD-7)
Immediately after a successful sale confirmation, the POS screen MUST display a success
state that includes a link/view to the just-confirmed sale's receipt
(`/ventas/:id/recibo`). Returning to a fresh cart MUST require the explicit "nueva venta"
action described in the requirement above; `useConfirmarVenta` MUST retain (not discard) the
confirmation response so the success state has the confirmed venta's id to link to.

#### Scenario: Confirmation success shows a link to the receipt
- GIVEN a cart is confirmed successfully
- WHEN the success state renders
- THEN it includes a link/view to that sale's receipt

#### Scenario: "Nueva venta" returns to a fresh cart
- GIVEN the success state is showing
- WHEN the cashier triggers "nueva venta"
- THEN the screen returns to the catalog/cart view with an empty cart

## Open Questions (not resolved by this spec — flagged for design/orchestrator, not decided here)

1. **Whether cart-clearing and success-screen dismissal are one event or two.** PD-9 (already
   shipped) says the cart clears automatically "after a sale is confirmed successfully." PD-7
   (this cycle) says returning to a "fresh cart" requires the explicit "nueva venta" action.
   This delta reads that as: the cart's *data* clears immediately at confirmation (preserving
   PD-9's literal guarantee), and the success state is a separate view layered on top that the
   cashier must explicitly dismiss — but the proposal does not confirm this reading explicitly,
   and an alternative reading (cart data itself stays populated/frozen until "nueva venta" is
   clicked) is equally consistent with PD-7's text. This should be validated with the owner if
   the design phase finds the distinction consequential.
