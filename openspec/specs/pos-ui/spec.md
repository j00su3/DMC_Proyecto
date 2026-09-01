# pos-ui Specification

## Purpose

The two-pane POS screen (catalog | fixed cart, `1.2fr | 460px` per `docs/design.md:93`), its
`localStorage`-backed cart — the first client-persisted state in this codebase — and the
payment step that calls `point-of-sale`'s `POST /api/ventas`. New capability (greenfield, no
prior spec; no wireframe exists for catalog/cart internals, so this spec defines their
observable behavior, not their layout, per `docs/design.md:95`).

## Non-Goals

- Mobile/responsive POS layout (PD-4; `docs/design.md:95` marks it "pendiente de diseño").
- Receipt / print UI (backlog #8).
- Anulación / voiding UI (backlog #9).
- Stock alert UI (backlog #10).
- Barcode scanning (`docs/PRD.md:141-142`).

## Requirements

### Requirement: Role Gate — POS Screen Reachable By Both Roles
The POS route MUST be reachable by sessions with `rol = encargado` or `rol = deposito` (a
shared `shellLayout` subtree, not `encargadoLayout`-gated), mirroring the backend role gate on
`POST /api/ventas`.

#### Scenario: Deposito reaches and uses the POS screen
- GIVEN a session with `rol = deposito`
- WHEN the POS route is navigated to
- THEN the screen renders with catalog and cart panes, not a permission refusal

### Requirement: Adding A Product Already In The Cart Merges Into Its Existing Line (PD-3)
The cart MUST contain at most one line per `producto_id`. Adding a product that already has a
line MUST increase that line's quantity rather than creating a second line.

#### Scenario: Adding the same product twice sums into one line
- GIVEN the cart already has one line for product X with quantity 2
- WHEN product X is added again
- THEN the cart still shows exactly one line for product X, with quantity 3

### Requirement: Cart Persists In `localStorage`, Scoped Per Device And Per Signed-In User
Cart state MUST persist in `localStorage`, keyed by both the device (browser storage instance)
and the current signed-in user. It MUST survive a page reload, tab close, and reconnection, and
MUST restore automatically when the POS screen is revisited. It MUST NOT be shared or
synchronized across devices, even for the same user (`docs/TECH-DESIGNv2.md:38-42`,
`docs/REVISION-ADVERSARIAL.md:255-269`, S9).

#### Scenario: Cart survives a reload
- GIVEN the cart has two items
- WHEN the page is reloaded
- THEN the cart still shows the same two items on return to the POS screen

#### Scenario: A different signed-in user on the same device does not see another user's cart
- GIVEN user A has items in their cart on this device
- WHEN user B signs in on the same device and opens the POS screen
- THEN user B's cart is empty (or shows only user B's own previously stored items), never
  user A's

### Requirement: Corrupt Or Incompatible Stored Cart Data Does Not Crash The POS Screen
If the value stored in `localStorage` for the cart cannot be parsed or does not match the
expected shape, the POS screen MUST fall back to an empty cart on load rather than crashing or
rendering blank.

#### Scenario: An unparseable stored value falls back to an empty cart
- GIVEN `localStorage` holds a cart value that is not valid JSON for the expected shape
- WHEN the POS screen loads
- THEN it renders normally with an empty cart, not an error state

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

### Requirement: Catalog Hides Inactive Products And Blocks Adding Zero-Stock Products (PD-8)
The catalog view MUST NOT list any product with `activo = false`. It MUST list active products
with zero stock, but MUST prevent adding them to the cart (their add control disabled or
equivalent), so the cashier can see the product exists without being able to add it.

#### Scenario: Inactive product does not appear in the catalog
- GIVEN a product with `activo = false`
- WHEN the catalog is displayed
- THEN that product is not shown

#### Scenario: Zero-stock active product is visible but not addable
- GIVEN an active product with zero stock
- WHEN the catalog is displayed
- THEN the product is shown, and its control to add it to the cart is disabled or absent

### Requirement: A Server-Reported Price Mismatch Requires Explicit Cashier Re-Confirmation Before The Sale Closes (PD-6)
When confirmation reports a price mismatch (per `point-of-sale`'s mismatch requirement), the
UI MUST show a notice naming the new price and MUST require an explicit re-confirmation action
from the cashier before the sale is resubmitted. It MUST NOT auto-resubmit and MUST NOT close
the sale on the mismatch notice alone.

#### Scenario: A mismatch notice blocks the sale until acknowledged
- GIVEN the confirmation attempt returns a price-mismatch response
- WHEN the response is received
- THEN the sale is not shown as complete, and a notice naming the new price is shown, with no
  further request sent automatically

#### Scenario: Explicit re-confirmation proceeds
- GIVEN a price-mismatch notice is showing
- WHEN the cashier explicitly re-confirms
- THEN the sale is resubmitted and, on success, shown as complete

### Requirement: Payment Step Supports Multiple Payments, At Most One Per Medio (PD-1, PD-7)
The payment step MUST allow adding more than one payment, using different payment media, to
reach or exceed the sale total. It MUST allow at most one entry per medio in what is sent to
confirmation — if the cashier enters the same medio more than once, those amounts MUST be
combined into a single entry before submission (PD-7).

#### Scenario: Cashier splits payment across cash and card
- GIVEN a sale total of `100.00`
- WHEN the cashier adds a cash payment of `40.00` and a card payment of `60.00`
- THEN both are included as distinct entries in the confirmation request

#### Scenario: Two cash entries are combined before submission
- GIVEN the cashier enters cash `30.00` and then cash `20.00`
- WHEN the sale is confirmed
- THEN the confirmation request contains a single cash entry of `50.00`, not two

### Requirement: Vuelto Is Shown Only Against The Cash Payment (PD-2)
`vuelto` MUST be displayed attached to the cash payment entry only (`docs/design.md:35`,
"Vuelto 22px/800 green"). When the sale has no cash payment, no `vuelto` value MUST be shown.

#### Scenario: Cash overpayment shows vuelto next to the cash entry
- GIVEN a cash payment exceeding the total
- WHEN the payment step reflects the server's response
- THEN the vuelto amount is shown attached to the cash entry

#### Scenario: Card-only payment shows no vuelto
- GIVEN the sale is paid entirely by card with no cash entry
- WHEN the payment step reflects the confirmed sale
- THEN no vuelto value is shown

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

### Requirement: POS Screen Uses A Fixed Two-Pane Layout
The POS screen MUST present a two-pane layout: a catalog/browsing area and a cart pane fixed
to one side, sized per `docs/design.md:93`'s `1.2fr | 460px` grid token. Both panes MUST be
visible simultaneously without the cart scrolling out of view while browsing the catalog.

#### Scenario: Catalog and cart are both visible together
- GIVEN the POS screen is open with items in the cart
- WHEN the cashier scrolls or browses the catalog pane
- THEN the cart pane remains visible with its current contents

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
2. **POS catalog query shape** — whether the catalog reuses
   `productos/repository.ts:89-115`'s `list(page, pageSize, q)` search-by-name/SKU, or needs a
   POS-specific query, is undecided (proposal Open Q4). No requirement above assumes either
   shape.
3. **Wire-level mechanism for the price-mismatch re-confirmation** (e.g., a confirm
   flag/token on resubmission vs. a full second request) is undecided — this spec states the
   observable behavior (notice, block, explicit re-confirm) but not the request shape that
   carries it (shared with `point-of-sale`'s Open Question 1).
4. **`localStorage` versioning/resilience beyond "don't crash"** — whether an incompatible
   stored shape should attempt any partial recovery (vs. this spec's flat fallback to empty)
   is a design-level question the proposal flags as needing "its own resilience design"; this
   spec only commits to the non-crashing floor.
