# Exploration: gestion-usuarios (backlog #3 — User Management)

## Current State

### What auth (backlog #2) already gives this change

- `apps/api/src/plugins/auth.ts` — default-deny RBAC. `onRequest` resolves the signed `sid` cookie to `request.user` via `app.repos.sesiones.findValid`; throws `unauthorized()` (401) if missing/invalid. `preHandler` checks `request.routeOptions.config.roles` against `request.user.rol`; throws `forbidden()` (403) on mismatch. Routes opt out of auth with `config: { auth: false }`; opt into role restriction with `config: { roles: ['encargado'] }`. This is exactly the mechanism `gestion-usuarios` needs for "403 a depósito."
- `apps/api/src/auth/repository.ts` — `UsuariosRepo` interface currently has ONLY `findByEmail`, `registerFailedAttempt`, `resetAttempts`. Nothing for create/list/update/deactivate/change-role. All of that is net-new for this change. `Usuario` type: `{ id, nombre, email, hashContrasena, rol: 'encargado'|'deposito', activo, intentosFallidos, bloqueadoHasta, creadoEn }` — no `actualizadoEn`/`updatedAt` column, which is a gap against design.md's "todo auditable" principle if user edits need an audit trail.
- `apps/api/src/db/schema.ts` — `usuarios` table: `id uuid pk defaultRandom`, `nombre text notNull`, `email text notNull unique`, `hash_contrasena text notNull`, `rol rol_usuario notNull` (pgEnum `encargado|deposito`), `activo boolean notNull default true`, `intentos_fallidos integer notNull default 0`, `bloqueado_hasta timestamptz`, `creado_en timestamptz notNull defaultNow`. `activo` is the logical-deletion flag already wired into `sesiones.findValid` (joins `usuarios` and requires `activo = true`), so deactivating a user already revokes their sessions on their very next request without any extra code — the join re-evaluates `activo` live every time.
- `apps/api/src/routes/auth.ts` — the Zod-typed route pattern to replicate: `app.withTypeProvider<ZodTypeProvider>()`, `config: { auth, roles, rateLimit? }`, `schema: { body, response: { 200: dto, 401: errorEnvelopeSchema, ... } }`, and a `toDto()` mapper that strips `hashContrasena` before returning. `usuarioDto` (`id, nombre, email, rol`) already exists in this file and can be reused/exported.
- `apps/api/src/lib/errors.ts` — factories available: `unauthorized()`, `forbidden()`, `accountLocked()`, `invalidCredentials()`, `accountInactive()`, plus generic `toErrorEnvelope()`/`notFoundEnvelope()` (404 catch-all for unmatched routes only). **No factory exists yet** for: a per-resource 404 (e.g. "user not found" for a bad `:id`), a 409/422-style conflict for "cannot remove the last encargado" or "email already in use," or a role-change guard. These will need to be added as part of this change (`AppError` is generic enough: `new AppError(code, message, status, details)`).
- `apps/api/src/lib/pagination.ts` — `pageQuerySchema` (`page` default 1, `pageSize` default 20, max 100, `z.coerce.number()`) and `paginated(data, page, pageSize, total)` → `{ data, page, pageSize, total }`. A user-list endpoint must use this verbatim to stay compliant with `api-contract-pipeline`.
- `apps/api/src/plugins/repos.ts` / `app.ts` — `app.repos` is the DI seam (`{ usuarios, sesiones }`); a new CRUD-capable `UsuariosRepo` implementation slots in here without touching route code. `app.ts` registers `authPlugin` before route plugins — a new `usersRoutes` plugin just needs to be registered after `authPlugin` (order already correct for any route file added there).

### Specs that bind this change

- `openspec/specs/auth-sessions/spec.md` — "RBAC Hook Contract" requirement: `preHandler` checks `request.user.rol` against a route-declared allowlist, 403 `FORBIDDEN` on mismatch; hook "MUST NOT perform row-level or field-level authorization" (relevant precedent: field-level permission like `stock_minimo` in products is handled in the service layer per-request, not the hook — the same pattern would apply to any per-field user-management rule).
- `openspec/specs/api-contract-pipeline/spec.md` — fixes the error envelope (`{ error: { code, message, details? } }`) and pagination envelope (`{ data, page, pageSize, total }`, `?page&pageSize`) that all new list/CRUD endpoints must reuse; also mandates Zod→OpenAPI→SPA-types generation with no hand-edited generated types (`pnpm contract`).
- `openspec/changes/archive/2026-08-25-auth-sesiones/design.md` — conventions to follow: three-seam split (data access / auth / route), business rules as pure functions over repo interfaces in a `service.ts` (mirrors what a `users/service.ts` should look like), atomic single-UPDATE SQL for stateful invariants (used for lockout; the same pattern — one atomic statement — is the natural fit for a "block removing/demoting the last active encargado" guard, to avoid TOCTOU races between a count-check and the update).

### Product docs

- `docs/PRD.md` — permission matrix: "Gestión de usuarios y roles" is available only to `encargado`, not to `deposito`. This is a full-feature gate (not a per-field permission like `stock_minimo`), so the whole `gestion-usuarios` route group can use `config: { roles: ['encargado'] }` uniformly — no per-field 403 needed here, unlike products.
- `docs/TECH-DESIGNv2.md` — Usuario model confirmed as above (id, nombre, email/usuario, hash_contraseña, rol, activo, creado_en). RBAC checklist items (lines ~221–231) state: unauthenticated → 401 on any data endpoint; `deposito` gets 403 attempting several encargado-only actions including "gestionar usuarios or configuración." No item-#3-specific acceptance criteria block exists beyond this general checklist — the detailed CRUD/role/logical-deletion acceptance criteria for `gestion-usuarios` are NOT yet written anywhere and will need to be authored in this change's own proposal/spec.
- `docs/design.md` — no dedicated "Usuarios" screen wireframe/mockup in this file. Only a generic sidebar user-card spec (circular avatar with initials, colored by role — blue for encargado, green for deposito) and a mention that the login screen uses the dark sidebar background color (`#16233c`) as its background — no layout, fields, or copy for a login form are specified. The file references `Wireframes.dc.html` as "wireframes aprobados (turno 1)" but that file is **not present** under `docs/` in this repo — either external/not committed, or missing. Generic table/modal/KPI/permission-lock component conventions in this file are reusable for a Usuarios list/detail screen once one is designed.
- `docs/REVISION-ADVERSARIAL.md` (A6, resolved 2026-08-13) — RBAC middleware is endpoint-level by design; row-level filtering ("mis movimientos") is a service-layer concern elsewhere, not directly relevant to user CRUD. Confirms: bootstrap of the first encargado is out-of-band (`seed-encargado.ts`, already shipped in #2); the only documented account-recovery path for a locked-out sole encargado is a **manual admin procedure resetting the hash directly in the DB**, outside the application — there is no in-app or email-based password reset in v1 (ADR-0007 explicitly defers email reset). No text anywhere resolves self-deactivation, self-demotion, or a "last encargado" guard — this is an open product question, not a decided one.

### Frontend reality check

- `apps/web/src/` is a bare scaffold: `App.tsx` only renders a `useQuery` health check via `apiFetch()`; `api/client.ts` is a raw `fetch` wrapper (`credentials: 'include'`, JSON headers) that throws a generic `Error` on any non-2xx — it does NOT parse the `{ error: { code, message } }` envelope, so structured error handling (e.g. distinguishing 401 vs 403 vs 423) does not exist yet anywhere in the SPA.
- `apps/web/package.json` — dependencies are only `react`, `react-dom`, `@tanstack/react-query`. **No router is installed** (no `react-router-dom`, no `@tanstack/react-router`, nothing). There is no concept of routes, protected routes, or navigation in the codebase at all.
- **There is no login screen.** Backlog item #2 (auth-sesiones) shipped zero UI — only the API contract. Without a login screen, there is no way to reach a users list/detail screen (or any protected screen) from a browser; the only way to exercise this change today is via `curl`/Postman/integration tests hitting the API directly with a cookie.
- No forms library, no TanStack Query mutation patterns established yet (only one read-only query exists), no existing pattern for a paginated table component, modal, or role-gated UI element.

## Affected Areas

- `apps/api/src/auth/repository.ts` — extend `UsuariosRepo` (or add a new interface) with `create`, `list` (paginated), `findById`, `update`, `setActivo`/`deactivate`, `setRol`, and a `countActiveEncargados`-style guard query.
- `apps/api/src/db/schema.ts` — likely needs an `actualizado_en`/audit column if user edits must be auditable per design.md's "todo auditable" principle; otherwise unchanged.
- `apps/api/src/auth/service.ts` (or new `apps/api/src/users/service.ts`) — business rules: password hashing on create (reusing `auth/password.ts`'s argon2id `hashPassword`), last-encargado protection, self-deactivation/self-demotion rule, uniqueness/email-normalization on create/update.
- `apps/api/src/routes/` — new `routes/usuarios.ts` (or similar) exposing list/create/get/update/deactivate, all `config: { roles: ['encargado'] }`, reusing `errorEnvelopeSchema` and `paginated()`.
- `apps/api/src/lib/errors.ts` — new factories needed: a resource-scoped `notFound()`, an email-conflict error, and a last-encargado-guard error (409 or 422).
- `apps/api/src/plugins/repos.ts` — wire the extended/new repo implementation.
- `apps/api/src/auth/password.ts` — reuse `hashPassword` for user creation; already exists from #2, no change expected.
- `openspec/specs/auth-sessions/spec.md` and a new `openspec/specs/user-management/spec.md` (or similarly named) — this change should add its own delta spec; it should NOT silently extend `auth-sessions` scope.
- `apps/web/src/` — potentially in scope depending on the scope decision below: router installation, login screen, users list/detail screens, mutation-aware API client error handling. Currently zero code exists for any of this.

## Approaches

1. **Backend-only CRUD (matches literal BACKLOG #3 scope)** — implement `usuarios` CRUD + role management + logical deletion entirely in `apps/api`, no frontend work, mirroring how #2 shipped API-only.
   - Pros: Matches backlog item wording exactly ("CRUD de usuarios y roles"); smallest, most reviewable slice; consistent precedent with #2; keeps scope creep out of a single PR/review budget.
   - Cons: The feature remains unreachable from a browser — testable only via API tooling, not a real user flow; compounds the "no UI at all" gap for a second consecutive backlog item, deferring the moment a login screen becomes unavoidable.
   - Effort: Low–Medium.

2. **Backend CRUD + login screen + full users list/detail UI in the same change** — closes the reachability gap immediately: install a router, build a login form, and a Usuarios list/detail/create/edit UI.
   - Pros: Delivers an actually browsable, demoable feature end-to-end; forces the router/error-handling/forms decisions now rather than accumulating them as debt.
   - Cons: Substantially larger scope than the backlog item's stated wording; login screen and generic app-shell/router work arguably belongs to a cross-cutting "frontend shell" concern, not specifically to "gestión de usuarios"; likely blows well past a single 400-line review budget, forcing PR chaining; `docs/design.md` provides no concrete login/users wireframe to build against, so screen design would be improvised mid-implementation rather than following an approved mockup.
   - Effort: High.

3. **Backend CRUD + minimal login screen only (defer users list/detail UI)** — ship the API plus just enough frontend (router install + a login form + session-aware fetch wrapper) to make the app usable in a browser at all, but leave the actual Usuarios management screen for a later/parallel change.
   - Pros: Unblocks manual QA and future screens generically (any future protected screen needs the router + login anyway); scoped smaller than option 2; the login screen is arguably a shared prerequisite for every future item (#4 proveedores, #5 productos, etc.), not specific to user management, so building it once here benefits the whole backlog.
   - Cons: Still expands this specific change beyond its literal backlog wording; introduces an app-shell/router decision inside a change nominally about "gestión de usuarios"; the Usuarios screen itself — the actual point of backlog item #3 — still wouldn't be reachable, so the "close the gap" benefit is partial.
   - Effort: Medium.

## Recommendation

Option 1 (backend-only CRUD) most faithfully matches the backlog item's literal scope ("CRUD de usuarios y roles por el encargado; 403 a depósito; baja lógica de usuario") and follows the precedent set by backlog #2, which also shipped with zero UI. However, this is not a purely technical call — the orchestrator/user must explicitly decide the scope question below before proposal, because deferring frontend work a second time compounds an already-visible gap (no login screen exists anywhere in the repo yet). Recommend option 1 for the `gestion-usuarios` change itself, paired with an explicit, separately tracked decision (either a fast-follow change or an amendment to this backlog) for "minimal app shell + login screen," since that is a cross-cutting prerequisite for every future UI-bearing backlog item, not something specific to user management.

## Hard Questions Surfaced (investigated, not decided)

1. **Does this change include the login screen?** No login UI exists (confirmed: no router installed, `App.tsx` only renders a health check). Without it, `gestion-usuarios` cannot be reached in a browser even if the API CRUD is fully correct. This is a scope question for the proposal phase, not something this exploration resolves.
2. **Self-protection rules — undecided in all product docs.** No PRD/TECH-DESIGNv2/REVISION-ADVERSARIAL text addresses: (a) whether an encargado can deactivate or self-demote themselves, or (b) any guard preventing the last active encargado from being deactivated/demoted (which would permanently lock out all admin access, since there is no email-based password reset — the only recovery path is a manual DB hash reset outside the application). This must be resolved as a product decision in the proposal; the technical pattern to enforce it (an atomic single-statement guard, matching the lockout-UPDATE precedent in `repository.ts`) is already established in the codebase.
3. **Password handling on create/update — no documented flow.** The only precedent is `seed-encargado.ts`, which reads a password from env vars for the one-time bootstrap encargado (never CLI args, per its own security rule). Nothing in the docs specifies whether an encargado creating a new user types that user's initial password directly, or whether a temporary-password/must-change-on-first-login flow is expected. ADR-0007 explicitly defers email-based password reset out of v1 scope, which implies there is also no "invite via email" flow available as an alternative — so if the encargado does not set the password directly, there is currently no other delivery mechanism.
4. **Logical deletion semantics — mostly resolved, one gap.** `sesiones.findValid` already joins `usuarios` and requires `activo = true`, so setting `activo = false` revokes a user's session automatically on their very next request — no separate "delete their sessions on deactivate" step is strictly required for correctness (though eagerly deleting the rows at deactivation time may still be desirable for cleanliness/audit, and is cheap to add given `SesionesRepo.delete`/`purgeExpired` already exist). Login already checks `activo` (after password verify, per D10, to avoid a user-enumeration oracle) and returns `ACCOUNT_INACTIVE` — this existing behavior does not need to change for `gestion-usuarios`, just to be relied upon.
5. **Role change while logged in.** Because `findValid` re-joins `usuarios` live on every request (no role snapshot is cached in the `sesiones` row), a role change takes effect on the user's very next authenticated request automatically — no explicit session invalidation or refresh mechanism is needed for role changes to propagate. This is a favorable existing property, not a gap.

## Risks

- No login screen exists yet; if this change is scoped API-only (recommended), the feature will remain unreachable in a browser until a separate frontend/app-shell change ships — flag this dependency explicitly in the proposal's rollout plan.
- Last-encargado lockout is a real product risk given there is no password-reset flow in v1; if unresolved, this change could ship a way to accidentally lock every user out of the system permanently.
- No `errors.ts` factory yet for resource-not-found, email-conflict, or last-encargado-guard responses — these need new `AppError` factories and new status codes decided (404, 409/422) plus matching Zod response-schema entries per route, or the OpenAPI contract will under-document the new error surface.
- No `actualizado_en`/audit trail column on `usuarios` — if user edits (role changes, deactivation) need to be auditable per design.md's stated principle ("todo auditable"), the schema needs a new column and its own migration.
- `docs/design.md`'s referenced `Wireframes.dc.html` is absent from the repo — if any UI work is scoped into this change, there is no approved wireframe to build the Usuarios screen against, unlike other areas of the design system.
- `apps/web/src/api/client.ts` does not parse the structured error envelope at all — any frontend work in or adjacent to this change will need to extend it first, which is itself a small but real prerequisite.

## Ready for Proposal

Yes, with the five open questions above flagged for explicit resolution before or during the proposal phase — particularly the login-screen scope question (#1) and the self-protection/last-encargado guard (#2), since both materially change the shape of the design and tasks phases.

---

## Reconciliation (2026-08-27) — supersedes the stale parts above

The body of this exploration was written on 2026-08-26, **before** backlog #2.1
(`app-shell-login`) and #2.2 (`auditoria-general`) shipped. Both are now merged and archived
(`main` at `293ae75`). Nothing above is deleted — this section records what changed and which
open questions are now closed, in the same supersede-don't-rewrite style `TECH-DESIGNv2.md`
uses against v1.

### Open questions: closed

**Q1 — "Does this change include the login screen?" → MOOT.** Backlog #2.1 shipped the whole
app shell: TanStack Router with typed public/protected routes, the login screen, session
context and logout, `react-hook-form` + zod resolver, and server-side enforcement of
`debe_cambiar_password`. The scope debate in "Approaches" above (options 1/2/3) no longer
exists: option 1 (backend-first) is now the only coherent reading, because the shell it was
deferring already exists. Any UI this change needs is a screen on an existing rail, not new
cross-cutting infrastructure.

**Q2 — self-protection and last-encargado guard → DECIDED (product, user, 2026-08-27).**
The system MUST refuse to deactivate or demote the last active `encargado`. This is the
decision that actually closes the lockout risk: `sesiones.findValid`
(`apps/api/src/auth/repository.ts:118`) joins `usuarios` live on every request and requires
`activo = true`, and it returns the live row, so `rol` is re-read per request. That means
self-deactivation locks the actor out on the very next request, and self-demotion strips
admin instantly while leaving the session valid — and no password-recovery flow of any kind
would undo either, because the credential was never the thing that was lost.

**Q3 — password handling on create → DECIDED (product, user, 2026-08-27).** The API generates
the temporary password, returns it **exactly once** in the creation response for the encargado
to hand over in person, and sets `debe_cambiar_password = true`. No email. Rationale: the
plaintext never reaches the database (only the argon2id hash is stored) and Fastify's default
logger records the request line, status and timing but not bodies, so it does not reach the
logs either. The encargado resetting any user's password reuses the same path, which is what
makes every non-encargado account rescuable without email.

**Email-based recovery → OUT OF SCOPE, tracked as backlog #3.5.** Not deferred on effort — the
code is roughly 60% of a #2.2-sized cycle and reuses the `UnitOfWork` seam pattern, the already
installed `@fastify/rate-limit`, and #2.1's forms and router. It is deferred because the
blocking constraint is not code: sending to an arbitrary address requires a domain whose DNS
can carry SPF/DKIM records. The user has no domain (Firebase Hosting yields a `*.web.app`
subdomain whose DNS belongs to Google and cannot carry those records), so the feature could not
reach an employee's inbox at all. Adopting Firebase Authentication instead was rejected: it
replaces the cookie+`sesiones` session model that ADR-0007 fixes, and `auditoria.usuario_id`
carries a real FK to `usuarios` (design.md D14) that would have nothing to point at.

**Q4 (logical deletion) and Q5 (role change propagation) → unchanged and still favorable.**
Re-verified against `findValid` at `apps/api/src/auth/repository.ts:118`.

### Risks: closed

- **"No `actualizado_en`/audit column on `usuarios`" → RESOLVED, and NOT by adding a column.**
  Backlog #2.2 shipped a generic `auditoria` table. Per ADR-0012 the trail lives there, not as
  columns on the audited row. `usuarios` needs no schema change for auditability.
- **"`apps/web/src/api/client.ts` does not parse the error envelope" → RESOLVED** by #2.1.
- **"No approved wireframe for a Usuarios screen"** — still true. `Wireframes.dc.html` is still
  absent. Mitigated, not resolved: #2.1 established real component conventions in code to build
  against, which the exploration could not assume when it flagged this.

### New constraints this change inherits from #2.2

These did not exist when the body above was written and are binding:

1. **Every mutation runs inside `app.uow.run`** (`apps/api/src/db/uow.ts`), with the record
   change and its audit row committing or rolling back together. The callback receives repos,
   never the raw executor, so a service cannot reach around the boundary.
2. **Every mutation calls `recordAudit`** (`apps/api/src/auditoria/service.ts`). `AuditAccion`
   already defines exactly the four verbs this change needs — `crear`, `actualizar`,
   `baja_logica`, `reactivar` — plus `cambiar_password`.
3. **The last-encargado guard must live inside that same transaction.** The atomic-single-
   statement precedent from the lockout UPDATE is still the right shape against TOCTOU, but it
   is no longer sufficient on its own: the guard, the write and the audit row must share one
   transaction, or a rolled-back write can leave an audit row claiming it happened.
4. **`FIELD_CLASSIFICATION.usuarios`** (`apps/api/src/auditoria/fields.ts`) already classifies
   every column this change touches, `debeCambiarPassword` included, with `hashContrasena` on
   the denylist. Expected to need no edit — if this change adds a column, `fields.test.ts`
   fails by name, which is the intended build-time gate (design.md D11).
5. **`changePassword` in `apps/api/src/auth/service.ts` is the reference implementation** of
   the whole pattern, including the rule that argon2 hashing happens *outside* the transaction.

### Still open, unchanged

`apps/api/src/lib/errors.ts` still has no factory for a per-resource 404, an email conflict, or
the last-encargado guard. Those remain net-new, along with their status codes and matching Zod
response-schema entries, or the OpenAPI contract will under-document the new error surface.
