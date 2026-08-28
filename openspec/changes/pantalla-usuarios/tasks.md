# Tasks: Pantalla de Usuarios (backlog #3.1)

Ten seams in dependency order, refining `design.md`'s seven-seam split after re-checking each
against the 400-line budget and against the two corrections applied after design was written
(self-action rol-locking, and the `apiFetch` bodyless-POST fix already merged in `c6153c1`).

`design.md` forecasts ~2685 authored lines across S1–S7, with S3, S4 (at the line), S5 and S6 at
or over budget, and flags `Decision needed before apply: Yes`. Re-deriving against the spec:

- **S1** (~385) stays one slice — it is under 400 and D1's own note says ~180 of it is a CSS
  move counted twice by additions+deletions, so a reviewer's real read is closer to ~200. No
  split needed.
- **S2** absorbs the nav-link/🔒 work design tagged "S1b, merges naturally into S2" — this
  tasks list keeps that merge rather than re-splitting it out, because `design.md`'s own File
  Changes table already assigns `NavItem.tsx` and the 🔒 treatment to S1/S2, not to a
  standalone S1b PR.
- **S3 splits** into **S3a** (DataTable + StatusChip, ~290) and **S3b** (Pagination, ~160), per
  `design.md`'s own suggested seam — combined they were ~450, over budget.
- **S4** (list screen) stays one slice at ~400 — exactly at the line. Flagged as a slice to
  watch during apply; if it drifts over during implementation, `errorMessages.ts` (used by every
  later slice too) is the first candidate to peel into its own tiny commit within the same PR.
- **S5 splits** into **S5a** (detail route, read-only render) and **S5b** (edit form, dirty-field
  PATCH, and the **rol** self-lock) — `design.md`'s single S5 was already marginal at ~410, and
  the corrected spec (rol now included in the self-action block, not just deactivate/password-
  reset) adds work D17 did not price, which is exactly the kind of addition that tips a marginal
  slice over. Splitting the read half from the write half keeps both comfortably under budget.
- **S6 splits** into **S6a** (`Modal` primitive alone, ~200) and **S6b** (create screen +
  credential containment, ~260), per `design.md`'s own suggested seam — combined they were
  ~460. The split is also the right review shape: S6a is generic UI, S6b is the highest-risk
  code in the change and deserves a review that is entirely about containment.
- **S7** (deactivate/reactivate/password-reset) stays one slice at ~340 — under budget, and
  splitting three thin mutations three ways would multiply retargets for no review-load benefit.

Chain order: **S1 → S2 → S3a → S3b → S4 → S5a → S5b → S6a → S6b → S7**. See Review Workload
Forecast at the end for the full numbers and the proposed chain shape.

## Two corrections from spec/design carried into every affected task below

1. **Self-action block now locks three controls, not two.** The original design (D17) priced
   only deactivate/reactivate and password-reset as disabled-with-reason on your own row. The
   current, authoritative spec (`Self-Action Block Is A UI Affordance, Not An Authorization
   Control`) adds the **`rol` selector** to that set. S5b's edit form must render `rol` disabled
   with a visible reason on the logged-in user's own account while `nombre`/`email` stay
   editable — this is new work relative to D17 and is priced into S5b's estimate below.
2. **No bodyless-POST hedge.** `apiFetch` (`apps/web/src/api/client.ts:55-64`) already sets
   `Content-Type: application/json` only when `init.body !== undefined` (merged in PR #40,
   `c6153c1`). S7's three hooks (deactivate, reactivate, password-reset) MUST call `apiFetch`
   with **no `body` key at all** — do NOT add `body: JSON.stringify({})}` as a hedge; that was
   `design.md`'s Interfaces section hedging against a bug that is already fixed. The RED test for
   "bodyless POSTs" must assert `init.body === undefined`, the opposite of what `design.md`'s
   Testing Strategy table originally specified.

Threat Matrix: every row is N/A (no doc classification, VCS, shell/subprocess, or PR-automation
boundary is touched anywhere in this change) — no dedicated RED task is required for it.

## Phase 1: S1 — Layout Extraction (behaviour-neutral relocation)

Satisfies spec: **app-layout / Shared Application Layout Component**. Design refs: D1.

- [x] 1.1 RED `apps/web/src/components/ui/AppShell.test.tsx` (new, P4) — against the
      pre-extraction markup (so it fails before `AppShell.tsx` exists): renders the user's
      initials, full name and `ROL_LABEL`; calls `onLogout` on click; renders `children` inside
      `<main>`
- [x] 1.2 GREEN `apps/web/src/components/ui/AppShell.tsx` (new) — presentational
      `{ usuario, onLogout, isLoggingOut, children }`, sidebar + `<main>{children}</main>`
- [x] 1.3 GREEN `apps/web/src/components/ui/AppShell.module.css` (new) — `.shell/.sidebar/
      .brandMark/.nav/.navItem/.userCard/.avatar/.userName/.userRole/.main` relocated verbatim
      from `routes/index.module.css`, plus `.navItemActive`/`.navItemLocked` placeholders for S2
- [x] 1.4 GREEN `apps/web/src/routes/shellLayout.tsx` — `component` becomes a container reading
      `useRouteContext().usuario` and `useLogout()`, rendering `<AppShell>` around `<Outlet/>`;
      `beforeLoad` untouched
- [x] 1.5 GREEN `apps/web/src/routes/index.tsx` — drop the sidebar markup, `NAV_ITEMS`,
      `ROL_LABEL`, the logout button; keep only the "Panel general" `<main>` content
- [x] 1.6 GREEN `apps/web/src/routes/index.module.css` — emptied of shell rules (moved, not
      rewritten)
- [x] 1.7 Confirm `apps/web/src/app/router.test.tsx:126-146` ("populates the session and
      navigates into the shell", asserting `Ana` renders) still passes **unmodified** — this is
      the regression guard for D1 and must not be edited by this slice
- [x] 1.8 Verify: `pnpm --filter @inventienda/web test`, `pnpm typecheck`, `pnpm lint`

## Phase 2: S2 — Routing + RBAC Skeleton + Nav Links

Satisfies spec: **app-layout / Sidebar Items Render As Navigation Links**; **usuarios-ui /
Encargado-Only Route Guard Is UX Convenience, Not Access Control**. Design refs: D2, D3, D4, D5,
D6.

- [x] 2.1 RED `apps/web/src/components/ui/NavItem.test.tsx` (new, P3/P4) — navigate to
      `/usuarios?page=3`; the Usuarios item carries the active class (fails without
      `activeOptions={{ includeSearch: false }}`, D2); an entry with no `to` renders as a
      non-interactive marker through the same component/class, not a bare `<span>`
- [x] 2.2 GREEN `apps/web/src/components/ui/NavItem.tsx` (new) — `Link` when `to` is set,
      non-interactive marker otherwise; `activeProps`/explicit `activeOptions={{ includeSearch:
      false }}` (D2)
- [x] 2.3 RED extend `NavItem.test.tsx` — a `deposito` session renders the Usuarios item with the
      🔒 marker and its reason, and **not** as a `Link` (D3)
- [x] 2.4 GREEN `apps/web/src/routes/index.tsx` (nav array) — `NAV_ITEMS` becomes `{ label, to?,
      backlog }[]`; render through `NavItem`, gating the Usuarios entry's 🔒 state on
      `usuario.rol !== 'encargado'`
- [x] 2.5 RED `apps/web/src/routes/encargadoLayout.test.ts` (new, P1/P2) —
      `beforeLoad({ context: { usuario: { rol: 'deposito' } } })` throws a redirect to `/`; an
      `encargado` context returns `undefined`; `encargadoLayout.options.getParentRoute?.() ===
      shellLayout` (pins D4's ordering)
- [x] 2.6 GREEN `apps/web/src/routes/encargadoLayout.tsx` (new) — pathless route under
      `shellLayout`, `beforeLoad` redirect (D4), docblock stating UX-convenience-only per
      `shellLayout.tsx:4-8`'s precedent wording
- [x] 2.7 RED `apps/web/src/routes/usuarios.test.ts` (new, P2/P3) — `/usuarios/nuevo` resolves to
      the create route, not `/usuarios/$id` with `id === 'nuevo'` (D5); `/usuarios?page=abc` and
      `/usuarios?page=-4` both render page 1 without throwing (D6)
- [x] 2.8 GREEN `apps/web/src/routes/usuarios.tsx` (new) — `usuariosListRoute` with
      `validateSearch` (`z.coerce.number().int().catch(1).transform(n => Math.max(1, n))`, D6);
      stub component (no data fetch yet — S4 wires it)
- [x] 2.9 GREEN `apps/web/src/routes/usuariosNuevo.tsx` (new) — `/usuarios/nuevo` stub route
      (S6b wires it)
- [x] 2.10 GREEN `apps/web/src/routes/usuariosDetalle.tsx` (new) — `/usuarios/$id` stub route
      (S5a wires it)
- [x] 2.11 GREEN `apps/web/src/routes/routeTree.ts` — `encargadoLayout.addChildren([
      usuariosListRoute, usuariosNuevoRoute, usuariosDetalleRoute])` nested under `shellLayout`
- [x] 2.12 Verify: `pnpm --filter @inventienda/web test`, `pnpm typecheck`, `pnpm lint`

## Phase 3: S3a — DataTable + StatusChip Primitives

Satisfies spec: **usuarios-ui / Design-Tokens-Only Build, No Approved Mockup** (table tokens
half). Prerequisite for S4 (List Screen); no feature requirement is independently satisfied by a
primitive alone.

- [x] 3.1 RED `apps/web/src/components/ui/DataTable.test.tsx` (new, P4) — column headers render
      as `<th scope="col">`; rows render from a `columns`/`rows` prop; `aria-busy` prop passes
      through when set
- [x] 3.2 GREEN `apps/web/src/components/ui/DataTable.tsx` + `.module.css` (new) — white card,
      11px uppercase header, `#eef1f5` row dividers, `11px 18px` row padding
      (`docs/design.md:73-74`); code comment noting Usuarios has no approved mockup (Req 12)
- [x] 3.3 RED `apps/web/src/components/ui/StatusChip.test.tsx` (new, P4) — an inactive user's
      row shows the `Inactivo` chip variant; active shows `Activo`; `debeCambiarPassword` shows
      the warning variant
- [x] 3.4 GREEN `apps/web/src/components/ui/StatusChip.tsx` + `.module.css` (new) — 11px/700
      pill (`docs/design.md:76-77`); `Activo` success, `Inactivo` neutral, `Debe cambiar
      contraseña` warning
- [x] 3.5 RED `apps/web/src/components/ui/DataTable.test.tsx` (extend) — table container carries
      the documented white-card/divider/padding token classes (P4/P5 — class presence, not
      computed style, per the jsdom limitation `styles/tokens.test.ts:6-20` already documents)
- [x] 3.6 Verify: `pnpm --filter @inventienda/web test`, `pnpm typecheck`, `pnpm lint`

## Phase 4: S3b — Pagination Primitive

Prerequisite for S4; no feature requirement is independently satisfied by a primitive alone.

- [x] 4.1 RED `apps/web/src/components/ui/Pagination.test.tsx` (new, P4) — `onPageChange` fires
      with the right page on next/prev/direct-page click; controls are `disabled` when `isBusy`;
      current page renders with the active-page treatment
- [x] 4.2 GREEN `apps/web/src/components/ui/Pagination.tsx` + `.module.css` (new) — compact
      footer buttons, blue active page (`docs/design.md:73-74`)
- [x] 4.3 Verify: `pnpm --filter @inventienda/web test`, `pnpm typecheck`, `pnpm lint`

## Phase 5: S4 — List Screen

Satisfies spec: **usuarios-ui / List Screen With Pagination And Visible Deactivated Users**;
**usuarios-ui / Last-Active-Encargado Guard Is Server-Authoritative** (the "no pre-disabled
control" half — the 409-reaction half ships with S7's mutations); establishes
**usuarios-ui / Error Surfacing By Code**'s module. Design refs: D6–D8, D11, D19. Depends on S2,
S3a, S3b.

- [x] 5.1 RED `apps/web/src/features/usuarios/queries.ts` has no test of its own (pure key
      factory) — covered indirectly by 5.3/5.4's spies. Author `usuariosKeys` (D7) and
      `PAGE_SIZE = 20` (D6) as GREEN-only scaffolding with a docblock stating the D9 rule
      ("no mutation in this feature calls `setQueryData`; all invalidate") up front for later
      slices to follow. Extended (still GREEN-only, no test of its own) with
      `usuariosListQueryOptions(page)` so the loader (5.7) and `useUsuarios` (5.5) share one
      query definition and cache entry
- [x] 5.2 RED `apps/web/src/features/usuarios/errorMessages.test.ts` (new) — each of
      `USER_NOT_FOUND`, `EMAIL_ALREADY_IN_USE`, `LAST_ACTIVE_ENCARGADO`, `VALIDATION_ERROR`,
      `FORBIDDEN` maps to a distinct message, switching on `error.code` never `error.status`
      (D15)
- [x] 5.3 GREEN `apps/web/src/features/usuarios/errorMessages.ts` (new) — the five-code switch,
      following `features/auth/errorMessages.ts`'s shape
- [x] 5.4 RED `apps/web/src/features/usuarios/useUsuarios.test.ts` (new, P3) — while a page-2
      request is in flight, page-1 rows are still present, `isPlaceholderData` true (the route
      component maps this to `aria-busy` + disabled pagination controls, asserted in 5.6/5.12)
      (D8, `keepPreviousData`)
- [x] 5.5 GREEN `apps/web/src/features/usuarios/useUsuarios.ts` (new) — list query keyed by
      `usuariosKeys.list({ page })`, `placeholderData: keepPreviousData`
- [x] 5.6 RED `apps/web/src/routes/usuarios.test.ts` (extend) — a settled, non-placeholder
      response with `data.length === 0 && total > 0 && page > 1` navigates to
      `Math.ceil(total / PAGE_SIZE)` with `replace: true` (D11); `total === 0` renders the empty
      state and does **not** navigate. Implemented as a route `loader` (via
      `context.queryClient.ensureQueryData(usuariosListQueryOptions(...))`), not a component
      `useEffect` — this keeps the correction pre-render and testable with `router.load()` (P2/P3)
      like every other route test in this file, with no RTL render needed for the redirect case
- [x] 5.7 GREEN wire the out-of-range recovery into `usuariosListRoute`'s `loader` (D11)
- [x] 5.8 RED `apps/web/src/features/usuarios/format.test.ts` (new, P4) — an ISO string in, a
      stable `es` date out (D19); a malformed string yields a placeholder, not `Invalid Date`
- [x] 5.9 GREEN `apps/web/src/features/usuarios/format.ts` (new) — `formatFecha` on
      `Intl.DateTimeFormat('es')`
- [x] 5.10 RED `apps/web/src/features/usuarios/UsuariosTable.test.tsx` (new, P4) — presentational;
      renders rows via `DataTable`, a `StatusChip` per row, `creadoEn` through `formatFecha`; no
      router or react-query import (asserted by the presentational-component precedent, not a
      literal test — verified by inspection per `LoginForm.tsx:17`'s stated boundary)
- [x] 5.11 GREEN `apps/web/src/features/usuarios/UsuariosTable.tsx` (new). Deviation: no
      `.module.css` — the component composes `DataTable`/`StatusChip` with zero layout of its
      own; an empty stylesheet would be dead weight. Row action styling (S5b/S7) will add one
      when there is real content for it
- [x] 5.12 GREEN wire `usuariosListRoute`'s component: `useUsuarios`, `UsuariosTable`,
      `Pagination`, error rendering via `errorMessages.ts`
- [x] 5.13 Verify: `pnpm --filter @inventienda/web test`, `pnpm typecheck`, `pnpm lint`

## Phase 6: S5a — Detail Screen (read-only)

Satisfies spec: **usuarios-ui / Detail Screen**. Design refs: D7 (detail key). Depends on S2,
S4 (`errorMessages.ts`, `formatFecha`).

- [x] 6.1 RED `apps/web/src/features/usuarios/useUsuario.test.ts` (new, P3) — queries
      `usuariosKeys.detail(id)`; on `USER_NOT_FOUND` surfaces that mapped message
- [x] 6.2 GREEN `apps/web/src/features/usuarios/useUsuario.ts` (new) — detail query
- [x] 6.3 RED `apps/web/src/routes/usuariosDetalle.test.ts` (extend, P3) — navigating to
      `/usuarios/:id` for an existing id renders that user's profile fields with no password or
      hash field present anywhere in the rendered output
- [x] 6.4 GREEN wire `usuariosDetalleRoute`'s component: `useUsuario`, a read-only profile render
      (`nombre`, `email`, `rol`, status chip, `creadoEn` via `formatFecha`)
- [x] 6.5 Verify: `pnpm --filter @inventienda/web test`, `pnpm typecheck`, `pnpm lint`

## Phase 7: S5b — Edit Flow + Rol Self-Lock

Satisfies spec: **usuarios-ui / Edit User Flow**; the **`rol`** third of **usuarios-ui /
Self-Action Block Is A UI Affordance, Not An Authorization Control** (deactivate/reactivate and
password-reset are S7's). Design refs: D9, D10, D18. Depends on S6a (Modal is not used here —
listed for completeness: none). Depends on S5a.

- [x] 7.1 RED `apps/web/src/features/usuarios/schemas.ts` has no test of its own — a client
      mirror of `actualizarUsuarioBody`, verified against `apps/api/src/routes/usuarios.ts:78-87`
      by 7.4's request-body assertion
- [x] 7.2 GREEN `apps/web/src/features/usuarios/schemas.ts` (extend or create) — Zod mirror for
      `{ nombre?, email?, rol? }`
- [x] 7.3 RED `apps/web/src/features/usuarios/useActualizarUsuario.test.ts` (new, P3) — changing
      only `nombre` sends a captured body of exactly `{"nombre":"…"}` (D18, from
      `formState.dirtyFields`); submitting with nothing changed makes no request and the button
      stays disabled; PATCH on the logged-in user's own id also invalidates `['session']`, PATCH
      on another user does not (D10); after any usuarios mutation, `queryClient.setQueryData` was
      never called (D9 spy)
- [x] 7.4 GREEN `apps/web/src/features/usuarios/useActualizarUsuario.ts` (new) — PATCH from
      `dirtyFields`, invalidates `lists()` + `detail(id)` (+ `['session']` conditionally, D10)
- [x] 7.5 RED `apps/web/src/features/usuarios/UsuarioForm.test.tsx` (new, P4) — on the logged-in
      user's own account, `rol` renders `disabled` with an adjacent visible reason while `nombre`
      and `email` stay editable and enabled; on any other user's form `rol` is enabled (D17,
      extended by the corrected spec to cover `rol`)
- [x] 7.6 GREEN `apps/web/src/features/usuarios/UsuarioForm.tsx` + `.module.css` (new) —
      presentational form for `{ nombre, email, rol }`; the self-lock reason text must not claim
      server authority — mirror D17's wording constraint ("the server still permits this; the
      screen declines to offer it")
- [x] 7.7 GREEN wire `usuariosDetalleRoute`'s component: `UsuarioForm` in edit mode,
      `useActualizarUsuario`, "Guardar cambios" disabled while `!formState.isDirty`
- [x] 7.8 Verify: `pnpm --filter @inventienda/web test`, `pnpm typecheck`, `pnpm lint`

## Phase 8: S6a — Modal Primitive

Satisfies spec: **usuarios-ui / Design-Tokens-Only Build, No Approved Mockup** (modal tokens
half); prerequisite for **Temporary Password Handling**'s modal mechanics (wired in S6b/S7).
Design refs: D13, D14.

- [ ] 8.1 RED `apps/web/src/styles/tokens.test.ts` (extend) — two assertions pinning
      `--radius-modal` (18px) and `--overlay-modal` (`rgba(22,35,60,.55)`) — both already exist
      in `tokens.css` (verified), so this pins rather than adds
- [ ] 8.2 RED `apps/web/src/components/ui/Modal.module.css` reference test (P5, same file as
      8.1 or a sibling) — `Modal.module.css` references `var(--radius-modal)`,
      `var(--overlay-modal)`, `var(--shadow-modal)`
- [ ] 8.3 RED `apps/web/src/components/ui/Modal.test.tsx` (new, P4) — with
      `closePolicy="explicit-only"`: `Escape` does not call `onClose`; an overlay click does not
      call `onClose`; the acknowledge button does. With `closePolicy="casual"`: both do. Focus
      lands on the heading (not the acknowledge button) on open. Tab from the last focusable
      wraps to the first; Shift+Tab from the first wraps to the last. On unmount, focus returns
      to the trigger
- [ ] 8.4 GREEN `apps/web/src/components/ui/Modal.tsx` + `.module.css` (new) — `<div role="dialog"
      aria-modal="true" aria-labelledby>` over an overlay div; required, non-defaulted
      `closePolicy: 'explicit-only' | 'casual'` prop (D13); hand-rolled focus trap and restore
- [ ] 8.5 Verify: `pnpm --filter @inventienda/web test`, `pnpm typecheck`, `pnpm lint`

## Phase 9: S6b — Create Flow + Credential Containment

Satisfies spec: **usuarios-ui / Create User Flow**; **usuarios-ui / Temporary Password
Handling** (create half — password-reset's half ships in S7 reusing this same modal). Design
refs: D7, D9, D12. Depends on S3a/S3b (form fields reuse none, but the route needs
`UsuarioForm` from S5b), S6a (Modal), S5b (`UsuarioForm`, `schemas.ts`).

- [ ] 9.1 RED `apps/web/src/features/usuarios/schemas.ts` (extend) — a client mirror of
      `crearUsuarioBody`, covered by 9.3's assertions
- [ ] 9.2 GREEN `apps/web/src/features/usuarios/schemas.ts` (extend) — Zod schema for
      `{ nombre, email, rol }` (create)
- [ ] 9.3 RED `apps/web/src/features/usuarios/useCrearUsuario.test.ts` (new, P3 — **the
      highest-value test in this change**) — after a successful create through a stubbed
      `POST /api/usuarios` returning a known plaintext, assert **all** of:
      `JSON.stringify(queryClient.getQueryCache().getAll())` does not contain it;
      `JSON.stringify(queryClient.getMutationCache().getAll())` does not contain it;
      `router.state.location.href` does not contain it; `localStorage`/`sessionStorage` do not
      contain it; and the returned `credential` state **does** carry it (D12)
- [ ] 9.4 GREEN `apps/web/src/features/usuarios/useCrearUsuario.ts` (new) — `mutationFn` narrows
      inside itself: awaits `apiFetch`, calls `setCredential({ nombre, passwordTemporal })` via
      local `useState`, **returns only `body.usuario`** (typed `UsuarioResumen`, no
      `passwordTemporal` member); `onSuccess` does **not** `await` the `invalidateQueries` call
      and does **not** `navigate()` (D12's data-flow diagram)
- [ ] 9.5 RED `apps/web/src/features/usuarios/CredentialDialog.test.tsx` (new, P4) — password
      renders in a monospace block grouped 4×4 with `user-select: all`; copy states it cannot be
      shown again; no copy-to-clipboard button exists anywhere in the component (D14)
- [ ] 9.6 GREEN `apps/web/src/features/usuarios/CredentialDialog.tsx` + `.module.css` (new) —
      wraps `Modal` with `closePolicy="explicit-only"`, the grouped password display, the
      "Anote esta contraseña…" copy
- [ ] 9.7 RED `apps/web/src/routes/usuariosNuevo.test.ts` (extend, P3) — the create form submits
      valid unique data, `POST /api/usuarios` returns `201`, and the temporary password is handed
      to `CredentialDialog`, never rendered inline in the form
- [ ] 9.8 GREEN wire `usuariosNuevoRoute`'s component: `UsuarioForm` in create mode,
      `useCrearUsuario`, `CredentialDialog` gated on `credential !== null`, `acknowledge()` →
      `navigate({ to: '/usuarios' })`
- [ ] 9.9 Verify: `pnpm --filter @inventienda/web test`, `pnpm typecheck`, `pnpm lint`

## Phase 10: S7 — Deactivate / Reactivate / Password-Reset

Satisfies spec: **usuarios-ui / Deactivate And Reactivate Actions**; the deactivate/reactivate
and password-reset thirds of **usuarios-ui / Self-Action Block**; **usuarios-ui / Admin
Password-Reset Flow**; **usuarios-ui / Last-Active-Encargado Guard Is Server-Authoritative**
(the 409-reaction half); completes **usuarios-ui / Temporary Password Handling** (reset half)
and **Error Surfacing By Code** (the `LAST_ACTIVE_ENCARGADO` case, live end to end). Design
refs: D9, D10, D12, D15. Depends on S4 (list rows), S5a/S5b (detail actions), S6a (Modal), S6b
(`CredentialDialog`, reused for the reset credential per `design.md`'s data flow note).

- [ ] 10.1 RED `apps/web/src/features/usuarios/useEstadoUsuario.test.ts` (new, P3) — deactivate
      and reactivate each send a `POST` with **no `body` key** (`init.body === undefined`,
      reflecting the merged `apiFetch` fix — see "Two corrections" above, NOT
      `JSON.stringify({})}`); each invalidates `lists()` + `detail(id)` on success (D10); a 409
      `LAST_ACTIVE_ENCARGADO` also invalidates `lists()`; `setQueryData` is never called (D9 spy)
- [ ] 10.2 GREEN `apps/web/src/features/usuarios/useEstadoUsuario.ts` (new) — `deactivate`/
      `reactivate` mutations, bodyless `apiFetch` calls, invalidation per 10.1
- [ ] 10.3 RED `apps/web/src/features/usuarios/useRestablecerPassword.test.ts` (new, P3) — sends
      a bodyless `POST /usuarios/:id/password-reset`; narrows the result the same way as
      `useCrearUsuario` (D12) — the containment sweep from 9.3 repeated for this mutation:
      neither cache, the URL, nor storage ever contains the plaintext, and `credential` does;
      invalidates `lists()` + `detail(id)`
- [ ] 10.4 GREEN `apps/web/src/features/usuarios/useRestablecerPassword.ts` (new) — same D12
      narrowing pattern as S6b's `useCrearUsuario`, instantiated once at the list/detail screen
      level (not inside a row component — `design.md`'s data-flow note on why: a row is free to
      unmount under a refetch, and it must not be the only holder of the credential)
- [ ] 10.5 RED `apps/web/src/features/usuarios/UsuariosTable.test.tsx` (extend) — on the
      logged-in user's own row, Desactivar/Reactivar and Restablecer render `disabled` with a
      visible adjacent reason; on any other row both render enabled (D17)
- [ ] 10.6 GREEN wire deactivate/reactivate/password-reset action buttons into
      `UsuariosTable`'s row rendering and into the detail screen's actions, both gated by the
      self-row check from 10.5
- [ ] 10.7 RED `apps/web/src/routes/usuarios.test.ts` / `usuariosDetalle.test.ts` (extend, P3) —
      a deactivate targeting the last active encargado renders the `LAST_ACTIVE_ENCARGADO` copy
      from `errorMessages.ts` beside the action (persistent `FormError`, D16), and the control
      was enabled beforehand — no client-side pre-disable exists anywhere in this slice or any
      prior one
- [ ] 10.8 GREEN wire the password-reset action's `CredentialDialog` reuse into the list and
      detail screens
- [ ] 10.9 Verify: `pnpm --filter @inventienda/web test`, `pnpm typecheck`, `pnpm lint`
- [ ] 10.10 Verify the full chain end to end: `pnpm --filter @inventienda/web build`

## Phase 11: Bookkeeping

- [ ] 11.1 Before merging each PR except the last in a stacked chain, `gh pr edit
      <next-pr-number> --base main` — GitHub does not auto-retarget a stacked PR when its base
      merges (precedent: `gestion-usuarios` #36→#37→#38, and `auditoria-general` before it);
      delete a merged branch only after confirming the retarget landed
- [ ] 11.2 Confirm no `.env*` file is touched and no new environment variable is introduced by
      any slice (this change is frontend-only against already-provisioned inputs) — no manual
      user step is needed before any PR in this change merges
- [ ] 11.3 After the last slice merges, confirm `pnpm contract:check` is still byte-identical —
      this change touches no `apps/api/**` file and regenerates nothing

## Review Workload Forecast

Estimated changed lines (authored additions + deletions, tests included, no generated artifact
produced by this change): **2705**
Chained PRs recommended: **Yes**
400-line budget risk: **High**
Decision needed before apply: **Yes**

| Slice | Source | Tests | Total | Over 400? |
|---|---|---|---|---|
| S1 — layout extraction | ~280 | ~105 | ~385 | No (marginal) |
| S2 — routing + RBAC + nav links | ~110 | ~130 | ~240 | No |
| S3a — DataTable + StatusChip | ~140 | ~150 | ~290 | No |
| S3b — Pagination | ~70 | ~90 | ~160 | No |
| S4 — list screen | ~200 | ~200 | ~400 | At the line |
| S5a — detail screen (read-only) | ~90 | ~110 | ~200 | No |
| S5b — edit flow + rol self-lock | ~110 | ~120 | ~230 | No |
| S6a — Modal primitive | ~90 | ~110 | ~200 | No |
| S6b — create + credential containment | ~120 | ~140 | ~260 | No |
| S7 — deactivate/reactivate/reset | ~150 | ~190 | ~340 | No |
| **Chain total** | **~1360** | **~1345** | **~2705** | **Yes** |

Divergence from `design.md`'s ~2685 estimate is small and deliberate: splitting the original
seven seams into ten moves ~180 lines of S1's inflated CSS-move count nowhere (S1 is unchanged),
holds S2/S3/S6/S7 at their design-time numbers (the design's own suggested sub-splits), and adds
~20 lines to the S5 pair for the rol self-lock work the corrected spec requires and D17 did not
price. Every individual slice lands at or under 400, which is the property the split exists to
guarantee; the chain total crossing 400 by ~6.8× is expected — this is a ten-slice, two-new-
platform-primitive, full-CRUD screen, and `stacked-to-main` (per the archived `gestion-usuarios`
precedent) exists to absorb exactly that.

### Requirement Coverage Map

| Requirement | Slice(s) |
|---|---|
| app-layout / Shared Application Layout Component | S1 |
| app-layout / Sidebar Items Render As Navigation Links | S2 |
| usuarios-ui / Encargado-Only Route Guard | S2 |
| usuarios-ui / List Screen With Pagination And Visible Deactivated Users | S4 (built on S3a/S3b) |
| usuarios-ui / Detail Screen | S5a |
| usuarios-ui / Create User Flow | S6b (built on S6a) |
| usuarios-ui / Edit User Flow | S5b |
| usuarios-ui / Deactivate And Reactivate Actions | S7 |
| usuarios-ui / Self-Action Block (deactivate/reactivate + password-reset) | S7 |
| usuarios-ui / Self-Action Block (rol) | S5b |
| usuarios-ui / Admin Password-Reset Flow | S7 (built on S6a/S6b) |
| usuarios-ui / Last-Active-Encargado Guard Is Server-Authoritative | S4 (no pre-disable) + S7 (409 reaction) |
| usuarios-ui / Temporary Password Handling | S6a (modal mechanics) + S6b (create) + S7 (reset) |
| usuarios-ui / Error Surfacing By Code | S4 (module + 4 codes) + S7 (`LAST_ACTIVE_ENCARGADO` live) |
| usuarios-ui / Design-Tokens-Only Build, No Approved Mockup | S3a (table tokens) + S6a (modal tokens) |

No requirement is left without a covering slice.

### Suggested Work Units / Proposed Chain Shape

Recommendation, not a decision — the orchestrator confirms the chain with the user before
`sdd-apply` starts, per `delivery_strategy: ask-on-risk` cached for this session.

| Unit | Goal | Likely PR | Focused test command | Rollback boundary |
|------|------|-----------|----------------------|-------------------|
| S1 | `AppShell` extraction, zero behaviour change | PR1 | `pnpm --filter @inventienda/web test` | revert `AppShell.tsx`/`.module.css`, `shellLayout.tsx`, `index.tsx`/`.module.css` changes; `/` unaffected beyond the move |
| S2 | `encargadoLayout`, three usuarios routes, `NavItem` links + 🔒 | PR2 | `pnpm --filter @inventienda/web test` | revert `encargadoLayout.tsx`, the three route files, `routeTree.ts`'s new children, `NavItem.tsx`; S1 unaffected |
| S3a | `DataTable` + `StatusChip` | PR3 | `pnpm --filter @inventienda/web test` | revert both components; nothing else references them yet |
| S3b | `Pagination` | PR3 (same PR as S3a — both are primitives with no independent user-facing behaviour) or PR4 if S3a alone exceeds review comfort | `pnpm --filter @inventienda/web test` | revert `Pagination.tsx`; S3a unaffected |
| S4 | List screen live at `/usuarios` | PR4 (or PR5) | `pnpm --filter @inventienda/web test` | revert `queries.ts`, `useUsuarios.ts`, `errorMessages.ts`, `format.ts`, `UsuariosTable.tsx`, the list route's component wiring; S1–S3b unaffected |
| S5a | Detail screen live at `/usuarios/:id` (read-only) | PR5 | `pnpm --filter @inventienda/web test` | revert `useUsuario.ts` and the detail route's read-only render |
| S5b | Edit flow + rol self-lock | PR6 | `pnpm --filter @inventienda/web test` | revert `useActualizarUsuario.ts`, `UsuarioForm.tsx`, `schemas.ts`'s update schema, the detail route's edit wiring; S5a's read view stays usable |
| S6a | `Modal` primitive | PR7 | `pnpm --filter @inventienda/web test` | revert `Modal.tsx`/`.module.css`; no consumer yet |
| S6b | Create screen + credential containment | PR8 | `pnpm --filter @inventienda/web test` | revert `useCrearUsuario.ts`, `CredentialDialog.tsx`, `schemas.ts`'s create schema, `/usuarios/nuevo`'s wiring; S6a unaffected |
| S7 | Deactivate/reactivate/password-reset, feature complete | PR9 | `pnpm --filter @inventienda/web test` | revert `useEstadoUsuario.ts`, `useRestablecerPassword.ts`, and the row/detail action wiring; the read+edit screens stay usable without mutations |

Nine or ten PRs (S3a/S3b may combine, per the note in that row) is a real jump from the archived
`gestion-usuarios` cycle's three merged PRs — but that cycle's owner explicitly accepted
`size:exception` for two oversized PRs after being shown an eight-slice forecast, cutting by
where concurrency risk sat rather than by line count. This change has no equivalent concurrency
risk to cut around (the last-encargado race proof is server-side and already shipped); its risk
is spread evenly across ten independently-useful, independently-revertable slices, which is the
shape `stacked-to-main` was designed for. If the user prefers fewer, larger checkpoints instead
(mirroring `gestion-usuarios`' three-PR precedent), the natural three-way cut is:
**PR-A = S1+S2** (~625, platform skeleton, `size:exception`), **PR-B = S3a+S3b+S4+S5a+S5b**
(~1280, the whole read+edit surface, `size:exception`), **PR-C = S6a+S6b+S7** (~800, all
mutations including the credential flow, `size:exception`) — three PRs, three `size:exception`
grants, and each one still ends at a state where the app builds, typechecks, and has no dangling
route. The orchestrator should present both shapes (ten-slice `ask-on-risk`-compliant chain vs.
three-PR `exception-ok` chain) and let the user pick, exactly as `gestion-usuarios` did.

### Decision status

```
Decision needed before apply: Yes — orchestrator must confirm chain shape and delivery_strategy
  resolution with the user before sdd-apply starts.
Two shapes proposed: (a) ten PRs, no exceptions, ask-on-risk-compliant; (b) three PRs
  (S1+S2 / S3a+S3b+S4+S5a+S5b / S6a+S6b+S7), each requiring size:exception.
```

---

## Accepted Delivery Decision (2026-08-28)

The backlog owner reviewed the forecast above and **chose the three-PR shape**, mirroring the
archived `gestion-usuarios` cycle. The ten-slice, zero-exception chain and a seven-PR middle
option were both presented with their line counts; the owner selected three after being told
explicitly that PR-B at ~1280 lines exceeds what a single review sitting can genuinely cover.

- `delivery_strategy`: **`exception-ok`** — `size:exception` granted for all three PRs.
- `chain_strategy`: **`stacked-to-main`**, as in the #3 cycle. Each PR targets the previous
  branch and is retargeted to `main` as its base merges. Note: this repository has
  `deleteBranchOnMerge: false` and GitHub does **not** auto-retarget a stacked PR when its base
  merges — `gh pr edit <n> --base main`, a rebase, and a full re-verification are required at
  each step.

| PR | Slices | Est. lines | Ends at |
|---|---|---|---|
| PR-A | S1 + S2 | ~625 | Platform skeleton: `AppShell` extracted, `encargadoLayout` guarding three empty usuarios routes, nav items linked with 🔒 for `deposito` |
| PR-B | S3a + S3b + S4 + S5a + S5b | ~1280 | The whole read + edit surface: table, pagination, list screen, detail screen, edit flow with the rol self-lock |
| PR-C | S6a + S6b + S7 | ~800 | Feature complete: modal primitive, create with credential containment, deactivate/reactivate/password-reset |

Every PR still ends at a state where the app builds, typechecks, has no dangling route, and has
a green test suite.

**Commit granularity — revised after PR-A was implemented.** The original intent was one commit
per slice, keeping the ten work units individually revertable. That does not survive contact with
S1/S2: S2 rewrites the very nav rendering S1 had just extracted, so `AppShell.tsx` and
`AppShell.test.tsx` each carry both slices. Splitting them would mean reconstructing an
intermediate state that never existed as tested code — a commit that documents a fiction. PR-A
therefore ships as one implementation commit covering S1 and S2 together, plus a separate commit
for the SDD planning artifacts. Later PRs split by slice wherever the slices genuinely touch
disjoint files; where they do not, one honest commit beats two invented ones.

**Verification gate for every PR, without exception**: `pnpm -r test`, `pnpm typecheck`,
`pnpm lint`, `pnpm contract:check`, and `pnpm test:integration`.
