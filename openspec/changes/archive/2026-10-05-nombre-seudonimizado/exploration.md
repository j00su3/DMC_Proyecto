# Exploration: pseudonymize `usuarios.nombre` in audit snapshots (closes D-22)

Owner decision before exploration (2026-10-04): pseudonymize `nombre` (`CORREGIR CÓDIGO`). This
exploration maps what that decision touches. Line citations were checked at `eba53f9`.

## Current state

- `FIELD_CLASSIFICATION.usuarios` lists `nombre` as auditable (`apps/api/src/auditoria/fields.ts:33`)
  and pseudonymizes only `email` (`fields.ts:47`).
- `recordAudit` (`apps/api/src/auditoria/service.ts:131-169`) filters excluded fields, then runs
  `pseudonymizeWith` (`:75-91`), an HMAC with the domain tag `'audit-email-pseudonym:'` (`:54`) and
  the prefix `hmac-sha256:` (`:55`). The tag is shared by every pseudonymized field.
- The key is lazy (`:141-144`): it is read only when a listed field holds a string, and a missing
  `COOKIE_SECRET` throws before `repo.record`, so the transaction rolls back.

## Audit writes that can carry `nombre`

| Action | Call site | Carries `nombre`? |
| --- | --- | --- |
| `crear` | `usuarios/service.ts:149-158` (whole created row) | Yes |
| `actualizar` | `usuarios/service.ts:206-222` (changed fields only) | Only when the name changes; old and new values |
| `baja_logica` / `reactivar` | `usuarios/service.ts:248-272` | No |
| `cambiar_password` (admin reset, rescue) | `usuarios/service.ts:308-324` | No |
| `cambiar_password` (self-service) | `auth/service.ts:183-190` | No |

## Effects

- **Key requirement:** the only write that newly needs `COOKIE_SECRET` is a `PATCH` that changes the
  name and not the email. `crear` already needs it. Production validates the secret at startup
  (`lib/env.ts:10`). The rescue script still runs without it: its snapshots carry no `nombre`
  (`usuarios/service.ts:313-323`; asserted at `rescate.integration.test.ts:146-151`).
- **Read side:** `GET /api/auditoria` returns snapshots as stored (`routes/auditoria.ts:33-72`), and
  actor names and entity labels come from live tables (`auditoria/service.ts:251-253`). No code
  reads `nombre` from a snapshot; the web app has no audit screen. The OpenAPI contract does not
  change.
- **Rename history:** a rename stays visible as a change (the two pseudonyms differ) but is no longer
  readable as "old → new". A no-op rename still writes nothing (`usuarios/service.ts:210-212`).
- **Linkability:** the same name gives the same pseudonym across rows; names have far less entropy
  than emails, so anyone holding `COOKIE_SECRET` can dictionary-test them.
- **Shared tag:** with one tag, the same text under `email` and `nombre` gives the same pseudonym.
  Changing the existing tag would change every email pseudonym already written.
- **D-21:** rotating `COOKIE_SECRET` now changes the `nombre` pseudonyms too.

## Tests that break

- `apps/api/src/auditoria/fields.test.ts:41` — expects `['email']`.
- `apps/api/src/auditoria/service.test.ts:121-143` — the `crear` case expects plaintext `nombre`.
- `apps/api/src/routes/usuarios.integration.test.ts:599-600` — expects plaintext old and new names.

Missing coverage: a unit test that `nombre` is pseudonymized in both snapshots and rejected without
the key, and an integration test that no stored snapshot contains the name after a real create and
rename (the test D-22 itself asks for).

## Specs and docs

- `openspec/specs/record-audit-trail/spec.md:191-212` ("Pseudonym Key Required Only When a
  Pseudonymized Field Is Present") is worded for `email` only; it needs a delta.
- `docs/PRD.md:202-209` says snapshots "seudonimizan el correo".
- `docs/SECURITY.md` SEC-012 (`:994-1068`) states email only.
- `docs/DRIFT.md` D-22 would be resolved; D-21 widens.
- `docs/BACKLOG.md:33` (item 2.5) says "Seudonimizar el correo".
- Code comments that say "email": `fields.ts:43-46`, `service.ts:54`, `:57-74`, `:101-112`,
  `vitest.config.ts:25-30`.

## Rows already written

`AuditoriaRepo` exposes only `record` and `list` (`auditoria/repository.ts:46-56`); the trail is
described as permanent (`docs/PRD.md:202-203`) and write-only (`record-audit-trail` spec Purpose).
There is no database-level guard against an update. Options were: leave them, rewrite them to the
keyed HMAC, or rewrite them to a fixed marker.

## `proveedores.contacto`

Audited in plain text (`fields.ts:52`, `pseudonymizedFields: []` at `:58`); free text
(`routes/proveedores.ts:42,55`). Not part of D-22.

## Owner answers (2026-10-04)

1. Rows already written: **leave them as they are**; document that rows before this change keep the
   name.
2. Domain tag: **a separate tag for `nombre`**; the email tag stays, so existing email pseudonyms do
   not change.
3. Docs: **edit `docs/PRD.md:202-209`** to say email and name, and **add a Status line to SEC-012**.
4. `proveedores.contacto`: **out of scope**; record it as a new drift finding.
