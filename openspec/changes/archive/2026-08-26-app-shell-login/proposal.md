# Proposal: App Shell + Login

## Intent

Backlog #1 (auth API) and #2 (contract pipeline) shipped zero UI. The auth API is live in production but `apps/web` has no router and no login screen — nothing is reachable in a browser. This change builds the minimal cross-cutting app shell (router, session bootstrap, login, forced-password-change) so every later UI backlog item (starting with #3, `gestion-usuarios`) has a foundation to build on.

## Scope

### In Scope
- TanStack Router: public layout (login) vs protected layout (authenticated shell), typed routes/guards.
- Session bootstrap via `GET /api/auth/me` on load; logout action.
- Login screen (react-hook-form + zod resolver).
- Change-password screen + `POST /api/auth/password` endpoint, both client and server enforced.
- `debe_cambiar_password` column on `usuarios` + migration, default `false`.
- `apps/web/src/api/client.ts`: parse `{ error: { code, message, details? } }` into a structured `ApiError` (breaking change to its existing test, which must be rewritten).
- Server-side allowlist guard for the forced-password-change state.
- `pnpm contract` regeneration (`openapi.json`, `schema.d.ts`).

### Out of Scope
- User CRUD (`gestion-usuarios`, backlog #3).
- Audit trail for password/temporary-password actions (separate future item).
- Any screen beyond login, change-password, and a minimal authenticated shell.
- Email-based password reset (deferred by ADR-0007).

## Capabilities

### New Capabilities
- `app-shell`: SPA routing (public/protected layouts, typed guards), session bootstrap, logout, structured API error handling in the frontend.
- `password-change`: authenticated password-change endpoint + forced-change enforcement (server allowlist + UI redirect) + session revocation on change.

### Modified Capabilities
- `auth-sessions`: `usuario` DTO (login/me responses) gains `debe_cambiar_password`; RBAC hook contract gains a forced-password-change allowlist alongside the existing role allowlist.

## Approach

- **Router**: TanStack Router — pairs with the already-installed `@tanstack/react-query`, gives typed paths/params, and makes protected-route guards (`beforeLoad`) first-class.
- **Forms**: react-hook-form + `@hookform/resolvers` + `zod` (new to `apps/web`) — keeps client validation aligned with server Zod schemas; anticipates `gestion-usuarios` forms next.
- **Password change**: `POST /api/auth/password` (authenticated), verifies current password via existing `argon2` module, updates `hash_contrasena`, clears `debe_cambiar_password`, and revokes all OTHER sessions for that user (current session survives) — supports non-repudiation for the future audit trail.
- **Server enforcement (hard requirement)**: the `onRequest`/`preHandler` chain in `plugins/auth.ts` gains a scoped allowlist so `POST /api/auth/password`, `POST /api/auth/logout`, and `GET /api/auth/me` stay reachable while `debe_cambiar_password` is true; every other protected route is refused. The UI redirect is UX only, mirroring how role allowlists work today — the server is the authority.
- **`debe_cambiar_password` default = `false`**: avoids forcing the already-live production `encargado` through an unwanted password change; only users created in backlog #3 are born with the flag `true`.
- **Design basis**: all three `.dc.html` wireframes referenced by `docs/design.md` are absent from the repo. Screens are built from design tokens only (login background `#16233c`, Public Sans, documented radii/inputs/buttons) and must be labelled as not built against an approved mockup.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/web/src/api/client.ts` | Modified | Parse error envelope, throw structured `ApiError`; rewrites existing `.rejects.toThrow('503')` test |
| `apps/web/src/main.tsx`, `App.tsx` | Modified | Router provider, split into public/protected route trees |
| `apps/web/package.json` | Modified | Add `@tanstack/react-router`, `react-hook-form`, `@hookform/resolvers`, `zod` |
| `apps/web/src/routes/**` | New | Login screen, change-password screen, protected shell layout, guards |
| `apps/api/src/db/schema.ts` | Modified | `debe_cambiar_password boolean default false` on `usuarios` |
| `apps/api/drizzle/000X_*.sql` | New | Additive migration |
| `apps/api/src/auth/repository.ts` | Modified | Methods to update `hash_contrasena` and the flag |
| `apps/api/src/auth/service.ts` | Modified | `changePassword()`: verify current password, update hash, clear flag, revoke other sessions |
| `apps/api/src/routes/auth.ts` (or new `routes/password.ts`) | New | `POST /api/auth/password`, authenticated |
| `apps/api/src/plugins/auth.ts` | Modified | Forced-password-change scoped allowlist |
| `apps/api/src/lib/errors.ts` | Modified | New error code(s) for wrong-current-password / must-change-password |
| `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts` | Regenerated | Via `pnpm contract` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| No approved wireframe exists for login/change-password screens | High | Build from design tokens; flag explicitly as not-yet-approved visually |
| UI-only guard would be bypassable via direct API calls | Would be High if unmitigated | Server-side allowlist enforcement is a hard requirement of this proposal |
| `client.ts` fix breaks its existing test | Certain | Rewrite the test alongside the fix, not additive |
| Form-interaction tests need `@testing-library/user-event` (not installed) | Medium | Add as devDependency during spec/tasks, or use `fireEvent` as lower-fidelity fallback |
| Wrong default on `debe_cambiar_password` disrupts live production encargado | Would be High if defaulted `true` | Default `false`, confirmed by user |

## Rollback Plan

Additive migration only (new nullable-with-default column) — revert by dropping the column in a follow-up migration if needed. Frontend changes are a new deployable SPA bundle; revert via redeploying the prior Vercel build. New endpoint and allowlist changes are additive to `plugins/auth.ts` and isolated to the new route — revert by reverting the commit, no data migration required for rollback.

## Dependencies

- `@tanstack/react-router` (or `@tanstack/router-*` packages), `react-hook-form`, `@hookform/resolvers`, `zod` — all new to `apps/web`.
- `pnpm contract` regeneration pipeline (existing, from `api-contract-pipeline`).

## Success Criteria

- [ ] A user can load the SPA, see a login screen styled per design tokens, and log in.
- [ ] An authenticated session bootstraps via `/me` and the protected shell renders; logout works.
- [ ] A user with `debe_cambiar_password = true` cannot reach any protected route except change-password, logout, and `/me` — enforced server-side (verified by direct API call bypassing the UI).
- [ ] Changing password succeeds, clears the flag, and invalidates all other sessions for that user while the current session remains valid.
- [ ] `client.ts` surfaces structured `ApiError` with `code`/`status`/`details`; its test suite reflects the new contract.
