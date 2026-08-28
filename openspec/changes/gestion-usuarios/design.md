# Design: Gestión de Usuarios (backlog #3)

## Technical Approach

Backend only (#3.1 owns the screen). Four seams in dependency order, each independently mergeable.
Decision ids are cited as `gestion-usuarios D1..D17`; `auditoria-general/design.md`,
`app-shell-login/design.md` and `auth-sesiones/design.md` own their own D-numbers and are cited by
name where they bind.

1. **S1 — Repository relocation** (`src/usuarios/repository.ts`, `src/auth/`, `src/plugins/`).
   `Usuario`, `UsuariosRepo` and `DrizzleUsuariosRepo` move out of `auth/repository.ts`, which keeps
   `SesionesRepo` only. Import-only diff, zero behaviour change, `Repos` shape untouched (D1).
2. **S2 — CRUD + guard SQL** (`src/usuarios/repository.ts`, `src/auth/repository.ts`). The new repo
   methods, the `FOR UPDATE` predicate lock, the 23505 mapping, and `SesionesRepo.deleteAllForUser`.
   Proven against real Postgres, including the concurrency test, before any service consumes them.
3. **S3 — Service + errors + generator** (`src/usuarios/service.ts`, `src/usuarios/temp-password.ts`,
   `src/lib/errors.ts`). Business rules over repo interfaces, exactly as `auth/service.ts` does.
   No route, so `openapi.json` stays byte-identical and `pnpm contract:check` is green.
4. **S4 — Routes** (`src/routes/usuarios.ts`, `src/app.ts`, regenerated contract artifacts). The only
   slice that changes observable API surface and the only one carrying a contract diff.

Naming rule inherited from the codebase: table/column names and pgEnum *values* are Spanish
(`hash_contrasena`, `'encargado'`); TypeScript identifiers, filenames and comments are English, with
domain entity nouns kept Spanish (`Usuario`, `NuevaSesion` — the existing precedent). Wire-level error
codes are English (`ACCOUNT_LOCKED`, `PASSWORD_CHANGE_REQUIRED`), except where they name a pgEnum
value.

## Architecture Decisions

| # | Decision | Alternatives rejected | Rationale |
|---|---|---|---|
| D1 | `Usuario`, `UsuariosRepo` and `DrizzleUsuariosRepo` **move** to `apps/api/src/usuarios/repository.ts`; `auth/repository.ts` keeps `SesionesRepo`/`NuevaSesion` only. `Repos` keeps exactly three keys and `buildRepos` changes by one import line | (a) Extend `UsuariosRepo` in place inside `auth/`; (b) a second `repos.usuariosAdmin` key over the same table | (a) leaves `auth/` — a consumer of the table — owning its CRUD, against the settled rule that a domain directory takes the name of the table it owns. The stub-churn cost of (a) is real, but it is **unavoidable either way** — a correction to this design's first draft. Most fakes are object literals cast `as UsuariosRepo` (`auth/service.test.ts:37`, `routes/auth.test.ts:44`, `plugins/auth.test.ts:30`, `plugins/repos.test.ts:17`) and would indeed still compile. But `app.test.ts:38` uses `satisfies UsuariosRepo`, deliberately, so that an incomplete stub fails by name instead of drifting — and `satisfies` is checked against whichever interface the identifier resolves to, so **widening `UsuariosRepo` breaks that stub no matter which file it lives in**. Moving does not dodge it; S2 must extend `app.test.ts`'s fake when it adds the CRUD members, and its forecast must carry those lines. That is the guard working as intended, not an obstacle. The case for the move therefore rests on cohesion alone, which is enough: (b) is worse than either: two repo objects mutating one table means `updatePassword` and the last-encargado guard live behind different interfaces, so no single file shows the complete lock order for `usuarios`. The move keeps `uow.run`'s hand-off (`work(buildRepos(tx))`) and every existing stub shape identical; its cost is a mechanical import-only diff across ~8 files, isolated in S1 |
| D2 | The guard is a **predicate lock plus an explicit service check**, not a single conditional UPDATE: `select id from usuarios where rol = 'encargado' and activo = true order by id for update`, then the service refuses if the locked set minus the target is empty | (a) One `UPDATE … WHERE … AND EXISTS (select 1 from usuarios u2 where u2.id <> $1 and u2.rol='encargado' and u2.activo)`; (b) `SERIALIZABLE` isolation + 40001 retry; (c) a transaction-scoped advisory lock | (a) is the shape `registerFailedAttempt` uses, and it is **insufficient here for a provable reason**: that invariant is per-row, so a single statement closes it; this one spans rows. Under Drizzle's default READ COMMITTED, T1 (deactivate A) and T2 (deactivate B) each evaluate `EXISTS` against a snapshot in which the other's uncommitted write is invisible, both see a second active encargado, both lock disjoint rows, both commit — zero active encargados. Textbook write skew; a WHERE-clause subquery cannot see it. `FOR UPDATE` can: after T1 commits, T2's lock wait releases and Postgres re-evaluates the WHERE against the *new* row version, so A drops out of T2's set and the guard trips. (b) also closes it, but `UnitOfWork.run` is deliberately a one-method port (auditoria-general D1) with no isolation parameter, so it would need a widened port plus a retry policy — more machinery than locking 1–3 rows. (c) needs a magic constant and, worse, fails **open**: a future writer that forgets the advisory lock races freely, whereas `FOR UPDATE` conflicts with *any* concurrent update of an encargado row, including one taken by a code path that never heard of this guard |
| D3 | Lock order is fixed and total: **the active-encargado set first (ordered by id), then the target row** (`select … where id = $1 for update`). The set lock is taken *conservatively* — before the target is read — whenever the request could remove admin capability (`activo: false` requested, or `rol: 'deposito'` requested, or any deactivate) | Read the target first and lock the set only once the predicate is known to apply | Reading the target first locks a row that may itself be inside the set, inverting the order against a concurrent transaction that took the set first — a genuine deadlock cycle. Deciding from the *request shape* alone needs no read, so the order is unconditional. Over-locking costs a scan of a table with single-digit rows. Writes that cannot remove admin capability (create, reactivate, promote, name/email edit) never take the set lock at all, and therefore hold exactly one `usuarios` lock and can never participate in a cycle |
| D4 | Three outcomes, three distinct mechanisms, none of them `rowCount`: **404** comes from the locked read returning `undefined`; **409** comes from the explicit guard check throwing before any write; **no-op** comes from an empty changed-field diff. A zero-row UPDATE is unreachable (the row is held under lock) and is thrown as an internal invariant violation, never silently mapped to 404 | Fold the guard into the UPDATE's WHERE and infer the outcome from `rowCount === 0` | Overloading one integer with "no such user", "guard refused" and "nothing to change" produces exactly the bug class this design exists to avoid: the route cannot tell a refusal from a missing row, so a deleted-user race would surface as `LAST_ACTIVE_ENCARGADO` and vice versa. Separating them also puts the guard's decision in TypeScript, where the RED test can assert the thrown code directly instead of a driver-specific row count |
| D5 | **No state change ⇒ no write and no audit row**, applied uniformly to all three write paths: a PATCH whose values equal the current row, a deactivate on an already-inactive user, and a reactivate on an already-active user all return **200** with the current DTO. Not 409, not 404 | (a) 409 on an already-inactive deactivate; (b) always write the row and the audit entry | The requested end state already holds, so nothing conflicts — (a) would make a retry after a dropped response look like a failure. (b) is the real damage: `baja_logica` and `reactivar` name a *transition*, and a row whose diff is `{activo:false} → {activo:false}` asserts a transition that did not happen. That breaks the exact query auditoria-general D10 created these verbs for ("who deactivated this user" would return whoever clicked the button twice) and pollutes the trail #2.2 exists to keep trustworthy. Consequence, stated: the caller cannot tell from the response whether it caused the change — acceptable, because the trail, not the status code, is the record of who did what, and it is the trail's precision being protected. The guard composes with this correctly: an already-inactive encargado fails the "removes admin capability" predicate, so the guard is not consulted |
| D6 | `hashPassword` and temporary-password generation run **outside** `uow.run`; the set lock, the target read, the row write and `recordAudit` run inside one `uow.run` | One transaction around the whole service function | Direct application of auditoria-general D3 and the `changePassword` reference implementation: argon2id at `memoryCost: 19456` is deliberately hundreds of milliseconds, depends on nothing in the database, and would hold both a pooled connection **and** the encargado-set lock open across it — here the contention cost is strictly worse than in #2.2, because the lock this transaction holds is the one every other user-management write must wait on |
| D7 | Temporary password: `randomBytes(10)` → 80 bits → 16 symbols of the 32-character Crockford alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, five bits per symbol | (a) `randomBytes(12).toString('base64url')`; (b) modulo over a 62-character alphanumeric alphabet; (c) a word list; (d) `Math.random` | The alphabet size is 2^5, so 80 random bits map onto 16 symbols with **zero modulo bias** and no rejection sampling — the bias problem is removed rather than managed, which is (b)'s defect. Crockford excludes `I`, `L`, `O` and `U`, which matters because this credential's entire delivery channel is an encargado reading it aloud or writing it on paper: (a) is case-sensitive and contains `-`/`_`, so it is transcription-hostile for the one job it has. (c) adds a dependency and a longer string for less entropy per character. (d) is not a CSPRNG. 80 bits is far beyond brute force against argon2id, and the credential's intended lifetime is a single login |
| D8 | The plaintext is contained by **type, not by discipline**: no repo method signature accepts it (`NuevoUsuario` carries `hashContrasena`, never `password`); it is returned only by `POST /api/usuarios` (201) and `POST /api/usuarios/:id/password-reset` (200) through a dedicated `usuarioConPasswordDto`; `usuarioResumenDto` — the shape every other route returns — has no such field; both credential-bearing responses set `Cache-Control: no-store`; it is never passed to `request.log` | Return it through a widened shared DTO with the field optional | An optional field on the shared DTO means every GET is one accidental spread away from leaking it, and Zod response serialization would happily emit it. With two disjoint schemas the leak is unrepresentable: the temporary password is not a member of the type any read path returns. It cannot reach the database (no column and no repo parameter carries it) nor the audit snapshots (which are built from returned *columns*, and `hashContrasena` is denylisted by auditoria-general D6/D11/D12 on top of that). It cannot reach the logs: Fastify's default logger records the request line, status and timing, never bodies — verified by probe in `app.ts`, not assumed |
| D9 | Email uniqueness is enforced by the existing `usuarios_email_unique` index. The repo catches SQLSTATE **23505** on that constraint and throws `emailAlreadyInUse()` (409). No `findByEmail` pre-check. Emails are normalized `trim().toLowerCase()` on every write, matching the login path | Pre-check with `findByEmail` and throw before the INSERT | A pre-check is the same TOCTOU class D2 rejects, one table over: two concurrent creates both find nothing and one dies on the index anyway, so the pre-check adds a round trip and still needs the 23505 handler. Because the throw happens inside `uow.run`, the transaction rolls back and no audit row survives. Note the interaction with auditoria-general D5: `recordAudit` wraps only failures thrown by *its own* repo, so a 23505 from the `usuarios` write reaches the client as `EMAIL_ALREADY_IN_USE`, not masked as `AUDIT_WRITE_FAILED` |
| D10 | `SesionesRepo` gains **one new method**, `deleteAllForUser(usuarioId)` → `delete from sesiones where usuario_id = $1`. Admin reset **and** deactivate call it; self-service `changePassword` keeps `deleteOthers(usuarioId, sessionId)` unchanged | (a) `delete(id)` — deletes by session id, not user id; (b) `purgeExpired(usuarioId)` — deletes only already-expired rows; (c) `deleteOthers(targetId, '')` as a sentinel | (a) and (b) simply do not express "revoke every session of this user"; the surface genuinely lacks the method. (c) works only because a session id is `base64url(randomBytes(32))` and therefore never the empty string — an implicit invariant that breaks silently the day session ids change, inside a security path, with a method name that lies about intent. The asymmetry with `changePassword` is deliberate and belongs in the contract: there the actor **is** the subject and owns the surviving session, so keeping it avoids logging a user out of the tab they are typing in; in an admin reset the actor is a different principal, there is no caller-owned session on the target to preserve, and the triggering reason is normally a lost or suspected-compromised credential, so leaving a session alive leaves the attacker in. Deactivate revokes eagerly even though `findValid` already joins `activo = true`: it makes the revocation a fact in the table rather than a property of a join a future refactor could drop, and without it a deactivated user's session rows are **immortal** — `purgeExpired` runs only on login, which that user can never perform again |
| D11 | Admin reset clears the lockout counters **in the same UPDATE** that sets the hash: `set hash_contrasena = $2, debe_cambiar_password = true, intentos_fallidos = 0, bloqueado_hasta = null where id = $1 returning …`. **Reactivation does not clear them** | (a) Call the existing `resetAttempts(id)` as a second statement inside the same `uow.run`; (b) leave the counters alone on reset; (c) clear them on reactivate too | (b) is a correctness bug, verified in code: `login` (`auth/service.ts:54`) checks `bloqueadoHasta` and throws `accountLocked` **before** `verifyPassword` at line 61, so a locked account cannot authenticate for the full window whatever its hash is — and being locked out is the single most likely reason an encargado resets a password. Without this, the encargado hands over a credential that provably does not work and the employee sees `ACCOUNT_LOCKED`, which reads as "the reset failed". The asymmetry with self-service `changePassword` is real and needs no counter clearing there: you must already be authenticated to call it, so you were never locked. Between (a) and the single statement, the atomicity argument that justified `updatePassword`'s single statement does **not** apply here — both are inside one transaction and roll back together. Two other arguments do: one statement yields one row version, so `RETURNING` gives the exact post-state for the audit snapshot without a re-read; and `resetAttempts` carries auth's meaning ("a successful login clears the counter"), so reusing it would let a future change to login policy silently change admin-reset behaviour. (c) is rejected: `bloqueado_hasta` is an absolute timestamp and the window is 5 minutes, so a reactivated account is virtually always already unlocked — and `registerFailedAttempt`'s elapsed-lockout branch (`repository.ts:64`) already prevents a stale counter of 5 from re-locking on the first attempt after the window. Clearing them on reactivate would make reactivation a second, undocumented partial credential reset, and would drag credential columns into a `reactivar` diff whose question is "who put this account back" |
| D12 | The audit verb for admin reset is **`cambiar_password`**. Snapshots carry the changed non-denylisted columns: `datosPrevios = { debeCambiarPassword, intentosFallidos, bloqueadoHasta }` (prior values), `datosPosteriores = { debeCambiarPassword: true, intentosFallidos: 0, bloqueadoHasta: null }` | (a) `actualizar`; (b) a new `restablecer_password` enum value; (c) copy `changePassword`'s two-key snapshot verbatim | The enum value names the **act**, not who initiated it, and auditoria-general D10 created it for precisely this case ("#3's temporary-password window"). (a) would file a credential event under the same verb as a name edit, defeating D10. (b) encodes something already derivable at zero cost: the row itself carries `usuario_id` (actor) and `entidad_id` (subject), so an admin reset is exactly the row where they differ — and adding an enum value needs a migration plus the `ALTER TYPE … ADD VALUE` friction auditoria-general D9 documented. (c) would under-record: this UPDATE changes three non-denylisted columns, and D6's changed-field rule says all three belong. That is not incidental detail — `bloqueadoHasta: "<timestamp>" → null` is the evidence that answers "was this a rescue of a locked-out account or an unexplained credential change?", which is the non-repudiation question ADR-0012 says `auditoria` exists for. `bloqueadoHasta` serializes into `jsonb` as an ISO-8601 string |
| D13 | Deactivate and reactivate are **explicit routes** (`POST /api/usuarios/:id/deactivate`, `/reactivate`); `PATCH /api/usuarios/:id` rejects an `activo` key at the Zod layer and accepts `{ nombre?, email?, rol? }` with at least one key required | Model both as `PATCH { activo: boolean }` and derive the audit verb from the diff | Deriving the verb from a patch shape means one request can legitimately change `nombre` **and** `activo`, forcing either two audit rows for one transaction or a lossy choice of verb — and the lossy choice destroys D10's indexed equality filter. Rejecting the key makes that unreachable by construction: the request fails Zod with `VALIDATION_ERROR` before any handler runs. Path convention: the collection segment is the Spanish domain noun `usuarios` (it names the table and the directory), action segments are English, matching `/auth/login`, `/auth/logout`, `/auth/password` |
| D14 | Three new factories in `lib/errors.ts`: `userNotFound()` → `USER_NOT_FOUND` **404**; `emailAlreadyInUse()` → `EMAIL_ALREADY_IN_USE` **409**; `lastActiveEncargado()` → `LAST_ACTIVE_ENCARGADO` **409**. Each route declares every reachable status in its Zod `response` map | (a) Reuse the existing `notFoundEnvelope()` / `NOT_FOUND`; (b) one generic `resourceNotFound(resource)` with `details.resource`; (c) 422 for the guard | (a) is reserved for unmatched routes, and reusing it makes "no such path" and "no such user" indistinguishable to the SPA. (b) forces every client to branch on `details` instead of on `code`; #4/#5 add `proveedorNotFound()`/`productoNotFound()` the same way, keeping the client's switch exhaustive. (c) 422 is for a syntactically valid but semantically invalid entity; this request is entirely valid and is refused because of the current state of the collection, which is 409's definition, and it is resolvable by changing that state (promote another encargado first). `LAST_ACTIVE_ENCARGADO` keeps the Spanish role token because it names a pgEnum *value* |
| D15 | Every user-management read projects an explicit column list that **omits `hash_contrasena`**, returning `UsuarioResumen`. The hash leaves the database on exactly one user-management code path: none | Select the row and strip the hash in the DTO mapper | Defence in depth at the layer that actually costs nothing: a mistaken `return rows[0]` in a handler cannot leak what the query never fetched, and the RED test asserts the absence of the *key*, not of a value. Stated honestly and not overclaimed: `findByEmail` (login) and `SesionesRepo.findValid` (which populates `request.user` on every authenticated request) still return the full row including the hash. Narrowing those is out of scope for #3 and is recorded as an open question, not silently implied |
| D16 | `routes/usuarios.ts` defines its own `usuarioResumenDto` (`id, nombre, email, rol, activo, debeCambiarPassword, creadoEn`). `routes/auth.ts`'s `usuarioDto` is not exported, extended, or reused | Export `usuarioDto` from `routes/auth.ts` and extend it | The auth DTO is the *session* projection `/auth/me` returns; the admin DTO is a directory projection. They change for different reasons, and widening the shared one would regenerate `/auth/me`'s contract for a field that route has no use for. Duplication here is two literal objects; coupling here is a contract change in an unrelated capability |
| D17 | `GET /api/usuarios` uses `pageQuerySchema` and `paginated()` verbatim, ordered `creado_en desc, id desc`, with `total` from a second `count(*)`. Reads go through the pool-bound `app.repos`, never `uow` | (a) Order by `creado_en` alone; (b) `count(*) over ()` in one query; (c) run reads inside `uow.run` | (a) is a real bug at seed/import time: `creado_en` defaults to `now()` and ties are common, and OFFSET pagination over a non-deterministic order skips and duplicates rows across pages. The `id` tiebreaker makes the order total. (b) saves a round trip but couples the count to the LIMIT window's plan for no benefit at this size. (c) contradicts auditoria-general D4 — only mutations need atomicity, and taking a transaction per list would hold a pooled connection for a read that cannot tear |

## Data Flow

```
PATCH /api/usuarios/:id        config: { roles: ['encargado'] }
POST  /api/usuarios/:id/deactivate

  onRequest  → sid → findValid (JOIN usuarios: expira_en > now AND activo)   401 if miss
  preHandler → debeCambiarPassword && !allowPasswordChangePending → 403 PASSWORD_CHANGE_REQUIRED
             → rol !== 'encargado' → 403 FORBIDDEN

  handler → updateUsuario / setUsuarioActivo(app.uow, { actorId: request.user.id, id, … })

    (no argon2 on this path — see the create/reset flow below)

    uow.run(async (repos) => {                     db.transaction(tx => work(buildRepos(tx)))

      if (request could remove admin capability)                              ← D3, from the
        locked = repos.usuarios.lockActiveEncargados()                          request shape
          -- select id from usuarios                                            alone, before
          --  where rol = 'encargado' and activo = true                         any read
          --  order by id for update

      previo = repos.usuarios.findByIdForUpdate(id)      ← select … for update, no hash (D15)
        undefined → throw userNotFound()                 → 404 USER_NOT_FOUND        (D4)

      removesAdmin = previo.rol === 'encargado' && previo.activo
                     && (next.activo === false || next.rol !== 'encargado')
      if (removesAdmin && locked.filter(x => x !== id).length === 0)
        throw lastActiveEncargado()                      → 409 LAST_ACTIVE_ENCARGADO (D4)

      diff = changedFields(previo, next)
      if (diff is empty) return previo                   → 200, NO write, NO audit row (D5)

      posterior = repos.usuarios.update(id, cambios)     ← business write first (auditoría D8)
                | repos.usuarios.setActivo(id, activo)
                    23505 on usuarios_email_unique → throw emailAlreadyInUse() → 409  (D9)
      if (!activo) repos.sesiones.deleteAllForUser(id)                              (D10)

      repos.auditoria.record via recordAudit({           ← same tx, same connection
        entidad: 'usuarios', entidadId: id,
        accion: 'actualizar' | 'baja_logica' | 'reactivar',
        usuarioId: actorId,                              ← actor ≠ subject on every route here
        datosPrevios:     diff.before,                   ← changed fields only (auditoría D6)
        datosPosteriores: diff.after,
      })
        throws → AUDIT_WRITE_FAILED → ROLLBACK: no row change, no session revocation → 500
    })
    → 200 { usuario: usuarioResumenDto }

  Two concurrent deactivates, two active encargados A and B (the D2 property)

    T1  lockActiveEncargados → locks {A,B}          T2  lockActiveEncargados → BLOCKS on A
    T1  set A inactive, audit, COMMIT               T2  wakes, Postgres re-checks A against the
                                                        NEW version: activo=false, A drops out
                                                    T2  locked = {B}, target B, {B}\{B} = ∅
                                                    T2  409 LAST_ACTIVE_ENCARGADO, ROLLBACK
    Result: exactly one active encargado. The rejected EXISTS-subquery UPDATE leaves zero.


POST /api/usuarios          POST /api/usuarios/:id/password-reset

  plain = generateTempPassword()      ← randomBytes(10) → 16 × 5 bits → Crockford32   (D7)
  hash  = await hashPassword(plain)   ← OUTSIDE the transaction and outside the lock  (D6)

  uow.run(async (repos) => {
    create:  usuario = repos.usuarios.create({ nombre, email, rol, hashContrasena: hash })
               -- insert … returning id, nombre, email, rol, activo,
               --                  debe_cambiar_password, creado_en     ← never the hash (D15)
             recordAudit({ accion: 'crear', usuarioId: actorId, entidadId: usuario.id,
                           datosPrevios: null,                          ← null iff crear (D7)
                           datosPosteriores: <the returned row> })

    reset:   previo = repos.usuarios.findByIdForUpdate(id)   undefined → 404
             usuario = repos.usuarios.resetPassword(id, hash)
               -- update usuarios set hash_contrasena = $2, debe_cambiar_password = true,
               --                     intentos_fallidos = 0, bloqueado_hasta = null
               --  where id = $1 returning …                                        (D11)
             repos.sesiones.deleteAllForUser(id)             ← ALL, not deleteOthers (D10)
             recordAudit({ accion: 'cambiar_password', usuarioId: actorId, entidadId: id,
                           datosPrevios:     { debeCambiarPassword, intentosFallidos,
                                               bloqueadoHasta },        ← prior values (D12)
                           datosPosteriores: { debeCambiarPassword: true,
                                               intentosFallidos: 0, bloqueadoHasta: null } })
  })
  reply.header('Cache-Control', 'no-store')                                          (D8)
  → 201/200 { usuario: usuarioResumenDto, passwordTemporal: plain }   ← the only exit, once

  next login with `plain` → debeCambiarPassword → preHandler 403 PASSWORD_CHANGE_REQUIRED
  on every route except /auth/me and /auth/password (app-shell-login D3, unchanged)
```

## File Changes

| File | Action | Slice | Description |
|---|---|---|---|
| `apps/api/src/usuarios/repository.ts` | Create | S1, S2 | S1: `Usuario`, `LockoutResult`, `UsuariosRepo`, `DrizzleUsuariosRepo` moved verbatim. S2: `UsuarioResumen`, `NuevoUsuario`, `CambiosUsuario`, the CRUD methods, `lockActiveEncargados`, `resetPassword`, 23505 mapping |
| `apps/api/src/auth/repository.ts` | Modify | S1, S2 | S1: keeps `NuevaSesion`/`SesionesRepo`/`DrizzleSesionesRepo`, imports `Usuario` from `../usuarios/repository.js`. S2: `deleteAllForUser` (D10) |
| `apps/api/src/auth/service.ts` | Modify | S1 | Import path only |
| `apps/api/src/plugins/auth.ts` | Modify | S1 | Import path only (`Usuario`) |
| `apps/api/src/plugins/repos.ts` | Modify | S1 | One import line; `Repos` and `buildRepos` shapes unchanged (D1) |
| `apps/api/src/usuarios/temp-password.ts` | Create | S3 | `TEMP_PASSWORD_ALPHABET`, `TEMP_PASSWORD_LENGTH`, `generateTempPassword()` (D7) |
| `apps/api/src/usuarios/service.ts` | Create | S3 | `listUsuarios`, `getUsuario`, `createUsuario`, `updateUsuario`, `setUsuarioActivo`, `resetUsuarioPassword` |
| `apps/api/src/lib/errors.ts` | Modify | S3 | `userNotFound()`, `emailAlreadyInUse()`, `lastActiveEncargado()` (D14) |
| `apps/api/src/routes/usuarios.ts` | Create | S4 | Seven routes, all `config: { roles: ['encargado'] }`, Zod schemas + response maps |
| `apps/api/src/app.ts` | Modify | S4 | `app.register(usuariosRoutes, { prefix: '/api' })` after `authPlugin` |
| `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts` | Modify | S4 | Regenerated by `pnpm contract`; committed. Generated — excluded from the authored-line count |
| `apps/api/src/**/*.test.ts` | Create/Modify | all | See Testing Strategy |

`apps/api/src/db/schema.ts`, `apps/api/drizzle/**` and `apps/api/src/auditoria/fields.ts` are
**not** touched: no column is added, so `fields.test.ts`'s exhaustiveness gate (auditoria-general
D11) stays green by construction, and `entidad: 'usuarios'` already compiles (D9).

## Interfaces

```ts
// apps/api/src/usuarios/repository.ts
// UsuarioResumen is the projection every user-management read returns. It has no
// hashContrasena member, so no read path can leak the hash even by accident (D15).
export interface UsuarioResumen {
  id: string; nombre: string; email: string;
  rol: 'encargado' | 'deposito';
  activo: boolean; debeCambiarPassword: boolean; creadoEn: Date;
}

// No field here admits a plaintext password — the service hashes before it calls (D6, D8).
export interface NuevoUsuario {
  nombre: string; email: string;
  rol: 'encargado' | 'deposito';
  hashContrasena: string;
}
export interface CambiosUsuario {
  nombre?: string; email?: string; rol?: 'encargado' | 'deposito';
}

export interface UsuariosRepo {
  // moved unchanged from auth/repository.ts (D1)
  findByEmail(email: string): Promise<Usuario | undefined>;
  registerFailedAttempt(id: string): Promise<LockoutResult>;
  resetAttempts(id: string): Promise<void>;
  updatePassword(id: string, hash: string): Promise<void>;
  // new (S2)
  list(page: number, pageSize: number): Promise<{ rows: UsuarioResumen[]; total: number }>;
  findById(id: string): Promise<UsuarioResumen | undefined>;
  findByIdForUpdate(id: string): Promise<UsuarioResumen | undefined>;   // select … for update
  lockActiveEncargados(): Promise<string[]>;                            // the D2 predicate lock
  create(input: NuevoUsuario): Promise<UsuarioResumen>;                 // maps 23505 → 409 (D9)
  update(id: string, cambios: CambiosUsuario): Promise<UsuarioResumen>; // maps 23505 → 409
  setActivo(id: string, activo: boolean): Promise<UsuarioResumen>;
  resetPassword(id: string, hash: string): Promise<UsuarioResumen>;     // + clears lockout (D11)
}

// apps/api/src/auth/repository.ts — one new method (D10)
export interface SesionesRepo {
  /* … existing five … */
  deleteAllForUser(usuarioId: string): Promise<void>;
}
```

```sql
-- The D2 predicate lock. FOR UPDATE, unlike a WHERE-clause EXISTS, re-evaluates the
-- predicate against the NEW row version after a lock wait, which is the entire reason
-- it closes the write skew a single conditional UPDATE cannot see.
select id from usuarios where rol = 'encargado' and activo = true order by id for update;

-- The D11 reset: one statement, one row version, RETURNING feeds the audit snapshot.
update usuarios
   set hash_contrasena = $2, debe_cambiar_password = true,
       intentos_fallidos = 0, bloqueado_hasta = null
 where id = $1
returning id, nombre, email, rol, activo, debe_cambiar_password, creado_en;
```

```
GET   /api/usuarios                       200 paginated(usuarioResumenDto) | 401 | 403
POST  /api/usuarios                       201 usuarioConPasswordDto | 400 | 401 | 403 | 409 | 500
GET   /api/usuarios/:id                   200 okUsuario | 401 | 403 | 404
PATCH /api/usuarios/:id                   200 okUsuario | 400 | 401 | 403 | 404 | 409 | 500
POST  /api/usuarios/:id/deactivate        200 okUsuario | 401 | 403 | 404 | 409 | 500
POST  /api/usuarios/:id/reactivate        200 okUsuario | 401 | 403 | 404 | 500
POST  /api/usuarios/:id/password-reset    200 usuarioConPasswordDto | 401 | 403 | 404 | 500
```

All seven carry `config: { roles: ['encargado'] }` and none opts into
`allowPasswordChangePending`, so an encargado who still owes a password change gets 403
`PASSWORD_CHANGE_REQUIRED` here — default-deny, inherited, not re-implemented. The 500 entry is
declared wherever `AUDIT_WRITE_FAILED` is reachable, so the contract documents it (auditoria-general
D5); every error entry uses the shared `errorEnvelopeSchema`.

## Testing Strategy (Strict TDD — RED first, every row)

| File | Layer | What it proves |
|---|---|---|
| `src/usuarios/temp-password.test.ts` | Unit | Exactly 16 symbols; every symbol is in the 32-character alphabet and none is `I`/`L`/`O`/`U`; 1000 draws are distinct; `randomBytes` is called with 10 and `Math.random` is never called (spy); the 5-bit mapping consumes all 80 bits (D7) |
| `src/usuarios/service.test.ts` | Unit (stub repos + `{ run: (work) => work(stubs) }`) | Create passes a hash and **no plaintext-bearing key** to the repo, and the returned `passwordTemporal` never equals any repo argument; `debeCambiarPassword: true` on create; `crear` audit has `datosPrevios === null` and no `hashContrasena`; guard throws `LAST_ACTIVE_ENCARGADO` when the locked set is `{target}` and passes at size 2; guard is **not** consulted for create/reactivate/promote/name-edit (D3); empty diff → no write, no audit row, 200 (D5); already-inactive deactivate → no write, no audit row, guard not consulted; reset calls `deleteAllForUser` and never `deleteOthers`, and its audit event is `cambiar_password` with the three-key snapshot (D12); every mutation's repo calls occur inside a single `run` |
| `src/usuarios/repository.integration.test.ts` | Integration (Docker PG) | `list` paginates and totals correctly and stays stable across pages when `creado_en` ties (D17); `list`/`findById`/`findByIdForUpdate` results have **no `hashContrasena` key** (D15); `lockActiveEncargados` returns active encargados only; a duplicate email surfaces as `EMAIL_ALREADY_IN_USE`, not a raw pg error (D9); `resetPassword` sets the flag true and clears `intentos_fallidos`/`bloqueado_hasta` in one statement (D11); `setActivo` leaves both counters untouched on reactivate (D11) |
| `src/usuarios/guard.integration.test.ts` | Integration (Docker PG, **two real concurrent transactions** on separate pooled connections) | With exactly two active encargados, two simultaneous deactivates leave exactly one — one succeeds, one raises `LAST_ACTIVE_ENCARGADO`; same for deactivate-A ∥ demote-B; **and the documented negative**: the rejected `EXISTS`-subquery UPDATE run in the same harness leaves zero active encargados, i.e. the bug D2 prevents, asserted the way `uow.integration.test.ts` asserts auditoria-general D1's negative |
| `src/auth/repository.integration.test.ts` | Integration (modify) | `deleteAllForUser` removes every session of the target and none of any other user (D10) |
| `src/routes/usuarios.test.ts` | Unit (`buildApp({ repos, uow, cookieSecret })` + `inject`) | `deposito` → 403 on all seven routes; unauthenticated → 401; a flagged encargado → 403 `PASSWORD_CHANGE_REQUIRED`; `passwordTemporal` present in the 201 body and **absent from every other response body**, including `GET /:id` and `PATCH` (D8); `Cache-Control: no-store` on both credential-bearing responses; `PATCH` with `activo` → 400 `VALIDATION_ERROR`; `PATCH` with `{}` → 400 (D13) |
| `src/routes/usuarios.integration.test.ts` | Integration (real app + Docker PG, no stubs) | Create → login with the returned temporary password → `GET /api/usuarios` returns 403 `PASSWORD_CHANGE_REQUIRED` → `POST /auth/password` clears it; a reset on a **locked** account lets that account log in immediately (the D11 bug, asserted as behaviour); exactly one `auditoria` row per mutation with the right `accion`, the actor in `usuario_id`, and no `hash_contrasena` in either snapshot; admin reset kills every session of the target while the actor's own session still resolves, and self-service `/auth/password` keeps the caller's (D10); a forced audit-insert failure leaves the user row and the sessions unchanged and returns 500 `AUDIT_WRITE_FAILED` |
| `src/lib/errors.test.ts` | Unit (extend) | The three new factories' codes, statuses, and absent `details` (D14) |
| `src/auth/service.test.ts`, `src/auth/repository.test.ts`, `src/plugins/repos.test.ts` | Unit (modify) | Import paths only after S1 — green with no assertion change is the proof the move is behaviour-neutral |
| Contract | CI | `pnpm contract:check` byte-identical in S1–S3; in S4 the seven paths and every declared status appear in `openapi.json` and `schema.d.ts` |

Integration files match `*.integration.test.ts`, are excluded from the default `vitest.config.ts`
`include`, and run against real Docker Postgres with `fileParallelism: false` — which the
concurrency test depends on, since it needs two live connections and no other file truncating
`usuarios` underneath it. It must **not** run its two transactions through a single `uow.run`: the
race only exists across connections.

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The `FOR UPDATE` predicate lock deadlocks against a concurrent transaction locking the same rows in a different order | Low | A 40P01 abort → whole `uow.run` rolls back → 500 | D3 fixes one total order (set-then-target) and confines the set lock to writes that can remove admin capability, so no other path holds two `usuarios` locks. Residual: Postgres may lock in scan rather than sort order; the plan is identical for both transactions, and at single-digit table size the window is sub-millisecond. Detected, not silenced — a 40P01 must surface as 500, never be retried silently |
| The encargado-set lock contends with the login path (`registerFailedAttempt`, `updatePassword` on an encargado row) | Low | A login request blocks for the guard transaction's duration | D6 keeps argon2 outside the transaction, so the lock is held only for a lock-read, one UPDATE and one INSERT. Accepted explicitly rather than worked around |
| Temporary password leaks via a response the design did not anticipate | Low | Credential disclosure | D8 makes it unrepresentable in the read DTO rather than filtered out of it; RED tests assert the key's absence from every non-creation response |
| An admin reset that leaves the account locked reads as "the reset failed" | Was High before D11 | The documented rescue path does not rescue | D11, with an integration test that logs in immediately after resetting a locked account |
| A no-op write pollutes the audit trail and breaks the "who deactivated this user" filter | Medium | The trail #2.2 exists for becomes untrustworthy | D5, asserted at both the unit and integration layer |
| The S1 move touches auth files inside a security-sensitive change | Medium | Review noise; a bad merge in the auth suite | S1 is import-only, ships as its own slice with no behaviour change, and is proven by the existing auth suite passing unmodified except for import lines |
| New error codes under-documented in OpenAPI if Zod response maps lag the factories | Low | The SPA cannot branch on codes it cannot see | D14 requires the response-map entry in the same commit as the factory; `contract:check` gates S4 |
| `request.user` still carries `hashContrasena` on every authenticated request | Low | Not a new exposure, but D15's property is narrower than it reads | Stated explicitly in D15 and carried as an open question rather than implied away |

## Threat Matrix

| Boundary | Applicability |
|---|---|
| Documentation-like paths | N/A — no file classification or execution of repository content |
| Git repository selection | N/A — no VCS automation is introduced |
| Commit state | N/A — no index/worktree manipulation |
| Push state | N/A — no push automation |
| PR commands | N/A — no PR automation |
| Shell/subprocess construction | N/A — no command is built or spawned |

No routing, shell, subprocess, executable-classification or process-integration boundary changes.
The security-relevant boundaries of this change are (a) a plaintext credential with a human delivery
channel and (b) removal of the last administrative principal. Both are addressed by decisions with
dedicated RED tests — D2/D3/D4 and `guard.integration.test.ts` for the second, D7/D8 and
`temp-password.test.ts` / `routes/usuarios.test.ts` for the first — not by prose.

## Migration / Rollout

**No migration.** No table, column, enum value, index or CHECK changes: the guard reads existing
columns and the audit trail lives in `auditoria` per ADR-0012, so `usuarios` needs no
`actualizado_en` column. No index is added for `where rol = 'encargado' and activo = true` — the
table holds single-digit rows and a sequential scan is optimal; adding one would be noise a future
reader has to justify.

**Environment:** no new variable. `DATABASE_URL` and `COOKIE_SECRET` already exist and are the only
inputs. No manual user step is required for this change.

Rollback is a revert of the commits: every change is additive except the S1 move, which is
behaviour-neutral. Nothing reads the new routes until the #3.1 screen ships.

### Changed-line forecast (authored additions + deletions; generated `openapi.json` / `schema.d.ts` excluded)

| Slice | Source | Tests | Total | Over 400? |
|---|---|---|---|---|
| S1 — repository relocation | ~180 | ~15 | **~195** | No |
| S2 — CRUD + guard SQL + `deleteAllForUser` | ~130 | ~190 | **~320** | No |
| S3 — service, errors, generator | ~155 | ~205 | **~360** | No |
| S4 — routes + contract | ~175 | ~200 | **~375** | No |
| **Chain total** | ~640 | ~610 | **~1250** | **Yes** |

```
Decision needed before apply: Yes
Chained PRs recommended: Yes
400-line budget risk: High
```

Recommendation: **four stacked PRs, S1 → S2 → S3 → S4**, per the session's `stacked-to-main` chain
strategy. Each slice has an autonomous scope, its own verification and a clean revert: S1 is a pure
move with no behaviour change; S2 adds repo methods with no call site; S3 adds a service with no
route; S4 is the only slice that changes observable API behaviour and the only one carrying a
contract diff. The delivery strategy is `ask-on-risk` and the chain total exceeds the 400-line
budget, so the orchestrator must confirm the chain before apply. `sdd-tasks` owns the final
forecast; these numbers are the design's estimate, not its output.

## Open Questions

- [ ] `SesionesRepo.findValid` returns the full `usuarios` row, so `request.user.hashContrasena` is
      present on every authenticated request. That predates this change and D15 does not fix it.
      Narrowing it means changing what `login`/`changePassword` receive; recommend a separate
      hardening item rather than folding it into a security-sensitive CRUD change.
- [ ] `usuarioResumenDto` omits `intentosFallidos`/`bloqueadoHasta`, so the encargado cannot see
      *that* an account is locked — only reset it blindly. Cheap to add once #3.1 has a screen that
      would render it; deliberately out of v1 rather than forgotten.
- [ ] No rate limit is applied to `POST /api/usuarios/:id/password-reset`. It is encargado-only,
      audited, and every call revokes the target's sessions, so abuse is attributable rather than
      anonymous. Revisit if a second encargado role ever becomes semi-trusted.
- [ ] An encargado may reset **their own** password through the admin route, which by D10 logs them
      out everywhere including the current tab. Intentional (the route is uniform and self-service
      exists for the other behaviour), but it is a surprising interaction worth one line of UI copy
      in #3.1.
- [ ] The last-encargado guard protects the *count*, not *reachability*: two active encargados who
      both forget their passwords are still locked out with no email recovery (#3.5). ADR-0007's
      manual DB-side hash reset remains the documented last resort; this change narrows the hole, it
      does not close it.
