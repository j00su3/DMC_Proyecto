# app-layout Specification

## Purpose

Shared sidebar/content application chrome, extracted from the inline `ShellPlaceholder`
markup in `apps/web/src/routes/index.tsx`, so any screen — starting with Usuarios — can
mount into the same layout instead of duplicating sidebar, user card, and logout per
screen. New capability (greenfield, no prior spec).

## Requirements

### Requirement: Shared Application Layout Component
The system MUST provide one reusable layout component (sidebar + content area) extracted
from the current `ShellPlaceholder` inline markup. The existing home route and every new
Usuarios route MUST mount their content into this shared layout rather than each
rendering its own copy of the sidebar, user card, and logout control.

#### Scenario: Home route renders unchanged through the shared layout
- GIVEN the home route (`/`) renders after the extraction
- WHEN its sidebar, user card, and logout control are inspected
- THEN they are visually and behaviorally identical to the pre-extraction `ShellPlaceholder`

#### Scenario: A second screen mounts into the same chrome
- GIVEN the Usuarios list route renders
- WHEN its sidebar and user card are inspected
- THEN they are the same shared layout instance used by the home route, not a duplicate

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
