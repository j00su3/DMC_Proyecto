# Design: Gestión de Proveedores (backlog #4)

## Technical Approach

Backend only. The three-layer split `usuarios` established is mirrored verbatim —
`routes/proveedores.ts` (Fastify + Zod, `config: { roles }` per route) → `proveedores/service.ts`
(normalization, diff-then-audit) → `proveedores/repository.ts` (port + Drizzle adapter) — with every
write inside one `app.uow.run` paired with `recordAudit`.

Almost all of this change is mirroring. Three things are genuinely new and carry the design effort:
a **case-insensitive unique constraint whose column keeps the user's casing** (D1–D3), the **first
per-route RBAC read/write split in this codebase** (D6), and the **relocation of
`isUniqueViolation()`** into shared infrastructure (D4). Everything else is cited to the
`gestion-usuarios` decision it copies, so `sdd-tasks` and `sdd-apply` re-derive nothing.

Decision ids are `gestion-proveedores D1..D14`. `gestion-usuarios/design.md` and
`auditoria-general/design.md` own their own D-numbers and are cited by name.

Five seams in dependency order:

1. **S1 — `isUniqueViolation` extraction** (`lib/db-errors.ts`, `usuarios/repository.ts`). Pure
   relocation of an existing private function plus the direct unit coverage it never had.
2. **S2 — Schema, migration, audit classification** (`db/schema.ts`, `drizzle/0003_*.sql`,
   `auditoria/fields.ts`). The functional unique index and the `FIELD_CLASSIFICATION` entry that
   `recordAudit({ entidad: 'proveedores' })` will not compile without (D5). Proven against real
   Postgres before anything consumes it.
3. **S3 — Repository + wiring** (`proveedores/repository.ts`, `plugins/repos.ts`, five stub files).
4. **S4 — Service + error factories** (`proveedores/service.ts`, `lib/errors.ts`). No route, so
   `openapi.json` stays byte-identical and `pnpm contract:check` is green.
5. **S5 — Routes + contract** (`routes/proveedores.ts`, `app.ts`, regenerated contract artifacts).
   The only seam that changes observable API surface.

Naming rule inherited unchanged: table/column names and pgEnum values are Spanish; TypeScript
identifiers, filenames and comments are English, with domain entity nouns kept Spanish
(`Proveedor`, `ProveedoresRepo`).

**Refined 2026-08-28** — the codebase has two families with different conventions, and each keeps
its own. **Types and repositories are Spanish**: `Usuario`, `UsuariosRepo` → `Proveedor`,
`ProveedoresRepo`. **Error factories and their codes are English**: `userNotFound()` /
`USER_NOT_FOUND` and `emailAlreadyInUse()` / `EMAIL_ALREADY_IN_USE` — note `user`, not
`usuario`, even though the table is `usuarios` → `supplierNotFound()` / `SUPPLIER_NOT_FOUND`
and `supplierNameInUse()` / `SUPPLIER_NAME_IN_USE`.

`lastActiveEncargado()` / `LAST_ACTIVE_ENCARGADO` is not a counter-example: `encargado` there is
the literal `rol` enum value, so it is a domain datum, not a language choice.

This matters beyond tidiness because the error code is **public contract** — it reaches
`openapi.json`, then the generated `apps/web/src/api/schema.d.ts`, then the web client's
`errorMessages.ts` switch. Renaming one after it ships breaks every consumer.

## Architecture Decisions

| # | Decision | Alternatives rejected | Rationale |
|---|---|---|---|
| D1 | Case-insensitive uniqueness is a **functional unique index on `lower(nombre)`**, declared in the Drizzle schema as `uniqueIndex('proveedores_nombre_lower_unique').on(sql\`lower(${table.nombre})\`)` and emitted by `drizzle-kit generate` into `drizzle/0003_*.sql`. The column stays plain `text('nombre').notNull()` with no `.unique()` | (a) the `citext` extension; (b) a `generated always as (lower(nombre)) stored` column with a plain unique index; (c) a nondeterministic ICU collation on the column | All three alternatives are *expressible* to some degree, so the case is made on cost, not capability. **(a) citext** needs `CREATE EXTENSION citext` in a migration — free on `postgres:16-alpine` (the compose role is the image superuser) but an allowlist question on any managed deployment, so it becomes a **manual user step** this change would otherwise not have. Worse, drizzle-orm 0.45.2 has no `citext` column type: it would need `customType`, and `drizzle-kit` would carry an unknown type through every snapshot — the exact drift class this decision exists to avoid. citext is also discouraged upstream in favour of collations. **(b)** is fully expressible — `generatedAlwaysAs` exists on the pg column builder (verified: `drizzle-orm/pg-core/columns/common.d.ts:49`) — and is rejected for a cost that is checkable rather than aesthetic: an extra column enters `getTableColumns(proveedores)`, which is the input to `auditoria/fields.test.ts`'s exhaustiveness gate (D5), so it must be classified as auditable or excluded; classified auditable it would put a redundant lowercase copy of `nombre` in every audit snapshot, and classified excluded it would need a denylist entry justifying why a non-secret column is hidden from the trail. It buys nothing the index does not already give. **(c)** cannot be expressed in a Drizzle schema at all, so it drifts on every `db:generate`. **(a) is expressible in Drizzle 0.45.2**: `IndexBuilderOn.on()` accepts `SQL` (verified: `drizzle-orm/pg-core/indexes.d.ts:42`), and `drizzle-kit` 0.31.10 serializes an `SQL` index column as `{ expression, isExpression: true, asc: true, nulls: 'last' }` and renders it unquoted in the DDL (verified: `drizzle-kit/api.js:22608-22614` and `:15006`). One hard constraint, verified in the same source: an expression index **must** be given an explicit name, or `drizzle-kit` prints an error and calls `process.exit(1)` (`api.js:22570-22576`). **Round-trip**: `db:generate` diffs the schema-serialized snapshot against the stored `drizzle/meta/NNNN_snapshot.json` — both produced by the same serializer — so the expression string is byte-identical on both sides and does not re-diff. The known "index drifts on every generate" failure comes from `drizzle-kit push`/`pull`, where Postgres renders the expression back as `lower((nombre)::text)` from `pg_get_indexdef`; this project runs neither (`apps/api/package.json` has only `db:generate` and `db:migrate`). That is an argument, not a proof, so S2 carries a cheap one: run `db:generate` twice and assert the second run emits no migration. Keeping `nombre` as `text` rather than `varchar` is load-bearing for the same reason — a `varchar` column makes Postgres render the index expression with a `::text` cast that a naive query predicate then fails to match |
| D2 | **Case folding happens in exactly one place: the database.** No `toLowerCase()` anywhere in `proveedores/*`. There is no `findByNombre` and no uniqueness pre-check — `create`/`update` let the index fire and map SQLSTATE 23505 to `supplierNameInUse()` (409), exactly as `usuarios` maps it to `emailAlreadyInUse()` | (a) Normalize in TypeScript and store/compare the folded value; (b) a `findByNombre` pre-check before the INSERT | (a) is what `usuarios.email` does and it is **deliberately not copied**, because a login identity and a display name answer different questions (proposal Decision 2): folding for storage would read "Distribuidora Norte" back as "distribuidora norte" and mangle every supplier's display name. But there is a second, sharper reason to keep folding out of TypeScript entirely: JS `String.prototype.toLowerCase` and Postgres `lower()` are **not the same function** — `lower()` is collation-dependent while `toLowerCase` follows Unicode default casing — so any code path that folds in TS and compares against a value folded by SQL is one locale away from disagreeing with its own index. Since the constraint is enforced by SQL, the comparison must be SQL's. **(b)** is the same TOCTOU class `gestion-usuarios` D9 rejects for email: two concurrent creates both find nothing, one dies on the index anyway, so the pre-check adds a round trip and still needs the 23505 handler. Consequence, recorded: `ProveedoresRepo` has **no** name-lookup method at all. When backlog #5 adds a supplier selector that needs one, it MUST be written `where lower(nombre) = lower($1)` — passing the raw input and letting Postgres fold both sides. A predicate of `nombre = $1`, `nombre ilike $1`, or `lower(nombre) = $1` with a TS-folded parameter will either miss the functional index or disagree with it |
| D3 | `nombre` and `contacto` are **trimmed at the Zod boundary** (`z.string().trim().min(1)`), so the value the service, the diff, the repo and the column all see is already trimmed. The index therefore only needs `lower(nombre)`, not `lower(trim(nombre))` | (a) Index on `lower(trim(nombre))` and store the raw string including padding; (b) trim in the service, mirroring `normalizeEmail` | The proposal's "the column stores exactly what the user typed" is about **casing**, which carries meaning; leading and trailing whitespace does not, and storing it forces every future consumer to trim on display. **(a)** would additionally make the index expression two functions deep, so every future lookup has to reproduce `lower(trim(...))` exactly or silently fall off the index — D2's failure mode, doubled. **(b)** is closer to house style but leaves `z.string().min(1)` accepting `"   "`, which trims to the empty string after validation has already passed. Trimming at the schema means the length check runs on the trimmed value, so `"   "` is a `VALIDATION_ERROR` rather than an empty supplier name. `z.string().trim()` exists in the installed Zod (verified: `zod@4.4.3/v4/classic/schemas.d.ts:101`). One residual to prove rather than assume: `.trim()` is an overwrite-style check and must survive `jsonSchemaTransform`'s conversion — S5's `pnpm contract:check` is the assertion. If it does not, the documented fallback is `.min(1).refine(v => v.trim().length > 0)` plus a `trim()` in the service, not dropping the rule |
| D4 | `isUniqueViolation()` moves **verbatim, with its comment block**, from `apps/api/src/usuarios/repository.ts:120-132` to a new `apps/api/src/lib/db-errors.ts` and is exported. `usuarios/repository.ts` gains one import line and loses the function. Behaviour is unchanged: the depth-5 `error.cause` walk and the `'23505'` test are copied character for character | (a) `apps/api/src/db/errors.ts`; (b) add it to `apps/api/src/lib/errors.ts`; (c) duplicate the walk into `proveedores/repository.ts` | **(b)** is the wrong direction of travel: `lib/errors.ts` is this app's **outbound** error vocabulary — `AppError`, the envelope, the factories a handler throws — whereas this is an **inbound** classifier for a driver error the app did not create. Mixing them makes the module answer two unrelated questions. **(a)** is defensible on cohesion (the SQLSTATE-plus-`DrizzleQueryError`-wrapping fact is driver knowledge, and `db/` owns `client.ts`) and is rejected on a specific hazard: `db/pool.ts` requires `DATABASE_URL` at import time — documented at `app.ts:53-55` as the reason `lib/env.ts` is avoided there — so putting a helper that **every** repository imports next to it invites a future barrel export that drags Postgres into the unit suite. `lib/db-errors.ts` has no imports at all and can be unit-tested with plain object literals. **(c)** is what the proposal exists to prevent; #5's unique SKU would make it three copies. **Regression safety, stated precisely**: `isUniqueViolation` currently has *no* direct test — its only coverage is indirect, through `usuarios/repository.integration.test.ts:136-170` (create and update surface `EMAIL_ALREADY_IN_USE` against real Postgres). Those two tests are **not touched**, and passing unmodified is the proof the relocation is behaviour-neutral. S1 then *adds* `lib/db-errors.test.ts`, which the codebase never had. Coverage goes up; nothing moves out from under an existing assertion |
| D5 | **`auditoria/fields.ts` MUST gain a `proveedores` entry** — `auditableFields: ['id','nombre','contacto','activo','creadoEn']`, `excludedFields: []` — and `auditoria/fields.test.ts` gains the mirrored exhaustiveness assertion against `getTableColumns(proveedores)` | Rely on the `entidadAuditoria` pgEnum, which already lists `'proveedores'` | **This corrects the proposal**, which says the audit trail needs "a call site, nothing more" because the pgEnum already covers `proveedores`. It does not. `auditoria/service.ts:8` declares `export type AuditableEntidad = keyof typeof FIELD_CLASSIFICATION`, and `fields.ts:20-35` currently has exactly one key, `usuarios`. So `recordAudit({ entidad: 'proveedores', … })` **does not compile** today, and would throw a `TypeError` at runtime if it did, because `recordAudit` destructures `FIELD_CLASSIFICATION[event.entidad]` at `service.ts:49`. This is the gate `auditoria-general` D9/D11 built working exactly as designed — an entity with no classified columns is unrepresentable — and it is a real, small work item that `sdd-tasks` must carry rather than discover during apply. `excludedFields: []` is correct and deliberate: `proveedores` has no secret column, and the empty denylist is the honest statement of that, not an oversight. The exhaustiveness test is not optional either — it is hard-coded to `usuarios` (`fields.test.ts:8-19`), so a `proveedores` entry that drifts from the table would go unnoticed without its own copy |
| D6 | `GET /api/proveedores` and `GET /api/proveedores/:id` carry `config: { roles: ['encargado', 'deposito'] }`; `POST`, `PATCH`, `/deactivate` and `/reactivate` carry `config: { roles: ['encargado'] }`. **No change to `plugins/auth.ts` is required** | Two route plugins with different guards; a bespoke per-method check inside the handler | **Verified, not assumed**: `FastifyContextConfig.roles` is typed `Array<Usuario['rol']>` (`plugins/auth.ts:17`) and the `preHandler` hook evaluates `roles && (!request.user \|\| !roles.includes(request.user.rol))` (`:92-95`). A two-element array is exactly what that mechanism already supports, per route, in one file. This is **not** a CRITICAL finding — the plugin needs no change. What is worth saying loudly instead is the character of the boundary. In the archived `pantalla-usuarios` cycle, role gating was a UI affordance and the design said so explicitly; here the 403 is a **genuine server-side authorization boundary**, enforced by a hook that runs before any handler, and it is the acceptance criterion `docs/TECH-DESIGN.md:211-212` states in those words. Two inherited interactions are documented rather than re-implemented: the forced-password-change check runs **before** the roles check (`plugins/auth.ts:85-90`), so a `deposito` user who owes a password change gets `403 PASSWORD_CHANGE_REQUIRED` on a GET, not `200`; and `proveedoresRoutes` MUST be registered **after** `authPlugin` in `app.ts`, alongside the other route plugins, or the default-deny hook silently stops covering it |
| D7 | Every write takes **exactly one** row lock: `findByIdForUpdate(id)` on the target, inside `uow.run`. There is no set lock, no predicate lock, and therefore **no lock order to document** | (a) No lock at all, relying on the single-statement UPDATE; (b) copy `usuarios`'s set-then-target ordering apparatus | The lock is not decoration and it is not the `usuarios` guard. The service reads `previo`, computes a changed-field diff, then writes — a read-then-write sequence whose audit snapshot must describe the state the write actually replaced. Without `FOR UPDATE`, two concurrent PATCHes on the same supplier each diff against a stale snapshot and file two audit rows whose `datosPrevios` never both happened. That is a **per-row** invariant, and a per-row invariant is exactly what a single row lock closes (`gestion-usuarios` D2's own framing of why the *cross-row* case needed more). **(b)** is the trap: because only one lock is ever held, there is no second resource to acquire, so no deadlock cycle exists and none of D3's ordering machinery is needed. Copying it would mean paying for a concurrency-ordering test that protects nothing |
| D8 | **There is no last-active-supplier guard**, and none is to be added. Deactivating the only active supplier returns `200` | Mirror `assertNotLastActiveEncargado` for suppliers | The `usuarios` guard exists because `sesiones.findValid` re-reads `usuarios` live on every request, so losing every active encargado locks every administrator out with no recovery path — a system-wide invariant with a genuine write-skew risk, which is why it justified a predicate lock, a total lock order, and a two-connection concurrency test. **No supplier is on any such path.** No session, no login and no administrative capability depends on a supplier being active; #5's products keep their `proveedor_id` regardless, because the row is never deleted (D14 of `TECH-DESIGN`, restated by the proposal). Writing the absence down as a decision — rather than leaving it as silence — is the point: the shapes are close enough that a later phase could invent the guard by analogy, and it would then owe concurrency tests protecting an invariant that does not exist. If a future change makes some capability depend on an active supplier, that change reopens this decision; nothing before it does |
| D9 | `list(page, pageSize)` is **two statements** — the windowed page, then a separate `count(*)::int` — ordered `desc(creadoEn), desc(id)`. **This is mirrored from `gestion-usuarios` D17, not re-derived** | Re-evaluate `count(*) over ()`; order by `creadoEn` alone | Both alternatives were already paid for in the #3 cycle and both are already known-wrong here for the same reasons. `count(*) over ()` returns **no row at all** on an out-of-range page, so `total` would read `0` for a non-empty table (`usuarios/repository.ts:191-198` records this). `desc(creadoEn)` alone is not a total order — `creado_en` defaults to `now()` and ties are routine at seed or import time — and OFFSET pagination over an order that ties is free to return a row on two pages or on none; the #3 cycle's mutation testing proved the tiebreaker was load-bearing. Suppliers are entered in batches by one person on one afternoon, so ties are *more* likely here than for users, not less. The `::int` cast stays for the same reason: node-postgres hands back `bigint` as a string |
| D10 | **No state change ⇒ no write and no audit row.** A PATCH whose values equal the current row, a deactivate on an already-inactive supplier and a reactivate on an already-active one all return `200` with the current DTO. Mirrored from `gestion-usuarios` D5 | 409 on an already-inactive deactivate; always write and always audit | The requested end state already holds, so nothing conflicts and a retry after a dropped response must not look like a failure. The real damage of the alternative is to the trail: `baja_logica` and `reactivar` name a **transition**, and a row whose diff is `{activo:false} → {activo:false}` asserts a transition that did not happen, breaking the "who deactivated this supplier" query the verbs exist for. Same reasoning, same mechanism (`changedFields` + `isEmpty`), no re-derivation |
| D11 | Deactivate and reactivate are **explicit routes**; `PATCH /api/proveedores/:id` uses `.strict()` so an `activo` key is rejected at the Zod layer, and `.refine(keys.length > 0)` so an empty body cannot answer `200` having done nothing. `PATCH` accepts `{ nombre?: string, contacto?: string \| null }` | One `PATCH` carrying `activo` | Mirrors `gestion-usuarios` D13: the path names the transition, so the audit verb is decided by which URL was called rather than inferred from a diff — and a body carrying both `nombre` and `activo` would force either two audit rows for one transaction or a lossy choice of verb. `.strict()` makes that request unreachable rather than discouraged, and it fails before any handler runs. The one shape decision that is *not* inherited: `contacto` is nullable in the column, so clearing it must be expressible — `contacto: z.string().trim().min(1).nullable().optional()` means "omit to leave alone, send a non-empty string to set, send `null` to clear", and empty string is not a third spelling of null. `changedFields` composes with this unchanged: `null !== null` is false, so clearing an already-null `contacto` is a D10 no-op |
| D12 | Two new factories in `lib/errors.ts`: `supplierNotFound()` → `SUPPLIER_NOT_FOUND` **404**, and `supplierNameInUse()` → `SUPPLIER_NAME_IN_USE` **409**. Every route declares each reachable status in its Zod `response` map | Reuse `notFoundEnvelope()`; a generic `resourceNotFound(resource)`; 422 for the name conflict | `gestion-usuarios` D14 already anticipated this exact pair — "#4/#5 add `supplierNotFound()`/`productoNotFound()` the same way" — so the factory name is settled precedent, and the wire code is the mechanical SCREAMING_SNAKE of it, matching `userNotFound()` → `USER_NOT_FOUND`. 409 rather than 422 for the same reason as `emailAlreadyInUse()`: the request is entirely valid and is refused because of the current state of the collection, which is 409's definition and is resolvable by changing that state. The codes are taken **verbatim from the ratified spec** (`specs/supplier-management/spec.md:16-22`); one naming tension this creates is recorded as an open question rather than resolved unilaterally here |
| D13 | The repository maps **any** 23505 from a `proveedores` write to `supplierNameInUse()`, without inspecting the constraint name — the same blanket mapping `usuarios` uses | Discriminate on `constraint === 'proveedores_nombre_lower_unique'` | Discrimination would be a **rewrite** of the helper D4 is relocating, and D4's whole safety argument is that the walk moves unchanged. It is also unnecessary today and provably so: `proveedores` has exactly two unique constraints, the primary key and the name index, and the primary key cannot collide because `id` is `defaultRandom()`. So every 23505 reachable from this repository is the name index. The latent limitation is real and shared with `usuarios` — the day a second unique column is added to either table, the blanket mapping mislabels — and it is carried as an open question, not fixed inside a change whose helper move must stay behaviour-neutral |
| D14 | Reads go through the pool-bound `app.repos`; only writes go through `app.uow`. The migration is generated by `drizzle-kit generate` into `drizzle/0003_*.sql` with its `meta/0003_snapshot.json`, never hand-written | Run reads inside `uow.run`; hand-write the migration SQL | Mirrors `gestion-usuarios` D17 and `auditoria-general` D4: a pair of SELECTs cannot tear, and wrapping them would take a pooled connection out of circulation for a guarantee they do not need. Hand-writing the migration would leave `meta/0003_snapshot.json` out of sync with the schema module, and the next `db:generate` would then emit a spurious second migration for a table that already exists — the drift D1 spends its length avoiding |

## Data Flow

```
GET   /api/proveedores            config: { roles: ['encargado','deposito'] }   ← D6
GET   /api/proveedores/:id        config: { roles: ['encargado','deposito'] }

  onRequest  → sid → sesiones.findValid                          401 if miss
  preHandler → debeCambiarPassword && !allowPasswordChangePending
                                          → 403 PASSWORD_CHANGE_REQUIRED  (inherited, D6)
             → rol ∉ ['encargado','deposito'] → 403 FORBIDDEN
  handler → listProveedores(app.repos, …)         ← app.repos, NOT app.uow      (D14)
              select id,nombre,contacto,activo,creado_en from proveedores
                order by creado_en desc, id desc limit $1 offset $2             (D9)
              select count(*)::int from proveedores      ← second statement     (D9)
          → 200 { data, page, pageSize, total }


POST  /api/proveedores            config: { roles: ['encargado'] }              ← D6
PATCH /api/proveedores/:id
POST  /api/proveedores/:id/deactivate | /reactivate

  preHandler → rol !== 'encargado' → 403 FORBIDDEN   ← real authorization, before any handler
  Zod        → nombre/contacto trimmed; PATCH .strict() rejects `activo`   (D3, D11)
                                          → 400 VALIDATION_ERROR

  uow.run(async (repos) => {                     db.transaction(tx => work(buildRepos(tx)))

    create:  creado = repos.proveedores.create({ nombre, contacto })
               insert … returning id, nombre, contacto, activo, creado_en
               23505 → throw supplierNameInUse()      → 409  (D2, D13)
                       ↑ raised by proveedores_nombre_lower_unique on lower(nombre)  (D1)
             recordAudit({ entidad:'proveedores', accion:'crear', usuarioId: actorId,
                           datosPrevios: null,          ← null iff crear (auditoría D7)
                           datosPosteriores: { ...creado } })

    update / deactivate / reactivate:
             previo = repos.proveedores.findByIdForUpdate(id)   ← the ONLY lock taken (D7)
               undefined → throw supplierNotFound()    → 404
             diff = changedFields(previo, cambios)
             if (isEmpty(diff)) return previo           → 200, NO write, NO audit row  (D10)
             posterior = repos.proveedores.update(id, cambios)  23505 → 409  (D13)
                       | repos.proveedores.setActivo(id, activo)   ← never DELETE  (D8)
             recordAudit({ accion: 'actualizar' | 'baja_logica' | 'reactivar',
                           datosPrevios: diff.before, datosPosteriores: diff.after })
               throws → AUDIT_WRITE_FAILED → ROLLBACK: no row change → 500
  })
  → 200/201 { proveedor: proveedorDto }        nombre reads back with ORIGINAL casing (D2)

  Case-insensitive uniqueness, end to end (D1/D2) — no TypeScript folding anywhere

    row exists:  nombre = 'Distribuidora Norte'   index key = 'distribuidora norte'
    request:     nombre = '  DISTRIBUIDORA NORTE  '
      Zod .trim()          → 'DISTRIBUIDORA NORTE'          ← stored value if it survives (D3)
      INSERT               → index computes lower(…) = 'distribuidora norte'
      Postgres             → 23505 on proveedores_nombre_lower_unique
      repo                 → supplierNameInUse()          → 409, nothing written
    the existing row still reads back as 'Distribuidora Norte' — untouched
```

## File Changes

| File | Action | Seam | Description |
|---|---|---|---|
| `apps/api/src/lib/db-errors.ts` | Create | S1 | `isUniqueViolation()` moved verbatim with its comment block, now exported (D4) |
| `apps/api/src/usuarios/repository.ts` | Modify | S1 | Delete the private copy (`:111-132`), add one import. No other change |
| `apps/api/src/db/schema.ts` | Modify | S2 | `proveedores` table + `uniqueIndex('proveedores_nombre_lower_unique')` on `lower(nombre)` (D1) |
| `apps/api/drizzle/0003_*.sql` + `meta/0003_snapshot.json` | Create | S2 | Generated by `drizzle-kit generate`; the `.sql` is reviewed, the snapshot JSON is machine-only (D14) |
| `apps/api/src/auditoria/fields.ts` | Modify | S2 | `proveedores` classification entry — required for `recordAudit` to compile (D5) |
| `apps/api/src/proveedores/repository.ts` | Create | S3 | `Proveedor`, `NuevoProveedor`, `CambiosProveedor`, `ProveedoresRepo`, `DrizzleProveedoresRepo` |
| `apps/api/src/plugins/repos.ts` | Modify | S3 | `Repos` gains `proveedores`; `buildRepos` constructs it |
| `apps/api/src/proveedores/service.ts` | Create | S4 | `listProveedores`, `getProveedor`, `createProveedor`, `updateProveedor`, `setProveedorActivo` |
| `apps/api/src/lib/errors.ts` | Modify | S4 | `supplierNotFound()`, `supplierNameInUse()` (D12) |
| `apps/api/src/routes/proveedores.ts` | Create | S5 | Six routes, split read/write roles, Zod DTOs + response maps |
| `apps/api/src/app.ts` | Modify | S5 | `app.register(proveedoresRoutes, { prefix: '/api' })` **after** `authPlugin` (D6) |
| `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts` | Modify | S5 | Regenerated by `pnpm contract`. Generated — excluded from the authored-line count |
| `apps/api/src/app.test.ts`, `plugins/auth.test.ts`, `plugins/repos.test.ts`, `routes/auth.test.ts`, `routes/usuarios.test.ts` | Modify | S3 | Mandatory stub churn — see below |

**Stub churn is not optional and must be in the forecast.** Widening `Repos` with a required
`proveedores` key breaks every fake built as an object literal and passed where `Repos` is expected.
Verified, file by file: `app.test.ts:33-71` (`fakeRepos()` → `buildApp({ repos })`, and its
`usuarios` stub uses `satisfies`, so it fails by name), `plugins/auth.test.ts:25-37`,
`routes/auth.test.ts:27-52`, `routes/usuarios.test.ts:44-…`, and `plugins/repos.test.ts:22-28`,
`:65-70`, `:82-88`. Two files are **not** affected and should not be touched:
`usuarios/service.test.ts:127` uses `as unknown as Repos`, and `auth/service.test.ts` builds against
`auth/service.ts`'s own local two-key `Repos` interface (`auth/service.ts:17-20`), not the plugin
one. This is `gestion-usuarios` D1's lesson applied in advance rather than discovered during apply.

## Interfaces

```ts
// apps/api/src/db/schema.ts — D1. The index MUST be named: drizzle-kit exits with an
// error on an unnamed expression index (drizzle-kit/api.js:22570-22576).
export const proveedores = pgTable(
  'proveedores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nombre: text('nombre').notNull(),          // text, not varchar — see D1's cast note
    contacto: text('contacto'),                // nullable: optional per TECH-DESIGN.md:69
    activo: boolean('activo').notNull().default(true),
    creadoEn: timestamp('creado_en', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('proveedores_nombre_lower_unique').on(sql`lower(${table.nombre})`),
  ],
);
```

```sql
-- The DDL drizzle-kit is expected to emit into drizzle/0003_*.sql.
CREATE TABLE "proveedores" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "nombre" text NOT NULL,
  "contacto" text,
  "activo" boolean DEFAULT true NOT NULL,
  "creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "proveedores_nombre_lower_unique"
  ON "proveedores" USING btree (lower("nombre"));

-- D2: the ONLY predicate shape that uses this index. No such lookup exists in this
-- change; this is the contract backlog #5's selector must honour when it adds one.
select … from proveedores where lower(nombre) = lower($1);
```

```ts
// apps/api/src/lib/db-errors.ts — D4, moved verbatim from usuarios/repository.ts:120-132
export function isUniqueViolation(error: unknown): boolean;

// apps/api/src/proveedores/repository.ts
export interface Proveedor {
  id: string; nombre: string; contacto: string | null;
  activo: boolean; creadoEn: Date;
}
export interface NuevoProveedor { nombre: string; contacto?: string | null }
export interface CambiosProveedor { nombre?: string; contacto?: string | null }

export interface ProveedoresRepo {
  list(page: number, pageSize: number): Promise<{ rows: Proveedor[]; total: number }>; // D9
  findById(id: string): Promise<Proveedor | undefined>;
  findByIdForUpdate(id: string): Promise<Proveedor | undefined>;   // the only lock (D7)
  create(input: NuevoProveedor): Promise<Proveedor>;               // maps 23505 → 409 (D13)
  update(id: string, cambios: CambiosProveedor): Promise<Proveedor>; // maps 23505 → 409
  setActivo(id: string, activo: boolean): Promise<Proveedor>;      // never DELETE (D8)
  // No findByNombre, deliberately (D2). No lock* method, deliberately (D7, D8).
}

// apps/api/src/auditoria/fields.ts — D5. Without this entry, recordAudit({ entidad:
// 'proveedores' }) does not compile: AuditableEntidad = keyof typeof FIELD_CLASSIFICATION.
proveedores: {
  auditableFields: ['id', 'nombre', 'contacto', 'activo', 'creadoEn'],
  excludedFields: [],   // no secret column on this table — the empty list is the claim
},
```

```
GET   /api/proveedores                200 paginated(proveedorDto) | 401 | 403
GET   /api/proveedores/:id            200 okProveedor | 401 | 403 | 404
POST  /api/proveedores                201 okProveedor | 400 | 401 | 403 | 409 | 500
PATCH /api/proveedores/:id            200 okProveedor | 400 | 401 | 403 | 404 | 409 | 500
POST  /api/proveedores/:id/deactivate 200 okProveedor | 401 | 403 | 404 | 500
POST  /api/proveedores/:id/reactivate 200 okProveedor | 401 | 403 | 404 | 500
```

The two GETs carry `roles: ['encargado','deposito']`; the four writes carry `roles: ['encargado']`
(D6). None opts into `allowPasswordChangePending`, so a user who owes a password change gets 403
`PASSWORD_CHANGE_REQUIRED` on every one of them — default-deny, inherited, not re-implemented. The
500 entry is declared wherever `AUDIT_WRITE_FAILED` is reachable (`auditoria-general` D5).

## Testing Strategy (Strict TDD — RED first, every row)

| File | Layer | What it proves | Seam |
|---|---|---|---|
| `src/lib/db-errors.test.ts` | Unit (new) | RED before the move compiles: `{ code: '23505' }` → true; `{ cause: { code: '23505' } }` → true (the Drizzle wrapping case); a 23505 at depth 4 → true and at depth 6 → false (the bound is asserted, not assumed); a self-referencing `cause` chain terminates instead of hanging; `{ code: '23503' }`, `null`, `'string'`, `undefined` → false. Coverage the codebase did not previously have (D4) | S1 |
| `src/usuarios/repository.integration.test.ts` | Integration (**unmodified**) | The regression proof for D4. `:136-170` already assert create and update surface `EMAIL_ALREADY_IN_USE` against real Postgres. Green with **zero edits** is what makes the relocation behaviour-neutral. If this file needs an edit, the move stopped being a move | S1 |
| `src/auditoria/fields.test.ts` | Unit (extend) | RED first: every `getTableColumns(proveedores)` column is classified auditable or excluded, failing by name when one is missing — mirroring the `usuarios` assertion at `:7-20`. Also asserts `recordAudit`'s type gate: `entidad: 'proveedores'` now compiles (D5) | S2 |
| `src/db/schema.integration.test.ts` | Integration (Docker PG, new) | **The constraint is only truly provable here, not against a fake.** RED before the migration exists: inserting `'Distribuidora Norte'` then `'distribuidora norte'` raises 23505; then `'DISTRIBUIDORA NORTE'` also raises it; the surviving row reads back as exactly `'Distribuidora Norte'`, character for character; a row with `activo = false` still blocks the duplicate. Plus the accented case (`'Ñandú'` vs `'ñandú'`) asserted against **whatever the database actually does**, so the collation's real behaviour is pinned rather than assumed (see the risk register). A fake repo can only prove that the code calls the database; it cannot prove Postgres agrees | S2 |
| `src/db/migration.check` | CI / manual gate | `pnpm db:generate` run twice emits **no** second migration — the D1 round-trip claim, proven rather than argued | S2 |
| `src/proveedores/repository.integration.test.ts` | Integration (Docker PG) | `list` paginates, totals correctly, and returns the right `total` on an **out-of-range page** (the D9 windowed-count trap, asserted as a value not a comment); order stays stable across pages when `creado_en` ties (D9); `findByIdForUpdate` returns the row and holds `for update`; `create` and `update` surface `SUPPLIER_NAME_IN_USE`, not a raw pg error (D13); `setActivo(false)` leaves the row present and readable (D8); `update` of `contacto` to `null` clears it (D11) | S3 |
| `src/plugins/repos.test.ts` | Unit (extend) | `buildRepos` returns a `proveedores` member bound to the given executor; the injected-fakes case includes it | S3 |
| `src/proveedores/service.test.ts` | Unit (fake repos + `{ run: (work) => work(stubs) }`) | Empty diff → no repo write **and** no `recordAudit` call, 200 (D10); already-inactive deactivate and already-active reactivate → same; `findByIdForUpdate` returning `undefined` → `SUPPLIER_NOT_FOUND` before any write (D7); every mutation's repo calls occur inside a **single** `run`; `crear` audit has `datosPrevios === null`; update audit carries changed fields only, in both directions; **and the D8 negative** — deactivating the only active supplier succeeds and records `baja_logica`, with no guard consulted and no lock-set method existing on the port to consult | S4 |
| `src/lib/errors.test.ts` | Unit (extend) | `supplierNotFound()` → 404 `SUPPLIER_NOT_FOUND`, `supplierNameInUse()` → 409 `SUPPLIER_NAME_IN_USE`, no `details`, and `toErrorEnvelope` maps both (D12) | S4 |
| `src/routes/proveedores.test.ts` | Unit (`buildApp({ repos, uow, cookieSecret })` + `inject`) | The full 6×role matrix: `deposito` → **200** on both GETs and **403 FORBIDDEN** on all four writes; unauthenticated → 401 on all six; a flagged user → 403 `PASSWORD_CHANGE_REQUIRED` on all six (D6); `PATCH` with `activo` → 400 `VALIDATION_ERROR`; `PATCH` with `{}` → 400; `nombre: '   '` → 400 after trimming (D3); `contacto: null` accepted, `contacto: ''` rejected (D11) | S5 |
| `src/routes/proveedores.integration.test.ts` | Integration (real app + Docker PG, no stubs) | The authorization boundary with a **real `deposito` session**, not a stubbed one: the write is refused *and* the table and `auditoria` are unchanged afterwards (D6); exactly one `auditoria` row per mutation with `entidad = 'proveedores'` and the right verb; a duplicate name differing only in case returns 409 through the HTTP layer and the existing row's casing is intact; a deactivated supplier is still `200` on `GET /:id` with `activo = false` (D8); a forced audit-insert failure leaves the row unchanged and returns 500 `AUDIT_WRITE_FAILED` | S5 |
| Contract | CI | `pnpm contract:check` byte-identical in S1–S4; in S5 the six paths and every declared status appear in `openapi.json` and `schema.d.ts` — which is also the assertion that Zod `.trim()` survives `jsonSchemaTransform` (D3) | all |

Integration files match `*.integration.test.ts`, are excluded from the default `vitest.config.ts`
`include`, and run against real Docker Postgres with `fileParallelism: false`
(`vitest.integration.config.ts:16`) — new files truncate `proveedores` in `beforeEach` and must not
re-enable parallelism.

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `drizzle-kit` re-emits the expression index on every `db:generate`, producing spurious migrations | Low | Migration noise; a reviewer cannot tell a real schema change from drift | D1's argument is that `generate` diffs snapshot-against-snapshot from one serializer, and this project never runs `push`/`pull`. Argument is not proof: S2 carries the double-`db:generate` gate. If it does drift, the fallback is the D1(b) generated column, whose cost is known and priced |
| Postgres `lower()` under the database's actual collation does not fold accented characters, so `'Ñandú'` and `'ñandú'` are stored as two suppliers | **Medium** | A dropdown shows two rows a person cannot tell apart — the exact defect the constraint exists to prevent, surviving it | **Measured on 2026-08-28 and did not materialise**: the running container reports `datcollate = datctype = en_US.utf8`, and `lower('ÑANDÚ') = 'ñandú'` is true, so accented pairs collide as intended. The risk is retained here because it is environment-dependent, not code-dependent: a database initialised with `C` collation would fold ASCII only. S2's RED test asserts the **real** behaviour for an accented pair, so the truth is recorded in a test rather than believed. If ASCII-only folding is confirmed and unacceptable, the fix is a nondeterministic ICU collation or `unaccent`, and it is a follow-up change with its own migration — not a silent widening of this one |
| A later phase adds a `findByNombre` written as `nombre = $1` or `lower(nombre) = $1` with a TS-folded parameter | Medium | Sequential scan, or a lookup that silently disagrees with its own unique index | D2 states the required predicate shape explicitly and gives the reason. There is deliberately **no** name-lookup method on the port for a later phase to "just extend" |
| A later phase reintroduces a last-active-supplier guard by analogy to `usuarios` | Medium | Concurrency machinery and tests protecting an invariant that does not exist | D8 records the absence as a decision with its reasoning, the proposal records it, and `service.test.ts` carries the positive assertion that deactivating the only active supplier succeeds |
| The proposal's "the audit trail needs a call site, nothing more" is taken at face value | **Was High before D5** | `recordAudit({ entidad: 'proveedores' })` does not compile; discovered mid-apply | D5 corrects it with the evidence (`auditoria/service.ts:8`, `fields.ts:20-35`) and makes the `FIELD_CLASSIFICATION` entry an S2 work item with its own exhaustiveness test |
| Widening `Repos` breaks five test files, and the churn is not in the forecast | **Was High** | The same 17–165% underestimate as the last cycle, from the same cause | The five affected files and the two unaffected ones are enumerated by line in File Changes, and the churn is priced into S3 |
| Zod `.trim()` does not survive `jsonSchemaTransform`, breaking `openapi:generate` | Low | S5 cannot regenerate the contract | D3 names the fallback (`.refine` + service-level trim) rather than leaving the phase stuck. `contract:check` is the detector |
| The blanket 23505 mapping mislabels a future second unique constraint | Low | A wrong 409 code on some future column | D13 states the limitation and why fixing it inside a behaviour-neutral helper move would be wrong. Carried as an open question |
| The 403 read/write split is treated as a UI concern, as role gating was in `pantalla-usuarios` | Low | A real authorization boundary reviewed as cosmetic | D6 states the difference explicitly, and `routes/proveedores.integration.test.ts` proves it with a real `deposito` session against real Postgres — including that nothing was written |

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
The one security-relevant boundary this change introduces is the `deposito` read / `encargado` write
split (D6), and it is addressed by an enforcement mechanism with dedicated RED tests at both the unit
and integration layer, not by prose.

## Migration / Rollout

**One migration**, generated by `pnpm db:generate` into `apps/api/drizzle/0003_*.sql` with its
`meta/0003_snapshot.json`. It creates the `proveedores` table and the
`proveedores_nombre_lower_unique` functional index. No enum value is added — `entidadAuditoria`
already lists `'proveedores'` (`db/schema.ts:69-73`) — and no existing table or column changes.

**No Postgres extension is required** (D1), and therefore **no manual user step**: `citext` was
rejected partly to avoid one. No new environment variable. `DATABASE_URL` already exists and is the
only input. If the accented-folding risk above resolves against the default collation, the follow-up
fix *would* introduce a manual step, which is one more reason it belongs in its own change.

Rollback is a revert of the commits plus rolling back the migration. Everything is additive except
the S1 relocation, which is behaviour-neutral. Nothing reads the new routes until a supplier UI or
backlog #5 ships.

### Changed-line forecast (authored additions + deletions)

Excluded as generated: `openapi.json`, `apps/web/src/api/schema.d.ts`, and
`drizzle/meta/0003_snapshot.json`. The migration `.sql` **is** counted — it is short and reviewed.

| Seam | Source | Tests | Total | Over 400? |
|---|---|---|---|---|
| S1 — `isUniqueViolation` extraction | ~50 | ~90 | **~140** | No |
| S2 — schema, migration, audit classification | ~45 | ~105 | **~150** | No |
| S3 — repository + `Repos` widening + stub churn | ~165 | ~235 | **~400** | **At budget** |
| S4 — service + error factories | ~150 | ~230 | **~380** | No |
| S5 — routes + contract | ~165 | ~480 | **~645** | **Yes, alone** |
| **Chain total (floor)** | ~575 | ~1140 | **~1715** | **Yes** |

**This is a floor, stated as one.** On the #3 cycle the design-stage forecast was ~1250 against
~2110 actual — a 69% miss — and on the #3.1 cycle `sdd-tasks` missed by 17% to 165%, every time
because integration-test weight was not in the estimation model. The table above already loads
integration tests heavily (they are ~60% of the test column), which is the correction. Applying the
residual of the #3 calibration to the test-heavy seams gives a realistic band of **~1700–2400
authored lines**. Plan against the upper end.

Two seams are already at or over the budget on their own, which is a fact for `sdd-tasks` to route
around, not a chain this design is deciding: S3 because the repository's integration suite and the
five-file stub churn arrive together, and S5 because the route file, the 6×role unit matrix and the
real-session integration suite all land in the same seam. S5 has an obvious internal split (routes +
unit matrix | integration suite) and S3 has a weaker one (wiring + stubs | repository + integration
suite). **The seams above are dependency boundaries, not PR boundaries.** `sdd-tasks` owns the PR
chain and the final forecast; these numbers are this design's estimate, not its output.

```
Decision needed before apply: Yes
Chained PRs recommended: Yes
400-line budget risk: High
```

## Open Questions

- [x] **The database's collation, and therefore what `lower()` actually folds.** **Answered by
      measurement on 2026-08-28**, against the running container rather than inferred from the
      compose file:

      ```
      datcollate | datctype  →  en_US.utf8 | en_US.utf8
      lower('ÑANDÚ')         →  ñandú
      lower('ÑANDÚ') = 'ñandú'   →  true
      ```

      The image does not fall back to `C`. Accented folding works, so `'Ñandú'` and `'ñandú'`
      collide exactly as intended and the Medium risk in the register does not materialise in this
      environment. No ICU collation or `unaccent` follow-up is needed.

      **The caveat that survives**: this measures the local Docker instance. A deployment whose
      database was initialised with `C` collation would fold ASCII only and behave differently.
      That is precisely why S2's RED test still asserts the accented pair against whatever the
      database actually does — the test is what keeps this true in every environment, and a failure
      there is a real signal about that environment, not a flaky test to relax.
- [ ] **Wire-code language.** `SUPPLIER_NOT_FOUND` and `SUPPLIER_NAME_IN_USE` are taken verbatim
      from the ratified spec and are the mechanical SCREAMING_SNAKE of the factory names
      `gestion-usuarios` D14 already anticipated. But `SUPPLIER_NAME_IN_USE` is fully Spanish
      while `EMAIL_ALREADY_IN_USE` is fully English, and `nombre` is a field name, not the domain
      entity noun the naming rule exempts. Changing a ratified wire code needs a spec delta, not a
      design decision, so this design follows the spec. Flagged so the owner can amend before archive
      if consistency matters more than the spec's current letter.
- [ ] **`isUniqueViolation` does not discriminate on constraint name** (D13). Harmless today for both
      tables; the day either gains a second unique column the mapping mislabels. Recommend a separate
      hardening item rather than folding a rewrite into a relocation.
- [ ] **No `updatedAt`/`actualizadoEn` column on `proveedores`**, matching `usuarios`. The audit trail
      is the record of change per ADR-0012. Noted so a future reader does not read the absence as an
      oversight.
- [ ] **The list endpoint returns inactive suppliers with no way to filter them out** (proposal
      Decision 4 defers filtering). Backlog #5's selector will almost certainly want
      `?activo=true`; that is that change's decision, but it is the most likely fast-follow and is
      recorded here so it is not rediscovered as a surprise.
