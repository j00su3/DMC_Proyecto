# usuarios-ui Specification

## Purpose

Frontend screens (list, detail, create, edit, deactivate, reactivate, password-reset) and
route guard consuming the seven existing `user-management` backend routes as-is. Mounts
into `app-layout`. New capability (greenfield, no prior spec). No API, repository, or
OpenAPI change; no search or filtering.

Routes covered (all backend, unmodified): `GET /api/usuarios`, `GET /api/usuarios/:id`,
`POST /api/usuarios`, `PATCH /api/usuarios/:id`, `POST /api/usuarios/:id/deactivate`,
`POST /api/usuarios/:id/reactivate`, `POST /api/usuarios/:id/password-reset`.

## Requirements

### Requirement: Encargado-Only Route Guard Is UX Convenience, Not Access Control
Usuarios routes MUST be nested under a route guard (e.g. `encargadoLayout`) that redirects
any session whose `usuario.rol` is not `encargado` away before rendering. This guard is a
UX convenience only. The backend's `403 FORBIDDEN` on every user-management route is the
actual security boundary; a hidden route MUST NOT be documented, treated, or relied upon
as access control.

#### Scenario: Deposito session is redirected away from a Usuarios route
- GIVEN an authenticated session with `usuario.rol = 'deposito'`
- WHEN the user navigates to any Usuarios route
- THEN the router redirects away before the screen renders

#### Scenario: The server boundary holds independent of the client guard
- GIVEN a deposito session calls any user-management route directly, bypassing the client router
- WHEN the request reaches the backend
- THEN it is refused with `403 FORBIDDEN` regardless of any client-side routing state

### Requirement: List Screen With Pagination And Visible Deactivated Users
The list screen MUST render `GET /api/usuarios`'s `{ data, page, pageSize, total }`
response with pagination footer controls, and MUST NOT offer any search or filter
control. Deactivated users (`activo = false`) MUST remain visible, distinguished by a
status chip, since this change ships no filtering to bring them back into view otherwise.

#### Scenario: Paginated list renders from the envelope
- GIVEN more users exist than one page
- WHEN the list screen loads
- THEN it renders at most `pageSize` rows and its pagination footer reflects `page`/`total`

#### Scenario: Deactivated user stays visible with a status chip
- GIVEN a user has `activo = false`
- WHEN the list screen renders that row
- THEN the row is shown, not hidden, with a status chip indicating it is inactive

### Requirement: Detail Screen
Each user MUST have its own detail route `/usuarios/:id`, reachable from a list row and
independently navigable by URL, rendering that user's profile excluding password/hash
fields per the backend DTO contract.

#### Scenario: Navigating to a valid id renders the detail
- GIVEN `:id` matches an existing user
- WHEN `/usuarios/:id` is opened directly by URL
- THEN the screen renders that user's profile fields, with no password or hash field present

### Requirement: Create User Flow
The screen MUST provide a create form for `{ nombre, email, rol }` submitting to
`POST /api/usuarios`, and MUST hand the `201` response's one-time plaintext temporary
password to the acknowledgment flow defined under Temporary Password Handling, not render
it inline in the form.

#### Scenario: Successful create hands off the temporary password
- GIVEN the create form is submitted with valid, unique data
- WHEN `POST /api/usuarios` returns `201`
- THEN the returned temporary password is passed to the acknowledgment flow, and the form does not render it inline

### Requirement: Edit User Flow
The screen MUST provide an edit form for `{ nombre, email, rol }` submitting a partial
`PATCH /api/usuarios/:id`. The form MUST NOT expose or submit an `activo` field; active
status is exclusively managed by the deactivate/reactivate actions. On the logged-in user's
own account the `rol` control MUST be disabled with a visible reason per the self-action
block below, while `nombre` and `email` stay editable.

#### Scenario: Successful edit persists the submitted fields
- GIVEN the edit form is submitted with a valid partial change
- WHEN `PATCH /api/usuarios/:id` returns `200`
- THEN the detail/list reflect the updated fields, and no `activo` field was part of the request body

#### Scenario: Editing your own profile keeps name and email but locks the role
- GIVEN the edit form renders for the logged-in user's own account
- WHEN its controls are inspected
- THEN `nombre` and `email` are editable while `rol` is disabled and shows a reason

### Requirement: Deactivate And Reactivate Actions
The screen MUST offer a deactivate action on active users' rows and a reactivate action on
inactive users' rows (subject to the self-action block below), each calling its respective
route and updating the row's status chip from the response without a full page reload.

#### Scenario: Deactivate updates the status chip
- GIVEN an active user's row offers the deactivate action
- WHEN the action is triggered and the server returns `200`
- THEN the row's status chip updates to inactive without a page reload

#### Scenario: Reactivate updates the status chip
- GIVEN an inactive user's row offers the reactivate action
- WHEN the action is triggered and the server returns `200`
- THEN the row's status chip updates to active without a page reload

### Requirement: Self-Action Block Is A UI Affordance, Not An Authorization Control
On the row or detail belonging to the logged-in user's own account, the screen MUST render
the deactivate/reactivate control, the password-reset control, and the role control in a
**disabled state carrying a visible reason** — never absent. `docs/design.md`'s "Permisos
visibles" principle is explicit that what a role cannot do is marked, not hidden without
explanation; a control that silently vanishes reads as a broken screen rather than as a
deliberate limit.

The limit exists because all three operations cost the actor their own access: deactivate
and password-reset revoke every session of their target, and demoting your own `rol` makes
the encargado-only guard redirect you out of the screen mid-flow. Aimed at yourself they
are an immediate self-logout with no upside, and an encargado who wants to change their own
password already has the `/auth/password` flow shipped in #2.1.

It is NOT a security or authorization guarantee. The backend still permits an encargado to
deactivate, password-reset, or demote their own account; the screen simply declines to
offer it. This requirement MUST NOT be read, implemented, or tested as if the screen
prevents the server from allowing it.

#### Scenario: Own row renders all three controls disabled with a reason
- GIVEN the list or detail screen renders the row/profile of the currently logged-in user
- WHEN the deactivate/reactivate, password-reset and role controls for that row are inspected
- THEN each one is present, disabled, and accompanied by a reason the user can read

#### Scenario: The server still permits the action the screen declines to offer
- GIVEN the deactivate, password-reset or PATCH endpoint is called directly for the logged-in user's own id, bypassing the screen
- WHEN the backend processes that request
- THEN it succeeds exactly as for any other target, because the screen's refusal is not a server-enforced rule

#### Scenario: Other users' rows keep every control enabled
- GIVEN a row belongs to a user other than the logged-in one
- WHEN the available actions for that row are inspected
- THEN the deactivate/reactivate, password-reset and role controls all render enabled

### Requirement: Admin Password-Reset Flow
The screen MUST offer a password-reset action, disabled with a visible reason on the
logged-in user's own row per the requirement above, calling
`POST /api/usuarios/:id/password-reset`, and MUST hand
the `200` response's one-time plaintext temporary password to the acknowledgment flow
defined under Temporary Password Handling.

#### Scenario: Successful reset hands off the temporary password
- GIVEN the password-reset action is triggered on another user's row
- WHEN `POST /api/usuarios/:id/password-reset` returns `200`
- THEN the returned temporary password is passed to the acknowledgment flow

### Requirement: Last-Active-Encargado Guard Is Server-Authoritative
The screen MUST NOT predict or pre-disable deactivate, reactivate, or role-change controls
based on any client-side count of active encargados. The list's `total` counts all users,
not active encargados specifically, so a client-side heuristic built from it is wrong in
both directions; even a correctly computed count would still race the server, since the
client cannot know the server's answer without asking. The screen MUST react only to the
backend's `409 LAST_ACTIVE_ENCARGADO` response after the request is sent.

#### Scenario: A refused deactivate is only known after the response arrives
- GIVEN a deactivate targets the last active encargado, initiated by a different admin session
- WHEN the backend responds `409 LAST_ACTIVE_ENCARGADO`
- THEN the screen surfaces the error only after that response, and the control was enabled beforehand

#### Scenario: No control is pre-disabled from a client-side prediction
- GIVEN the list screen has loaded any page of users
- WHEN its deactivate/reactivate controls are inspected before any request is sent
- THEN none of them are disabled based on a computed "last active encargado" guess

### Requirement: Temporary Password Handling
The plaintext temporary password returned by create (`201`) or password-reset (`200`) —
each sent with `Cache-Control: no-store` and never repeated on any later response — MUST
be held only in local component state fed directly from that mutation's response. It MUST
NOT enter the TanStack Query cache, router or URL state, or `localStorage`/`sessionStorage`.
It MUST be presented in a modal requiring an explicit acknowledgment action before
dismissal; it MUST NOT auto-dismiss.

#### Scenario: Temporary password lives only in local component state
- GIVEN a create or password-reset mutation succeeds
- WHEN the temporary password is displayed
- THEN it is sourced from local component state fed by the mutation response, not from the query cache, router/URL state, or web storage

#### Scenario: The modal requires explicit acknowledgment
- GIVEN the temporary-password modal is open
- WHEN no acknowledgment action has been taken
- THEN the modal remains open indefinitely — it does not auto-dismiss on a timer or on background click alone

#### Scenario: The password is unrecoverable after dismissal
- GIVEN the user has acknowledged and dismissed the temporary-password modal
- WHEN the user navigates away and back, or reopens the same user's detail
- THEN the plaintext password is no longer available anywhere in the UI

### Requirement: Error Surfacing By Code
The screen MUST render a distinct, user-facing message for each of `USER_NOT_FOUND`,
`EMAIL_ALREADY_IN_USE`, `LAST_ACTIVE_ENCARGADO`, `VALIDATION_ERROR`, and `FORBIDDEN`, keyed
off `ApiError.code`, following the `errorMessages.ts` convention established by
`features/auth`.

#### Scenario: Each code maps to a distinct message
- GIVEN a fetch or mutation throws an `ApiError` with one of the five listed codes
- WHEN the screen renders the resulting error
- THEN the displayed message matches that code's mapped copy, not a generic fallback message

### Requirement: Design-Tokens-Only Build, No Approved Mockup
Usuarios screens MUST be implemented from `docs/design.md`'s documented tokens, because no
approved `.dc.html` wireframe exists in the repository for Usuarios (`Wireframes.dc.html`
and `UI Vistas.dc.html` are referenced but absent). This MUST be noted in code and PR
description as not visually approved. This requirement is independent of, and not
inherited from, `app-shell`'s equivalent requirement, which names only the login and
change-password screens. Table tokens (`docs/design.md:73-74`): white card, 11px
uppercase header, `#eef1f5` row dividers, `11px 18px` row padding, footer with compact
pagination buttons and the active page in blue. Modal tokens (`docs/design.md:38-40`):
18px radius, `rgba(22,35,60,.55)` overlay, `0 18px 50px rgba(22,35,60,.4)` shadow.

#### Scenario: List table matches the documented table tokens
- GIVEN the Usuarios list screen renders
- WHEN its table styling is inspected
- THEN it uses a white card, an 11px uppercase column header, `#eef1f5` row dividers, and `11px 18px` row padding

#### Scenario: Temporary-password modal matches the documented modal tokens
- GIVEN the temporary-password modal renders
- WHEN its container styling is inspected
- THEN it uses an 18px border radius, `rgba(22,35,60,.55)` overlay, and `0 18px 50px rgba(22,35,60,.4)` shadow

#### Scenario: Screens are noted as not visually approved
- GIVEN the Usuarios screens ship
- WHEN the code and the PR description are inspected
- THEN both explicitly note the screens are built from tokens only, not an approved mockup
