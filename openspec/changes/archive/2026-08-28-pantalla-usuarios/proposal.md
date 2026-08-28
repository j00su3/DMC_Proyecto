# Proposal: Pantalla de Usuarios (backlog #3.1)

## Intent

Give encargados a UI to manage the seven already-shipped `user-management` backend
routes (list, get, create, update, deactivate, reactivate, password-reset). Today the
capability is fully built and tested server-side but has zero web consumers — user
administration is impossible except by direct API calls. This change closes that gap
with the app's second real screen.

## Scope

### In Scope

- Full CRUD UI for users: list (paginated), detail (`/usuarios/:id`), create, edit,
  deactivate, reactivate, password-reset — consuming all seven existing routes as-is.
- Prerequisite platform work this screen exposes as missing, priced in explicitly:
  - Extract a shared application layout (sidebar + content) out of the inline
    `ShellPlaceholder` markup in `apps/web/src/routes/index.tsx`, so a second screen can
    mount into the same chrome. `NAV_ITEMS` becomes real links.
  - A new encargado-only route guard layer (e.g. `encargadoLayout`), alongside the
    existing session and forced-password-change guards.
  - New shared UI primitives: table/list, pagination, modal/dialog, toast — none exist
    in `apps/web/src/` today (verified: only `Button`, `TextField`, `FormError`,
    `AuthCard`).
- A temporary-password display flow (create and password-reset responses) built to the
  constraint below.
- A restated design-tokens-only requirement for the Usuarios screens (see below).

### Out of Scope

- No API, repository, or OpenAPI changes. The list route accepts only `page` and
  `pageSize` (verified in `apps/api/src/routes/usuarios.ts`) — no other params exist.
- No search or filtering. Confirmed as a deliberate UI-only fast-follow choice, not an
  oversight.
- No master-detail (340px | 1fr) layout. `docs/design.md` line 94 scopes that pattern to
  Proveedores only; Usuarios detail is a separate page route.
- No email-based password recovery (backlog #3.5 — blocked on not owning a domain).

## Capabilities

### New Capabilities
- `app-layout`: shared sidebar/content shell extracted from the current placeholder,
  consumed by any screen (not just Usuarios).
- `usuarios-ui`: list, detail, create, edit, deactivate, reactivate, password-reset
  screens and their RBAC guard.

### Modified Capabilities
None. `user-management` (backend) and `app-shell` (routing/auth guards) are consumed,
not changed.

## Approach

Frontend-only feature slice following the `features/auth/` container/presentational
precedent, backed by TanStack Query against the existing generic `apiFetch`/`ApiError`
(already verified sufficient for every error code this screen hits: `USER_NOT_FOUND`,
`EMAIL_ALREADY_IN_USE`, `LAST_ACTIVE_ENCARGADO`, `VALIDATION_ERROR`, `FORBIDDEN`).

Key constraints carried forward as fixed inputs, not decisions for `sdd-design` to
reopen:

- **Temporary password**: plaintext lives only in local component state fed directly
  from the create/password-reset mutation response. Never in the TanStack Query cache,
  never in router/URL state, never in `localStorage`/`sessionStorage`. Proposed
  mechanism: a modal with explicit acknowledgment and no auto-dismiss (`sdd-design`
  owns exact mechanics).
- **Last-encargado guard**: no client-side prediction. `total` in the paginated list
  counts all users, not active encargados, so any heuristic is wrong in both directions
  and even a correct count would race the server. The UI reacts to the 409
  `LAST_ACTIVE_ENCARGADO` after the request, full stop.
- **RBAC**: the new route guard is UX convenience only. The server's 403 is the
  security boundary; a hidden route is not access control. This must be documented in
  code and PR description, not just implied.
- **Wireframes**: `docs/design.md` cites `Wireframes.dc.html` as approved but it is not
  in the repo. The #2.1 cycle's requirement (`openspec/specs/app-shell/spec.md:87-88`)
  is scoped by name to login/change-password and does not cover Usuarios by
  inheritance. This change carries its own delta requirement: Usuarios screens MUST be
  built from `docs/design.md`'s documented tokens and noted in code/PR as not visually
  approved. Follow the already-settled table tokens (white card, 11px uppercase
  header, `#eef1f5` row dividers, 11px 18px padding, compact pagination footer with blue
  active page — lines 73-74) and modal tokens (18px radius, `rgba(22,35,60,.55)`
  overlay, `0 18px 50px rgba(22,35,60,.4)` shadow — lines 38-40) verbatim.

## Affected Areas

| Area | Impact | Description |
|------|--------|--------------|
| `apps/web/src/routes/index.tsx` | Modified | Sidebar/nav extracted into shared layout; `NAV_ITEMS` becomes links |
| `apps/web/src/routes/` | New | Usuarios list/detail/create/edit routes + `encargadoLayout` guard |
| `apps/web/src/features/usuarios/` | New | Container/presentational slice, hooks, `errorMessages.ts` |
| `apps/web/src/ui/` (or equivalent) | New | Table, pagination, modal, toast primitives |
| `apps/web/src/routes/shellLayout.tsx` | Read-only reference | Guard-composition pattern to extend, not change |
| `openspec/specs/app-shell/spec.md` | Unaffected | No change — new requirement lives in this change's own delta spec |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 400-line PR review budget exceeded by full CRUD + 4 new primitives + layout extraction | High | `sdd-tasks` chains into multiple deliverable PR slices (layout+RBAC+list first, then detail, then mutations) |
| Temp-password leaks into a re-readable cache/storage layer | Medium impact if it happens | Constraint stated explicitly above; `sdd-design` and code review both check for it |
| Wireframes remain unapproved when this ships | Low | Explicit delta requirement + code/PR note, same pattern as #2.1 |
| Last-encargado UX feels abrupt (no pre-warning) | Low | Accepted tradeoff — correctness over predictive UX |

## Rollback Plan

Frontend-only change with no API/schema/data migration. Revert is a standard git revert
of the merged PR chain; no backend or database rollback needed. If only part of the PR
chain has landed (e.g. layout + list but not mutations), the read-only slice can ship
and stabilize independently since it does not depend on the mutation slices.

## Dependencies

- None external. All backend routes and DTOs already exist and are stable.

## Success Criteria

- [ ] Encargados can list, view, create, edit, deactivate, reactivate, and reset
      passwords for users, exercising all seven backend routes.
- [ ] Temporary passwords never persist outside local component state.
- [ ] Deactivate/reactivate on the last active encargado is blocked only by the server's
      409, with no client-side pre-disabling.
- [ ] Non-encargados cannot reach Usuarios routes in the UI (convenience guard), and the
      PR/code explicitly notes the server 403 as the real boundary.
- [ ] No changes to `apps/api/`, the repository layer, or the OpenAPI contract.

## Proposal question round

All questions from this round are **settled**. The backlog owner answered on 2026-08-28.
These are fixed inputs for `sdd-spec` and `sdd-design`, not open items.

Answered before this phase started:

1. **Scope**: full CRUD, not read-only-first.
2. **Detail view**: a separate `/usuarios/:id` route, not a master-detail panel.
3. **Search/filtering**: none; this change stays UI-only and does not touch the API.

Answered after this proposal was drafted:

4. **Deactivated users stay visible in the list**, marked with a status chip.
   Rationale: this change ships no filtering, so hiding them would leave no way to bring
   them back into view. Logical deactivation is reversible by design, and the UI must not
   make it look permanent.

5. **On the logged-in user's own row, three controls render disabled with a visible
   reason** — deactivate/reactivate, password-reset, and the `rol` selector. They are
   **disabled, never hidden**: `docs/design.md`'s "Permisos visibles" principle states that
   what a role cannot do is marked, not hidden without explanation, and a control that
   silently vanishes reads as a broken screen.

   Rationale: all three cost the actor their own access. Deactivate and password-reset
   revoke every session of the target (verified by the `usuarios` integration tests of the
   archived #3 cycle); demoting your own `rol` makes the encargado-only guard redirect you
   out of the screen mid-flow. An encargado who wants to change their own password already
   has the `/auth/password` flow shipped in #2.1. `nombre` and `email` stay editable on
   your own profile.

   This is a **UI affordance, not a security control**. The server still permits all three
   operations; the screen simply declines to offer them. Requirements MUST be written that
   way — never as an authorization claim.

   *Revised 2026-08-28 after `sdd-design` surfaced the conflict with `docs/design.md`: the
   original wording said the controls were not rendered at all.*
