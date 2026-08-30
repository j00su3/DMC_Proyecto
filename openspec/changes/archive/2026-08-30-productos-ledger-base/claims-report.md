# Claims Report: productos-ledger-base

**Verified revision:** `9c887f181ad47bcabbf2f350f2f8ef4a46913631`
**Verified on:** 2026-08-30
**Sources:** verify-report.md, tasks.md, PRs #58–#80, design.md

Claims were extracted verbatim and handed to an independent verifier **cold** — the statements
and nothing else, with no report, no rationale and no summary of what their author intended.
This matters: the orchestrator that wrote `verify-report.md` also directed the implementation,
so its own verification pass is the weakest link in this cycle, and it says so in its own
caveat. The pass below is the check on that check.

It found one false statement. That is the whole point of running it.

| # | Claim (verbatim) | Source | How it was proven | Verdict |
| --- | --- | --- | --- | --- |
| 1 | "`pnpm -r test` passes 275 tests in apps/api and 194 tests in apps/web" | verify-report.md | ran it; `24 passed (24)` / `275 passed (275)`, `40 passed (40)` / `194 passed (194)` | CONFIRMED |
| 2 | "`pnpm --filter api test:integration` passes 117 tests across 14 files" | verify-report.md | ran it against the live container; `14 passed (14)` / `117 passed (117)` | CONFIRMED |
| 3 | "`pnpm typecheck`, `pnpm lint` and `pnpm contract:check` all exit 0" | verify-report.md | ran all three; exit 0 each | CONFIRMED |
| 4 | "read routes declare `roles: ['encargado','deposito']`, and both deactivate and reactivate declare `roles: ['encargado']`" | verify-report.md | read `routes/productos.ts:117,141,161,187`; `:223` inside the loop at `:216-244` covering both segments | CONFIRMED |
| 5 | "the `stock_minimo` guard tests key presence via `Object.hasOwn`, not the value, on both create and update" | verify-report.md | read `productos/service.ts:72` and `:194-196` | CONFIRMED |
| 6 | "`actualizarProductoBody` has no `stockActual` key and is `.strict()`, and `CambiosProducto` has no `stockActual` key either" | verify-report.md | read `routes/productos.ts:82-91`, `productos/repository.ts:33-40` | CONFIRMED |
| 7 | "`aplicarDelta` is exactly one conditional UPDATE, never `SELECT ... FOR UPDATE` plus a plain SET" | design.md D1 | read `productos/repository.ts:205-218` | CONFIRMED |
| 8 | "the search predicate is built once and composed into BOTH the page query and the count query" | design.md D7 | read `productos/repository.ts:94-112`; built at `:94`, used at `:104` and `:112` | CONFIRMED |
| 9 | "the inactive-supplier guard on update re-runs only when `proveedorId` is present, and a test proves a PATCH omitting it does not re-run it even when the stored supplier is inactive" | design.md D8 | read `productos/service.ts:200-210` and `service.test.ts:362`; also mutation-proved, row 23 | CONFIRMED |
| 10 | "the audit compile gate is `AuditableEntidad = keyof typeof FIELD_CLASSIFICATION`, not the pgEnum, and the pgEnum already lists `productos`" | verify-report.md | read `auditoria/service.ts:8` and `db/schema.ts:97-101` | CONFIRMED |
| 11 | "`stockActual` is in `FIELD_CLASSIFICATION.productos.excludedFields`, and `recordAudit` applies the exclusion in exactly one place" | decision R1 | read `auditoria/fields.ts:46-59` and `service.ts:45-65`; repo-wide search found no other production call site | CONFIRMED |
| 12 | "`setActivo` updates `activo` and nothing else, and never issues a DELETE" | verify-report.md | read `productos/repository.ts:193-200` | CONFIRMED |
| 13 | "the migration creates a unique index on `lower(sku)` and carries both `movimientos` CHECK constraints" | verify-report.md | read `drizzle/0004_legal_shinobi_shaw.sql:13-19,39` | CONFIRMED |
| 14 | "`productos.proveedor_id` is NOT NULL" | decision R3 | read `0004_legal_shinobi_shaw.sql:30` and `db/schema.ts:174-176` | CONFIRMED |
| 15 | "the client PATCH body carries only fields the user touched, using `formState.dirtyFields`" | PR #78 | read `features/productos/schemas.ts:102-123` and `ProductoForm.tsx:53,64` | CONFIRMED |
| 16 | "the edit form renders no initial-stock input at all — absent, not disabled" | ADR-0012 rule 1 | read `ProductoForm.tsx:122-129`; the field is inside `{resolvedMode === 'create' && (...)}` | CONFIRMED |
| 17 | "`estadoStock` returns `quiebre` / `bajo` / `ok` per D9, so `stockMinimo === null` can never be `bajo`" | design.md D9 | read `features/productos/format.ts:9-16` | CONFIRMED |
| 18 | "`errorMessages.ts` maps six distinct codes to six distinct messages plus a distinct fallback, switching on `error.code`, never `error.status`" | verify-report.md | read `features/productos/errorMessages.ts:8-24` | CONFIRMED |
| 19 | "the product list route is mounted under `shellLayout`, not `encargadoLayout`" | design.md D9 | read `routes/productos.tsx:39-40` and `routeTree.ts:32,35` — sibling of the `encargadoLayout` block, not inside it | CONFIRMED |
| 20 | "every checkbox in tasks.md is ticked except 14.4" | tasks.md | counted: 67 of 68; the open one is `tasks.md:620` | CONFIRMED |
| 21 | "no `.env*` file is tracked except `.env.example`, and `.gitignore` covers `.env`" | tasks.md 14.1 | `git ls-files`; `.gitignore:11-12` | CONFIRMED |
| 22 | "no file this cycle created or changed reads any environment variable" | tasks.md 14.1 | searched `env.[A-Z_]+` across `productos/service.ts`, `productos/repository.ts`, `movimientos/repository.ts`, `routes/productos.ts`, `auditoria/fields.ts` and the whole `features/productos` UI — zero matches in all of them. This row **replaces** a statement refuted during this pass; see below. | CONFIRMED |
| 23 | "replacing the `Object.hasOwn(input.cambios,'proveedorId')` guard with `if (true)` fails exactly one test out of 275" | verify-report.md | mutation run: `1 failed | 274 passed (275)`, the failure being `a PATCH that omits proveedorId does NOT re-run the inactive-supplier guard...`; reverted, `git diff --exit-code` clean | CONFIRMED |
| 24 | "making `recordAudit` swallow its error fails 5 of 117 integration tests, one asserting zero productos, zero movimientos, zero auditoria and 500 AUDIT_WRITE_FAILED" | verify-report.md | mutation run: `5 failed | 112 passed (117)` across auth, productos, proveedores and usuarios; the productos failure was exactly that test; reverted, `git diff --exit-code` clean | CONFIRMED |

**Confirmed:** 23 · **Refuted:** 0 remaining · **Unverifiable:** 0

One claim was refuted during this pass and the false sentence was corrected in `tasks.md`
before this report was finalised, so the table above reflects the re-run over the corrected
repository — which is what the skill prescribes ("fix the claim or fix the code, then re-run
the gate"), not a clean first attempt. The refutation is recorded in full below and is the most
useful thing in this document.

A note on how it is recorded, because it matters more than the finding. The verdict cell
initially read `REFUTED → corrected`. The gate's own regex requires the verdict to stand alone
between pipes, so that arrow would have made the row **invisible to the hook** — a refutation
that passes the gate on a formatting accident. Relying on that would have been working around a
refusal, which is precisely what the gate exists to prevent. The row was rewritten to state the
claim that is actually true today, and the refuted original is documented here in prose instead
of being smuggled through the table.

## Refuted during this pass, and corrected

### "the only environment variables read anywhere ... are `DATABASE_URL`, `NODE_ENV`, `LOG_LEVEL` and `COOKIE_SECRET`"

Written in `tasks.md`'s task 14.1 evidence row. It is false. The repository also reads:

- `PORT` — `apps/api/src/server.ts:8`
- `SEED_ENCARGADO_EMAIL`, `SEED_ENCARGADO_NOMBRE`, `SEED_ENCARGADO_PASSWORD` — `apps/api/scripts/seed-encargado.ts:56-58`

The independent verifier found the three `SEED_ENCARGADO_*` variables. Re-checking its finding
surfaced a fourth the verifier had also missed, `PORT`. So the original sentence was wrong by
four variables, and the pass that caught it was itself incomplete — which is the argument for
re-checking a refutation rather than accepting it, exactly as it is the argument for not
accepting a confirmation.

**Root cause, and it is the interesting part.** The evidence was gathered with a
`process.env.[A-Z_]+` search. `seed-encargado.ts` reads its variables off a passed-in
`env: NodeJS.ProcessEnv` parameter (`resolveSeedInput(process.env, argv)` at `:96`), and
`server.ts` reads through a validated `env` object. Neither is spelled `process.env.X`, so the
search **structurally could not see them**. The instrument was wrong, not just the answer — and
a search that cannot fail in the relevant direction produces confidence rather than evidence.

**Does the underlying task still hold?** Yes, and this was checked separately rather than
assumed. Task 14.1 asks that this cycle introduce no new environment variable. All four missed
variables pre-date it: `seed-encargado.ts` landed in `aa61a50` on 2026-08-24, and `server.ts` is
older still. Every file this cycle created or changed reads zero environment variables. The task
is satisfied; the sentence claiming to prove it was not.

**Resolution.** The false sentence was replaced in `tasks.md` with claim 22b, which states what
was actually checked and is narrower than what it replaces. Nothing false remains written down,
which is the condition this gate exists to enforce — not the appearance of a clean run.

## Unverifiable

None. The two items `verify-report.md` records as unverifiable — the end-to-end
"inactive product rejects new movements" guarantee, and the independence of that report's own
authorship — are correctly scoped there: the first is out of scope until backlog #6 ships a
movement-writing endpoint, and the second is what this report settles.

**Accepted unverifiable:** 0 (none to accept).
