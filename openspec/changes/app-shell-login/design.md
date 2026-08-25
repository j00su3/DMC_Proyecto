# Design: App Shell + Login (backlog #2.1)

## Technical Approach

Six seams in dependency order. Each is independently mergeable and each is a candidate PR slice under the 400-authored-line budget. Decision ids below are cited as `app-shell-login D1..D16`; `auth-sesiones/design.md` owns its own D-numbers.

1. **S1 — Frontend error contract** (`apps/web/src/api/`). `apiFetch` parses the `{ error: { code, message, details? } }` envelope on non-2xx and throws `ApiError`. Touches no API file, so `pnpm contract:check` cannot move. Supersedes the existing `.rejects.toThrow('503')` test.
2. **S2 — Data + domain** (`apps/api`). `debe_cambiar_password` column + migration `0001`, `Usuario.debeCambiarPassword`, `UsuariosRepo.updatePassword`, `SesionesRepo.deleteOthers`, `service.changePassword`, two error factories. **No route file changes**, so `openapi.json` is byte-identical and the drift gate stays green mid-chain (`toDto` still whitelists fields explicitly — the DTO does not widen until S3).
3. **S3 — API surface + server enforcement** (`apps/api`). Forced-change guard in `plugins/auth.ts`, `POST /api/auth/password`, `usuarioDto` gains `debeCambiarPassword`, **plus regenerated `openapi.json` and `schema.d.ts` in the same commit**. This is the only slice that touches routes, so the drift gate can only ever be evaluated on a complete change (D14).
4. **S4 — Visual foundation** (`apps/web`). `styles/tokens.css` from `docs/design.md`, `components/ui/*` atoms, self-hosted Public Sans, new dependencies. Pure presentational, no router, no network.
5. **S5 — Router + session + login**. Route tree, guards, session query, login screen, placeholder authenticated shell with logout.
6. **S6 — Change-password screen**. `/cambiar-password` route, form, mutation, forced-change redirect branch.

S1, S2 and S4 have no dependency on each other. S3 needs S2; S5 needs S1+S3+S4; S6 needs S5.

## Architecture Decisions

| # | Decision | Alternatives rejected | Rationale |
|---|---|---|---|
| D1 | `debe_cambiar_password` rides the existing `SesionesRepo.findValid` JOIN | Second lookup in the guard; cache the flag on the `sesiones` row | `findValid` already does `select({ usuario: usuarios })` — the whole row. Adding the Drizzle column carries the flag into `request.user` with **zero extra queries**, and it is re-read live every request, so clearing it propagates instantly. Exactly the property that makes `activo = false` revoke sessions today |
| D2 | Forced-change check lives in the **existing `preHandler`** of `plugins/auth.ts`, after the `auth === false` early return and **before** the `roles` check | A new plugin; a check inside each route | `onRequest` is authentication, `preHandler` is authorization; forced-change is authorization. Placing it before `roles` makes the reachable set exactly the allowlist regardless of role, and returns one deterministic code. **No `app.ts` change**: `authPlugin` is already registered before every route plugin, and the new endpoint lives in the already-registered `routes/auth.ts`, so the hook-ordering hazard is structurally avoided rather than re-argued |
| D3 | Allowlist is a route-`config` opt-in: `config: { allowPasswordChangePending: true }` | Hardcoded URL list inside the plugin | Mirrors `auth: false` / `roles` — plain data, colocated with the Zod schema, assertable in tests, and default-deny (a new route is blocked unless it opts in). A URL list would duplicate knowledge of the `/api` prefix and silently drift. **Only two routes need the flag**: `GET /api/auth/me` and `POST /api/auth/password`. Logout and login are already `auth: false` and skip both hooks entirely |
| D4 | `PASSWORD_CHANGE_REQUIRED`, HTTP **403** | Reuse `FORBIDDEN`; 423; 409 | The SPA branches on `code`, not status. 403 is "authenticated principal, not permitted in this state"; 423 is already `ACCOUNT_LOCKED`. A distinct code is what makes the SPA able to self-correct instead of guessing |
| D5 | Wrong current password → `INVALID_CURRENT_PASSWORD`, HTTP **400** | `INVALID_CREDENTIALS` (401) | A 401 would trip the SPA's global "session expired → go to login" rule and destroy the user's typed input, for a request whose session is perfectly valid. 400 + a distinct code maps to a field-level error on the current-password input |
| D6 | `updatePassword(id, hash)` sets the hash **and** clears the flag in one UPDATE | Two statements / two repo methods | A partial failure that changed the password but left the flag set would trap the user in a redirect loop while holding the new password. One statement makes that state unreachable |
| D7 | Password update happens **before** revoking other sessions | Revoke first | If revocation fails after a successful update, stale sessions live at most 12 h and the user can retry. The reverse leaves other devices logged out with an unchanged password — worse and inexplicable to the user |
| D8 | `plugins/auth.ts` decorates `request.sessionId` in `onRequest` | Re-`unsignCookie` inside the password handler | The hook already holds the unsigned value; re-deriving it would put cookie/signature knowledge in a third place |
| D9 | Add **only** `debe_cambiar_password`; no `actualizado_en` | Add `actualizado_en` "for the audit trail" | Backlog #2.2 needs immutable event rows with actor and timestamp, not a mutable column on `usuarios`. Speculative columns are dead weight. **Audit hook point**: `auth/service.ts#changePassword` is the single funnel for every password mutation — the later audit change writes there |
| D10 | TanStack Router **code-based** route tree (`createRoute`), no `@tanstack/router-plugin`, no `routeTree.gen.ts` | File-based routing with codegen | The repo already runs one generated-artifact drift gate (`contract:check`). A second generated file committed to git adds CI surface and merge noise for a 4-route app. Code-based routing keeps full path/param type inference |
| D11 | Two nested pathless layout routes mirror the server allowlist structurally | One protected layout with a `location.pathname !== '/cambiar-password'` comparison | `authLayout` (session required) is the client mirror of the server allowlist; `shellLayout` (flag must be false) is the client mirror of "everything else". Adding a screen to either set is a placement decision, not an edit to a string comparison that someone will forget |
| D12 | Session lives **only** in the react-query cache (`['session']`), read by guards through `context.queryClient.ensureQueryData` | A React `AuthContext` provider | One source of truth; the guard resolves before render so protected UI never flashes; logout is `queryClient.setQueryData(['session'], null)` + `router.invalidate()`. A context would duplicate the cache and need manual sync |
| D13 | `sessionQueryOptions.queryFn` returns `usuario \| null` — it catches a 401 `ApiError` and returns `null` | Let the 401 throw | A guard needs a definite answer, not an error state. `retry: false`, `staleTime: 30_000` so navigation does not re-hit `/me` on every click (Render free tier cold starts) |
| D14 | Any slice that edits a route file regenerates `openapi.json` + `schema.d.ts` **in the same commit** (S3 is the only such slice) | Regenerate once at the end of the chain | A mid-chain PR that changes routes without regenerating fails `contract:check` in CI. Concentrating all route edits in one seam makes the failure mode unreachable |
| D15 | CSS Modules + `styles/tokens.css` custom properties; zero styling dependencies | Tailwind; CSS-in-JS; global stylesheet | Vite supports CSS Modules natively. `docs/design.md` is already a token list, so custom properties are a 1:1 transcription and later screens inherit them. Tailwind would be a large config + mental-model change for the first UI |
| D16 | SPA URLs are Spanish (`/ingresar`, `/cambiar-password`); API paths stay English (`/api/auth/login`) | Spanish everywhere; English everywhere | URLs are user-facing and the UI copy is Spanish (`docs/design.md`, neutral formal *usted*); API paths are developer-facing. Sets the convention for `/productos`, `/usuarios` later |

## Data Flow

```
POST /api/auth/password              (config: { allowPasswordChangePending: true })
  onRequest  → cookie → sesiones.findValid (JOIN usuarios) → request.user + request.sessionId
  preHandler → user.debeCambiarPassword && !config.allowPasswordChangePending
                 → 403 PASSWORD_CHANGE_REQUIRED     ← every other protected route lands here
             → roles check (unchanged)
  handler    → changePassword(repos, { usuario, sessionId, currentPassword, newPassword })
                 verifyPassword(usuario.hashContrasena, currentPassword)
                   false → 400 INVALID_CURRENT_PASSWORD          (no writes)
                 hashPassword(new) → usuarios.updatePassword(id, hash)   [hash + flag, 1 UPDATE]
                                   → sesiones.deleteOthers(usuarioId, sessionId)
                 → 200 { ok: true }        current cookie still resolves

SPA navigation
  authLayout.beforeLoad   ensureQueryData(['session'])  null → redirect /ingresar
  shellLayout.beforeLoad  usuario.debeCambiarPassword   true → redirect /cambiar-password
  /cambiar-password is a child of authLayout, NOT of shellLayout  → always reachable

any ApiError with code UNAUTHORIZED | PASSWORD_CHANGE_REQUIRED
  QueryCache/MutationCache onError → invalidate ['session'] → router.invalidate()
  → guards re-run → correct redirect        (router late-bound via setRouter() to avoid a cycle)
```

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/src/db/schema.ts` | Modify | `debeCambiarPassword: boolean('debe_cambiar_password').notNull().default(false)` |
| `apps/api/drizzle/0001_*.sql` + `meta/` | Create | `pnpm db:generate`. `ADD COLUMN ... NOT NULL DEFAULT false` — no table rewrite on PG 11+ |
| `apps/api/src/auth/repository.ts` | Modify | `Usuario.debeCambiarPassword`; `UsuariosRepo.updatePassword(id, hash)`; `SesionesRepo.deleteOthers(usuarioId, exceptId)` |
| `apps/api/src/auth/service.ts` | Modify | `changePassword()` (D5–D7); audit hook point (D9) |
| `apps/api/src/lib/errors.ts` | Modify | `passwordChangeRequired()` 403, `invalidCurrentPassword()` 400 |
| `apps/api/src/plugins/auth.ts` | Modify | `allowPasswordChangePending` config key, `request.sessionId`, forced-change branch in `preHandler` |
| `apps/api/src/routes/auth.ts` | Modify | `POST /auth/password`; `usuarioDto` + `toDto` gain `debeCambiarPassword`; `allowPasswordChangePending` on `/auth/me` and `/auth/password` |
| `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts` | Regenerate | `pnpm contract`, committed inside S3 |
| `apps/web/src/api/errors.ts` | Create | `ApiError` + `isApiError` |
| `apps/web/src/api/client.ts` | Modify | Parse the envelope, throw `ApiError` |
| `apps/web/src/api/client.test.ts` | Rewrite | Old `.rejects.toThrow('503')` contract intentionally superseded |
| `apps/web/src/api/session.ts` | Create | `sessionQueryOptions`, `Usuario` type from `schema.d.ts` |
| `apps/web/src/app/{queryClient,router,providers}.tsx` | Create | QueryClient + global 401 recovery; `createRouter` with `{ queryClient }` context; provider composition |
| `apps/web/src/routes/*` | Create | `__root`, `publicLayout`, `authLayout`, `shellLayout`, `ingresar`, `cambiarPassword`, `index`, `routeTree` |
| `apps/web/src/features/auth/*` | Create | `LoginForm`, `ChangePasswordForm` (presentational), `schemas.ts`, `useLogin`/`useLogout`/`useChangePassword`, `errorMessages.ts` |
| `apps/web/src/components/ui/*` | Create | `Button`, `TextField`, `FormError`, `AuthCard` + `*.module.css` |
| `apps/web/src/styles/{tokens,global}.css` | Create | `docs/design.md` tokens as custom properties |
| `apps/web/src/test/renderWithProviders.tsx` | Create | Fresh `QueryClient` per test; optional memory router |
| `apps/web/src/App.tsx`, `App.test.tsx` | Delete | Scaffolding health-check screen, superseded by `routes/index.tsx` |
| `apps/web/src/main.tsx` | Modify | Providers + `RouterProvider` |
| `apps/web/package.json` | Modify | `@tanstack/react-router`, `react-hook-form`, `@hookform/resolvers`, `zod`, `@fontsource/public-sans`; dev `@testing-library/user-event` |

## Interfaces

```ts
// apps/web/src/api/errors.ts — exception-based because react-query's error
// channel is exceptions; a Result type would fight every call site.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,          // UPPER_SNAKE from the server envelope
    message: string,
    readonly details?: unknown,     // narrowed per-code by the caller (e.g. { retryAfter })
  ) { super(message); this.name = 'ApiError'; }
}
// Non-JSON or malformed body → code 'UNEXPECTED_RESPONSE', message carries the status.

// apps/api/src/plugins/auth.ts
interface FastifyContextConfig { auth?: false; roles?: Array<Usuario['rol']>;
                                 allowPasswordChangePending?: true; }
interface FastifyRequest { user: Usuario | null; sessionId: string | null; }

// POST /api/auth/password  (authenticated, allowPasswordChangePending)
body: z.object({ currentPassword: z.string().min(1),
                 newPassword: z.string().min(12) })
        .refine(v => v.newPassword !== v.currentPassword)   // → 400 VALIDATION_ERROR, no new code
response: 200 z.object({ ok: z.literal(true) }) | 400 | 401 envelope
```

Route-module boundary (the convention every later screen inherits): modules under `src/routes/` are containers — they may import the router and react-query. Modules under `src/features/*/` (presentational) and `src/components/ui/` must import neither; they take props and callbacks. This is what lets the forms be tested without a `RouterProvider`.

## Visual Direction — NOT APPROVED

All three `.dc.html` wireframes referenced by `docs/design.md` are absent from the repository. **The login and change-password screens are designed from tokens only and have never been reviewed as a mockup — the user should review the visual direction before S4/S5 implement it.**

Derived directly from `docs/design.md`: full-bleed `#16233c` background (the file names it as the login background), a centered white card (radius 14, `0 1px 3px rgba(22,35,60,.07)`, max-width ~380px) holding the 30×30 brand mark on `linear-gradient(135deg,#3b82f6,#2456c8)`, Public Sans 400–800 with `system-ui` fallback, inputs white / border `#dde3ea` / radius 10 / padding 9px 14px / placeholder `#8794a5`, full-width primary button `#3b82f6` radius 10 weight 700 with the blue shadow, errors in `#e04f3a` on `#fdecea`. Copy is Spanish, neutral formal (*usted*), no decorative emojis, active voice, errors state what to do next. Restraint is the point: one accent colour, one card, no gradient background, no animation beyond focus/hover transitions. Quality floor: visible keyboard focus, labels bound to inputs, `aria-invalid` + `aria-describedby` on errors, `prefers-reduced-motion` respected.

## Testing Strategy (Strict TDD — RED first, every row)

| Layer | What to test | Approach |
|---|---|---|
| Unit `apps/web/src/api/client.test.ts` | Envelope → `ApiError{status,code,details}`; malformed/non-JSON body → `UNEXPECTED_RESPONSE`; 2xx passthrough and `credentials: 'include'` unchanged | `vi.stubGlobal('fetch')` (existing precedent). **Rewrites** the `'503'` test |
| Unit `features/auth/*.test.tsx` | Zod errors render; valid submit calls `onSubmit` with trimmed values; server error message renders; submit disabled while pending | `render()` with no router (presentational boundary) + `@testing-library/user-event` |
| Unit `features/auth/errorMessages.test.ts` | `ACCOUNT_LOCKED` → minutes from `details.retryAfter`; `INVALID_CREDENTIALS` / `ACCOUNT_INACTIVE` / `RATE_LIMITED` / unknown code | Pure function |
| Unit `routes/*.test.ts` | `beforeLoad` throws `redirect` to `/ingresar` when session is null; to `/cambiar-password` when the flag is true; passes through otherwise | Call `beforeLoad` directly with a stub `{ queryClient }` context — the highest-value logic without a full router |
| Integration (jsdom) `app/router.test.tsx` | `/` with no session lands on `/ingresar`; login → shell; flag `true` → `/cambiar-password` and `/` is unreachable | `createMemoryHistory` + `RouterProvider` + stubbed fetch |
| Unit `apps/api/src/auth/service.test.ts` | Wrong current password → `INVALID_CURRENT_PASSWORD` **and no repo writes**; success → `updatePassword` then `deleteOthers(usuarioId, sessionId)` in that order; new hash verifies, old does not | Stub repos, real argon2 (precedent) |
| Unit `apps/api/src/plugins/auth.test.ts` | Flagged user: plain protected route → 403 `PASSWORD_CHANGE_REQUIRED`; `allowPasswordChangePending` route → 200; `auth: false` route unaffected; unflagged user unaffected; forced-change beats `roles` (403 code is `PASSWORD_CHANGE_REQUIRED`, not `FORBIDDEN`) | Throwaway routes registered on `buildApp()` before `ready()` (existing precedent) |
| Unit `apps/api/src/routes/auth.test.ts` | `POST /auth/password` status/envelope codes; `debeCambiarPassword` present in `login`/`me` DTOs | `buildApp({ repos: stubRepos })` + `inject()` |
| Integration `apps/api` | Migration applied (column exists, default `false`); `deleteOthers` removes only other rows and the current cookie still resolves via `findValid` | Docker Postgres, real repos |
| Contract | `pnpm contract:check` green inside S3's commit | CI |

## Threat Matrix

| Boundary | Applicability |
|---|---|
| Documentation-like paths | N/A — no file classification or execution of repository content |
| Git repository selection | N/A — no VCS automation is introduced |
| Commit state | N/A — no index/worktree manipulation |
| Push state | N/A — no push automation |
| PR commands | N/A — no PR automation |

HTTP and SPA routing are changed, but neither is agent routing, shell-command construction, or subprocess spawning. The security-critical boundary of this change (forced-password-change bypass) is covered by D2–D4 and by dedicated RED tests in `plugins/auth.test.ts`, which assert enforcement at the API, not at the router.

## Migration / Rollout

Additive `ALTER TABLE usuarios ADD COLUMN debe_cambiar_password boolean NOT NULL DEFAULT false`, applied manually against Neon (`pnpm db:migrate`, ADR-0010) before S3 deploys. Default `false` leaves the live production `encargado` untouched; only users created by backlog #3 are born with `true`. Rollback: revert the commit and, if required, drop the column in a follow-up migration — no data is lost, because nothing but the guard reads it.

Nothing in this change introduces a browser-visible cross-origin call: the SPA keeps calling relative `/api/...` with `credentials: 'include'` through the Vercel rewrite, and no cookie option is touched, so the no-`Domain` constraint of ADR-0010 is untouched.

Suggested PR chain (`stacked-to-main`): S1 → S2 → S3 → S4 → S5 → S6. S1, S2 and S4 are independent and can be reordered or parallelised; S3 carries the regenerated contract diff (generated lines, excluded from the authored-line count).

## Open Questions

- [ ] **Visual direction is unapproved** — no wireframe exists for either screen. Confirm the token-derived direction above before S4 begins, or accept a later correction pass.
- [ ] Rate-limiting `POST /api/auth/password` is deliberately deferred: the endpoint already requires a valid session, so an attacker able to hit it has already won. Revisit if `gestion-usuarios` adds an unauthenticated reset path.
- [ ] Pin exact versions at install: `@hookform/resolvers` must be a release that supports **zod v4** (`apps/api` is on `^4.4.3`; a v3-only resolver will typecheck-fail against a shared schema style). Same for `@tanstack/react-router` against React 19.
- [ ] `apiFetch` still calls `response.json()` unconditionally on success. No current endpoint returns an empty body, so this is left as-is rather than widened speculatively.
