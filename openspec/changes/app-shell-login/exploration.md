# Exploration: app-shell-login

## Current State

### Frontend (`apps/web`) — bare scaffold, confirmed

- `package.json` deps: only `react` ^19.2.8, `react-dom` ^19.2.8, `@tanstack/react-query` ^5.101.4. **No router** (`react-router`/`@tanstack/react-router` absent). **No forms library**. **No `zod` in this workspace** (zod ^4.4.3 exists only in `apps/api`).
- `src/App.tsx` — single component, renders a `useQuery` health check via `apiFetch`. No routing, no auth state, no protected/public route concept anywhere.
- `src/main.tsx` — mounts `<App/>` under `QueryClientProvider` only. No router provider, no auth provider.
- `src/api/client.ts` — raw `fetch` wrapper: `credentials: 'include'`, JSON headers, and on `!response.ok` throws a **generic `Error('API request failed with status ${response.status}')`**. It never reads the body, so the `{ error: { code, message, details? } }` envelope is completely discarded today. This is a hard blocker for distinguishing 401 vs 403 vs 423 vs 429 in the UI and must be fixed as part of this change.
- `src/api/schema.d.ts` (generated via `openapi-typescript`) already has typed paths for `/api/auth/login` (200/401/423/429), `/api/auth/logout` (200 only), `/api/auth/me` (200/401). All error response bodies are typed as the generic envelope shape (`code: string`, not a literal union) — narrowing to a specific `code` string is a client-side concern, not something the generated types give for free.
- `vite.config.ts` — dev proxy `'/api' -> 'http://localhost:3000'`; production is same-origin (Vercel SPA proxied to Render API), so `credentials: 'include'` + relative `/api/...` works unchanged in both environments.
- `vitest.config.ts` — `environment: 'jsdom'`, `setupFiles: ['./src/test/setup.ts']`, includes `src/**/*.test.{ts,tsx}`. `src/test/setup.ts` only imports `@testing-library/jest-dom/vitest`.
- `@testing-library/react` ^16.3.2 and `@testing-library/jest-dom` ^7.0.1 are already devDependencies. Two existing test files (`App.test.tsx`, `api/client.test.ts`) establish the pattern: `vi.stubGlobal('fetch', vi.fn()...)` + `render()` + `screen.getByText`. `client.test.ts`'s second test (`throws on a non-ok response`, asserts `.rejects.toThrow('503')`) will need updating once `client.ts` is changed to parse the error envelope and throw a structured error — this is an existing test whose contract this change will change.

### API surface this UI consumes (`apps/api`) — production-live, unchanged by this exploration

- `POST /api/auth/login` — body `{ email, password }` (Zod: email format, password min 1). `config: { auth: false, rateLimit: { max, timeWindow: '1 minute' } }`. Responses: `200 { usuario: { id, nombre, email, rol } }` + sets signed httpOnly session cookie; `401` (`INVALID_CREDENTIALS` or `ACCOUNT_INACTIVE`); `423` (`ACCOUNT_LOCKED`, `details: { retryAfter }` seconds); `429` (`RATE_LIMITED`).
- `POST /api/auth/logout` — `config: { auth: false }`, always `200 { ok: true }` regardless of prior session validity; clears cookie.
- `GET /api/auth/me` — protected by default (no `auth: false`); `200 { usuario }` or `401 { error: { code: 'UNAUTHORIZED' } }`.
- `apps/api/src/plugins/auth.ts` — default-deny `onRequest` hook: missing/invalid/expired cookie → `unauthorized()` (401 `UNAUTHORIZED`). `preHandler` checks `config.roles` allowlist → `forbidden()` (403 `FORBIDDEN`) on mismatch. Both hooks skip when a route declares `config: { auth: false }` or when `request.routeOptions.url === undefined` (unmatched route, preserves 404 instead of a false 401).
- `apps/api/src/lib/errors.ts` — full code inventory the UI may receive today: `UNAUTHORIZED` (401), `FORBIDDEN` (403), `ACCOUNT_LOCKED` (423, `details.retryAfter`), `INVALID_CREDENTIALS` (401), `ACCOUNT_INACTIVE` (401), `VALIDATION_ERROR` (400), `RATE_LIMITED` (429), `NOT_FOUND` (404), `INTERNAL_ERROR` (500). Envelope shape is fixed via `errorEnvelopeSchema`. No `ACCOUNT_MUST_CHANGE_PASSWORD`-style code exists yet — net-new for this change if the forced-change flow needs one.
- `apps/api/src/auth/service.ts` — `login()` order: rate-limit (route config) → lookup → lockout check → argon2 verify (dummy hash on unknown email, D11 anti-enumeration) → `activo` check (after verify, D10) → reset attempts + purge expired sessions → create session + cookie. `logout()` deletes the session row. `resolveSession()` exists but is currently unused by routes (the `onRequest` hook does its own `findValid` call directly).
- `apps/api/src/auth/repository.ts` — `UsuariosRepo` today: `findByEmail`, `registerFailedAttempt` (atomic single-UPDATE), `resetAttempts`. **No `updatePassword`/`setDebeCambiarPassword`-style method exists** — net-new. `SesionesRepo`: `create`, `findValid` (JOINs `usuarios`, requires `activo = true` and unexpired), `delete`, `purgeExpired`. `findValid` re-evaluates `usuarios` live on every request — no field is cached in the `sesiones` row, which is favorable for propagating a forced-password-change flag instantly.
- `apps/api/src/auth/password.ts` — `hashPassword`/`verifyPassword` (argon2id, OWASP baseline params) + `DUMMY_HASH` fixture. Directly reusable for a change-password endpoint; no changes needed to this module itself.
- `apps/api/src/db/schema.ts` — `usuarios` table: `id uuid pk`, `nombre`, `email unique`, `hash_contrasena`, `rol` (pgEnum `encargado|deposito`), `activo boolean default true`, `intentos_fallidos`, `bloqueado_hasta`, `creado_en`. **No `debe_cambiar_password` column exists.** Adding it requires a schema change + a new Drizzle migration — additive-only, same low-risk shape as the original `0000` migration.

### Prior exploration cross-reference (do not re-decide)

`openspec/changes/gestion-usuarios/exploration.md` (backlog #3, explored, not yet proposed) independently reached the same conclusion the user acted on: recommend backend-only CRUD for `gestion-usuarios` itself, paired with a **separately tracked "minimal app shell + login screen" change** — because the login screen is a cross-cutting prerequisite for every future UI-bearing backlog item. `app-shell-login` is exactly that change. That prior exploration also flagged: no login screen exists, `client.ts` doesn't parse the error envelope, no router is installed, `Wireframes.dc.html` is missing, and password handling on user-create is undocumented while ADR-0007 defers email-based reset out of v1 — consistent with the decision to use temporary-password-with-mandatory-change.

### Design constraints (`docs/design.md`)

- Sidebar background `#16233c` is explicitly named as also being the **login screen's background**. This is the only login-specific visual guidance in the file.
- Sidebar user card: circular 30px avatar with initials, colored by role (blue = encargado, green = deposito), on `rgba(255,255,255,.06)` at the bottom of the 210px sidebar — relevant to the post-login shell, not the login screen.
- Color tokens, typography (Public Sans 400–800, `system-ui` fallback), radii (cards 14px, buttons/inputs 10px), button/input styles, and component conventions (tables, chips, KPI cards, empty states) are documented and reusable, but none are login/change-password-form-specific beyond the background color and general input styling.
- **`Wireframes.dc.html`, `UI Dashboard.dc.html`, and `UI Vistas.dc.html` — all three files referenced in `docs/design.md`'s "Archivos" section are absent from the repository** (confirmed via glob, zero matches for `*.dc.html`). There is no approved mockup for the login screen, the forced-password-change screen, or any other screen. Screens in this change must be built from token/typography conventions alone, and should be flagged as "implemented from design tokens, not an approved wireframe" so a later correction pass is not a surprise.

### Testing precedent

- Component tests are simple: `render()` under `QueryClientProvider`, `vi.stubGlobal('fetch', ...)`, `screen.getByText`/`getByRole`. Nothing yet exercises form submission, user typing (`@testing-library/user-event` is NOT a dependency), or router navigation/redirects.
- No MSW or similar network-mocking library is installed; the precedent mocks `global.fetch` directly.
- `apps/api` precedent stubs `UsuariosRepo`/`SesionesRepo` and uses `buildApp({ repos: stubRepos }) + app.inject()` — the pattern a new change-password endpoint's tests should follow.

## Affected Areas

- `apps/web/src/api/client.ts` — must parse the error envelope on non-2xx and throw a structured error (e.g. an `ApiError` class carrying `code`/`status`/`details`). Breaking change to the existing `client.test.ts` test.
- `apps/web/src/main.tsx`, `apps/web/src/App.tsx` — router provider wiring, root layout split into public (login) vs protected (shell) route trees.
- `apps/web/package.json` — new deps: a router package, optionally a forms library + resolver, optionally `zod`.
- `apps/web/src/` — new modules for: session/auth context (bootstrap via `GET /api/auth/me` on load), login screen + form, change-password screen + form, protected-route guard, logout action.
- `apps/api/src/db/schema.ts` — new `debe_cambiar_password` boolean column on `usuarios`. Its default is a product decision with a live-production consequence (see Risks).
- `apps/api/drizzle/000X_*.sql` + snapshot — new additive migration.
- `apps/api/src/auth/repository.ts` — new method(s) to read/write the flag and update `hash_contrasena`.
- `apps/api/src/auth/service.ts` — new `changePassword(...)` verifying the current password before allowing a change, and deciding the "revoke other sessions on change" behavior.
- `apps/api/src/routes/auth.ts` (or a new `routes/password.ts`) — new authenticated `POST /api/auth/password` endpoint; must NOT be `config: { auth: false }` since it needs `request.user`.
- `apps/api/src/lib/errors.ts` — likely a new factory if "current password incorrect" needs its own code distinct from `INVALID_CREDENTIALS`, and possibly `ACCOUNT_MUST_CHANGE_PASSWORD`.
- `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts` — regenerated via `pnpm contract` once the endpoint and the `usuario` DTO's new flag field are added.

## Approaches

### A. Client-side router: React Router v7 vs TanStack Router

1. **React Router v7 (library/SPA mode)** — the more conventional choice.
   - Pros: largest ecosystem and community precedent; least migration friction; ~12kb gzipped in library mode; typed routes exist but are strongest in framework mode, which this Vite SPA setup does not use.
   - Cons: in plain SPA mode, route param and search-param typing falls back to manual casting — weaker type safety for a ~8–12 screen app that will want typed protected-route params (e.g. `/usuarios/:id`).
   - Effort: Low.
2. **TanStack Router** — pairs naturally with the already-installed `@tanstack/react-query`.
   - Pros: end-to-end type safety (paths, params, search params) without a separate codegen step; same vendor conventions as the existing query dependency; makes "protected vs public route" a first-class typed concept (a `beforeLoad` guard on a layout route) rather than a wrapper-component convention.
   - Cons: ~14kb gzipped (marginal); smaller ecosystem; steeper initial learning curve without prior exposure; testing router-aware components requires a `RouterProvider`/memory-history wrapper, a pattern not yet established here (net-new either way).
   - Effort: Low–Medium.

Both support redirect-based protected routes and are equally testable under vitest+jsdom. This decision does not block any other investigation area.

### B. Forms: react-hook-form + zod resolver vs plain controlled state

1. **react-hook-form + zod resolver.**
   - Pros: `zod` is already the validation library across the stack; keeps client validation close to the server's shape; scales cleanly as `gestion-usuarios` adds create/edit-user forms next.
   - Cons: new dependencies (`react-hook-form`, `@hookform/resolvers`, `zod` in `apps/web`); small boilerplate cost for two simple forms; testing submission needs `@testing-library/user-event` (not installed).
   - Effort: Low.
2. **Plain controlled `useState` + manual validation.**
   - Pros: zero new dependencies; simplest code for exactly two small forms.
   - Cons: validation logic hand-rolled and duplicated between forms; likely revisited within 1–2 more changes once more forms arrive.
   - Effort: Low.

At this size either is viable; the tradeoff is whether to pay the dependency cost now, knowing `gestion-usuarios` adds more forms next.

### C. Password-change backend shape and session revocation

1. **API-level guard (recommended, effectively required)** — the forced-change state blocks routes server-side; every protected route checks the flag and refuses unless the request targets the change-password endpoint itself, plus a UI redirect for UX.
   - Pros: closes the real gap. A UI-only guard is trivially bypassable by calling the API directly while `debe_cambiar_password` is still true. Consistent with the default-deny philosophy in `plugins/auth.ts` (D7).
   - Cons: touches the shared hook, which is higher blast radius; needs a carefully scoped allowlist (change-password + logout + me must stay reachable while the flag is true).
   - Effort: Medium.
2. **UI-only guard** — router-level redirect whenever `me`'s flag is true, with no server enforcement beyond the endpoint that clears it.
   - Pros: smallest, most isolated change.
   - Cons: bypassable. A user with a temporary password could call any other endpoint directly and act on the system while supposedly forced through a change. Contradicts the existing philosophy where the server is the authority and the UI a convenience.
   - Effort: Low.

**Recommendation: API-level enforcement is required, with the UI guard added on top for UX**, not as a substitute — mirroring how `roles` allowlists already work.

**Session revocation on password change** — open question, no precedent. Revoking all OTHER sessions for that `usuario_id` on a successful change is standard practice for the compromised-password scenario and is cheap given `SesionesRepo` already has `delete`/`purgeExpired`. No spec requires or forbids it; a net-new product/security decision for the proposal phase.

## Recommendation

Proceed with `app-shell-login` scoped as confirmed (router + protected/public routes, login screen, structured `client.ts` error handling, session bootstrap via `/me` + logout, forced-password-change screen + endpoint + migration). Two decisions remain genuinely open and low-stakes enough to resolve at proposal time: (1) router choice — TanStack Router is the closer fit given the existing `@tanstack/react-query` dependency, but React Router v7 is the lower-friction default without prior TanStack Router familiarity; (2) forms library — optional at this size, worth adding now only if `gestion-usuarios`'s upcoming forms are considered in the same tooling decision. The one point that is NOT optional: the forced-password-change flag must be enforced server-side, not only in the SPA router.

## Risks

- All three `.dc.html` design files referenced by `docs/design.md` are absent from the repository — no approved mockup exists for the login or change-password screens; both will be built from design tokens only.
- A UI-only guard for the forced-password-change state is a real, not theoretical, security gap. Must be resolved server-side.
- `apps/web/src/api/client.ts`'s error-handling change is a breaking change to its own existing test — the test needs rewriting alongside the fix, not just new tests added around it.
- The default value chosen for the new `debe_cambiar_password` column affects existing users. Defaulting to `true` would force the already-operating production `encargado` (created via `seed-encargado.ts`) through a password change on next login; defaulting to `false` means only future backlog-#3-created users get the forced flow. This is a product decision with a live-production consequence and must be made explicitly in the proposal.
- No `@testing-library/user-event` is installed; realistic form-interaction tests will either need it added or rely on lower-fidelity `fireEvent` calls.
- `apps/web` has no `zod` dependency today; choosing react-hook-form + zod resolver requires adding it to this workspace.

## Ready for Proposal

Yes. Scope is user-confirmed and cross-validated against the independent `gestion-usuarios` exploration. The two open technical choices (router, forms library) can be decided in the proposal phase; the one non-negotiable constraint (server-side enforcement of the forced-password-change state) should be written into the proposal as a requirement, not left implicit.
