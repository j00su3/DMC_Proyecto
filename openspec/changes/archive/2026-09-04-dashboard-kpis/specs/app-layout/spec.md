# Delta for app-layout

## MODIFIED Requirements

### Requirement: Sidebar Items Render As Navigation Links
`NAV_ITEMS` MUST render as link elements instead of inert `<span>`s. The "Usuarios" entry
MUST navigate to the Usuarios list route. The "Panel general" entry MUST navigate to the
dashboard route (see `dashboard-ui`), reachable by both `rol='encargado'` and
`rol='deposito'` sessions with no lock indicator. Entries with no shipped destination yet MAY
remain non-interactive but MUST still render through the same link markup, not the old
`<span>`.
(Previously: only "Usuarios" had a wired destination; "Panel general" was a destination-less
placeholder covered only by this requirement's non-interactive fallback clause.)

#### Scenario: Usuarios nav item navigates to the list route
- GIVEN the sidebar renders
- WHEN the user activates the "Usuarios" nav item
- THEN the router navigates to the Usuarios list route

#### Scenario: Active route highlights its nav item
- GIVEN the current route is a Usuarios route
- WHEN the sidebar renders
- THEN the "Usuarios" nav item is visually marked active, distinct from inactive items

#### Scenario: Panel general nav item navigates to the dashboard for both roles
- GIVEN a session with `rol='encargado'` or `rol='deposito'`
- WHEN the user activates the "Panel general" nav item
- THEN the router navigates to the dashboard route

#### Scenario: Panel general shows no lock indicator for deposito
- GIVEN a `rol='deposito'` session viewing the sidebar
- WHEN the "Panel general" nav item is inspected
- THEN it shows no lock icon, unlike role-restricted items such as Usuarios or Discrepancias
