# Exploration: Pantalla de Usuarios (backlog #3.1)

Phase: `sdd-explore` · Change: `pantalla-usuarios` · Date: 2026-08-28
Artifact store: hybrid (Engram topic `sdd/pantalla-usuarios/explore`)

## Purpose

Backlog #3.1 is the UI fast-follow for #3. The `user-management` backend capability is
shipped and archived; nothing in `apps/web/` consumes it yet. This exploration establishes
what exists to build on, what does not exist and must be built, and where the real
decisions are — before any proposal is written.

## Current State

### Backend: complete and unused by the frontend

Seven encargado-only routes live in `apps/api/src/routes/usuarios.ts` (list, get, create,
patch, deactivate, reactivate, password-reset), governed by the 15 requirements in
`openspec/specs/user-management/spec.md`. They are already typed in the generated
`apps/web/src/api/schema.d.ts`. No web code imports them.

The contract detail that drives the hardest UI decision (design decision D8 of the #3
cycle): `usuarioResumenDto` and `usuarioConPasswordDto` are **disjoint**. The plaintext
temporary password leaves the server on exactly two responses — create and password-reset —
each sent with `Cache-Control: no-store`. It is never readable again.

### Frontend: the shell exists, the building blocks do not

What #2.1 left behind and this change can lean on:

- A code-based TanStack Router tree (`apps/web/src/routes/routeTree.ts`) with a
  session-presence guard (`authLayout.tsx`) and a forced-password-change guard
  (`shellLayout.tsx`).
- `apps/web/src/api/client.ts` + `errors.ts` — a generic `apiFetch` / `ApiError` pair that
  already parses the `{ error: { code, message, details? } }` envelope. **Verified
  sufficient** for every code this screen will hit (`USER_NOT_FOUND`,
  `EMAIL_ALREADY_IN_USE`, `LAST_ACTIVE_ENCARGADO`, `VALIDATION_ERROR`, `FORBIDDEN`).
  No changes needed.
- One feature slice, `features/auth/`, establishing the container/presentational split and
  the `errorMessages.ts` convention.
- Exactly four UI primitives: `Button`, `TextField`, `FormError`, `AuthCard`.
- Testing: Vitest 4 + React Testing Library 16 + user-event 14. No MSW; `fetch` is stubbed
  per test via `vi.stubGlobal`.

What does **not** exist anywhere in `apps/web/src/` (verified by inventory, not assumed):

- No list or table component.
- No pagination primitive.
- No modal or dialog primitive.
- No toast/notification primitive.
- **No role-based route gating of any kind.** The router guards session presence and the
  forced-password-change flag; it has never gated on `rol`.
- **No shared application layout.** The sidebar is inline markup inside `ShellPlaceholder`
  in `routes/index.tsx`, and `NAV_ITEMS` (lines 7-15) is an array of plain strings —
  including `'Usuarios'` — with no links. A second screen cannot mount into that chrome
  without extracting a shared layout first.

That last point is prerequisite work the backlog letter does not call out, and it must be
priced into scope explicitly rather than discovered during apply.

## The wireframe precedent does not transfer as written

`docs/design.md` (~line 113) cites `Wireframes.dc.html` as approved wireframes; the file is
not in the repository. The #2.1 cycle handled this with a requirement in
`openspec/specs/app-shell/spec.md:87-88`:

> ### Requirement: Screens Built From Design Tokens, No Approved Mockup
> **Login and change-password screens** MUST be implemented from `docs/design.md`'s
> documented tokens [...] this MUST be noted in code/PR as not visually approved.

The requirement is scoped **by name** to login and change-password. It does not generically
cover future screens. Extending the same treatment to Usuarios is a sound analogy —
`docs/design.md`'s own file inventory names `UI Vistas.dc.html — las 7 vistas restantes` as
the same class of absence — but this change must **restate it as its own requirement** in
its delta spec. It cannot be inherited by assumption.

## Findings against the investigation questions

### 1. Scope boundary

The backlog letter says "pantalla de listado/detalle". Taken literally, v1 is read-only.
Recommended: **list + detail only in v1**, with create / edit / deactivate / reactivate /
password-reset deferred to follow-up slices. The backend is already shipped and stable, so
nothing forces the mutations into v1, and deferring them isolates the highest-risk decision
in the change.

### 2. Temporary-password display — highest-risk decision

The plaintext arrives once and is never re-readable. That forces a hard constraint:

- It MUST live only in local component state fed by the mutation response.
- It MUST NOT enter the TanStack Query cache as a re-readable source.
- It MUST NOT enter router or URL state.
- It MUST NOT enter `localStorage` or `sessionStorage`.

Options considered:

| Option | Cost |
| --- | --- |
| Modal with explicit acknowledgment, no auto-dismiss | Needs a `Modal` primitive that does not exist yet |
| Inline banner on the list | Easy to lose on navigation or scroll; a lost password means a second reset |
| Print / download | Extra scope with no requirement asking for it; writes the credential to disk |

Recommended: the acknowledged modal. Losing the credential is not a cosmetic failure — it
forces another reset, which is another audited security event.

### 3. Pagination

The API returns `{ data, page, pageSize, total }`. This change introduces the app's first
pagination primitive. Recommended: query keys shaped `['usuarios', { page, pageSize }]` with
TanStack Query v5's `placeholderData: keepPreviousData` to avoid flicker between pages.
No existing code demonstrates this pattern.

### 4. Last-encargado guard

Do **not** pre-disable the action client-side. The list is paginated and `total` counts all
users, not active encargados, so any client-side heuristic is wrong in both directions —
and even a correct count is a race, because the client cannot know the server's answer
without asking. Predicting it would be a hint presented as an authority.

React to the 409 `LAST_ACTIVE_ENCARGADO` instead. The server is the only authority.

### 5. Error envelope

`client.ts` / `errors.ts` are generic and already sufficient. The only new work is a
feature-local `errorMessages.ts`, following the `features/auth/errorMessages.ts` precedent.

### 6. RBAC in the UI

Needs a new guard layer (e.g. `encargadoLayout`) between `shellLayout` and the route.
It MUST be documented as UX convenience only: the server's 403 is the security boundary,
and a hidden route is not an access control.

### 7. Testing

Strict TDD is active. Two established patterns apply: `vi.stubGlobal('fetch', ...)` for
route and hook tests, plain RTL for presentational components. No MSW is installed and
none is needed to follow the existing convention.

### 8. Size forecast

Realistically 400-600+ authored lines for the read-only slice alone once tests are counted,
driven by the absence of prior art: a shared layout extraction, an RBAC guard, a table, and
a pagination primitive are all new. **This will not fit the 400-line review budget as a
single PR.** Suggested chain shape: PR1 = layout extraction + RBAC guard + list;
PR2 = detail; PR3+ = mutations. The chaining decision itself belongs to `sdd-tasks`.

## Risks

| Risk | Impact |
| --- | --- |
| No shared sidebar/layout component exists | Scope is undersized if the extraction is not priced in |
| Temp-password display | Highest-risk UX/security surface in the change |
| Wireframe precedent scoped by name to login/change-password | Must be restated for this change, not inherited |
| 400-line review budget | Very likely exceeded by the read-only slice alone |
| Last-encargado guard | Cannot be safely predicted client-side; 409 is the only authority |

## Ready For Proposal

Yes. Enough is verified — the capability spec, the routes and DTOs, the shell code, the
test conventions, and the confirmed absence of list, pagination, modal, RBAC and shared
layout — to scope a proposal at list + detail for v1.
