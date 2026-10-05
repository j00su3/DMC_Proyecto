# Design: Pseudonymize `usuarios.nombre` in audit snapshots (`nombre-seudonimizado`, closes D-22)

## Technical Approach

One data change and one lookup change, no new module, route, env variable or contract change:

1. `fields.ts` gains a field-to-tag map and lists `nombre` in `usuarios.pseudonymizedFields` (D1-D3).
2. `pseudonymizeWith` (`auditoria/service.ts:75-91`) reads the tag per field instead of the single
   `PSEUDONYM_DOMAIN_TAG` (`:54`). Key access stays lazy (`:140-144`), so snapshots with no string
   under a listed field still record without `COOKIE_SECRET`.

Facts checked at the source:

- `recordAudit` builds `datosPrevios` before `datosPosteriores` (`service.ts:155-162`), so a
  missing key throws on the first listed string it meets, in that order.
- Unit tests A2 and A6 put `{ nombre: 'Old Name' }` in `datosPrevios` (`service.test.ts:17-24`,
  `:256`, `:312-319`). Once `nombre` is listed they throw on the name, not the email, and stay green
  even if `email` were unlisted. They must be tightened (Testing).
- The integration suite sets `COOKIE_SECRET` in its env (`vitest.integration.config.ts:25`);
  `buildApp({ cookieSecret })` does not feed the HMAC key. The rescue suite stubs it out
  (`usuarios/rescate.integration.test.ts:182-184`).
- A no-op rename test already exists (`routes/usuarios.integration.test.ts:711-731`).

## Architecture Decisions

| # | Decision | Rejected | Rationale |
|---|---|---|---|
| D1 | `PSEUDONYM_DOMAIN_TAGS = { email: 'audit-email-pseudonym:', nombre: 'audit-nombre-pseudonym:' } as const`, exported from **`fields.ts`**; `type PseudonymizedField = keyof typeof PSEUDONYM_DOMAIN_TAGS` | Map in `service.ts` (forces `fields.ts` to import from the module that imports it); per-entity record replacing the `pseudonymizedFields` array (breaks the array shape `fields.test.ts:41-44` and `service.ts:151` rely on, and lets two entities pick the same tag unseen) | Which fields are pseudonymized and under what domain is classification data; `service.ts` already imports `fields.ts` (`:7`) |
| D2 | New tag `'audit-nombre-pseudonym:'` | `'audit-name-pseudonym:'`, entity-qualified `'audit-usuarios-nombre-pseudonym:'` | Existing pattern is `audit-<snapshot key>-pseudonym:` and the key is `nombre`. The two tags differ at byte 7 (`e`/`n`), so no `tag + value` input can collide across fields |
| D3 | `EntityFieldClassification.pseudonymizedFields?: readonly PseudonymizedField[]` (`fields.ts:23`); `pseudonymizeWith` and the exported `pseudonymizeFields` take `readonly PseudonymizedField[]` | Runtime `if (!tag) throw` in `pseudonymizeWith` | Listing a field with no tag becomes a `pnpm typecheck` error through `satisfies` (`fields.ts:101`). A runtime branch is unreachable without a cast. Every existing call passes `['email']` literals, which still compile |
| D4 | Email digest unchanged by construction: today `HMAC(key, 'audit-email-pseudonym:' + value)`; after, `HMAC(key, PSEUDONYM_DOMAIN_TAGS.email + value)` with the same string, key, UTF-8 default, hex digest and `hmac-sha256:` prefix (`:55`, `:87`) | Re-deriving the expected value in the test with `createHmac` | A hard-coded digest also catches a changed prefix, encoding or concatenation order. It is captured from unchanged code and committed green **before** the refactor |

Global keying by field name means a future entity pseudonymizing a field called `nombre` would
share this tag. No entity does today (`fields.ts:58,78,99`); see Open Questions.

## Data Flow

    usuarios/service.ts ──recordAudit──→ filterExcluded ──→ pseudonymizeWith
                                                                │ per listed field holding a string:
                                                                │ HMAC(getKey(), TAGS[field] + value)
                                                                ▼
                                                     repo.record (inside UnitOfWork)

## File Changes and Size

Counts are additions plus deletions, estimated.

| File | Action | Est. |
|---|---|---|
| `apps/api/src/auditoria/fields.ts` | Modify: map, type, `nombre` listed, comments `:15-23`, `:43-46` | 25 |
| `apps/api/src/auditoria/service.ts` | Modify: remove `:54`, per-field lookup, comments `:51-53`, `:57-74`, `:101-112` | 25 |
| `apps/api/vitest.config.ts` | Modify: comment `:25-30` says email only | 6 |
| `apps/api/src/auditoria/fields.test.ts` | Modify `:41`, comment `:31-36`; add tag tests | 40 |
| `apps/api/src/auditoria/service.test.ts` | Fix `:121-143`, tighten A2/A6, add 4 cases | 100 |
| `apps/api/src/routes/usuarios.integration.test.ts` | Fix `:599-600`, extend `:281-308`, add 1 case | 60 |
| `docs/PRD.md`, `SECURITY.md`, `DRIFT.md`, `BACKLOG.md` | Modify (Docs below) | 115 |
| Planning: `exploration.md` 85, `proposal.md` 97 (committed); spec ~60, this design ~135, tasks ~70 | Create | ~450 |
| Closing: `verify-report.md` ~120, `claims-report.md` ~60 | Create | ~180 |

Total ≈ 1000 lines, over the 800 budget for one PR.

## Testing Strategy

Strict TDD. Each new test names the mutation that must turn it red.

| # | Test (file) | Covers | Mutation probe → red |
|---|---|---|---|
| T1 | Pin email: `pseudonymizeFields({ email: 'ana@example.com' }, ['email'], KEY)` equals a literal `hmac-sha256:<hex>` (`service.test.ts`). **First task, unchanged code**: compute the hex with `node -e` using `createHmac`, confirm today's function returns the same, commit green | criterion 2 | change one character of the email tag; swap to `value + tag` |
| T2 | Fix `:121-143`: created row's `nombre` matches `/^hmac-sha256:[0-9a-f]{64}$/`, not `'New User'` | criterion 1 | unlist `nombre` |
| T3 | `actualizar` with `nombre` in both snapshots: both pseudonymized, different, neither plaintext | criteria 1, 3 | unlist `nombre`; pseudonymize `datosPosteriores` only |
| T4 | Name-only snapshot, `COOKIE_SECRET` stubbed out: rejects `/COOKIE_SECRET must be set/`, `record` not called | key requirement | unlist `nombre` |
| T5 | Same string under `email` and `nombre` gives different pseudonyms | ratified decision 3 | set the `nombre` tag to the email tag |
| T6 | Tighten A2 and A6: replace the `{ nombre }` snapshot with a non-pseudonymized field (e.g. `rol`) | keeps email key coverage honest | unlist `email` (today they would stay green) |
| T7 | Fix `fields.test.ts:41` to `['email', 'nombre']` | classification | unlist `nombre` |
| T8 | Every listed field in every entity has a tag; tags are distinct, match `/^audit-[a-z]+-pseudonym:$/`, and none is a prefix of another; `// @ts-expect-error` on `const _x: PseudonymizedField = 'contacto'` | D2, D3 | duplicate a tag (runtime); widen `PseudonymizedField` to `string` (`pnpm typecheck` reports an unused directive) |
| I1 | Fix `:599-600`: each snapshot equals `pseudonymizeFields({ nombre }, ['nombre'], process.env.COOKIE_SECRET)` for the old and new name | criteria 1, 3 | unlist `nombre` |
| I2 | Extend `:281-308`: `datos_posteriores` text does not contain `'Beto Deposito'` | criterion 1 | unlist `nombre` |
| I3 | New: real `POST` create, then `PATCH` rename; `select datos_previos::text, datos_posteriores::text from auditoria` contains neither name | criterion 1 (D-22's own test) | unlist `nombre`; skip `datosPrevios` |
| I4 | Existing no-op rename (`:711-731`) and rescue suite (`rescate.integration.test.ts:182-184`) unchanged and green | criteria 3, 4 | rescue: resolve the key eagerly at the top of `recordAudit` |

`pnpm contract:check` must stay byte-identical (criterion 5); no route schema changes.

## Docs

- `docs/PRD.md:202-209`: "seudonimizan el correo" becomes "seudonimizan el correo y el nombre", plus
  one sentence: rows written before the change keep the name in plaintext and are not rewritten.
- `docs/SECURITY.md`: new **Status** line after `:1003-1007` (name pseudonymized under its own tag,
  pre-change rows unchanged, names are dictionary-testable by anyone holding the key); summary row
  `:1216` says correo only.
- `docs/DRIFT.md`: D-22 (`:437-470`) marked RESUELTO in the D-01/D-02 format; counts and lists at
  `:22`, `:34-49` and next step 1 (`:594-596`) updated; D-21 (`:411-428`) adds that rotation changes
  `nombre` pseudonyms too; the `contacto` bullet (`:458-460`) moves to new **D-26** (next free ID:
  the report ends at D-25, `:517`, and D-07/D-12 are retired, `:20-21`).
- `docs/BACKLOG.md:33` (2.5): title and text name the correo and the nombre, with the D-22 date.

## Threat Matrix

N/A: no routing, shell, subprocess, VCS/PR automation, executable-file classification, or
process-integration boundary.

## Migration / Rollout

No migration, no new env variable. Production already requires `COOKIE_SECRET` at startup. Rows
written before deploy keep plaintext names (ratified). Rollback is a revert; rows written meanwhile
stay pseudonymized.

## Delivery

Recommend **two PRs**: (1) planning — exploration, proposal, spec, design, tasks (~450); (2) code,
tests, docs, verify and claims reports, from a branch whose name contains the slug so the claims
gate applies (~550). Docs that claim the name is pseudonymized ship with the code, never before it.
The archive goes in its own PR, as in earlier cycles.

## Open Questions

- [ ] **Product, for the owner:** exact Spanish wording of the PRD sentence and the SEC-012 Status
  line. The design only fixes their content.
- [ ] **Doc judgement:** severity of D-26 (`proveedores.contacto`). Proposed: Sugerencia, since
  D-22 calls the case "menos claro" (`DRIFT.md:458-460`).
- [ ] **Future:** a second entity that pseudonymizes a field called `nombre` would share
  `audit-nombre-pseudonym:`, so its pseudonyms could be linked with users' names. Out of scope; if
  it ever comes up, the tag key should include the entity.
- [ ] **Spec alignment:** if the spec states something different for cross-field separation (T5)
  or the name-only key requirement (T4), flag it. Do not resolve it here.
