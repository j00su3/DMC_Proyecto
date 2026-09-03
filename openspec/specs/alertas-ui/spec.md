# alertas-ui Specification

## Purpose

The alert count badge (polled) and alert list screen consuming `alertas`' list/count and
manual-resolve endpoints. New capability (greenfield, no prior spec). Split from `alertas`
(backend) per this project's consistent backend/frontend capability split precedent — see
`alertas`'s spec header for the granularity justification; both ship in this one change.

## Non-Goals

- `sugerencia_reposicion` UI (backlog #11).
- Mobile/responsive-specific layout beyond existing `shellLayout` behavior.
- Real-time (websocket/SSE) alert delivery — polling only (PD-4).

## Requirements

### Requirement: Role Gate — Alert Screen Reachable By Both Roles
The alerts route MUST be reachable by sessions with `rol='encargado'` or `rol='deposito'` (a
shared `shellLayout` subtree, not `encargadoLayout`-gated), mirroring backend read access.

#### Scenario: Deposito reaches the alerts screen
- GIVEN a session with `rol='deposito'`
- WHEN the alerts route is navigated to
- THEN the screen renders the alert list, not a permission refusal

### Requirement: Alert Count Polled Every 60 Seconds
The SPA MUST refetch the alert count on a 60-second interval while the count/badge is mounted.

#### Scenario: Badge refetches after 60 seconds
- GIVEN the alert count badge is mounted and displaying a count
- WHEN 60 seconds elapse without user interaction
- THEN the badge issues a new request for the current alert count

### Requirement: Manual Resolve Control Restricted To Encargado
The resolve action for a `discrepancia` alert MUST be available only to sessions with
`rol='encargado'`; a `deposito` session MUST NOT be able to trigger it from the UI, mirroring the
server-side 403.

#### Scenario: Deposito sees no resolve control
- GIVEN a `deposito` session viewing an `activa` `discrepancia` alert
- WHEN the alert list renders
- THEN no resolve action is offered for that alert

#### Scenario: Encargado resolves from the list
- GIVEN an `encargado` session viewing an `activa` `discrepancia` alert
- WHEN the resolve action is invoked
- THEN the alert list reflects the alert as `resuelta` after the request succeeds
