# Proposal: Last-Encargado Rescue Procedure

## Intent

Close drift finding D-02 (`docs/DRIFT.md:78-96`, severity Crítico): ADR-0007
(`docs/adrs/0007-sesion-cookie-rbac-propio.md:61-63`) promises a documented manual procedure for
when the only `encargado` loses their password; none exists. User management requires an
authenticated encargado, so a deployed system with a lost password has no in-app way back in.

## Ratified Decisions (owner, 2026-10-01 — final)

1. **Tested script + runbook.** A new, separate script (not a mode of `seed-encargado.ts`, whose
   spec requires it to refuse when an encargado exists) reusing `resetUsuarioPassword`
   (`apps/api/src/usuarios/service.ts:277`), plus a short Spanish runbook in `docs/`.
2. **Audit row with explicit rescue marker.** The rescued encargado is recorded as their own actor
   (`auditoria.usuario_id` is NOT NULL; a script has no authenticated actor); the snapshot carries
   a marker (working name `origen: 'rescate'`) so it cannot read as self-service.
3. **Generated password.** Existing generator, printed once, forced change on first login. No
   password via CLI argument or environment.
4. **Inactive account: refuse and explain.** No reactivation; the runbook covers the case.

## Scope

### In Scope
- Core rescue logic under `apps/api/src/usuarios/` (real-Postgres integration-testable);
  `apps/api/scripts/` file is a thin wrapper.
- Runbook in `docs/DEPLOY-PLAN.md`; short addendum to ADR-0007; update `docs/DRIFT.md` D-02 and
  `docs/SECURITY.md` recommendation 4; fix stale cross-references (SECURITY.md cites ADR `56-58`,
  DRIFT cites `SECURITY.md:205`; actual `61-63` / `207`).

### Proposed Defaults (orchestrator-chosen; owner may still change)
- Lookup by email, normalized like login (`trim().toLowerCase()`, `auth/service.ts:33`); any
  non-`encargado` is refused.
- If another active encargado exists, the script still works but states the in-app reset is the
  normal route.
- Wrong-database guard: print the target DB host (never credentials) and require an explicit
  confirmation flag before writing.

### Out of Scope (record as new DRIFT items, not fixed here)
- ADR-0007 says a correct password grants access while locked; code returns 423 `ACCOUNT_LOCKED`
  (`auth/service.ts:106`).
- `seed-encargado.ts` inserts the email unnormalized (`:85`).
- Email self-service reset (backlog #3.5), any UI, account reactivation.

## Capabilities

### New Capabilities
- `encargado-rescue`: operator-run rescue of a lost encargado password (refusals, generated
  password, audit marker, confirmation guard).

### Modified Capabilities
- `record-audit-trail`: possibly — "Audit Row Identity and Snapshot Shape" / "Auditable Actions
  Scope" may need to admit a rescue-origin marker. Spec phase to decide.
- `auth-sessions`: possibly — only if the spec phase decides the seed-refusal requirement
  (`spec.md:214`) needs a cross-reference; the new script leaves it untouched.

## Approach

Wrap `resetUsuarioPassword` in a rescue service that finds the encargado by normalized email,
applies the refusals, runs through `UnitOfWork`, and prints the temporary password once. Reset
already clears lockout, deletes sessions and sets `debeCambiarPassword`.

## Open for Spec/Design (not resolved here)

- **`COOKIE_SECRET` dependency (verified).** `recordAudit` calls `resolvePseudonymKey()` whenever
  the entity has `pseudonymizedFields` (`auditoria/service.ts:121-128`, throws at `:99-107`);
  `usuarios` lists `email` (`fields.ts:47`). So the rescue throws without `COOKIE_SECRET` even
  though the reset snapshot carries no email. Design must decide how the script satisfies this
  without weakening the audit path.
- **Marker plumbing.** The service filter (`filterExcluded`/`pseudonymizeFields`) touches only
  listed keys, and `GET /api/auditoria` returns snapshots as `z.record(z.string(), z.unknown())`
  (`routes/auditoria.ts:45-46`), so an extra key should pass through. Unverified: `resetUsuarioPassword`
  hard-codes its snapshots (`:310-319`), so design must decide how `origen` is injected.
- **Spec delta scope** for `record-audit-trail` / `auth-sessions` (above).
- **Identity confirmation.** The operator is the only gate; the runbook must say so (wording is a
  spec/docs concern).

## Pinned Before Spec/Design (owner-approved, 2026-10-01)

Spec and design run in parallel and cannot see each other, so these are fixed here for both:

- **`COOKIE_SECRET`.** `recordAudit` resolves the pseudonym key only when the snapshot being
  written actually contains a pseudonymized field. A snapshot with an email still requires the key
  exactly as today. The rescue therefore runs without `COOKIE_SECRET`.
- **Marker.** `origen: 'rescate'`, in `datosPosteriores` only. `resetUsuarioPassword` gains an
  optional parameter to carry it; the in-app route does not pass it, so its rows are unchanged.
- **Names.** Core function `rescatarEncargado` in `apps/api/src/usuarios/rescate.ts`; script
  `apps/api/scripts/rescatar-encargado.ts`, run as `pnpm --filter @inventienda/api rescatar:encargado`;
  flags `--email <correo>` and `--confirmar`. Capability `encargado-rescue`.
- **Refusals are operator-facing console messages in Spanish, not wire codes.** No new error
  factory or HTTP code.

## Reconciled After Spec/Design (owner-approved, 2026-10-01)

Spec and design disagreed on one point and left two decisions to the owner:

- **Preview exit status.** Running without `--confirmar` exits zero: a preview is a successful
  outcome. Refusals and usage errors still exit non-zero. The spec was amended to match the design.
- **Mixed-case stored email is out of scope.** The lookup uses the normalized email only. An
  account stored with uppercase letters is reported as not found; the runbook explains the case and
  the seed defect is recorded as a new DRIFT finding.
- **Delivery.** Five chained PRs: planning; audit key + marker parameter + ports; rescue core;
  script; docs and claims report.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/usuarios/` | New/Modified | Rescue service; possible marker parameter |
| `apps/api/scripts/` | New | Thin wrapper + unit test |
| `docs/DEPLOY-PLAN.md`, ADR-0007, `docs/DRIFT.md`, `docs/SECURITY.md` | Modified | Runbook, addendum, status, refs |
| `openspec/specs/` | Modified/New | Per Capabilities |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Script run against wrong database | Med | Host printout + confirmation flag |
| Social-engineering: operator rescues the wrong person | Med | Runbook states operator is the sole gate |
| Marker breaks audit consumers | Low | Snapshot is opaque JSON on read |
| `COOKIE_SECRET` workaround weakens pseudonymization | Med | Design must keep `recordAudit` unchanged |

## Rollback Plan

Pure code and docs revert; no migration or schema change. A rescue already performed is not
reverted (it is an audited password reset); the rescued user simply changes the password again.

## Dependencies

Holder of the write `DATABASE_URL` (CI's Neon URL is read-only). Nothing in `.env*` is touched.

## Success Criteria

- [ ] Script resets a lost encargado password, forces change, clears lockout and sessions
- [ ] Refuses non-encargado, unknown email, and inactive accounts, writing nothing (DB asserted)
- [ ] Audit row exists with actor = target and the rescue marker, proven on real Postgres
- [ ] Runbook exists; D-02, SECURITY rec. 4 and ADR-0007 updated; stale refs fixed
- [ ] Two new DRIFT items recorded
