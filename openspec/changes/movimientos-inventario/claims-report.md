# Claims Report: movimientos-inventario

**Verified revision:** `7d0dedbfff2c3f94ac98df961af52c4b4f9cbb67`
**Verified on:** 2026-08-30
**Sources:** `tasks.md` (55 ticked checkboxes), PR #90–#100 bodies, `CLAUDE.md`, `docs/TECH-DESIGNv2.md`

Claims were extracted verbatim and handed to a cold verifier that received the statements
and nothing else — no report, no rationale, no author summary, and no indication of which
ones were expected to hold. Steps 3–5 of the harness (read the lines, run the command,
mutate before trusting) were performed by that verifier; the three REFUTED verdicts were
then independently re-checked by the orchestrator before being written down here.

Seven claims were settled by mutation: the covered behaviour was broken on purpose, the
named suite run, the observed failure count compared against the claimed one, and the
mutation reverted and the revert verified with `git diff --exit-code`. `git status --short`
is empty at the revision above.

| # | Claim (verbatim) | Source | How it was proven | Verdict |
| --- | --- | --- | --- | --- |
| 1 | "`AuditableEntidad = keyof typeof FIELD_CLASSIFICATION` (`apps/api/src/auditoria/service.ts:10`, keys confirmed: `usuarios`, `proveedores`, `productos`) has exactly three keys." | `tasks.md:25-27` | read `auditoria/service.ts:10` and `auditoria/fields.ts:20-60`; cited `:8` corrected to `:10` here and in `CLAUDE.md:95` — see below | CONFIRMED |
| 2 | "`productNotFound()` already exists in `apps/api/src/lib/errors.ts:189-191`" | `tasks.md:18` | read `errors.ts:189-191` | CONFIRMED |
| 3 | "`aplicarDelta` (`productos/repository.ts:205-218`) is not touched by any task below." | `tasks.md:36` | read `repository.ts:205-218`; `git diff 5d7d37d..HEAD` on the file is empty | CONFIRMED |
| 4 | "No `recordAudit` call anywhere in `movimientos/service.ts`" | `tasks.md:31-33` | read all 141 lines, imports included | CONFIRMED |
| 5 | "Exactly one `uow.run` per `registrarMovimiento` call … No `try`/`catch` inside it … `stockResultante` is `aplicarDelta`'s return value, verbatim." | `tasks.md:34-35` | read `movimientos/service.ts:88-141` against `productos/service.ts:67-135` | CONFIRMED |
| 6 | "No code follows it but the return" (the #10 `SAVEPOINT alertas` seam) | PR #93 | read `movimientos/service.ts:132-139` | CONFIRMED |
| 7 | The four routes and their `config.roles` (ajuste `encargado`-only) | PR #94 | read `routes/movimientos.ts:143-246` | CONFIRMED |
| 8 | "`config.roles` is checked in `plugins/auth.ts:92-95`, which throws a plain `forbidden()` with no per-route override" | PR #94 | read the whole preHandler, `auth.ts:72-96` | CONFIRMED |
| 9 | "`details: { available }`, ENGLISH key, not `disponible`" / "Reason code is `MOVEMENT_REASON_REQUIRED`" | `tasks.md:10,14` | read `errors.ts:233-237,253-259` and `errorMessages.ts:8-14` | CONFIRMED |
| 10 | "`MOTIVO_MIN_LENGTH = 3`, trimmed, `max(500)`." | `tasks.md:11` | read `routes/movimientos.ts:27-32` and web `schemas.ts`; the missing web ceiling was found here and closed — see below | CONFIRMED |
| 11 | "`esMerma` is not a key the entrada body accepts, and `esDiscrepancia` is not one the entrada or salida bodies accept." | PR #94 | read `routes/movimientos.ts:43-56`; corroborated by mutation #33 | CONFIRMED |
| 12 | "The six codes are `FORBIDDEN`, `MOVEMENT_REASON_REQUIRED`, `VALIDATION_ERROR`, `PRODUCT_NOT_FOUND`, `PRODUCT_INACTIVE` and `INSUFFICIENT_STOCK`" | PR #96 | read `errorMessages.ts:26-48` — exactly six cases plus a default | CONFIRMED |
| 13 | "`NuevoMovimiento.esMerma: boolean` **required**" | `tasks.md` 2.2 | read `movimientos/repository.ts:19-29` | CONFIRMED |
| 14 | "`es_merma boolean NOT NULL DEFAULT false` … plus two CHECK constraints" | PR #90 | read `drizzle/0005_mature_the_renegades.sql:1-3` and `schema.ts:204,239-246` | CONFIRMED |
| 15 | "`Modal.module.css` gains a single line … `Modal.tsx` itself is untouched. The only other consumer is `CredentialDialog.tsx` … the only `position: absolute` rules in the app belong to this new modal" | PR #97 | four separate checks: `git diff` on both files, import grep, `position:` grep across every web CSS file | CONFIRMED |
| 16 | The modal's audit note text, verbatim | PR #97 | read `MovimientoModal.tsx:52-53,405` — byte-identical | CONFIRMED |
| 17 | "**hidden rather than disabled** for an inactive product per D10" | PR #99 | read `productosDetalle.tsx:146-174` — the trigger is inside `producto.activo ? … : null` | CONFIRMED |
| 18 | "**No edit and no delete affordance anywhere.** The ledger is append-only" | PR #99 | read all of `MovimientosTable.tsx` and `productosDetalle.tsx`; `routes/movimientos.ts` registers one GET and three POSTs, no PATCH/PUT/DELETE | CONFIRMED |
| 19 | "Route module owns `useRegistrarMovimiento` and `movimientosErrorMessage`" | `tasks.md` 8.3 | read `productosDetalle.tsx:13,16,61,71`; `MovimientoModal.tsx` imports neither; matches `productosNuevo.tsx` | CONFIRMED |
| 20 | "`docs/TECH-DESIGNv2.md:137-140` (A9) ratifies that on registering an ajuste the user indicates whether it is an inventory discrepancy" | PR #98 | read the cited range — the A9 marker and the behaviour are both there | CONFIRMED |
| 21 | "`git log --name-only 5d7d37d..431fe3b` lists no `.env*` path … no new `process.env.*` read" | `tasks.md:522-523` | ran both git checks; each returns nothing. No `.env*` file was opened | CONFIRMED |
| 22 | "Every one of the ten PRs (#90-#99) … targeted `main` directly, so no PR ever had another PR's branch as its base." | `tasks.md:524-526` | `gh pr view` on all ten returns `baseRefName: main`; `git merge-base M^1 M^2 == M^1` for all ten merge commits | CONFIRMED |
| 23 | "Domain errors … are thrown before `MovimientosRepo.create`, never derived from a caught CHECK violation." | `tasks.md:36-38` | read `movimientos/service.ts:41-53,95,111,114` and `repository.ts:52-74` | CONFIRMED |
| 24 | api unit suite is at **332** passing | `tasks.md` 4.5 / PR #94 | ran `pnpm test` in `apps/api`: 27 files, 332 passed, exit 0 | CONFIRMED |
| 25 | api integration is at **135/135** against real Docker Postgres | `tasks.md` 5.4 / PR #95 | container healthy; ran `pnpm test:integration`: 15 files, 135 passed, exit 0 | CONFIRMED |
| 26 | web suite is at **247/247** | `tasks.md` 8.4 / PR #99 | ran `pnpm test` in `apps/web`: 44 files, 247 passed, exit 0 at `7d0dedb`. Now **250/250** — the fix for claim 10 added three tests | CONFIRMED |
| 27 | "`pnpm typecheck`, `pnpm lint`, `pnpm contract:check` all exit 0" | `tasks.md` 8.4 | ran all three from the root; all exit 0, `contract:check` byte-identical | CONFIRMED |
| 28 | PR #96 "web **216/216**" vs `tasks.md:310` "web: 212/212" | PR #96 / `tasks.md` 6.6 | `git log --follow` on `queries.test.ts` returns one commit, `89a4799`, the last on PR #96's branch; the file holds exactly 4 `it(` blocks; 212 + 4 = 216 | CONFIRMED |
| 29 | `tasks.md:480` "239 baseline + 8 new" and `tasks.md:454` "8 new tests (all 8 route-level + the file's existing 5 unaffected)" | `tasks.md` | counted `it(` blocks: 5 at `fedefc4`, 13 at HEAD; `tasks.md:454`'s two parentheticals corrected here — see below | CONFIRMED |
| 30 | "Re-running it now fails **three** tests: S6's two structural guards, and this slice's behavioural one" | PR #99 | mutated `queries.ts` list key out from under `lists()`; observed exactly 3 failures, the named ones; reverted, suite green at 247 | CONFIRMED |
| 31 | "deleting the `!producto.activo` branch … → **1 failure**" | PR #93 | mutated `movimientos/service.ts`; observed exactly 1 failure, the `productInactive` precedence test; reverted | CONFIRMED |
| 32 | "widening ajuste's `config.roles` to include `deposito` → **1 failure**, the RBAC test" | PR #94 | mutated `routes/movimientos.ts:246`; observed exactly 1 failure, the RBAC test; reverted | CONFIRMED |
| 33 | "removing `.strict()` from the entrada and salida bodies → **3 failures**, the unknown-key tests" | PR #94 | mutated both bodies; observed exactly 3 failures, all unknown-key; reverted, suite green at 332 | CONFIRMED |
| 34 | "added `eleccion: 'entrada'` to `defaultValues` … **1 failure**" | PR #97 | mutated `MovimientoModal.tsx:199-204`; observed exactly 1 failure, the named test; reverted | CONFIRMED |
| 35 | "forced `esDiscrepancia: false` in the wire mapper … **2 failures**, one at the component level and one at the pure mapper" | PR #98 | mutated `toWireSubmission`; observed exactly 2 failures, splitting component/pure exactly as claimed; reverted | CONFIRMED |
| 36 | "added a `recordAudit` call … Proof 5 failed with `expected 1 to be +0`" and "That mutation compiles, typechecks and lints clean." | PR #95 | mutated `movimientos/service.ts` against real Postgres: exactly 1 integration failure with that exact assertion text, while `pnpm typecheck` and `pnpm lint` both exit 0 under the mutation; reverted, integration green at 135 | CONFIRMED |

**Confirmed:** 36 · **Refuted:** 0 · **Unverifiable:** 0

The table above records the settled state. Three of those rows were **REFUTED on the first
pass** and are shown as confirmed only because the false statements were corrected, not
because they were re-read more charitably. What the gate actually caught is below; it is
the part of this report worth keeping.

## What this gate caught

Three claims were false at `7d0dedb`. Two were bookkeeping; one was a reachable defect no
suite, typecheck or lint run would ever have reported.

### 1 — a stale citation, in the one file where it teaches

`tasks.md:25` and **`CLAUDE.md:95`** both cited
`apps/api/src/auditoria/service.ts:8`. The declaration
`export type AuditableEntidad = keyof typeof FIELD_CLASSIFICATION;` is at
**`auditoria/service.ts:10`**, not `:8`; line 8 is a comment. The substantive half of the
claim holds — `auditoria/fields.ts:20-60` defines exactly three keys, `usuarios` (:21),
`proveedores` (:37) and `productos` (:46).

This is a **stale citation, not a false statement**. `git show bdbc829` puts the
declaration at line 8; commit `94adf49` (the SEC-012 security work) inserted two comment
lines above it and moved it to 10. The citation was never re-read afterwards.

This cycle did not introduce the drift, but it copied it forward — and the `CLAUDE.md`
occurrence is the one that matters. That paragraph exists to teach the next agent where the
real audit compile gate lives, and it was pointing two lines above it.

**Fixed:** both citations now read `service.ts:10`.

### 10 — "`MOTIVO_MIN_LENGTH = 3`, trimmed, `max(500)`."

Written at `tasks.md:11` as a RECONCILE resolution binding the whole cycle. It holds on the
API: `routes/movimientos.ts:27-32` is
`z.string().trim().min(MOTIVO_MIN_LENGTH).max(500).optional()`, all three properties present.

It **fails on the web**. `apps/web/src/features/movimientos/schemas.ts` (all 59 lines read)
carries `MOTIVO_MIN_LENGTH = 3` (:11) and `z.string().trim()` (:36) with the minimum
enforced in the `superRefine` (:38-48) — but there is **no `.max(500)` anywhere in the
file**.

The consequence is a real, reachable behaviour, not a stylistic gap: a motivo of 501
characters passes the browser-side form, is submitted, and comes back from the server as a
generic `VALIDATION_ERROR`. The operator is told nothing about a length limit and loses the
text they typed. The server boundary holds — nothing invalid is persisted — so this is a UX
defect, not a data-integrity one.

This is the finding that justifies the gate. Every suite was green, `typecheck` and `lint`
exited 0, and `contract:check` was byte-identical — the gap lived in the space between two
schemas that no single check compares.

**Fixed**, in TDD order, as its own slice:

- RED first: three cases added to `schemas.test.ts` — 501 characters refused on an `ajuste`,
  exactly 500 accepted, and 501 refused on an `entrada`, the choice where the minimum never
  fires and a test written only against `ajuste` would have missed it. Two failed on the
  first run; the third passed vacuously, because `MOTIVO_MAX_LENGTH` did not exist yet and
  `'x'.repeat(undefined + 1)` is the empty string. It became real once the constant landed.
- GREEN: `MOTIVO_MAX_LENGTH = 500` and `.max(MOTIVO_MAX_LENGTH, 'Máximo 500 caracteres.')`
  on `motivo`, unconditional across every `eleccion`, mirroring the API.
- Mutation probe: changed the ceiling to `MOTIVO_MAX_LENGTH + 1` — the off-by-one someone
  actually writes. Exactly **2 tests failed**, both 501 cases, while "exactly 500 accepted"
  stayed green. That is the proof the boundary is exact rather than merely present.
  Reverted; `git diff --exit-code` clean.

Web suite 247 → **250**.

### 29 — "239 baseline + 7 new, plus one fixture fix"

Written in PR #99's body. `apps/web/src/routes/productosDetalle.test.tsx` holds **5** `it(`
blocks at `fedefc4` (the commit before S8) and **13** at HEAD, and `git diff` on that range
shows 8 added and 0 removed. PR #99 touched three web files and no other test file gained a
case.

So **8 tests were added, not 7**, and the PR body contradicts its own total: 239 + 7 = 246,
while the same paragraph reports 247.

`tasks.md:480` ("239 baseline + 8 new") is correct and its arithmetic closes.
`tasks.md:454` gets the headline right — "8 new tests" — but both of its parentheticals are
wrong: all 8 are route-level, not 7, and the file's pre-existing count was **5**, not 6.

Nothing here changes what the code does or what the suite proves. Three artifacts describe
the same eight tests and two of them miscount, which is exactly the class of small false
statement this gate exists to stop before it is archived as history.

**Fixed:** `tasks.md:454` now reads "8 new tests (all 8 route-level + the file's existing 5
unaffected)". `tasks.md:480` was already right and is untouched.

**Left standing on purpose:** PR #99's merged body still says "239 baseline + 7 new, plus
one fixture fix". It is a historical record of what was claimed at merge time, not an
artifact archived with this cycle, and the correct figure is recorded here. Editing a merged
PR body is an outward-facing change to a public record and was not taken unilaterally.

## A bootstrap limitation in the harness itself, worth recording

`hooks/claims_gate.py` refuses a merge when the report's `Verified revision` is not `HEAD`.
That check cannot be satisfied by the commit that introduces the report: writing a sha into
the file changes the file, which changes the sha. Any amend chases its own tail.

The gate is currently **inert** for this cycle — `closing_cycles()` arms only once the folder
carries `verify-report.md` or `archive-report.md`, and it carries neither. So this does not
block anything today. It will need a deliberate answer when `sdd-verify` runs, and the answer
must not be to weaken the hook: the revision line is what stops a report describing code that
has since moved.
