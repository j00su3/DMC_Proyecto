# Tasks: App Shell + Login (backlog #2.1)

Six seams in dependency order (`design.md`): S1 → S2 → S3 → S4 → S5 → S6. S1, S2 and S4 have
no dependency on each other; S3 needs S2; S5 needs S1+S3+S4; S6 needs S5. S1 is already shipped
(see Phase 1). S5 is split into 5A/5B below because it forecasts roughly 2x the 400-line budget
— see **Review Workload Forecast** at the end of this file.

### Suggested Work Units

| Unit | Seam | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | S1 | Frontend error contract: `apps/web/src/api/{errors,client}.ts` | PR 1 (merged) | `pnpm --filter @inventienda/web test` | jsdom, `vi.stubGlobal('fetch')`, no network | commits `33c7bb5`, `b91810f` |
| 2 | S2 | Data + domain: schema, migration, repo methods, `service.changePassword`, error factories | PR 2 | `pnpm --filter @inventienda/api test` then `test:integration` | Docker Postgres for integration only | revert `apps/api/src/db/schema.ts` col, `apps/api/drizzle/0001_*`, `auth/repository.ts` additions, `auth/service.ts` `changePassword`, `lib/errors.ts` two factories |
| 3 | S3 | API surface + server enforcement + contract regen (D14, same commit) | PR 3 | `pnpm --filter @inventienda/api test`, `pnpm contract:check`, then `test:integration` | Docker Postgres + real argon2 for integration | revert `plugins/auth.ts` guard, `routes/auth.ts` route + DTO field, `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts` |
| 4 | S4 | Visual foundation: tokens, `components/ui/*`, deps | PR 4 | `pnpm --filter @inventienda/web test` | jsdom, no router/network | revert `apps/web/src/styles/**`, `apps/web/src/components/ui/**`, `apps/web/package.json` dep additions |
| 5A | S5a | Router skeleton + session bootstrap + guards + placeholder shell | PR 5 | `pnpm --filter @inventienda/web test` | jsdom, `createMemoryHistory` + stubbed fetch | revert `apps/web/src/app/**`, `apps/web/src/routes/{__root,publicLayout,authLayout,shellLayout,index}.tsx`, `api/session.ts`, `main.tsx`; restore `App.tsx`/`App.test.tsx` |
| 5B | S5b | Login screen: form, errorMessages, `useLogin`, `/ingresar` route | PR 6 | `pnpm --filter @inventienda/web test` | jsdom, `@testing-library/user-event` | revert `apps/web/src/features/auth/{schemas,errorMessages,LoginForm,useLogin}.ts(x)`, `apps/web/src/routes/ingresar.tsx` |
| 6 | S6 | Change-password screen + forced-change redirect verification | PR 7 | `pnpm --filter @inventienda/web test` | jsdom, `@testing-library/user-event` | revert `apps/web/src/routes/cambiarPassword.tsx`, `features/auth/{ChangePasswordForm,useChangePassword}.ts(x)` |

Delivery strategy: `ask-on-risk`. Chain strategy: `stacked-to-main`. Each unit above targets its
immediate predecessor's branch; no draft tracker PR is used (stacked-to-main, not feature-branch-chain).

## Phase 1: S1 — Frontend Error Contract (SHIPPED, verified, committed)

Maps to: *Structured API Client Errors* (`app-shell` spec). Branch `feat/shell-pr1-api-errors`,
commits `33c7bb5`, `b91810f`.

- [x] 1.1 `apps/web/src/api/errors.ts` (new) — `ApiError` class with explicit `status`/`code`/`details`
      fields set in the constructor body (NOT TypeScript parameter properties — those interact badly
      with `useDefineForClassFields` under esbuild) + `isApiError()`
- [x] 1.2 RED→GREEN `apps/web/src/api/client.test.ts` — rewritten: envelope → `ApiError{status,code,details}`;
      malformed/non-JSON body → `UNEXPECTED_RESPONSE`; 2xx passthrough and `credentials: 'include'`
      unchanged. **Intentionally supersedes** the old `.rejects.toThrow('503')` assertion, as recorded
      in advance by both spec and design
- [x] 1.3 GREEN `apps/web/src/api/client.ts` — `isErrorEnvelope()` narrowing + `toApiError()`; non-envelope
      body falls back to `UNEXPECTED_RESPONSE` carrying the response `status`
- [x] 1.4 GREEN (config, non-TDD) `biome.json` — add `docs/design/**` to `files.ignore`
- [x] 1.5 Verified on `feat/shell-pr1-api-errors`: typecheck OK, lint OK, `contract:check` OK
      (byte-identical — S1 touches no route file), api 63/63, web 9/9; 173 insertions / 11 deletions

## Phase 2: S2 — Data + Domain (TDD + integration)

Maps to: *debe_cambiar_password Column*, *Change Password Endpoint* domain logic (`password-change`
spec); *Usuario and Sesion Tables* (`auth-sessions` delta). **No route file changes** — `openapi.json`
must stay byte-identical after this phase (verified in 2.9's sibling `contract:check`, not regenerated
here).

- [x] 2.1 GREEN (config, no test) `apps/api/src/db/schema.ts` — modify: `debeCambiarPassword: boolean('debe_cambiar_password').notNull().default(false)` on `usuarios` (D1)
- [x] 2.2 Run `pnpm db:generate`; commit `apps/api/drizzle/0001_*.sql` + meta snapshot (generated,
      exempt from TDD) — `ADD COLUMN ... NOT NULL DEFAULT false`, no table rewrite on PG 11+
- [x] 2.3 RED: extend `apps/api/src/auth/repository.test.ts` — `UsuariosRepo.updatePassword(id, hash)`
      sets the hash **and** clears the flag in one UPDATE (D6); `SesionesRepo.deleteOthers(usuarioId, exceptId)`
      deletes only the other rows for that user, using an in-memory fake pool (interface-shape level,
      same precedent as `auth-sesiones` 1.5)
- [x] 2.4 GREEN `apps/api/src/auth/repository.ts` — implement `UsuariosRepo.updatePassword`,
      `SesionesRepo.deleteOthers`; `Usuario` type gains `debeCambiarPassword` (read from the existing
      `findValid` JOIN, D1 — zero extra queries)
- [x] 2.5 RED: extend `apps/api/src/lib/errors.test.ts` — `passwordChangeRequired()` → 403
      `PASSWORD_CHANGE_REQUIRED` (R1: reconciled from spec's `MUST_CHANGE_PASSWORD`);
      `invalidCurrentPassword()` → 400 `INVALID_CURRENT_PASSWORD` (R2: reconciled from spec's 401
      `INVALID_CREDENTIALS`)
- [x] 2.6 GREEN `apps/api/src/lib/errors.ts` — add the two factories to the shared envelope builder
- [x] 2.7 RED (new file): `apps/api/src/auth/service.test.ts` extend for `changePassword()` — wrong
      current password → `INVALID_CURRENT_PASSWORD` **and no repo writes** (D5); success → `updatePassword`
      then `deleteOthers(usuarioId, sessionId)` called in that exact order (D7); new hash verifies via
      real argon2, old hash does not
- [x] 2.8 GREEN `apps/api/src/auth/service.ts` — `changePassword(repos, { usuario, sessionId, currentPassword, newPassword })`
      per the Data Flow diagram (D5–D7): `verifyPassword` → on failure return `invalidCurrentPassword()`
      with no writes; on success `updatePassword` then `deleteOthers`
- [x] 2.9 Integration RED→GREEN: extend `apps/api/src/auth/repository.integration.test.ts` (real Docker
      Postgres, `test:integration` suite) — migration applies (`debe_cambiar_password` column exists,
      default `false` for pre-existing rows); `deleteOthers` removes only the other sessions and the
      current cookie's session still resolves via `findValid`

## Phase 3: S3 — API Surface + Server Enforcement (TDD + integration)

Maps to: *RBAC Hook Contract* (`auth-sessions` delta); *Change Password Endpoint*,
*Server-Side Forced-Password-Change Allowlist* (`password-change` spec).

**HARD CONSTRAINT (D14): this is the ONLY seam that touches route files. Tasks 3.2/3.4/3.5 MUST land
in the SAME commit — a mid-chain PR that edits routes without regenerating the contract fails
`pnpm contract:check` in CI.**

- [x] 3.1 RED: extend `apps/api/src/plugins/auth.test.ts` — flagged user (`debeCambiarPassword: true`):
      plain protected route → 403 `PASSWORD_CHANGE_REQUIRED`; `allowPasswordChangePending` route → 200;
      `auth: false` route unaffected; unflagged user unaffected; forced-change beats `roles` (403 code
      is `PASSWORD_CHANGE_REQUIRED`, not `FORBIDDEN`) — throwaway routes on `buildApp()` before
      `ready()`, existing precedent
- [x] 3.2 GREEN `apps/api/src/plugins/auth.ts` — `allowPasswordChangePending?: true` config key (D3);
      `request.sessionId` decoration in `onRequest` (D8, feeds `changePassword`'s `sessionId` param
      without re-deriving the cookie); forced-change branch in `preHandler`, placed **after** the
      `auth === false` early return and **before** the `roles` check (D2)
- [x] 3.3 RED: extend `apps/api/src/routes/auth.test.ts` — `POST /auth/password` status/envelope codes
      (200 success; 400 `INVALID_CURRENT_PASSWORD`; 400 `VALIDATION_ERROR` for empty/matching new
      password); `debeCambiarPassword` present in `login`/`me` DTOs; `GET /auth/me` and
      `POST /auth/password` reachable with the flag `true`; an unrelated protected route returns 403
      with the flag `true`
- [x] 3.4 GREEN `apps/api/src/routes/auth.ts` — `POST /auth/password` with `config: { allowPasswordChangePending: true }`,
      body `z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(12) }).refine(v => v.newPassword !== v.currentPassword)`
      (mismatch → 400 `VALIDATION_ERROR`, no new code, per Interfaces section); `usuarioDto` + `toDto`
      gain `debeCambiarPassword`; `GET /auth/me` gains `config: { allowPasswordChangePending: true }`
      (exactly two opted-in routes per R3/D3 — `POST /auth/logout` already declares `auth: false` and
      needs no entry)
- [x] 3.5 Regenerate contract (non-TDD, generated, **same commit as 3.2/3.4**) — `pnpm contract` →
      commit `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts`; verify `pnpm contract:check` passes
- [x] 3.6 Integration RED→GREEN: extend `apps/api/src/routes/auth.integration.test.ts` (real Docker
      Postgres, real argon2, `test:integration` suite) — change-password round trip: login → change
      password → session B (elsewhere) revoked and returns 401 → session A (current) still resolves
      via `/me` with `debeCambiarPassword: false`

## Phase 4: S4 — Visual Foundation (mostly non-TDD; component logic gets tests)

Maps to: *Screens Built From Design Tokens, No Approved Mockup* (`app-shell` spec — background token
scenario). Visual source of truth: `docs/design/Main.dc.html`, `docs/design/LoginError.dc.html`,
`docs/design/CambiarPassword.dc.html`, `docs/design/canvas.json`, `docs/design.md` (sidebar nav labels,
user-card format, the documented modal-shadow deviation for the login card). Pure presentational —
no router, no network.

- [x] 4.1 GREEN (config, non-TDD) `apps/web/package.json` — add `@tanstack/react-router`,
      `react-hook-form`, `@hookform/resolvers`, `zod`, `@fontsource/public-sans`; dev
      `@testing-library/user-event` (not currently installed). **PIN exact versions**: verify
      `@hookform/resolvers` supports zod v4 (`apps/web`'s `zod` is `^4.4.3`, matching `apps/api`) and
      `@tanstack/react-router` supports React 19 (Q3, `open_at_install` — both were unverified
      assumptions at design time)
- [x] 4.2 GREEN `apps/web/src/styles/tokens.css` — custom properties transcribed 1:1 from `docs/design.md`
      (colors, radii, shadows); login card uses the **modal shadow** `0 18px 50px rgba(22,35,60,.4)`,
      not the card shadow (documented deviation — the 7%-opacity card shadow is invisible on the dark
      `#16233c` field), radius stays 14px
- [x] 4.3 GREEN `apps/web/src/styles/global.css` — base resets, self-hosted Public Sans import
      (400–800 weights, `system-ui` fallback), `prefers-reduced-motion` respected
- [x] 4.4 RED→GREEN `apps/web/src/components/ui/Button.{tsx,module.css}` + `Button.test.tsx` — primary
      variant renders label/`onClick`; disabled/pending state disables the button; visible keyboard
      focus ring
- [x] 4.5 RED→GREEN `apps/web/src/components/ui/TextField.{tsx,module.css}` + `TextField.test.tsx` —
      label bound to input via `htmlFor`/`id`; `aria-invalid` + `aria-describedby` wired when an `error`
      prop is present
- [x] 4.6 RED→GREEN `apps/web/src/components/ui/FormError.{tsx,module.css}` + `FormError.test.tsx` —
      renders the message text with `role="alert"`
- [x] 4.7 GREEN `apps/web/src/components/ui/AuthCard.{tsx,module.css}` — centered white card (radius
      14, modal shadow per 4.2), max-width ~380px, **44×44 radius-12** brand mark on
      `linear-gradient(135deg,#3b82f6,#2456c8)` — corrected 2026-08-25: this task originally said 30×30
      radius-8, which is `docs/design.md`'s SIDEBAR logo spec, not the login card. The approved mockups
      (`docs/design/Main.dc.html`) render the login mark at 44×44 radius-12; the mockups win.

## Phase 5A: S5a — Router Skeleton + Session Bootstrap + Guards (TDD)

Maps to: *Route Guard Layout Split*, *Session Bootstrap*, *Logout Action*,
*Client-Side Forced-Password-Change Redirect* (`app-shell` spec).

- [x] 5A.1 GREEN `apps/web/src/api/session.ts` — `sessionQueryOptions` (D12/D13): `queryFn` calls
      `GET /api/auth/me`, catches a 401 `ApiError` and returns `null` (does not rethrow), `retry: false`,
      `staleTime: 30_000`; `Usuario` type imported from `schema.d.ts`
- [x] 5A.2 RED `apps/web/src/api/session.test.ts` — `queryFn` returns `usuario` on 200; returns `null`
      on a 401 `ApiError`; rethrows any other `ApiError`/error
- [x] 5A.3 GREEN `apps/web/src/app/queryClient.tsx` — `QueryClient` instance; `QueryCache`/`MutationCache`
      `onError` invalidates `['session']` and calls `router.invalidate()` on `ApiError` codes
      `UNAUTHORIZED` or `PASSWORD_CHANGE_REQUIRED` (router accessed via a late-bound `setRouter()` to
      avoid a `queryClient`↔`router` construction cycle, per Data Flow)
- [x] 5A.4 GREEN `apps/web/src/app/router.tsx` — `createRouter({ queryClient })` context; **code-based**
      route tree via `createRoute` (D10 — no `@tanstack/router-plugin`, no generated `routeTree.gen.ts`,
      to avoid a second generated-artifact drift gate alongside `contract:check`)
- [x] 5A.5 GREEN `apps/web/src/app/providers.tsx` — `QueryClientProvider` + `RouterProvider` composition
- [x] 5A.6 GREEN `apps/web/src/routes/__root.tsx` — root route, `{ queryClient }` context type
- [x] 5A.7 GREEN `apps/web/src/routes/publicLayout.tsx` — pathless layout route, no guard
- [x] 5A.8 RED `apps/web/src/routes/authLayout.test.ts` — call `beforeLoad` directly with a stub
      `{ queryClient }` context: `ensureQueryData(['session'])` resolving `null` → throws `redirect`
      to `/ingresar`; resolving a `usuario` → passes through
- [x] 5A.9 GREEN `apps/web/src/routes/authLayout.tsx` — session-required pathless layout guard (D11 —
      client mirror of the server allowlist's "session required" half)
- [x] 5A.10 RED `apps/web/src/routes/shellLayout.test.ts` — `beforeLoad`: `usuario.debeCambiarPassword === true`
      → throws `redirect` to `/cambiar-password`; `false` → passes through. Test name/comment MUST
      note this is UX convenience only — the server allowlist (Phase 3) is the enforcement authority
      (D2–D4)
- [x] 5A.11 GREEN `apps/web/src/routes/shellLayout.tsx` — forced-change client guard, nested under
      `authLayout`; `cambiarPassword` (Phase 6) is a child of `authLayout` directly, NOT of
      `shellLayout`, so it stays reachable while the flag is `true`
- [x] 5A.12 GREEN `apps/web/src/routes/index.tsx` — placeholder authenticated shell: sidebar nav labels
      from `docs/design.md` (Panel general, Inventario, Punto de venta, Movimientos, Proveedores,
      Reportes, Usuarios), the documented user-card format, and a logout control
- [x] 5A.13 GREEN `apps/web/src/features/auth/useLogout.ts` — `POST /api/auth/logout`,
      `queryClient.setQueryData(['session'], null)`, `router.invalidate()`, redirect to `/ingresar`
      regardless of response outcome
- [x] 5A.14 GREEN `apps/web/src/test/renderWithProviders.tsx` — fresh `QueryClient` per test, optional
      memory router wiring for later route-level tests
- [x] 5A.15 Integration RED→GREEN `apps/web/src/app/router.test.tsx` (jsdom) — `createMemoryHistory` +
      `RouterProvider` + stubbed `fetch`: `/` with no session lands on `/ingresar`; a session with
      `debeCambiarPassword: true` lands on `/cambiar-password` and `/` stays unreachable (full login
      submission flow is verified in Phase 5B's extension of this same file)
- [x] 5A.16 GREEN `apps/web/src/main.tsx` — modify: wire `providers.tsx` + `RouterProvider`; **delete**
      `apps/web/src/App.tsx` and `apps/web/src/App.test.tsx` (scaffolding health-check screen,
      superseded by `routes/index.tsx`)

## Phase 5B: S5b — Login Screen (TDD)

Maps to: *Login Screen*, *Screens Built From Design Tokens* (`app-shell` spec). Visual source of
truth: `docs/design/Main.dc.html` (normal state), `docs/design/LoginError.dc.html` (invalid
credentials state).

- [ ] 5B.1 GREEN `apps/web/src/features/auth/schemas.ts` — `loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) })`
- [ ] 5B.2 RED `apps/web/src/features/auth/errorMessages.test.ts` — `ACCOUNT_LOCKED` → a message
      derived from `details.retryAfter` (minutes); `INVALID_CREDENTIALS` / `ACCOUNT_INACTIVE` /
      `RATE_LIMITED` / unknown code → distinct messages
- [ ] 5B.3 GREEN `apps/web/src/features/auth/errorMessages.ts` — pure function `(ApiError) => string`
- [ ] 5B.4 RED `apps/web/src/features/auth/LoginForm.test.tsx` — zod validation errors render; a valid
      submit calls `onSubmit` with trimmed `email`/`password`; a server error message renders; submit
      is disabled while pending — `render()` with **no router** (route-module boundary: `features/*`
      takes props/callbacks only) + `@testing-library/user-event`
- [ ] 5B.5 GREEN `apps/web/src/features/auth/LoginForm.tsx` — `react-hook-form` +
      `zodResolver(loginSchema)`; composes `AuthCard`/`TextField`/`Button`/`FormError` per
      `docs/design/Main.dc.html` and `LoginError.dc.html`
- [ ] 5B.6 GREEN `apps/web/src/features/auth/useLogin.ts` — mutation `POST /api/auth/login`; on success
      `queryClient.setQueryData(['session'], usuario)` and navigate away from `/ingresar` (container —
      imports router/react-query, unlike `LoginForm`)
- [ ] 5B.7 GREEN `apps/web/src/routes/ingresar.tsx` — child of `publicLayout`, wires `LoginForm` +
      `useLogin`; already-authenticated visit redirects to the protected shell's default route
- [ ] 5B.8 Integration: extend `apps/web/src/app/router.test.tsx` (same file as 5A.15) — submitting
      valid credentials via stubbed `fetch` populates the session and navigates into the shell; wrong
      credentials keep the user on `/ingresar` with an error; a locked-account response shows the
      `retryAfter`-derived message

## Phase 6: S6 — Change-Password Screen (TDD)

Maps to: *Change Password Endpoint* (client side, `password-change` spec);
*Client-Side Forced-Password-Change Redirect* — "reaches change-password directly" scenario
(`app-shell` spec). Visual source of truth: `docs/design/CambiarPassword.dc.html`.

- [ ] 6.1 GREEN: extend `apps/web/src/features/auth/schemas.ts` — `changePasswordSchema` (`currentPassword`
      min 1, `newPassword` min 12, `.refine(v => v.newPassword !== v.currentPassword)` — client mirror
      of the server's `refine`, same message contract)
- [ ] 6.2 RED `apps/web/src/features/auth/ChangePasswordForm.test.tsx` — zod errors render; a valid
      submit calls `onSubmit`; a server `INVALID_CURRENT_PASSWORD` error renders bound to the
      `currentPassword` field (D5 — the whole point of the distinct 400 code); submit disabled while
      pending
- [ ] 6.3 GREEN `apps/web/src/features/auth/ChangePasswordForm.tsx` — `react-hook-form` +
      `zodResolver(changePasswordSchema)` per `docs/design/CambiarPassword.dc.html`
- [ ] 6.4 GREEN `apps/web/src/features/auth/useChangePassword.ts` — mutation `POST /api/auth/password`;
      on success merge `debeCambiarPassword: false` into the `['session']` cache and call
      `router.invalidate()` (re-runs `shellLayout`'s guard so the redirect clears immediately)
- [ ] 6.5 GREEN `apps/web/src/routes/cambiarPassword.tsx` — child of `authLayout`, **not** of
      `shellLayout` (built in 5A.11, verified here) so the route stays reachable while the flag is
      `true`; wires `ChangePasswordForm` + `useChangePassword`
- [ ] 6.6 RED `apps/web/src/routes/cambiarPassword.test.ts` — the route's own `beforeLoad` (if any)
      applies only `authLayout`'s session guard, with no forced-change redirect on itself
- [ ] 6.7 Integration: extend `apps/web/src/app/router.test.tsx` — a session with
      `debeCambiarPassword: true` lands on `/cambiar-password`; submitting a valid change clears the
      flag and the shell becomes reachable; a wrong current password shows the field error and the
      user stays on `/cambiar-password`

## Phase 7: Manual Steps + Bookkeeping

- [ ] 7.1 MANUAL (user, external/local action — not executable by the agent). Apply migration
      `0001_*.sql` against Neon per ADR-0010 (`pnpm db:migrate` with the Neon connection string) —
      **before** Phase 3 (S3) deploys, since the guard reads the new column live on every request.
      Tooling never reads or writes `.env*` files; this is a manual, user-owned step
- [ ] 7.2 MANUAL (user, local verification — not executable by the agent). Run
      `pnpm --filter @inventienda/api test:integration` locally against Docker Postgres to confirm
      Phase 2 and Phase 3's integration suites pass before requesting review on their respective PRs
- [ ] 7.3 Bookkeeping: mark completed checkboxes in this file as each PR lands; the orchestrator
      advances `openspec/changes/app-shell-login/state.yaml` phase statuses (this agent does not edit
      `state.yaml`)
- [ ] 7.4 Confirm `pnpm contract:check` is green specifically on Phase 3 (S3)'s PR — the only seam
      that can move the contract — and confirm `pnpm -r typecheck` stays green on every later PR
      (5A, 5B, 6) as a regression guard against accidental route/schema drift

## Review Workload Forecast

| Seam | Estimated authored lines | Fits 400-line budget? | Chained PRs recommended | 400-line budget risk | Decision needed before apply |
|------|---------------------------|------------------------|---------------------------|------------------------|-------------------------------|
| S1 (shipped) | 173 insertions / 11 deletions (actual) | Yes | No | Low (actual, already merged) | No |
| S2 — Data + domain | ~300 (schema+repo+service+errors ~110; tests ~190; migration SQL/meta excluded, generated) | Yes | No | Low | No |
| S3 — API surface + enforcement | ~290 (guard+route+DTO ~95; tests ~195; `openapi.json`/`schema.d.ts` regen excluded, generated but reviewer-visible) | Yes | No | Low–Medium (regen makes the diff look large even though it doesn't count against budget — flag for reviewer context) | No |
| S4 — Visual foundation | ~410 (tokens/global CSS ~80; 4 components + 4 CSS modules ~185; 3 component tests ~120; package.json ~15) | Borderline over | Possible | Medium — if it lands over 400, split by dropping `AuthCard` + its consumer wiring into the start of Phase 5A's PR, or split fonts/tokens (4.1–4.3) from the four components (4.4–4.7) into two PRs | Yes — confirm at apply time once actual diff is measured |
| S5a — Router + session + guards | ~430 (router/session/app wiring ~185; route files ~110; `useLogout`+`renderWithProviders` ~55; tests ~180 minus App.tsx deletion ~-40) | Over | Yes | High | Yes |
| S5b — Login screen | ~340 (schemas/errorMessages/LoginForm/useLogin/route ~155; tests ~185) | Yes | No (already split from 5a) | Medium — close enough to budget that a scope increase in `LoginForm` should trigger re-forecasting | No, unless scope grows |
| S6 — Change-password screen | ~265 (schema ext./form/mutation/route ~95; tests ~150) | Yes | No | Low | No |

**S5 is the seam most likely to overrun, exactly as flagged.** Splitting it into S5a (router
skeleton, session bootstrap, both layout guards, logout, placeholder shell — no visible login UI)
and S5b (the login screen itself: form, error-message mapping, login mutation, `/ingresar` route)
brings each half under budget individually (~430 and ~340 respectively) instead of shipping S5 as
one ~770-line PR, which is close to the ~810-line overrun the previous cycle (`auth-sesiones`) hit
on its own P4 when strict-TDD test coverage was underestimated. S5a is still forecast slightly over
400; if the actual diff confirms that, the router-skeleton/session-bootstrap tasks (5A.1–5A.9) and
the guards-integration-test task (5A.15) are the natural second split point, since 5A.10–5A.14 (the
placeholder shell + logout + test harness) can land as its own small follow-on PR ahead of 5B.

S4 is the second-most-likely seam to overrun, purely on CSS Modules volume across four atoms plus
their tests; it is flagged Medium rather than High because the content is entirely presentational
and mechanical, not logic-dense, so an over-budget diff is not a signal of underestimated test
coverage the way S5 is — it is a signal to split by file group as noted above.

Decision needed before apply (chain strategy already fixed as `stacked-to-main` per session
preflight): confirm at apply time, once each seam's actual diff is measured, whether S4 and S5a need
the file-group splits proposed above, per `delivery_strategy: ask-on-risk`.
