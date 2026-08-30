# Verify Report: productos-ledger-base

**Verified revision:** `9c887f181ad47bcabbf2f350f2f8ef4a46913631`
**Verified on:** 2026-08-30
**Status:** passed
**Tasks:** 67 of 68 ticked. The one open task is 14.4 (claims-gate report), which is produced
after this report, not by it.

## Independence caveat — read this before trusting the rest

This report was written by the orchestrator that directed the implementation, not by an
independent verifier. A first attempt to delegate this phase to a fresh `sdd-verify`
sub-agent terminated on an API session rate limit (HTTP 429) before writing anything; with
the delivery deadline one day out, the phase was completed in-session instead.

That is a real weakening of this gate, and it is recorded rather than glossed. The author of
a claim is its worst verifier: whoever directed the work already believes it and already
knows which parts were reasoned rather than run. Every claim below therefore names the exact
command run or the exact `file:line` read, so the `claims-gate` pass that follows can audit
this document instead of taking it on trust — and that pass **must** be independent.

## Suites — run for this report, not carried over

Every number below was produced by running the command on `9c887f1` with a clean tree, full
output captured to a file and read from the file.

| Command | Result |
| --- | --- |
| `pnpm -r test` (api) | 24 files / **275 tests passed** |
| `pnpm -r test` (web) | 40 files / **194 tests passed** |
| `pnpm --filter api test:integration` | 14 files / **117 tests passed** |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` (`biome ci .`) | exit 0 |
| `pnpm contract:check` | exit 0, byte-identical |

## Requirement verdicts — `product-management`

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| Role Gate — read open to both roles, deactivate/reactivate encargado-only | CONFIRMED | `routes/productos.ts:117,141,161,187` declare `roles: ['encargado','deposito']`; `:223` declares `roles: ['encargado']` inside the `for` loop at `:217-220` that registers **both** `deactivate` and `reactivate`, so one line covers both routes. Re-proved with a real `deposito` session in `routes/productos.integration.test.ts`. |
| Field-level permission — `stock_minimo` reserved to encargado | CONFIRMED | `productos/service.ts:72` (create) and `:193-198` (update) use `Object.hasOwn` — key presence, not value. Integration test covers both a numeric value and `null` from a real session, asserting the `productos` row count is unchanged. |
| Creation writes `stock_actual` and its initial movement in one transaction | CONFIRMED | `productos/service.ts:84-120`: `aplicarDelta` then `movimientos.create` with `stockResultante` taken from `aplicarDelta`'s return, never recomputed, all inside one `uow.run`. Rollback proved by mutation B below. |
| Stock correction requires a movement, not this endpoint | CONFIRMED | `routes/productos.ts:82-91` — `actualizarProductoBody` has no `stockActual` key and ends `.strict()`. `productos/repository.ts:33-40` — `CambiosProducto` has no `stockActual` key either, so the restriction is enforced at compile time as well as at the wire. Route tests assert both `stockActual` and the spec's `stock_actual` spelling bounce with `VALIDATION_ERROR` before the handler runs. |
| Unique SKU | CONFIRMED | `drizzle/0004_legal_shinobi_shaw.sql:39` creates `productos_sku_lower_unique` on `lower(sku)`. `productos/repository.ts:154-159` and `:183-188` map `23505` through `isUniqueViolation` with no prior existence check, exactly as the requirement words it. |
| Movimientos CHECK constraints | CONFIRMED | `drizzle/0004_legal_shinobi_shaw.sql` carries `movimientos_signo_tipo` and `movimientos_discrepancia_solo_ajuste`; rejection proved by direct insert at the integration level. |
| Logical deactivation/reactivation; history stays readable | CONFIRMED | `productos/repository.ts:193-200` — `setActivo` touches `activo` and nothing else, never a `DELETE`. |
| `stock_minimo` optional, never blocks creation | CONFIRMED | Nullable column in the migration; `NuevoProducto.stockMinimo` optional at `productos/repository.ts:24`. |
| Category free text and nullable | CONFIRMED | Nullable column; `categoria: z.string().trim().min(1).nullable().optional()` at `routes/productos.ts:86`. |
| List supports pagination and search by name or SKU | CONFIRMED | `productos/repository.ts:94-114` builds `searchCondition` **once** and composes it into both the page query (`:104`) and the count query (`:112`), which is D7's requirement. Integration test asserts both `data` and `total`. |
| New products may not reference an inactive supplier; existing references survive | CONFIRMED | `productos/service.ts:76-82` (create) and `:200-210` (update, gated on payload presence). D8's clause proved by mutation A below. |
| Audit trail recorded for every mutation, atomic with the write | CONFIRMED | `auditoria/service.ts:8` — `AuditableEntidad = keyof typeof FIELD_CLASSIFICATION` is the real compile gate, not the `entidadAuditoria` pgEnum, which already lists `productos` and is therefore not the constraint it appears to be. Integration test asserts exactly one row per mutation type. Rollback proved by mutation B. |

## Requirement verdicts — `productos-ui`

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| Product list open to both roles under `shellLayout` | CONFIRMED | `routes/productos.tsx:40` — `getParentRoute: () => shellLayout`, not `encargadoLayout`. `routes/productos.test.tsx` renders `/inventario` for a `deposito` session and asserts no redirect. |
| List with pagination, search, and derived status chips | CONFIRMED | `features/productos/format.ts:13-15` implements D9's exact branching. `stockMinimo === null` can never yield `bajo`, so a product with no threshold shows no chip at any stock level. |
| Create/edit form with role-gated `stock_minimo` and create-only initial stock | CONFIRMED | `features/productos/ProductoForm.tsx` renders the initial-stock field only when `mode === 'create'` — **absent in edit mode, not disabled**, per ADR-0012 rule 1. `deposito` sees `stockMinimo` visible, disabled and 🔒-marked. |
| Deactivate/reactivate controls, encargado-only, visible-locked for deposito | CONFIRMED | `routes/productosDetalle.tsx`; the chip updates from the response with no page reload, proved with a stateful test double rather than a fixed stub. |
| Error surfacing by code | CONFIRMED | `features/productos/errorMessages.ts:9-24` — six codes, six distinct messages, plus a distinct fallback; switches on `error.code`, never `error.status`. Unit-tested per code, plus one route-level proof that the mapper is actually wired to the screen. |

## Mutation log

A test never seen fail is not evidence. Each mutation below was applied to **production**
code, the suite was run, and the mutation was reverted with `git diff --exit-code` confirming
the revert rather than assuming it.

| # | Mutation | File | Result |
| --- | --- | --- | --- |
| A | D8's payload-presence guard replaced with `if (true)`, so the inactive-supplier check always re-runs | `productos/service.ts:200` | **1 failure** of 275 — `a PATCH that omits proveedorId does NOT re-run the inactive-supplier guard...`. Revert verified. |
| B | `recordAudit`'s `catch` swallows instead of throwing `auditWriteFailed` | `auditoria/service.ts:62-64` | **5 failures** of 117 integration tests, including `rolls back the whole create when the paired audit write fails: zero productos, zero movimientos, zero auditoria, 500 AUDIT_WRITE_FAILED`. ADR-0003 holds. Revert verified, tree clean. |

Earlier in the same session, on the branches that produced these commits: the client always
sending `stockMinimo` failed the deposito-body test; always sending `proveedorId` failed the
touched-fields test; rewriting `Object.hasOwn` as a value check failed the `stockMinimo: null`
integration case; dropping `.filter(p => p.activo)` failed two selector tests; removing the
search term from the query key failed the search route test; removing the route loader's
deliberate `.catch()` failed the mapped-error test; and dropping `roles: ['encargado']` from
the deactivate route failed the RBAC integration test.

## Deviations, recorded not re-litigated

1. **Phase 12 (S7a) shipped over the 400-line review budget** at 423 raw lines including
   `tasks.md`. Flagged in PR #74's body rather than measured around. Two cuts were made under
   that pressure and one was a mistake — inline styles replacing a CSS module, restored in
   PR #75 — because the branch was over budget anyway and the saving bought nothing.
2. **S5-breadth's `stockMinimo` re-proof covers the create route only**, not PATCH. The
   PATCH-side guard is proved against fakes in `productos/service.test.ts`. Noted in
   `tasks.md` under 9.1.
3. **Task 10.6 was stale** — it named an `AppShell.test.tsx` expectation that did not exist.
   Verified against `main` and corrected in `tasks.md`.

## Findings

**F1 — stale comment, low severity, no behaviour impact.** `apps/api/src/auditoria/service.ts:7`
reads `// v1: only 'usuarios' has an entry.` directly above `AuditableEntidad`. Three entities
now have entries in `FIELD_CLASSIFICATION` — `usuarios`, `proveedores` and `productos` — so the
comment is false as written. It predates this cycle (`proveedores` already falsified it), and
this cycle did not update it while adding the third entry.

Nothing depends on the comment and no test covers it, so this is not a blocker. It is recorded
rather than fixed because a verify phase produces verdicts, not edits: fixing what a verdict
exposes is separate work, done deliberately, after the report is written.

## Contradictions between artifacts

None found. `design.md`'s `[RECONCILE-1]` and `[RECONCILE-3]` (`:510`, `:519`) carry the
owner's explicit answers, and `tasks.md`'s RECONCILE section records the same two decisions
with the same resolutions — checked against each other, not assumed consistent.

## Unverifiable

| Claim | Why it cannot be settled here |
| --- | --- |
| "An inactive product rejects new movements" | The spec itself scopes this out: no movement-writing endpoint exists until backlog #6, so the guarantee is a data-model invariant, not yet HTTP-testable. Recorded in the spec at `product-management/spec.md:138-141`, not a gap this cycle introduced. |
| The independence of this verification pass | Stated in the caveat above. Settling it requires a verifier that did not direct the work. |

## Next recommended

`claims-gate` — audit this report claim by claim, **independently**. Then `sdd-archive`.
