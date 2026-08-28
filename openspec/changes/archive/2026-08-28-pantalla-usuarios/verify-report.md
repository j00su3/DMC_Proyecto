# Verify Report: pantalla-usuarios (backlog #3.1)

**Date**: 2026-08-28
**Branch**: main @ 95c516d
**Verifier**: sdd-verify (strict TDD mode)

## Gate Results (all real, all run by this agent)

| Gate | Result | Detail |
|---|---|---|
| pnpm -r test (run 1) | PASS | 172 api + 155 web tests passing, 0 failures |
| pnpm -r test (run 2, flake check) | PASS | 172 api + 155 web tests passing, identical result, 0 failures, no full-suite-only flake reproduced |
| pnpm typecheck | PASS | both packages clean |
| pnpm lint (biome ci) | PASS | 170 files checked, no fixes needed |
| pnpm contract:check | PASS | byte-identical, no apps/api/** touched |
| pnpm test:integration | PASS | 8 files / 59 tests passing |

No failures anywhere.

## TDD Compliance

TDD Cycle Evidence table exists in apply-progress for the S7 batch.

## Requirement-to-Test Mapping

### usuarios-ui (12 requirements)

1. Encargado-Only Route Guard Is UX Convenience, Not Access Control
   - Scenario "Deposito redirected": apps/web/src/routes/encargadoLayout.test.ts:17 - it redirects to / when the session usuario is not an encargado - COVERED
   - Scenario "server boundary holds independent of client guard": apps/api/src/routes/usuarios.test.ts - seven it returns 403 FORBIDDEN for a deposito session blocks, one per route (lines 132, 233, 320, 451, 576, 713) - COVERED

2. List Screen With Pagination And Visible Deactivated Users
   - Scenario "Paginated list renders from the envelope": NO COVERING TEST FOUND. Pagination.test.tsx tests the isolated component with hand-fed props (page, totalPages), never wired to a real GET /api/usuarios envelope through the route. usuarios.test.ts never stubs a multi-page response (total > pageSize) and asserts the rendered pagination footer reflects it. -- CRITICAL
   - Scenario "Deactivated user stays visible with a status chip": apps/web/src/features/usuarios/UsuariosTable.test.tsx:39 - it('keeps a deactivated user visible in the table, not hidden') - COVERED

3. Detail Screen
   - apps/web/src/routes/usuariosDetalle.test.ts:84 - it('renders the profile fields for an existing id, with no password/hash field anywhere') - COVERED

4. Create User Flow
   - apps/web/src/routes/usuariosNuevo.test.ts:78 - it('submits valid data and hands the temporary password to the credential dialog, not inline in the form') - COVERED

5. Edit User Flow
   - Scenario "Successful edit persists fields": apps/web/src/routes/usuariosDetalle.test.ts:141 - it('submits a PATCH with only the dirty fields and refetches the detail on success'), backed at unit level by useActualizarUsuario.test.ts:59 - it('sends exactly the given partial body as the PATCH request') - COVERED
   - Scenario "Own profile locks role": apps/web/src/features/usuarios/UsuarioForm.test.tsx:24 - it('renders rol disabled with a visible reason on the logged-in user own account (D17)'), plus route-level usuariosDetalle.test.ts:104 - it('renders rol enabled for another user, locked for the logged-in user own account (D17)') - COVERED

6. Deactivate And Reactivate Actions
   - Scenario "Deactivate updates the status chip": NO COVERING TEST FOUND.
   - Scenario "Reactivate updates the status chip": NO COVERING TEST FOUND.
   Both scenarios describe an end-to-end success path (200 response leads to row chip flip, no page reload). No test in usuarios.test.ts or usuariosDetalle.test.ts stubs a successful deactivate/reactivate response and asserts the rendered chip changes. Every route-level deactivate test present (usuarios.test.ts:209, usuariosDetalle.test.ts:250) stubs a 409 failure only. useEstadoUsuario.test.ts proves the mutation sends the right bodyless POST and calls invalidateQueries -- it does not render UsuariosTable or assert a chip changes; it uses an isolated QueryClient with renderHook, no UI. This is exactly the "route tested, client-shape not proven" pattern the POST /api/auth/logout incident illustrates. -- CRITICAL

7. Self-Action Block Is A UI Affordance, Not An Authorization Control
   - Scenario "Own row renders all three controls disabled with a reason": UsuariosTable.test.tsx:54 (deactivate/reactivate + password-reset) and UsuarioForm.test.tsx:24 (rol) - COVERED; assertions correctly use toBeDisabled() plus a visible reason string, never "the system prevents the operation"
   - Scenario "The server still permits the action the screen declines to offer": NO COVERING TEST FOUND, front or back end. No backend test in apps/api/src/routes/usuarios.test.ts exercises a self-targeted deactivate/password-reset/PATCH-rol call and asserts it succeeds. -- WARNING (backend code path unmodified by this change; design.md reasons through why no such guard exists server-side, but the spec's own scenario asks for a test and none exists)
   - Scenario "Other users rows keep every control enabled": UsuariosTable.test.tsx:70 - it('keeps deactivate/reactivate and restablecer enabled on other users rows'), UsuarioForm.test.tsx:45 - it('renders rol enabled with no reason on another user account') - COVERED

8. Admin Password-Reset Flow
   - apps/web/src/routes/usuarios.test.ts:280 - it('shows the CredentialDialog with the one-time plaintext after a password-reset, dismissed by acknowledging') - COVERED

9. Last-Active-Encargado Guard Is Server-Authoritative
   - Scenario "Refused deactivate only known after response": usuarios.test.ts:209 and usuariosDetalle.test.ts:250, both asserting expect(desactivar).toBeEnabled() before the click, then the 409 copy appears only after - COVERED
   - Scenario "No control pre-disabled from client prediction": covered by the same two tests, plus code inspection confirms no count/heuristic exists anywhere in usuarios.tsx/usuariosDetalle.tsx - COVERED

10. Temporary Password Handling
    - Scenario "Lives only in local component state": useCrearUsuario.test.ts:67 - it('never lets the plaintext password reach the query cache, mutation cache, router state, or web storage'), triangulated at useCrearUsuario.test.ts:100; identical pattern repeated for reset at useRestablecerPassword.test.ts:100 and :129 - COVERED, both credential-bearing paths proven, not one proven and one assumed
    - Scenario "Modal requires explicit acknowledgment": Modal.test.tsx:34/44/54 (explicit-only: Escape/overlay-click do not close, acknowledge does), wired to the real credential modal via CredentialDialog.tsx closePolicy="explicit-only" (verified by direct code read) - COVERED
    - Scenario "Password unrecoverable after dismissal": useCrearUsuario.test.ts:169 - it('acknowledge() clears the credential'), useRestablecerPassword.test.ts:192 same. Reasonable proxy (state is the only holder per D12, becomes null) though neither test literally exercises navigate-away-and-back - ACCEPTED as adequate given the containment sweep already proves no other reachable store exists

11. Error Surfacing By Code
    - Scenario "Each code maps to a distinct message": the five-code switch is fully proven pure-function-level at apps/web/src/features/usuarios/errorMessages.test.ts:6,13,20,31,38 (USER_NOT_FOUND, EMAIL_ALREADY_IN_USE, LAST_ACTIVE_ENCARGADO, VALIDATION_ERROR, FORBIDDEN, each distinct). Only LAST_ACTIVE_ENCARGADO is proven live in a rendered screen (usuarios.test.ts:209, usuariosDetalle.test.ts:250). The other four codes wiring into the actual screen is never exercised end-to-end -- useUsuario.test.ts:61 proves the hook surfaces USER_NOT_FOUND untouched, but no test renders the detail route with a 404 response and asserts the mapped Spanish copy actually appears on screen. -- WARNING (the wiring is a one-line ternary identical in shape to the one already proven live for LAST_ACTIVE_ENCARGADO, so risk is low, but it is not proven)

12. Design-Tokens-Only Build, No Approved Mockup
    - Scenario "Table tokens": apps/web/src/components/ui/DataTable.test.tsx:51 - COVERED
    - Scenario "Modal tokens": apps/web/src/styles/tokens.test.ts:50/54 (pins 18px / rgba(22,35,60,.55)) plus :64/68/72 (Modal.module.css references the three vars) - COVERED
    - Scenario "Screens noted as not visually approved": not a test per design own Testing Strategy table (Wireframe note -- Not a test); verified by code inspection -- usuarios.tsx:36-39 and DataTable.tsx docblock both carry the note - COVERED by inspection

### app-layout (2 requirements)

1. Shared Application Layout Component
   - Scenario "Home route unchanged": apps/web/src/app/router.test.tsx:126 - it('submitting valid credentials populates the session and navigates into the shell'), confirmed unmodified per tasks.md 1.7 intent and this agent own read of the file (still asserts Ana renders) - COVERED
   - Scenario "Second screen mounts into same chrome": structurally guaranteed by shellLayout mounting AppShell once around Outlet (D1); AppShell.test.tsx proves the component own render contract; no test literally diffs same instance, but the architecture (one layout route, all children nest under it) makes a duplicate instance unreachable by construction - COVERED (structural, not test-literal)

2. Sidebar Items Render As Navigation Links
   - Scenario "Usuarios nav item navigates to list route": apps/web/src/components/ui/AppShell.test.tsx:104 - it('renders the Usuarios nav item as a link to /usuarios for an encargado session') - COVERED
   - Scenario "Active route highlights nav item": apps/web/src/components/ui/NavItem.test.tsx:36 - it('renders as an active link when the current route matches, ignoring search params') - COVERED

## Summary

- Requirements with fully confirmed covering tests: 11 / 14 (usuarios-ui: 9/12 fully clean, app-layout: 2/2)
- Requirements with a CRITICAL gap (no covering test for a stated scenario): 2 -- "List Screen With Pagination And Visible Deactivated Users" (paginated-envelope scenario) and "Deactivate And Reactivate Actions" (both success-path scenarios)
- Requirements with a WARNING gap (claim plausible/low-risk but genuinely unproven): 2 -- "Self-Action Block" (server-permits-it scenario, backend-only, out of this change file scope) and "Error Surfacing By Code" (4 of 5 codes unproven at the screen-render level)

## Assertion Quality Audit

Scanned all test files created/modified by this change (components/ui/*.test.tsx, features/usuarios/*.test.{ts,tsx}, routes/usuarios*.test.ts, routes/encargadoLayout.test.ts). No tautologies, no assertions that never call production code, no ghost loops over possibly-empty collections. Assertions consistently target rendered DOM output (toBeDisabled, getByText, getByRole) or captured request bodies (init.body), not internal state or mock-call-counts alone. The five-surface containment sweeps (useCrearUsuario.test.ts, useRestablecerPassword.test.ts) are the strongest tests in the suite -- mechanical, not review-dependent.

One CSS-class-based assertion class exists (NavItem.test.tsx checking styles.navItemActive membership) -- acceptable per this codebase established P5 pattern (jsdom does not apply CSS Modules, documented at styles/tokens.test.ts:6-20), not flagged.

Assertion quality: no CRITICAL or WARNING issues found in the tests that do exist. The gaps above are about absence of a covering test, not quality of the tests that are present.

## Three Precision-Worded Requirements -- Verified In Code, Not Just Prose

1. Encargado-only guard as UX convenience: encargadoLayout.tsx docblock explicitly states this is not the enforcement mechanism and cites the backend unconditional 403. Confirmed in code, matches spec wording.
2. Self-action lock renders disabled with a reason, never absent: confirmed in UsuariosTable.tsx/usuariosDetalle.tsx -- controls always render (disabled={isOwnAccount}), never conditionally omitted. Every covering test asserts toBeDisabled() plus visible reason text, never "the operation is prevented". Correct per spec.
3. Last-encargado guard not predicted client-side: confirmed by code inspection -- no count, no heuristic, no pre-disable logic exists anywhere in usuarios.tsx/usuariosDetalle.tsx. estado.deactivate/estado.reactivate buttons are always enabled until a real 409 arrives. Tests pin the control as enabled before the request in both list and detail screens.

## Credential Containment -- Both Paths Proven

useCrearUsuario (useCrearUsuario.test.ts:67,100) and useRestablecerPassword (useRestablecerPassword.test.ts:100,129) both narrow inside mutationFn, both return only body.usuario (no passwordTemporal member reachable on the mutation result type -- verified in useCrearUsuario.ts/useRestablecerPassword.ts source), and both have the identical five-surface sweep (query cache, mutation cache, router href, localStorage, sessionStorage), each triangulated with a second plaintext value. Both paths proven, not one proven and one assumed.

## Deviations -- All Assessed, All Acceptable

1. NAV_ITEMS in AppShell.tsx -- confirmed by code read; correctly avoids the dependency inversion the task literal wording would have caused. Accept.
2. UsuariosTable.module.css arriving in S7 -- confirmed timing rationale holds (no layout needed until the actions column). Accept.
3. useEstadoUsuario/useRestablecerPassword taking id at mutate time -- confirmed in source and tests; matches the stated rationale (one credential-holding instance serving every row). Accept.
4. UsuarioForm mode prop (create/edit) -- confirmed present and used correctly by both usuariosNuevo.tsx (create) and usuariosDetalle.tsx (edit); minor spec/design documentation gap, not a code defect. Accept.
5. Modal.tsx two biome-ignore suppressions -- confirmed both are for the documented, deliberate D13 decisions (decorative overlay, dialog rejection). Accept.

None of the five are hidden defects; all match their stated rationale under direct code inspection.

## Open Design Questions (carried forward from design.md, not re-litigated)

Bodyless-POST Fastify parser behavior is now empirically resolved -- tests confirm init.body === undefined works, live in the running suite. Self-PATCH-of-own-rol surprise redirect remains an accepted open product question. The dialog/showModal follow-up remains an accepted open question. intentosFallidos/bloqueadoHasta absence remains an inherited scope boundary.
