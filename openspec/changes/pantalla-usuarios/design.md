# Design: Pantalla de Usuarios (backlog #3.1)

## Technical Approach

Frontend only. **No file under `apps/api/` changes, and `openapi.json` / `schema.d.ts` are not
regenerated.** That is a conclusion, not an assumption: every field the seven screens render
(`id, nombre, email, rol, activo, debeCambiarPassword, creadoEn`) is already in
`usuarioResumenDto`; the settled "no search, no filtering" decision means `pageQuerySchema`'s
`page`/`pageSize` is the whole query surface the UI needs; and the logged-in user's `id` — required
by the self-action affordance blocks — is already in `/auth/me`'s `usuarioDto`
(`apps/api/src/routes/auth.ts:26`). The one thing the contract does not expose,
`intentosFallidos`/`bloqueadoHasta`, is not named by any requirement of this change and stays an
inherited open question from the #3 cycle.

Decision ids are cited as `pantalla-usuarios D1..D19`. The archived `gestion-usuarios/design.md`
owns `D1..D17` and is cited by name where it binds (notably **its** D8, the disjoint-DTO
containment of the plaintext, which this design mirrors on the client).

Seven natural seams, in dependency order. `sdd-tasks` owns the chain shape; these are the joints,
not the plan.

1. **S1 — Layout extraction.** `ShellPlaceholder`'s inline sidebar becomes
   `components/ui/AppShell.tsx`; `shellLayout` renders it around an `<Outlet/>`. Zero visual
   change, zero new behaviour.
2. **S2 — Routing + RBAC skeleton.** `encargadoLayout`, the three usuarios routes, `validateSearch`
   for `?page`, the 🔒 nav treatment. No data yet.
3. **S3 — Primitives.** `DataTable`, `Pagination`, `StatusChip` and their tokens. No feature code.
4. **S4 — List screen.** Query-key factory, `useUsuarios`, the table, out-of-range recovery.
5. **S5 — Detail + edit.** `/usuarios/$id`, `useUsuario`, `useActualizarUsuario`.
6. **S6 — Modal + create.** The `Modal` primitive and the temporary-password containment.
7. **S7 — Deactivate / reactivate / password-reset.** Reuses S6's modal for the reset credential.

Naming rule, inherited: route paths and user-facing copy are Spanish (`/usuarios/nuevo`,
"Restablecer contraseña"); TypeScript identifiers, filenames and comments are English, with domain
nouns kept Spanish (`useUsuarios`, `usuariosKeys`) — the `features/auth/` precedent exactly.

## Architecture Decisions

| # | Decision | Alternatives rejected | Rationale |
|---|---|---|---|
| D1 | `AppShell` is a **presentational** component in `apps/web/src/components/ui/AppShell.tsx`, rendered as `shellLayout`'s `component` around an `<Outlet/>`. A thin container in `shellLayout.tsx` reads `context.usuario` and `useLogout()` and passes them down. `index.tsx` shrinks to the `<main>` content only | (a) Each route wraps itself in `<AppShell>`; (b) a new `components/layout/` folder; (c) `AppShell` reads router context and `useLogout` itself | (a) makes the chrome a convention every future screen must remember, and — decisive — remounts the sidebar on every navigation, so nav focus and scroll are lost on each click. Mounting it on the layout route makes React reconcile one persistent instance, which is literally what `app-layout`'s "same shared layout instance, not a duplicate" scenario asks for. (b) invents a second components folder when `AuthCard` already proves screen-level shells live in `components/ui/`. (c) breaks the container/presentational split the codebase states explicitly in `LoginForm.tsx:17` ("imports neither the router nor react-query"). `shellLayout` is the right host and not `authLayout`: `/cambiar-password` hangs off `authLayout` directly and must stay chrome-free, and it already does, so **no route moves** |
| D2 | `NAV_ITEMS` becomes `{ label, to?, backlog }[]`. One `NavItem` component renders a TanStack `Link` when `to` is set and a non-interactive marker otherwise — same component, same class, one branch. The Usuarios link passes `activeProps={{ className: styles.navItemActive }}` and **explicit** `activeOptions={{ includeSearch: false }}` | (a) Render `<Link>` for every item; (b) keep inert items as bare `<span>`s outside the component; (c) rely on `activeOptions` defaults | (a) is not expressible: with a registered router, `Link to="/inventario"` is a **type error** until that route exists — the type system refuses to fake a destination, and that is the framework working. (b) is what exists today and is what the spec asks to remove. (c) is the trap: the list route carries `?page`, and an active-state that depends on search-param matching breaks on page 2 and nowhere else — the worst possible failure shape. Declaring `includeSearch: false` makes it a decision instead of a default, and the RED test navigates to `/usuarios?page=3` and asserts the item is still active. Forward note for whoever ships Panel general: `/` is a prefix of every path, so that item will need `activeOptions={{ exact: true }}` |
| D3 | For a `deposito` session the Usuarios nav item renders **with the 🔒 marker and a short reason**, not hidden | Hide the item entirely | `docs/design.md:8` is explicit and this is the first screen that tests it: *«Permisos visibles: lo que el rol no puede hacer se marca con 🔒, no se oculta sin explicación»*, with a whole component section at `docs/design.md:88`. Hiding is the reflexive answer and it contradicts a documented project principle. It is also worse UX: a depósito user who was told "ask the encargado" learns nothing from an absence. The guard (D4) still exists for a typed URL — the marker is the explanation, not the control |
| D4 | `encargadoLayout` is a pathless route **under `shellLayout`**, `beforeLoad` redirects to `/` when `context.usuario.rol !== 'encargado'`. It is **UX convenience, not access control** — stated in its docblock, in its test's `describe`, and in the PR description | (a) Sibling of `shellLayout` under `authLayout`; (b) render a 403 screen instead of redirecting; (c) no guard at all, rely on the server | Position is the whole point: nesting under `shellLayout` makes the client evaluate **session → forced-change → role**, which is exactly the server's order — all seven routes carry `roles: ['encargado']` and none opts into `allowPasswordChangePending` (`apps/api/src/routes/usuarios.ts:121,143,166,…`), so a flagged encargado must land on `/cambiar-password`, not on a role refusal. (a) inverts that and would show a flagged encargado the wrong outcome. (b) adds a screen no requirement names and no token set describes; `/` is always reachable for an authenticated non-flagged user and a depósito user on the panel is a coherent place to be. (c) leaves a nav item that bounces off a 403. The disclaimer is not boilerplate: `shellLayout.tsx:4-8` and `shellLayout.test.ts:15-20` already carry the identical wording for the forced-change guard, and this repeats it because a hidden route is not authorization — the server's 403 is |
| D5 | Three routes: `/usuarios` (list), `/usuarios/nuevo` (create), `/usuarios/$id` (detail **and** edit — the detail screen's fields are the edit form). No `/usuarios/$id/editar` | (a) A fourth edit route; (b) create/edit as modals over the list | (a) splits one record's read and write across two URLs for a form with three fields. (b) is rejected on two grounds: the owner already settled that detail is a route, so a sibling operation in a modal is two paradigms for one job; and a create form is precisely where a reflexive Escape destroys typed input, which is the behaviour a modal invites and D13 deliberately suppresses for the one modal that needs it. Route-ranking note: TanStack ranks the static `/usuarios/nuevo` above the dynamic `/usuarios/$id`, so declaration order does not matter — but this codebase has never exercised that guarantee, so a RED test asserts `/usuarios/nuevo` resolves to the create route |
| D6 | The current page lives in the **URL** (`/usuarios?page=2`) behind `validateSearch` with a Zod schema that **clamps** (`z.coerce.number().int().catch(1)`, then `Math.max(1, …)`). `pageSize` is a module constant `20`, matching the server default, and is **not** in the URL | (a) `useState` in the list component; (b) both `page` and `pageSize` in the URL | (a) has a concrete bug on this exact screen: open a user, press Back, and you are on page 1 again — on a screen whose entire job is find-then-act. The page is addressable state; the URL is where addressable state goes. (b) doubles the validation surface and the out-of-range arithmetic for a page-size picker no requirement asks for. Clamping rather than throwing matters because `?page=abc` is one hand-edit away and a route that throws on it is a blank screen. **To be unambiguous: only `page` goes in the URL. The temporary password never does (D12)** |
| D7 | A key factory in `features/usuarios/queries.ts` with an explicit list/detail discriminator: `all: ['usuarios']`, `lists: () => [...all,'list']`, `list: (p) => [...lists(), p]`, `details: () => [...all,'detail']`, `detail: (id) => [...details(), id]` | (a) `['usuarios', { page, pageSize }]` and `['usuarios', id]` as siblings (the exploration's sketch); (b) string literals at each call site, matching the app's existing `['session']` | (a) makes `['usuarios', id]` a prefix-sibling of the list keys, so `invalidateQueries({ queryKey: ['usuarios'] })` can only ever hit both — "refetch every page but only this one detail" becomes inexpressible, and that is exactly what PATCH needs (D10). One extra segment buys both granularities. (b) is fine for `['session']`, a zero-argument key written three times; it is not fine for a parameterised key read by two queries and written by five mutations, which is where invalidation bugs live. The factory is scoped to this feature and does **not** retroactively change `['session']` |
| D8 | The list query uses `placeholderData: keepPreviousData` (the v5 import, not v4's boolean). While `isPlaceholderData` is true the table keeps rendering the old rows with `aria-busy="true"` and the **pagination controls are disabled** | (a) No placeholder — spinner between pages; (b) placeholder without disabling the controls | (a) collapses the table height on every page change, which moves the row the user was aiming at. (b) is the subtle one: with the controls live, a fast double-click queues a second page change against data that has not arrived, and the user lands two pages away from where they clicked. Disabling for the duration of a request is the honest coupling. On error the previous rows stay and an inline banner appears above them — blanking a table the user was reading in order to show an error loses their place for no gain |
| D9 | **No usuarios mutation ever calls `setQueryData`. All five invalidate.** Stated as a uniform rule in `queries.ts`, not a per-mutation judgement | Write the response into the cache where it is cheap — the three non-credential mutations (PATCH, deactivate, reactivate) return exactly the updated `usuarioResumenDto` | This is a deliberate departure from the app's own precedent: `useLogin.ts:29`, `useChangePassword.ts:30` and `useLogout.ts:26` all `setQueryData(['session'], …)`. That is right **there** — the login response *is* the session. It is wrong here for two independent reasons. Structurally: a mutation returns one user, a list cache entry is a page with an ordering and a `total`; splicing one into the other means reimplementing `order by creado_en desc, id desc` in the client and getting `total` right, to save one request on a table of single-digit rows. And by risk: **two of the five responses carry a plaintext credential**. A per-mutation rule where three are cache-writes and two must not be is a rule someone gets wrong exactly once, in the direction that leaks. A uniform rule has no exception to forget |
| D10 | Invalidation map, per mutation — see the table under **Data Flow**. The non-obvious entry: **`update` also invalidates `['session']` when the target is the logged-in user** | Invalidate `usuariosKeys.all` from every mutation and stop thinking | The blunt version is defensible for the usuarios keys themselves and is nearly what D9 does — but it misses `['session']` entirely, and that is a real stale-UI bug this design exists to catch. An encargado may PATCH their own `nombre`/`email`/`rol` (the settled affordance blocks cover deactivation and password-reset, **not** edit), and the sidebar user card in `AppShell` is fed by `['session']`. Without the extra invalidation the actor renames themselves and the sidebar keeps the old name until a reload. Consequence, stated rather than designed around: self-demotion to `deposito` succeeds server-side when a second encargado exists, the invalidated session re-runs D4's guard, and the actor is redirected out of `/usuarios` mid-flow. That is correct behaviour and surprising UX; it is carried as an open question, not silently blocked, because inventing a third affordance block would re-open a settled product decision |
| D11 | An out-of-range page is **detected and corrected**, not rendered: when a **settled, non-placeholder** response has `data.length === 0 && total > 0 && page > 1`, navigate to `Math.ceil(total / PAGE_SIZE)` with `replace: true`. `total === 0` renders the empty state and never redirects | (a) Render "no users" for a non-empty table; (b) clamp `page` against `total` before fetching | This works **only because** `apps/api/src/usuarios/repository.ts:191-215` runs two statements: the comment there is explicit that `count(*) over ()` "returns no row at all on an out-of-range page, which would report total 0 for a non-empty table". With the window function the client would receive `total: 0`, be unable to distinguish it from an empty directory, and (a) would be the only reachable behaviour. The two-statement choice is what makes recovery possible; the client depends on it and should say so. (b) cannot work — `total` is only known from a response. `replace: true` keeps the bad page out of history, and the redirect converges in one hop because the target is computed from the same authoritative `total`. Guarding on *settled and not placeholder* is what stops a loop: mid-flight `keepPreviousData` can transiently present a stale shape. **Correcting the brief:** this change ships **no DELETE route** (there are seven routes and none removes a row) and deactivation is logical with the row kept visible by settled decision 4, so `total` in this system can only grow. "Deleting the last row of the last page" is therefore unreachable *through this UI*; the surviving path to an out-of-range page is a typed or bookmarked `?page=`, which D6's clamp catches first and D11 catches second |
| D12 | The plaintext is contained on the client **by type, not by discipline** — the mirror of `gestion-usuarios D8`. The credential-bearing hooks narrow inside `mutationFn`: it awaits `apiFetch`, hands the plaintext to a local `useState` setter, and **returns only `body.usuario`**. `mutation.data` is therefore typed `UsuarioResumen`, which has no `passwordTemporal` member | (a) Return the full body and read the plaintext in `onSuccess`, calling `mutation.reset()` on dismiss; (b) return the full body and rely on `gcTime` | Both rejected alternatives put the credential in `queryClient.getMutationCache()` — a **global singleton on the QueryClient**, readable by anything holding it, visible in devtools, and cleared only by a `reset()` someone must remember or a `gcTime` (5 min default) that starts after the mutation settles. There is no auto-dismiss (D14), so the window between success and dismiss is unbounded by design; (a) makes the containment depend on a cleanup call at the end of that window, which is the discipline `gestion-usuarios D8` refused on the server for the same reason. Narrowing inside `mutationFn` makes the leak **unrepresentable**: no code path can read a key the result type does not have. `setState` after an `await` is not a render-phase side effect and is a no-op after unmount in React 19, which is also the honest answer to "what if the user navigates away mid-flight" — the credential is discarded and recovery is one more audited reset. Note the division of labour: the server's `Cache-Control: no-store` (`routes/usuarios.ts:187,214`) closes the *transport* copy; D12 closes the *application* copies |
| D13 | `components/ui/Modal.tsx` is a plain `<div role="dialog" aria-modal="true" aria-labelledby>` over an overlay div, with a **required, non-defaulted** `closePolicy: 'explicit-only' \| 'casual'` prop. The credential modal passes `'explicit-only'`: **Escape and overlay-click do not dismiss it.** Focus moves to the heading (`tabIndex={-1}`) on open — not to the acknowledge button — Tab/Shift+Tab cycle inside, and focus is restored to the trigger on close | (a) Native `<dialog>` + `showModal()`; (b) `closePolicy` defaulting to `'casual'`; (c) Escape-to-dismiss for the credential modal too | **Answering the question directly: Escape-to-dismiss is not safe for this modal.** Dismissal destroys the only copy of a credential, and both Escape and an overlay click are reflexive gestures — Escape to close an autocomplete, a stray click while aiming at the button. A generic confirm dialog wants exactly the opposite, so the policy is a prop; making it **required with no default** means the risky behaviour cannot be selected by omission, the same shape as D9's uniform rule. (a) is genuinely attractive — free top layer, free focus trap, free inert background — but it must be driven imperatively through a ref (`showModal()`/`close()`) kept in sync with React state, an impedance mismatch this codebase has no precedent for; half its free behaviour (Escape) is the half we must suppress; and its `::backdrop` cannot carry the documented `--overlay-modal` token through a CSS module the way a div can. Whether jsdom 30 implements `showModal` is **not verified here**, and a design should not rest on an unverified environment capability — carried as an open question rather than assumed. Focusing the heading rather than the button is deliberate: a stray Enter still held from the click that opened the modal must not immediately destroy the credential. Tokens are verbatim: `--radius-modal` (18px), `--overlay-modal` (`rgba(22,35,60,.55)`), `--shadow-modal` (`0 18px 50px rgba(22,35,60,.4)`) — all three already exist in `src/styles/tokens.css:41,47,50` |
| D14 | The credential modal has **no auto-dismiss, no navigation blocker, and no copy-to-clipboard button**. The password renders in a large monospace block, grouped 4×4, with `user-select: all`. Its copy states plainly that it cannot be shown again and how to get a new one | (a) A timed auto-dismiss; (b) `beforeunload` / TanStack `useBlocker` to protect the credential; (c) a "Copiar" button using `navigator.clipboard.writeText` | (a) puts a countdown on reading a 16-character string — the failure mode is losing the credential to a timer. (b) trades a lost password for a user trapped on a screen, and `beforeunload` renders as a generic untranslatable browser dialog this app cannot word. (c) is the interesting one: it writes the credential to the **OS clipboard**, which other applications read, which Windows Cloud Clipboard and Apple Universal Clipboard sync across devices, and which persists until overwritten — a durable copy outside the page, created by us, in exchange for convenience the credential was already designed not to need. `gestion-usuarios D7` chose Crockford-32 explicitly so a human could read it aloud or write it down, excluding `I`/`L`/`O`/`U` for transcription. Optimising the display for that channel — large, grouped, monospaced — serves the actual delivery path; `user-select: all` still makes a deliberate copy one click plus Ctrl+C, which is the **user's** clipboard action, not one the app performs silently. What replaces prevention is designed recovery: losing it costs one more audited reset, which the modal's own copy says |
| D15 | `features/usuarios/errorMessages.ts` switches on `error.code`, **never on `error.status`** | Branch on HTTP status | 409 is overloaded on this surface: `PATCH /usuarios/:id` returns 409 for both `EMAIL_ALREADY_IN_USE` and `LAST_ACTIVE_ENCARGADO` (`routes/usuarios.ts:231`, and `gestion-usuarios D3` puts a `rol: 'deposito'` PATCH under the last-encargado guard). A status-based branch shows "ese correo ya está en uso" to someone who just tried to demote the last encargado. `features/auth/errorMessages.ts:9` already switches on code; this follows it |
| D16 | **No toast primitive is built in this change.** Refusals render as a persistent `FormError` (the existing `role="alert"` primitive) adjacent to the action that failed; successes are visible in the refetched list | A toast, as listed in the proposal's "New shared UI primitives" | Flagged loudly because it **narrows the proposal's stated scope**: the proposal named four primitives and this design ships three. The reason is that no requirement names a toast and every message this screen produces is one of two things. A refusal is actionable and must persist — "promote another encargado first" is an instruction, and a container that disappears on a timer is the wrong home for an instruction. A success is already legible: the row appears, or the chip flips. Building a fourth primitive to announce what the table already shows spends review budget on a component with no reader. `sdd-tasks` and the owner should see this as a decision, not discover it as an omission |
| D17 | The two settled self-action blocks (deactivate, password-reset on your own row) render as **visibly disabled controls with an adjacent 12px muted reason**, not as absent controls | (a) Hide the controls on your own row; (b) `aria-disabled` with a tooltip | Same principle as D3, applied twice so the screen is coherent rather than ad hoc: `docs/design.md:8` forbids hiding a restriction without explanation. (b) fails on the mechanics — a `disabled` button is not focusable, so a tooltip on it is unreachable by keyboard, and `Button` sets `disabled={disabled \|\| isPending}` (`Button.tsx:28`), which this change has no reason to widen. Visible adjacent text needs no focus to be discoverable and needs no primitive change. The wording must not claim authority: **the server still permits both operations**; the screen declines to offer them because, aimed at yourself, each is an immediate logout with no upside |
| D18 | The PATCH body is built from react-hook-form's `formState.dirtyFields`, and "Guardar cambios" is disabled while nothing is dirty | Send all three fields on every submit | Not a style preference — an API-shape consequence. `actualizarUsuarioBody` is `.strict().refine(keys > 0)` (`routes/usuarios.ts:78-87`), so an empty body is a **400 `VALIDATION_ERROR`**, which is what a "save" with nothing changed would produce. Sending everything is safe (`gestion-usuarios D5`: an empty diff writes nothing and files no audit row, returning 200) but pointless, and it makes the request body stop describing intent. Dirty-fields gives the smallest correct body and makes the disabled state and the request derive from one source |
| D19 | One shared `formatFecha` in `features/usuarios/format.ts` built on `Intl.DateTimeFormat('es')`, applied to `creadoEn` | `new Date(x).toLocaleDateString()` inline at the call site | `creadoEn` arrives as an **ISO string**, not a `Date` — verified in the generated contract (`apps/web/src/api/schema.d.ts:351-352`, `/** Format: date-time */ creadoEn: string`) even though the server's Zod schema types it `z.date()`. This is the first date this app renders anywhere (no web file formats one today), so there is no precedent to follow and one shared function is cheaper than three call sites each re-deciding. `Intl` needs no dependency |

## Data Flow

### Route tree after this change

```
rootRoute
├── publicLayout ─────────────────────────── ingresarRoute        /ingresar
└── authLayout            (session)
    ├── cambiarPasswordRoute                                      /cambiar-password
    └── shellLayout       (forced-change)  component: AppShell + <Outlet/>      ← D1
        ├── indexRoute                                            /
        └── encargadoLayout (rol === 'encargado')  component: Outlet           ← D4
            ├── usuariosListRoute      /usuarios          validateSearch: page ← D6
            ├── usuariosNuevoRoute     /usuarios/nuevo    (static beats $id)   ← D5
            └── usuariosDetalleRoute   /usuarios/$id

Client order  session → forced-change → role   mirrors the server's
              401     → 403 PASSWORD_CHANGE_REQUIRED → 403 FORBIDDEN
              …and the client half is convenience. The server's 403 is the boundary.
```

### Query keys and invalidation (D7, D9, D10)

```
usuariosKeys.list({ page })   ← GET /api/usuarios?page&pageSize   keepPreviousData  (D8)
usuariosKeys.detail(id)       ← GET /api/usuarios/:id
```

| Mutation | Invalidates | Why exactly this set |
|---|---|---|
| `create` | `lists()` | Order is `creado_en desc, id desc`, so a new user lands on page 1 and shifts every later row down one; `total` changes. No detail entry exists yet |
| `update` (PATCH) | `lists()`, `detail(id)`, **and `['session']` when `id === session.id`** | Content of the row changes on whichever page holds it. Ordering does not (PATCH cannot touch `creado_en`), but computing *which* page holds it costs more than refetching. The `['session']` entry is D10's finding: the sidebar user card would otherwise keep a stale name |
| `deactivate` | `lists()`, `detail(id)` | `activo` flips → the status chip changes. The row stays (settled decision 4), so `total` and ordering are untouched |
| `reactivate` | `lists()`, `detail(id)` | Same, inverted |
| `password-reset` | `lists()`, `detail(id)` | `debeCambiarPassword` flips to `true`, which the detail screen renders as a chip. **This is the mutation where D9's invalidate-never-write rule is load-bearing** — its response body carries the plaintext |

A `LAST_ACTIVE_ENCARGADO` **failure** also invalidates `lists()`: the refusal is direct evidence that
the client's picture of who is an active encargado is wrong, and the user's next step is to find
someone to promote.

### The temporary-password flow (D12, D13, D14)

```
CreateUsuarioScreen (/usuarios/nuevo)          ← the credential holder is the SCREEN,
  const { mutate, credential, acknowledge }      never a table row: a list refetch must
        = useCrearUsuario();                     not be able to unmount the only copy

  mutationFn: async (input) => {
    const body = await apiFetch<CreateResponse>('/usuarios', { method:'POST', … });
    //          ^ Cache-Control: no-store already stopped the TRANSPORT copy (server D8)
    setCredential({ nombre: body.usuario.nombre,
                    passwordTemporal: body.passwordTemporal });   ← local useState only
    return body.usuario;   ←──────────────── the ONLY value that becomes mutation state.
  }                                           Typed UsuarioResumen: no passwordTemporal
                                              member exists, so no reader can reach it.
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: usuariosKeys.lists() });
    //   ^ NOT awaited: the credential must be on screen the instant it exists, never
    //     gated on a refetch that could fail. NOT setQueryData (D9).
    //   ^ NO navigate() here — unlike useLogin/useChangePassword, which navigate in
    //     onSuccess. Those carry no payload the user must read. This one does.
  }

  credential !== null  →  <Modal closePolicy="explicit-only">        ← Escape: no.
                            heading receives focus (not the button)     Overlay: no.
                            password: 16 chars, mono, grouped 4×4,      Auto-dismiss: no.
                                      user-select: all, no clipboard    (D13, D14)
                            "Anote esta contraseña. No podrá volver
                             a verla. Si la pierde, genere una nueva
                             desde la ficha del usuario."
                            [Entendido] → acknowledge():
                                            setCredential(null)
                                            focus restored to trigger
                                            navigate({ to: '/usuarios' })

Where the copy dies, exhaustively:
  acknowledge()          → state cleared
  route change / unmount → state discarded (setState-after-unmount is a no-op, React 19)
  reload / tab close     → nothing persisted anywhere
  NOT in: query cache · mutation cache (D12) · router or URL state (D6) ·
          localStorage · sessionStorage · clipboard (D14)
```

The password-reset flow is identical, with the hook instantiated **once at the list/detail screen
level** for the same reason: the mutation invalidates the list, the list refetches, and a hook
living inside a row component would be holding the only copy of a credential in a subtree that a
refetch is free to unmount.

### The last-encargado 409 (no client-side prediction)

```
[Desactivar] stays ENABLED, always.        POST /api/usuarios/:id/deactivate
                                             ↓
                                      409 LAST_ACTIVE_ENCARGADO
                                             ↓
  <FormError> beside the action (D16), persistent, actionable:
  «No se puede desactivar: es el último encargado activo.
   Asigne el rol de encargado a otra persona antes de continuar.»
  + invalidate lists()
```

The UI **does not predict this condition**, for three independent reasons, each verifiable:
the list is paginated so the client sees at most `PAGE_SIZE` rows; `total` is
`count(*)` over the whole table with no `WHERE`
(`apps/api/src/usuarios/repository.ts:210-212`) and therefore counts all users, not active
encargados; and even a perfect count is a TOCTOU race against a concurrent transaction holding the
`FOR UPDATE` predicate lock (`gestion-usuarios D2/D3`). A greyed-out button derived from any of
those would be a guess wearing the costume of an authority. The same 409 is reachable from `PATCH`
with `rol: 'deposito'`, which is why D15 branches on `code`.

## File Changes

| File | Action | Slice | Description |
|---|---|---|---|
| `apps/web/src/components/ui/AppShell.tsx` | Create | S1 | Presentational sidebar + `<main>{children}</main>`. Props: `usuario`, `onLogout`, `isLoggingOut` |
| `apps/web/src/components/ui/AppShell.module.css` | Create | S1 | `.shell/.sidebar/.brandMark/.nav/.navItem/.userCard/.avatar/.userName/.userRole/.main` relocated verbatim from `routes/index.module.css`, plus `.navItemActive` and `.navItemLocked` |
| `apps/web/src/components/ui/NavItem.tsx` | Create | S1/S2 | `Link` when `to` is set, marker otherwise (D2); 🔒 variant (D3) |
| `apps/web/src/routes/shellLayout.tsx` | Modify | S1 | `component` becomes a container reading `useRouteContext().usuario` + `useLogout()`. `beforeLoad` untouched, so `shellLayout.test.ts` stays green unmodified |
| `apps/web/src/routes/index.tsx` | Modify | S1 | Loses the sidebar, `NAV_ITEMS`, `ROL_LABEL` and the logout button; keeps only the "Panel general" content |
| `apps/web/src/routes/index.module.css` | Modify | S1 | Emptied of shell rules (moved, not rewritten) |
| `apps/web/src/routes/encargadoLayout.tsx` | Create | S2 | Pathless role guard (D4) |
| `apps/web/src/routes/usuarios.tsx` | Create | S2/S4 | `usuariosListRoute` + `validateSearch` (D6) |
| `apps/web/src/routes/usuariosNuevo.tsx` | Create | S2/S6 | `/usuarios/nuevo` |
| `apps/web/src/routes/usuariosDetalle.tsx` | Create | S2/S5 | `/usuarios/$id` |
| `apps/web/src/routes/routeTree.ts` | Modify | S2 | Adds `encargadoLayout.addChildren([...])` under `shellLayout` |
| `apps/web/src/components/ui/DataTable.tsx` + `.module.css` | Create | S3 | White card, 11px uppercase header, `#eef1f5` dividers, 11px/18px padding (`docs/design.md:73-74`) |
| `apps/web/src/components/ui/Pagination.tsx` + `.module.css` | Create | S3 | Compact footer buttons, blue active page (same lines) |
| `apps/web/src/components/ui/StatusChip.tsx` + `.module.css` | Create | S3 | 11px/700 pill (`docs/design.md:76-77`); `Activo` success, `Inactivo` neutral, `Debe cambiar contraseña` warning |
| `apps/web/src/components/ui/Modal.tsx` + `.module.css` | Create | S6 | D13. Required `closePolicy`; focus trap and restore |
| `apps/web/src/features/usuarios/queries.ts` | Create | S4 | Key factory, `PAGE_SIZE`, and the D9 rule as a module docblock |
| `apps/web/src/features/usuarios/useUsuarios.ts` | Create | S4 | List query (D8) |
| `apps/web/src/features/usuarios/useUsuario.ts` | Create | S5 | Detail query |
| `apps/web/src/features/usuarios/useCrearUsuario.ts` | Create | S6 | D12 narrowing + credential state |
| `apps/web/src/features/usuarios/useActualizarUsuario.ts` | Create | S5 | PATCH from dirty fields (D18) |
| `apps/web/src/features/usuarios/useEstadoUsuario.ts` | Create | S7 | deactivate / reactivate |
| `apps/web/src/features/usuarios/useRestablecerPassword.ts` | Create | S7 | D12 narrowing + credential state |
| `apps/web/src/features/usuarios/errorMessages.ts` | Create | S4 | Switch on `code` (D15) |
| `apps/web/src/features/usuarios/schemas.ts` | Create | S5/S6 | Client mirrors of `crearUsuarioBody` / `actualizarUsuarioBody` |
| `apps/web/src/features/usuarios/format.ts` | Create | S4 | `formatFecha` (D19) |
| `apps/web/src/features/usuarios/UsuariosTable.tsx`, `UsuarioForm.tsx`, `CredentialDialog.tsx` (+ CSS) | Create | S4/S5/S6 | Presentational; no router, no react-query, no `apiFetch` |
| `apps/web/src/styles/tokens.test.ts` | Modify | S6 | Two assertions pinning `--radius-modal` and `--overlay-modal` |
| `apps/web/src/**/*.test.{ts,tsx}` | Create/Modify | all | See Testing Strategy |

**Not touched:** `apps/api/**`, `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts`,
`apps/web/src/api/client.ts`, `errors.ts`, `session.ts`, `app/queryClient.tsx`, `app/router.tsx`,
`components/ui/{Button,TextField,FormError,AuthCard}.tsx`, and every `features/auth/` file.

## Interfaces

```ts
// features/usuarios/queries.ts
// RULE (D9): no mutation in this feature calls setQueryData. All five invalidate.
// Two of the five responses carry a plaintext credential; a per-mutation rule
// is one someone gets wrong exactly once, in the direction that leaks.
export const PAGE_SIZE = 20; // matches pageQuerySchema's server default

export const usuariosKeys = {
  all: ['usuarios'] as const,
  lists: () => [...usuariosKeys.all, 'list'] as const,
  list: (params: { page: number }) => [...usuariosKeys.lists(), params] as const,
  details: () => [...usuariosKeys.all, 'detail'] as const,
  detail: (id: string) => [...usuariosKeys.details(), id] as const,
};

// The narrowed result type. It is the client mirror of gestion-usuarios D8:
// `passwordTemporal` is not a member, so no consumer of mutation state can read it.
export type UsuarioResumen =
  paths['/api/usuarios/{id}']['get']['responses']['200']
       ['content']['application/json']['usuario'];

// features/usuarios/useCrearUsuario.ts
export interface CredentialHandoff {
  nombre: string;
  passwordTemporal: string;
}
export function useCrearUsuario(): {
  mutate: (input: CrearUsuarioInput) => void;
  isPending: boolean;
  error: unknown;
  /** Local component state. Never cached, never persisted, never in the URL. */
  credential: CredentialHandoff | null;
  /** Explicit dismissal — the only non-unmount way this reaches null. */
  acknowledge: () => void;
};

// components/ui/Modal.tsx
export interface ModalProps {
  title: string;
  /** REQUIRED and undefaulted on purpose (D13): the dangerous policy must not
   *  be reachable by omission. 'explicit-only' suppresses Escape AND overlay click. */
  closePolicy: 'explicit-only' | 'casual';
  onClose: () => void;
  children: ReactNode;
}
```

```ts
// routes/usuarios.tsx — the search contract (D6). Clamps, never throws:
// ?page=abc is one hand-edit away, and a route that throws on it is a blank screen.
const usuariosSearchSchema = z.object({
  page: z.coerce.number().int().catch(1).transform((n) => Math.max(1, n)),
});
```

Bodyless POSTs — `deactivate`, `reactivate`, `password-reset` — are sent as
`body: JSON.stringify({})`. See the risk register: this is a deliberate hedge against Fastify's
`FST_ERR_CTP_EMPTY_JSON_BODY`, since `apiFetch` always sets `Content-Type: application/json`
(`api/client.ts:55-58`). None of the three routes declares a body schema, so `{}` is accepted and
ignored.

## Testing Strategy (Strict TDD — RED first, every row)

Four established patterns, all verified in the existing suite, and no new tooling. **No MSW is
installed and none is needed.**

- **P1 — guard logic**: call `route.options.beforeLoad` directly with a stub context
  (`authLayout.test.ts:11`, `shellLayout.test.ts:13`).
- **P2 — route structure**: assert on `route.options` (`cambiarPassword.test.ts:15-20`).
- **P3 — full router**: `createMemoryHistory` + `createRouter(routeTree)` +
  `vi.stubGlobal('fetch', urlDispatchingMock)` + `userEvent` (`app/router.test.tsx:12-36,107-124`).
- **P4 — presentational**: plain RTL, no providers (`Button.test.tsx`, `LoginForm.test.tsx`).
- **P5 — CSS tokens**: read the `.module.css` from disk with `readFileSync` and match the token
  reference. jsdom never applies a CSS Module's stylesheet, so `getComputedStyle` reports nothing —
  `styles/tokens.test.ts:6-20` documents exactly this. **No test in this change may assert a
  computed style.**

| Target | Pattern | The RED test that must fail first |
|---|---|---|
| `AppShell` | P4 | Renders the user's initials, full name and `ROL_LABEL`; calls `onLogout` on click; renders `children` inside `<main>`. Written against the pre-extraction markup so it fails before `AppShell.tsx` exists |
| `/` unchanged after extraction | P3 | The existing `router.test.tsx:126-146` case ("populates the session and navigates into the shell", asserting `Ana` renders) must pass **unmodified**. It is the regression guard for D1 and must not be edited |
| `NavItem` links + active state | P3 | Navigate to `/usuarios?page=3`; the Usuarios item carries the active class. Fails without `activeOptions={{ includeSearch: false }}` (D2) — the whole point is that page 1 would pass and page 3 would not |
| 🔒 for `deposito` | P3/P4 | A `deposito` session renders the Usuarios item with the lock marker and its reason, and **not** as a `Link` (D3) |
| `encargadoLayout` | P1 | `beforeLoad({ context: { usuario: { rol: 'deposito' } } })` throws a redirect to `/`; an `encargado` returns `undefined` |
| Guard order | P2 | `encargadoLayout.options.getParentRoute?.() === shellLayout` — the assertion that pins D4's ordering claim |
| Route ranking | P3 | `/usuarios/nuevo` resolves to the create route, not `/usuarios/$id` with `id === 'nuevo'` (D5) |
| Search clamping | P3 | `/usuarios?page=abc` and `?page=-4` both render page 1 without throwing (D6) |
| `DataTable` / `StatusChip` / `Pagination` | P4 | Column headers as `<th scope="col">`; an inactive user's row shows the `Inactivo` chip; `onPageChange` fires with the right page; controls are `disabled` when `isBusy` |
| Modal tokens | P5 | `Modal.module.css` references `var(--radius-modal)`, `var(--overlay-modal)`, `var(--shadow-modal)`; `tokens.css` pins `18px` and `rgba(22,35,60,.55)` |
| Modal behaviour | P4 | With `closePolicy="explicit-only"`: `user.keyboard('{Escape}')` does **not** call `onClose`; a click on the overlay does **not** call `onClose`; the acknowledge button does. With `closePolicy="casual"`: both do. Focus lands on the heading on open — asserted as `document.activeElement`, **not** on the button. Tab from the last focusable wraps to the first; Shift+Tab from the first wraps to the last. On unmount, focus returns to the trigger |
| **Credential containment (D12)** | P3 | The highest-value test in this change, and the client mirror of the archived `routes/usuarios.test.ts` leak test. After a successful create through the real router with a stubbed `POST /api/usuarios` returning a known plaintext, assert **all** of: `JSON.stringify(queryClient.getQueryCache().getAll())` does not contain it; `JSON.stringify(queryClient.getMutationCache().getAll())` does not contain it; `router.state.location.href` does not contain it; `localStorage`/`sessionStorage` do not contain it; and the modal **does** display it. Five one-line assertions that encode the entire constraint mechanically instead of by review |
| Invalidation map (D10) | P3 | Spy `queryClient.invalidateQueries`. Each of the five mutations invalidates exactly its documented set. Separately: PATCH on the **logged-in user's own** id also invalidates `['session']`, and PATCH on another user does **not** |
| No `setQueryData` (D9) | P3 | Spy `queryClient.setQueryData`; after every usuarios mutation it was never called. One assertion that makes the uniform rule enforceable rather than aspirational |
| Out-of-range recovery (D11) | P3 | Stub `GET /api/usuarios?page=9` → `{ data: [], page: 9, pageSize: 20, total: 3 }`; the router lands on `?page=1` with the bad entry replaced in history. Stub `total: 0` → the empty state renders and no navigation occurs |
| `keepPreviousData` (D8) | P3 | While the page-2 request is in flight the page-1 rows are still in the document, the table carries `aria-busy="true"`, and the pagination buttons are `disabled` |
| Last-encargado 409 (D15) | P3 | A 409 `LAST_ACTIVE_ENCARGADO` on deactivate renders the promote-someone-first copy; a 409 `EMAIL_ALREADY_IN_USE` on PATCH renders the email copy. Both are 409 — the test fails against any status-based branch |
| Self-action affordance (D17) | P3 | On the logged-in user's own row, Desactivar and Restablecer are disabled with their reason visible; on any other row they are enabled. The test name must say **affordance**, not authorization |
| Dirty-fields PATCH (D18) | P3 | Change only `nombre`; the captured `fetch` body is exactly `{"nombre":"…"}`. Submit with nothing changed: the button is disabled and no request is made |
| Bodyless POSTs | P3 | The captured `init.body` for deactivate/reactivate/password-reset is a non-empty JSON string |
| `formatFecha` (D19) | P4 | An ISO string in, a stable `es` date out; a malformed string yields a placeholder rather than `Invalid Date` |
| Wireframe note | — | Not a test. The delta requirement is satisfied by the code comment and the PR line, per the `app-shell/spec.md:87-88` precedent |

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The plaintext reaches a re-readable store through `mutation.data` | Was High without D12 | Credential disclosure in a global singleton readable from devtools | D12 removes the field from the result **type**; the five-assertion containment test sweeps both caches, the URL and both storages |
| A future contributor writes `setQueryData` for a usuarios mutation, following `useLogin`'s in-repo precedent | Medium | The reset/create response — plaintext included — enters the query cache | D9 is a uniform rule stated in `queries.ts`'s docblock, plus a spy assertion that `setQueryData` was never called by this feature |
| The hand-rolled focus trap is incomplete (Shift+Tab, nodes added while open) | Medium | Keyboard users escape the modal into an unreachable background | Accepted, with explicit RED tests for Tab and Shift+Tab wrap and for focus restore. Only one modal is ever open and its content is static. `<dialog>` is carried as an open question, not silently assumed unavailable |
| Layout extraction regresses `/` | Medium | The app's only shipped authenticated screen breaks | S1 is a relocation with no behaviour change, and `router.test.tsx:126-146` already asserts the post-login shell renders `Ana`. That test must pass **unmodified** — editing it would remove the guard |
| `?page` is the app's first validated search param | Low | A malformed param blanks the route | D6 clamps with `.catch(1)` instead of throwing; two RED cases (`abc`, `-4`) |
| Out-of-range redirect loops | Low | The screen never settles | Redirect only on settled, non-placeholder data; the target comes from the same response's authoritative `total`, so it converges in one hop; `replace: true` |
| Fastify rejects the bodyless POSTs with `FST_ERR_CTP_EMPTY_JSON_BODY` because `apiFetch` always sets `Content-Type: application/json` | Unverified | Deactivate, reactivate and password-reset all fail with a 400 that maps to no known code | **Stated as unverified, not assumed either way.** `POST /auth/logout` already ships in exactly this shape (`useLogout.ts:22`) and no test exercises it through a real HTTP client, so the repo provides no evidence. The hooks send `body: JSON.stringify({})`, which is local to this change and cannot regress auth. Carried as an open question: if the parser does reject, logout has a latent bug from #2.1 that this change reports rather than fixes |
| Self-PATCH of `rol` bounces the actor out of `/usuarios` mid-flow | Low | Surprising, correct behaviour | Documented in D10 and carried as an open question. Deliberately **not** designed around: a third affordance block would re-open a settled product decision |
| Dropping the toast narrows the proposal's primitive list | Certain | Scope divergence discovered late | D16 states it as a decision so `sdd-tasks` and the owner see it here, not in a diff |
| Wireframes remain unapproved | Low | Visual rework later | The delta requirement plus the code/PR note, same as #2.1 |
| Every slice sits at or over the 400-line review budget | High | Reviewer burnout, the failure mode the guard exists to prevent | Seven seams with sub-seams identified below; the chain shape is `sdd-tasks`' decision |

## Threat Matrix

| Boundary | Applicability |
|---|---|
| Documentation-like paths | N/A — no file is classified or executed from repository content |
| Git repository selection | N/A — no VCS automation is introduced |
| Commit state | N/A — no index or worktree manipulation |
| Push state | N/A — no push automation |
| PR commands | N/A — no PR automation |
| Shell/subprocess construction | N/A — no command is built or spawned |

No process, shell, subprocess, executable-classification or VCS boundary changes. "Routing" here is
a client-side SPA route tree, not process routing. The two security-relevant boundaries this change
actually introduces are (a) a plaintext credential held in browser memory and (b) a role gate in a
client the user controls. Both are addressed by decisions with dedicated RED tests — D12/D13/D14
and the containment sweep for the first, D4 and its guard tests for the second, with the disclaimer
that the second is convenience and the server's 403 is the boundary.

## Migration / Rollout

**No migration.** No API, schema, contract, database or environment change: `apps/api/**`,
`openapi.json` and `schema.d.ts` are untouched, so `pnpm contract:check` stays byte-identical
throughout. No new dependency — `zod`, `react-hook-form`, `@hookform/resolvers`,
`@tanstack/react-query` and `@tanstack/react-router` are all already in `apps/web/package.json`.

Rollback is a revert of the merged slices. S1 is behaviour-neutral. The read-only half (S1–S4) is
independently shippable and useful: it exposes a directory that today has no consumer at all, and
it does not depend on any mutation slice.

### Changed-line forecast (authored additions + deletions; no generated artifact is produced)

| Slice | Source | Tests | Total | Over 400? |
|---|---|---|---|---|
| S1 — layout extraction | ~280 | ~105 | **~385** | No (marginal) |
| S2 — routing + RBAC skeleton | ~110 | ~130 | **~240** | No |
| S3 — DataTable / Pagination / StatusChip | ~300 | ~150 | **~450** | **Yes** |
| S4 — list screen | ~200 | ~200 | **~400** | At the line |
| S5 — detail + edit | ~200 | ~210 | **~410** | **Yes** (marginal) |
| S6 — Modal + create + credential | ~230 | ~230 | **~460** | **Yes** |
| S7 — deactivate / reactivate / reset | ~150 | ~190 | **~340** | No |
| **Chain total** | ~1470 | ~1215 | **~2685** | **Yes** |

```
Decision needed before apply: Yes
Chained PRs recommended: Yes
400-line budget risk: High
```

Honest notes for `sdd-tasks`, which owns the chain:

- **S1's number is inflated by a move.** Roughly 180 of its 385 lines are CSS relocated verbatim
  from `index.module.css`, counted twice by the additions+deletions rule. `git diff --color-moved`
  shows it as a move; the semantic diff a reviewer actually reads is closer to 200. If S1 must be
  split anyway, the seam is: **S1a** = extract `AppShell` with the nav still inert (~330);
  **S1b** = links, active state, 🔒 (~180, and it merges naturally into S2).
- **S3 splits cleanly** into DataTable + StatusChip (~290) and Pagination (~160).
- **S6 splits cleanly** into the `Modal` primitive alone (~200) and create + credential (~260).
  That split is worth considering on its own merits: the primitive is generic and the credential
  flow is the highest-risk code in the change, and reviewing them separately lets the second review
  be entirely about containment.
- The delivery strategy for this session is `ask-on-risk` and the chain total is ~6.7× the budget,
  so the orchestrator must confirm the chain before apply.

## Open Questions

- [ ] **Does Fastify's default JSON parser reject the bodyless POSTs?** `apiFetch` always sets
      `Content-Type: application/json`, and `POST /auth/logout` already ships that way from #2.1
      with no test covering it through a real HTTP client. D12's hooks hedge with
      `JSON.stringify({})`. Worth a five-minute probe against the running API; if the parser does
      reject, logout has a latent bug this change found but did not fix.
- [ ] **`<dialog>` + `showModal()` instead of the hand-rolled trap.** It would delete the focus-trap
      code and give a real top layer. Blocked on verifying jsdom 30's `HTMLDialogElement` support,
      which this design did not verify and would not assume. Revisit as a follow-up once `Modal`
      has its behavioural tests — they would carry over unchanged.
- [ ] **Self-PATCH of one's own `rol`** succeeds when a second encargado exists and redirects the
      actor out of `/usuarios` (D10). Correct, surprising. Whether it deserves a third affordance
      block is a product question for the backlog owner, not a design decision.
- [ ] **`app-layout/spec.md:30-32`** says inert nav entries "MUST still render through the same link
      markup, not the old `<span>`". D2 reads that as *the same component and class*, because a
      typed `Link` to a route that does not exist is a compile error. If the spec means literal
      `<a>` elements, it needs rewording — flagging rather than quietly reinterpreting.
- [ ] **`intentosFallidos` / `bloqueadoHasta` are still absent from `usuarioResumenDto`**, inherited
      verbatim from `gestion-usuarios`' open questions. The encargado cannot see *that* an account is
      locked, only reset it blindly — and being locked out is the most likely reason to reset. This
      change is now the screen that would render it, which is exactly the condition that open
      question named. It stays out of scope only because adding it is an API change.
- [ ] **`docs/design.md` has no tokens for an empty state's icon or for a "restricted" nav item.**
      D3's 🔒 treatment and the empty-state card are built from the general token set
      (`docs/design.md:85-89`) and inherit the same "not visually approved" note as everything else
      in this change.
