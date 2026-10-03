# Design: Last-Encargado Rescue Procedure (`rescate-encargado`, closes D-02)

## Technical Approach

Two small, behaviour-preserving changes to existing code unlock one new operator path:

1. `recordAudit` resolves the pseudonym key lazily, at the single line that computes an HMAC (D1).
2. `resetUsuarioPassword` gains an optional third parameter that adds `origen` to
   `datosPosteriores` (D2).
3. `rescatarEncargado` (`apps/api/src/usuarios/rescate.ts`) runs a read-only check phase, then
   delegates the write to `resetUsuarioPassword` unchanged (D4-D6).
4. `apps/api/scripts/rescatar-encargado.ts` is argument parsing, a target printout and result
   rendering around that function (D7-D8).

No migration, no schema change, no route, no OpenAPI change (`pnpm contract` must stay
byte-identical).

**Facts verified at the source that correct or sharpen the proposal:**

- The marker passes every layer untouched. The runtime filter is a denylist (`filterExcluded`,
  `auditoria/service.ts:41-49`); `auditableFields` is consumed only by `fields.test.ts`
  (`auditoria/fields.ts:3-8`, `fields.test.ts:9-22`, which compares against real table columns, so
  `origen` must NOT be added there). `DrizzleAuditoriaRepo.record` inserts the snapshot as given
  (`auditoria/repository.ts:66-75`); the only CHECK is `datos_previos is null` iff `crear`
  (`db/schema.ts:136-139`); the read DTO is `z.record(z.string(), z.unknown())`
  (`routes/auditoria.ts:45-46`). **No fix is needed anywhere for `origen`.**
- `findByEmail` is on `UsuariosRepo` (`usuarios/repository.ts:54`, adapter `:128-135`): an exact
  `eq(usuarios.email, email)`, no lock, returning the full `Usuario` including `hashContrasena`.
  It works inside a transaction (`buildRepos(tx)`, `plugins/repos.ts:46-57`), but see D5 for why
  the rescue does not call it there.
- `resetUsuarioPassword` owns its own `uow.run` (`usuarios/service.ts:284`). `UnitOfWork.run` is
  `db.transaction` on the pool (`db/uow.ts:81-85`), so wrapping it in an outer `uow.run` that
  holds a row lock would open a second connection that blocks on the first one forever. This rules
  out "checks and reset in one transaction" without restructuring the reset.

## Architecture Decisions

### D1 — Lazy pseudonym key: resolve at the HMAC site, not per entity

Today (`auditoria/service.ts:121-137`) the key is resolved whenever the entity *has*
`pseudonymizedFields`, before any snapshot is inspected. Replace that with a key *provider* that is
only invoked inside the branch that hashes a value.

```ts
// one loop, one HMAC site; the exported function keeps its signature
function pseudonymizeWith(
  data: Record<string, unknown>,
  pseudonymizedFields: readonly string[],
  getKey: () => string,
): Record<string, unknown> {
  const result = { ...data };
  for (const field of pseudonymizedFields) {
    const value = result[field];
    if (typeof value === 'string') {
      const digest = createHmac('sha256', getKey())   // <- only caller of getKey
        .update(PSEUDONYM_DOMAIN_TAG + value)
        .digest('hex');
      result[field] = `${PSEUDONYM_PREFIX}${digest}`;
    }
  }
  return result;
}

export function pseudonymizeFields(data, pseudonymizedFields, key: string) {
  return pseudonymizeWith(data, pseudonymizedFields, () => key);
}

// recordAudit
const { excludedFields, pseudonymizedFields } = FIELD_CLASSIFICATION[event.entidad];
let key: string | undefined;
const getKey = (): string => (key ??= resolvePseudonymKey()); // at most once per call
const applyClassification = (data: Record<string, unknown>) =>
  pseudonymizeWith(filterExcluded(data, excludedFields), pseudonymizedFields ?? [], getKey);
```

`hasPseudonymizedFields`, `pseudonymKey` and the `pseudonymKey && pseudonymizedFields ? … : filtered`
ternary are deleted. `resolvePseudonymKey` (`:99-107`) is unchanged.

| Option | Tradeoff |
|---|---|
| Pre-scan predicate in `recordAudit` (`fields.some(f => typeof data[f] === 'string')`) then call today's code | Two copies of the "is this a value to hash" predicate. If they drift, a string can skip hashing — the exact weakening the proposal's risk table names. |
| Script sets a throwaway `COOKIE_SECRET` | Rejected by the pinned decision; also makes a wrong key look valid. |
| **Key provider called at the HMAC site** (chosen) | One predicate, one HMAC line, no "skip" branch left in the code. |

**Why this cannot weaken pseudonymization.** Invariant: *no string stored under a listed field
reaches `repo.record` without passing through `createHmac`.* The only code that leaves a listed
field in the result is the loop above. For a string value the loop evaluates `getKey()`, which
returns a non-empty key or throws (`!key` covers unset and `''`) — and it throws while building
`filteredEvent`, before `repo.record`, so nothing is written and the enclosing `uow.run` rolls
back. For non-string values (absent, `null`) the loop is a no-op today as well
(`service.test.ts:82-95`). Every event that succeeded before produces byte-identical snapshots
(same key, tag and digest). The only behavioural difference: a `usuarios` event with no string
`email` in either snapshot no longer needs the key. The new code is strictly stronger in one
respect — the old ternary had a (then unreachable) path that returned un-hashed data on a falsy
key; the new code has no such path.

Not changed, noted: the loop is shallow (a nested `{ usuario: { email } }` was never hashed) and a
non-string `email` passes through. Both are pre-existing.

Comment updates only: `service.ts:89-98` and `vitest.config.ts:25-30` ("every unit test that
exercises `recordAudit` for `usuarios` needs a value" becomes "…whose snapshot carries `email`").

### D2 — Marker plumbing: optional third positional parameter

```ts
export async function resetUsuarioPassword(
  uow: UnitOfWork,
  input: ResetUsuarioPasswordInput,
  origen?: 'rescate',
): Promise<UsuarioConPassword>

// datosPosteriores (today :315-319)
datosPosteriores: {
  debeCambiarPassword: true,
  intentosFallidos: 0,
  bloqueadoHasta: null,
  ...(origen !== undefined ? { origen } : {}),
},
```

`datosPrevios` is not touched (pinned: `datosPosteriores` only).

| Option | Tradeoff |
|---|---|
| `origen?` field on `ResetUsuarioPasswordInput` (`:44-47`) | Adds a line at `:46`, shifting every line below it. Live docs cite this file by line: `docs/SECURITY.md:87,191,490,1001,1021,1070`, `docs/DRIFT.md:355`. |
| **Third parameter** (chosen) | Literally "an optional parameter" as pinned. Every edit sits at or below `:277`; only `SECURITY.md:490`'s `:281` moves. |

**In-app rows stay byte-identical.** The only production caller is `routes/usuarios.ts:235-238`,
which passes two arguments and is not edited. With `origen === undefined` the spread contributes
`{}`, so the object has the same three keys in the same order; the key is *absent*, not
`undefined` (the conditional-spread idiom already used at `service.ts:175-177`).

### D3 — Normalization: export the existing helper, no fourth copy

`normalizeEmail` exists three times (`auth/service.ts:32-34`, `usuarios/service.ts:61-63`,
`usuarios/repository.ts:121-123`). Add `export` to the one at `usuarios/service.ts:61`
(line-neutral) and import it in `rescate.ts`.

### D4 — `rescatarEncargado`: signature and typed result

```ts
// apps/api/src/usuarios/rescate.ts
export interface RescateRepos {
  usuarios: Pick<UsuariosRepo, 'findByEmail' | 'countActiveEncargados'>;
}
export interface RescatarEncargadoInput { email: string; confirmar: boolean }

export type MotivoRechazo = 'no_encontrado' | 'no_es_encargado' | 'inactivo';
export interface ObjetivoRescate { id: string; nombre: string; email: string }

export type ResultadoRescate =
  | { estado: 'rechazado'; motivo: MotivoRechazo }
  | { estado: 'simulado';  objetivo: ObjetivoRescate; hayOtroEncargadoActivo: boolean }
  | { estado: 'rescatado'; objetivo: ObjetivoRescate; hayOtroEncargadoActivo: boolean;
      passwordTemporal: string };

export async function rescatarEncargado(
  repos: RescateRepos,   // pool-bound, read phase only
  uow: UnitOfWork,       // write phase, via resetUsuarioPassword
  input: RescatarEncargadoInput,
): Promise<ResultadoRescate>
```

`(repos, uow, input)` mirrors `crearProducto(repos, uow, …)` (`scripts/seed-demo.ts:289`).

| Option | Tradeoff |
|---|---|
| Throw `AppError`s | Needs error factories and wire codes — excluded by the pinned decision. |
| Throw plain `Error`s with Spanish text | Puts operator copy in `src/`, and a dry run ("would proceed") is not an error. |
| **Discriminated result; refusals are values** (chosen) | The core returns a *motive*; Spanish wording lives in the script. Exhaustive `switch` in the renderer. Unexpected failures (DB down, `AUDIT_WRITE_FAILED`) still throw. |

`ObjetivoRescate` is projected explicitly from the `Usuario` that `findByEmail` returns —
`hashContrasena` never leaves `rescate.ts`.

`confirmar` lives in the core, not the script, so "a dry run writes nothing" is provable on real
Postgres.

### D5 — Refusals are decided before any transaction opens

```
email = normalizeEmail(input.email)
u = repos.usuarios.findByEmail(email)        // plain SELECT
!u                    -> rechazado/no_encontrado
u.rol !== 'encargado' -> rechazado/no_es_encargado
!u.activo             -> rechazado/inactivo
hayOtro = (repos.usuarios.countActiveEncargados()) > 1   // plain SELECT
!input.confirmar      -> simulado
resetUsuarioPassword(uow, { id: u.id, actorId: u.id }, 'rescate')  // the ONLY write
                      -> rescatado
```

A refusal or dry run returns before `uow.run` is reached and before `hashPassword` runs
(`service.ts:281-282`), so "writes nothing" holds by construction: the read phase issues two
`SELECT`s and no lock, and works against a read-only role.

`actorId: u.id` is the ratified "own actor" (`auditoria.usuario_id` is NOT NULL with an FK).

New port method, appended at the END of the interface and of the adapter class:

```ts
countActiveEncargados(): Promise<number>;   // count(*)::int where rol='encargado' and activo
```

`lockActiveEncargados` (`repository.ts:241-249`) is not reused: it is `FOR UPDATE`, which is wrong
for an informational read and fails under a read-only role.

### D6 — No extra row lock

| Race | Outcome | Decision |
|---|---|---|
| Target deactivated/demoted between the check and the reset | Only another *active encargado* can do that — the situation in which the rescue is not the last resort. Worst case an inactive account gets a temporary password it cannot use (`ACCOUNT_INACTIVE`, `auth/service.ts:109-111`); the audit row is truthful. | Accept. Closing it means moving the checks under `findByIdForUpdate` inside the reset's transaction, i.e. restructuring `resetUsuarioPassword` — disproportionate. |
| Concurrent in-app reset of the same row | Serialized by the existing `findByIdForUpdate` (`service.ts:287`). Last writer wins. | Already covered. |
| Two operators run the rescue at once | Both succeed in sequence; the first printed password is dead. | Runbook note, no code. |
| Target row disappears | `UsuariosRepo` has no delete (`repository.ts:53-80`). | Unreachable. |

### D7 — Script: strict argument parsing

`parseArgs(argv): { email: string; confirmar: boolean }`, modelled on `seed-encargado.ts:15,33-48`
but stricter, because a typo here must not be silently ignored:

- Password flags `--password`, `-p`, `--contrasena`, `--clave`, in both `flag value` and
  `flag=value` forms, throw a dedicated refusal (seed's `argv.includes` misses `--password=x`).
- `--email <correo>` required; missing value or a value starting with `-` is a usage error.
- `--confirmar` is a bare boolean flag.
- Any other token is a usage error (`--confirm`, `--emial`, `--email=x`).
- The script reads no password from the environment; there is no such variable.

### D8 — Script: target guard, wiring, output, exit codes

```ts
export function describeTarget(databaseUrl: string): string  // "host[:port]/database"
```

Built from `new URL(url)`'s `hostname`, `port`, `pathname` only — never `username`, `password`,
`search`, never the raw string. An unparseable URL throws a message that does not echo the input.
`requireDatabaseUrl` and `formatError` are imported from `./seed-demo.js` (`:306-327`; its `main`
is guarded by the `import.meta.url` check at `:344-347`).

Wiring outside Fastify, as `seed-demo.ts:249-251` does:

```ts
const db = getDb();                    // lazy pool on process.env.DATABASE_URL (db/pool.ts:10-22)
const result = await rescatarEncargado(buildRepos(db), createUnitOfWork(db), args);
```

`import 'dotenv/config'` stays first, as in both seed scripts. It does not override a variable
already set in the shell, and it is the reason the target printout matters: a stray local file can
supply `DATABASE_URL` silently.

Order in `main`: parse args → `requireDatabaseUrl` → print target → `rescatarEncargado` → render.
The target line is printed **before** any query, in both modes.

| Outcome | stdout (Spanish; wording owned by spec/runbook) | Exit |
|---|---|---|
| `rescatado` | target line, name + email, temporary password **once**, "must change on first login", other-encargado note when true | 0 |
| `simulado` | target line, name + email, "SIMULACIÓN — no se escribió nada; repita con `--confirmar`", other-encargado note when true | 0 |
| `rechazado` | target line, one line per motive, "no se escribió nada" | 3 |
| usage error / `DATABASE_URL` missing or unparseable | message + usage on stderr | 2 |
| unexpected failure | `formatError(err)` on stderr | 1 |

`renderResult(result, target): { lines: string[]; exitCode: number }` is pure, so the password
appearing exactly once (and never in any other branch) is unit-testable.

`apps/api/package.json`, after `:17`: `"rescatar:encargado": "tsx scripts/rescatar-encargado.ts"`.
No root alias — the pinned invocation is `pnpm --filter @inventienda/api rescatar:encargado`.

## Data Flow

    pnpm --filter @inventienda/api rescatar:encargado --email <correo> [--confirmar]
         │ parseArgs (strict, rejects password flags)                      D7
         │ requireDatabaseUrl → describeTarget → print host/db             D8
         ▼
    rescatarEncargado(buildRepos(db), createUnitOfWork(db), {email, confirmar})
         │
         ├─ READ PHASE (pool, no tx, no lock)                              D5
         │    findByEmail(normalized) ──▶ no_encontrado | no_es_encargado | inactivo ──▶ return
         │    countActiveEncargados() ──▶ hayOtroEncargadoActivo
         │    !confirmar ───────────────────────────────────────────────▶ return 'simulado'
         │
         └─ WRITE PHASE: resetUsuarioPassword(uow, {id, actorId: id}, 'rescate')   D2
              hashPassword (outside tx)
              uow.run ─ findByIdForUpdate ─ findLockoutState ─ resetPassword
                      ─ sesiones.deleteAllForUser
                      ─ recordAudit(datosPosteriores {…, origen:'rescate'})   D1: no email → no key
              ▶ { usuario, passwordTemporal } ──▶ 'rescatado'
         ▼
    renderResult → stdout → exit code

## File Changes

| File | Action | Description | Est. lines |
|---|---|---|---|
| `apps/api/src/auditoria/service.ts` | Modify | `pseudonymizeWith`, lazy `getKey` (D1) | 30 |
| `apps/api/src/auditoria/service.test.ts` | Modify | No-key cases (Testing) | 75 |
| `apps/api/vitest.config.ts` | Modify | Comment only | 4 |
| `apps/api/src/usuarios/service.ts` | Modify | Third parameter, spread, `export normalizeEmail` (D2, D3) | 12 |
| `apps/api/src/usuarios/service.test.ts` | Modify | Marker present / absent-exact | 40 |
| `apps/api/src/usuarios/repository.ts` | Modify | `countActiveEncargados` at end of port and class (D5) | 16 |
| `apps/api/src/usuarios/repository.test.ts` | Modify | Shape test for the new method | 15 |
| fakes typed as full `UsuariosRepo` | Modify | One-line stub where typecheck demands it (candidates: the files that stub `lockActiveEncargados` — `app.test.ts`, `routes/usuarios.test.ts`, `routes/ventas.test.ts`) | 6 |
| `apps/api/src/usuarios/rescate.ts` | Create | `rescatarEncargado` (D4, D5) | 85 |
| `apps/api/src/usuarios/rescate.test.ts` | Create | Service-level with fakes | 130 |
| `apps/api/src/usuarios/rescate.integration.test.ts` | Create | Real Postgres | 200 |
| `apps/api/scripts/rescatar-encargado.ts` | Create | Wrapper (D7, D8) | 115 |
| `apps/api/scripts/rescatar-encargado.test.ts` | Create | Args, guard, renderer | 120 |
| `apps/api/package.json` | Modify | Script entry | 1 |
| `docs/*` (see Docs Changes) | Modify | Runbook, addendum, DRIFT, SECURITY, README, BACKLOG | 130 |

No change: `auditoria/fields.ts`, `db/schema.ts`, any route, `openapi.json`, `schema.d.ts`,
`seed-encargado.ts`.

## Testing Strategy

Strict TDD. `[M]` marks an assertion that must be seen red under the named mutation.

**`auditoria/service.test.ts` — existing tests that must stay green untouched:** the six
`pseudonymizeFields` tests (`:26-96`) and the six `recordAudit` tests (`:98-215`). Also the whole
of `usuarios/service.test.ts`, `auth` suites and `routes/usuarios.integration.test.ts` (the
`:415-471` rollback test in particular).

New, using `vi.stubEnv('COOKIE_SECRET', undefined)` (precedent `plugins/cookie.test.ts:36`) and
`afterEach(() => vi.unstubAllEnvs())`:

| # | Case | Expectation |
|---|---|---|
| A1 | `usuarios`, reset-shaped snapshots (no `email`), no key | resolves; `repo.record` receives the snapshots unchanged. `[M]` restore the eager resolve → red |
| A2 | `email` string in `datosPosteriores` only, no key | rejects `/COOKIE_SECRET must be set/`; `repo.record` **not called**. `[M]` make `getKey` fall back to a constant → red |
| A3 | `email` string in `datosPrevios` only, no key | same as A2. `[M]` skip classification of `datosPrevios` → red |
| A4 | `crear` with a full created row (has `email`), no key | rejects; not recorded |
| A5 | `email: null`, no key | resolves, `null` stored (documents the no-op) |
| A6 | `COOKIE_SECRET=''` with a string `email` | rejects (empty is not a key) |
| A7 | `proveedores` event, no key | resolves (pins today's behaviour) |

**`usuarios/service.test.ts`** (existing harness, `:63-142`):

| # | Case | Expectation |
|---|---|---|
| B1 | two-argument call | `datosPosteriores` **`toEqual`** the exact three-key object and `not.toHaveProperty('origen')` — the existing test at `:449-474` uses `toMatchObject` and would not catch an extra key. `[M]` make the spread unconditional → red |
| B2 | `origen = 'rescate'` | `datosPosteriores.origen === 'rescate'`; `datosPrevios` has no `origen`. `[M]` drop the spread → red |

**`usuarios/rescate.test.ts`** (fakes; a `uow` whose `run` throws if reached for refusal cases):

- Each of the three refusals returns its motive and never calls `uow.run`. `[M]` delete each
  check in turn → its test red.
- Lookup receives the normalized email for `'  ANA@Example.COM '`. `[M]` drop normalization → red.
- `confirmar: false` → `simulado`, `uow.run` never called. `[M]` ignore the flag → red.
- `confirmar: true` → `rescatado`; the audit event has `usuarioId === entidadId === target.id`
  and `origen: 'rescate'`.
- `hayOtroEncargadoActivo` is `false` at count 1 and `true` at count 2. `[M]` `> 1` → `>= 1`.
- The returned `objetivo` has no `hashContrasena` key.

**`scripts/rescatar-encargado.test.ts`:**

- `parseArgs`: every password flag in both forms throws; missing `--email`; `--email` without a
  value; unknown flag; `--confirmar` default `false`.
- `describeTarget('postgres://user:s3cret@ep-x.neon.tech:5432/db?sslmode=require')` contains host
  and database and none of `user`, `s3cret`, `sslmode`. `[M]` return the raw URL → red. Garbage
  input throws without echoing it.
- `renderResult`: the password appears in exactly one line of `rescatado` and in no line of
  `simulado`/`rechazado`; exit codes 0/0/3; `simulado` mentions `--confirmar`.

**`usuarios/rescate.integration.test.ts`** — real Postgres, `getDb()`, `truncate table auditoria,
sesiones, usuarios cascade` in `beforeEach`, `getPool().end()` in a file-scope `afterAll`
(`routes/usuarios.integration.test.ts:59-71`). Run with `COOKIE_SECRET` stubbed to `undefined`:
the integration config sets one (`vitest.integration.config.ts:25`), which would otherwise hide
D1.

| # | Case | Assertions |
|---|---|---|
| I1 | Success: encargado seeded locked (`intentos_fallidos = 5`, `bloqueado_hasta` in the future), `debe_cambiar_password = false`, one session row | hash changed and `verifyPassword(newHash, passwordTemporal)` is true; flag `true`; counters `0`/`null`; zero session rows; exactly one audit row with `usuario_id = entidad_id = target.id`, `accion = 'cambiar_password'`, `datos_posteriores.origen = 'rescate'`, no `origen` in `datos_previos`, no `hashContrasena` and no plaintext email in the row. `[M]` on the actor and marker assertions |
| I2-I4 | Unknown email / `deposito` / inactive encargado, each with `confirmar: true` | motive returned; the full `usuarios` row, the session count and the audit count are **equal before and after**. `[M]` remove the check → the row comparison (not just the motive) goes red |
| I5 | Dry run on a valid target | `simulado`; same before/after equality |
| I6 | Rollback: real `createUnitOfWork(db)` wrapped so only `auditoria.record` throws (pattern at `routes/usuarios.integration.test.ts:423-440`) | rejects with `AUDIT_WRITE_FAILED`; hash, flag, lockout and session row unchanged; zero audit rows. `[M]` swap in the unwrapped uow → red |
| I7 | `countActiveEncargados` | counts only active encargados (seed: active encargado, inactive encargado, active deposito → 1) |

The three-line `main` wiring has no automated test; the tasks phase should include one manual
rehearsal against the local container (dry run, then `--confirmar`, then log in).

## Docs Changes (list only; `docs/` is Spanish)

| File | Where | Change |
|---|---|---|
| `docs/DEPLOY-PLAN.md` | new `#### Rescate del último encargado` under `### Recovery` (`:507`), before `### Backup independiente` (`:533`) | Runbook: when to use, who may run it, operator as sole identity gate, dry run first, reading the target line, `--confirmar`, handling the printed password, the inactive-account case, the other-encargado case |
| `docs/DEPLOY-PLAN.md` | `#### Datos semilla` (`:380-386`) | One-line pointer to the runbook |
| `docs/adrs/0007-sesion-cookie-rbac-propio.md` | new `### Actualizado 2026-10-01 — …` appended at the END of the file | The `:61-63` promise is now kept by a tested script, not "resetear el hash directo en base"; link to the runbook. `:61-63` itself is not edited, so existing citations stay valid |
| `docs/DRIFT.md` | D-02 block (`:78-96`) | Rewrite as RESUELTO in D-01's shape (`:55-76`) |
| `docs/DRIFT.md` | table `:44-48`, note `:50-51`, "Resueltos" `:331-339`, "Próximos pasos" item 1 `:389-390` | Crítico 1 → 0; add the D-02 bullet; strike item 1 |
| `docs/DRIFT.md` | after D-16 (`:289`) | **D-17**: ADR-0007 `:76-79` says a correct password grants access while locked; code throws `accountLocked` (`auth/service.ts:102-107`). **D-18**: `seed-encargado.ts:85` stores the email unnormalized while login normalizes (`auth/service.ts:45-46`) |
| `docs/SECURITY.md` | recommendation 4 (`:207-208`) | Resolution note in the style of `:218` |
| `docs/SECURITY.md` | `:164` | `56-58` → `61-63` |
| `docs/DRIFT.md` | `:88` | `SECURITY.md:205` → `207` (absorbed by the D-02 rewrite) |
| `README.md` | after `:60-62` | One sentence + command, pointing to the runbook |
| `docs/BACKLOG.md` | new row after `:50` | Item closing D-02, same shape as row 15 |

## Size Estimate and PR Split

Code + tests ≈ 850 lines, docs ≈ 130, planning artifacts (proposal 127, this design, spec, tasks)
≈ 700+. Roughly **1,700 raw lines against a 400 budget — a single PR is not viable.**

| PR | Content | Est. | Standalone? |
|---|---|---|---|
| 0 | `openspec/changes/rescate-encargado/` planning artifacts | ~700 | Docs-only; needs an explicit `size:exception` |
| 1 | D1 + D2 + D3 + `countActiveEncargados`, with tests | ~200 | Yes — behaviour-preserving for every existing caller |
| 2 | `rescate.ts` + unit + integration | ~415 | Yes, but at the edge; if it overshoots, move I7 and the repo test into PR 1 |
| 3 | Script + test + `package.json` | ~240 | Yes |
| 4 | Docs + claims report | ~130 + report | Must be last — D-02 is only true once PR 3 is merged |

## Threat Matrix

N/A for all five rows (documentation-like paths, Git repository selection, commit state, push
state, PR commands): the change adds no shell command composition, subprocess, VCS/PR automation
or executable-file classification. The script is a single Node process that parses its own
`argv`. Its real security surface is covered by tests above: password flags refused (D7),
credentials never printed (D8), no write without `--confirmar` (I5), refusals write nothing
(I2-I4).

## Migration / Rollout

No migration required. No new environment variable; the script needs only a write-capable
`DATABASE_URL` and explicitly does not need `COOKIE_SECRET`. D1 ships to the API on merge of PR 1
and changes nothing observable there (the server always has `COOKIE_SECRET`). Rollback is a code
revert.

## Open Questions — resolved by the owner, 2026-10-01

- [x] **Mixed-case seeded email: out of scope.** The rescue looks up the normalized email only. An
      account stored as `Admin@Example.com` gets `no_encontrado`; it could never log in, so it is a
      broken seed, not a lost password. The runbook says so, and the seed defect is recorded as a
      new DRIFT finding. No case-insensitive fallback.
- [x] **Exit codes: D8's table stands** (`rescatado` 0, `simulado` 0, `rechazado` 3, usage 2,
      unexpected 1). The spec was amended so the preview exits zero. Refusal precedence stays
      `not found → role → inactive`; the spec does not fix an order.
- [x] **Delivery: five chained PRs**, as in the size section.
- [x] **Severity of D-17 / D-18:** both `Advertencia` by default; the owner may change it when
      reviewing the docs PR.
- [x] **Stale ADR-0007 citations:** every citation in `docs/` that points into a file this change
      touches is in scope for the docs PR, including the extra ones listed here
      (`SECURITY.md:143`, `:162`, `:1190`, and `:757,773,798,1197` after re-verification) and the
      ones this change moves. The claims gate re-checks them all.
