# Archive Report: Anulación de Venta (Backlog #9)

**Change**: `anulacion-venta`
**Archive Date**: 2026-09-01
**Archived To**: `openspec/changes/archive/2026-09-01-anulacion-venta/`

## Summary

All 23 implementation tasks completed and verified. Specs merged into main capability specs. Backend and web implementations merged to main via PRs #130, #131, and follow-up fix #132. Verification PASS with 0 CRITICAL, 2 non-blocking WARNINGs (cosmetic), 1 SUGGESTION. Change is closed and ready for deployment.

## Artifact Traceability (Engram Observation IDs)

| Artifact | Observation ID | Created | Status |
|----------|---|---|---|
| Proposal | #238 | 2026-08-31 21:54:20 | Archived ✅ |
| Spec (point-of-sale + recibo-ui) | #239 | 2026-08-31 22:02:30 | Merged to main specs ✅ |
| Design | #241 | 2026-09-01 12:18:51 | Archived ✅ |
| Tasks (all 23) | #243 | 2026-09-01 12:29:18 | Complete ✅ |
| Verify Report | #245 | 2026-09-01 14:17:20 | PASS ✅ |
| Archive Report (this file) | — | 2026-09-01 | — |

## Work Completed

### Backend Implementation (PR #130)
- Schema: `ventas` + `anuladaPor`/`anuladaEn`/`motivoAnulacion` + CHECK `ventas_anulacion_datos_solo_anulada`
- Repository methods: `ProductosRepo.revertirStockPorAnulacion()` (A8-exempt), `VentasRepo.marcarAnulada()`, `VentasRepo.revertirPagos()`
- Service: `anularVenta()` with atomic `uow.run`, per-item stock reversal + movimiento creation, pagos revert
- Route: `POST /api/ventas/:id/anular`, `config: { roles: ['encargado'] }`, body `motivoAnulacion: z.string().trim().min(3).max(500)`
- Error factory: `saleAlreadyVoided()` → 409 `SALE_ALREADY_VOIDED`
- Contract: `ventaDto` extended with 3 new nullable fields; `pnpm contract` regenerated
- Tests: 451 unit tests (api) passing, 151 integration tests against real Postgres passing

### Web Implementation (PR #131)
- Data layer: `anularVentaFormSchema`, `useAnularVenta` mutation hook (invalidates `reciboKeys.detail` + `productosKeys.all`)
- UI: `AnularVentaModal.tsx` with mandatory motivo textarea, no second confirmation step (per design assumption)
- Route wiring: `/ventas/:id/recibo` trigger gated on `rol === 'encargado' && estado === 'confirmada'`, modal host, error message mapping
- `Recibo.tsx` unchanged (PD-4), trigger and modal live in route component only
- Tests: 441 unit tests (web) passing, RTL route tests passing

### Follow-up Fix (PR #132)
- Fixed atomicity test fidelity gap in PR #1 (commit 8585cd6): corrected `Object.create()` + `Object.assign()` pattern for injected failures to preserve prototype methods, confirming underlying transaction rollback guarantee is real

### Specs Merged

#### point-of-sale/spec.md
- Removed "Anulación / voiding" from Non-Goals
- Updated failure table: added new error codes and status codes for anulación
- Appended full ADDED Requirements section with 8 requirements (Encargado-only, Mandatory motivo, No time limit, Atomic reversal, A8 exemption, Already-anulada conflict, Correlativo immutability, Total reversal only)
- Added Open Questions for anulación (route shape, error codes, length constraints, ventaDto exposure)

#### recibo-ui/spec.md
- Removed "Anulación itself" from Non-Goals
- Appended full ADDED Requirements section with 1 requirement: Anulación Entry Point On Receipt View (PD-3)
- Added Open Questions for anulación (placement, confirmation step, client-side length floor)

## Design Decisions Archived

Per design.md, the following decisions were finalized:

1. **Route shape**: `POST /api/ventas/:id/anular` (action-style) — ratified at design time
2. **Serialization point**: Conditional UPDATE on `ventas` runs first, ensuring race guard via ADR-0005 idiom
3. **A8 exemption**: `revertirStockPorAnulacion` has no `activo` predicate, quantities positive-only for anti-backdoor safety
4. **Pagos revert**: Bulk UPDATE all `registrado` → `revertido` in same transaction
5. **No audit**: `ventas` is not an `AuditableEntidad` per #7 D9; anulación metadata + movimientos are the trail
6. **Error codes**: `saleAlreadyVoided()` 409 `SALE_ALREADY_VOIDED`; motivo validation via direct AppError in service, not Zod (deviation from tasks phrasing, functionally equivalent)
7. **UI placement**: Receipt route `/ventas/:id/recibo`, not POS screen — resolves recibo-ui's ambiguity flag
8. **No second confirm**: Modal + mandatory typed motivo treated as sufficient, matching `MovimientoModal` precedent

## Final State Authority

**Ranked from highest to lowest authority** (per skill specification):

1. **Native review authority**: Not applicable — review-driven development kill switch was off; no `reviewGate` present.
2. **Persisted tasks artifact**: All 23 tasks marked complete in `openspec/changes/archive/2026-09-01-anulacion-venta/tasks.md` ✅
3. **Orchestrator launch prompt**: Confirms all 3 PRs merged to main, current HEAD = 7ebe04c, verify-report already exists and states PASS.
4. **Verify-report** (intermediate snapshot): 0 CRITICAL, 2 non-blocking WARNINGs (cosmetic), 1 SUGGESTION — intermediate state, superseded by verification at archive time.

### Verification Status

Per `verify-report` #245 (2026-09-01 14:17:20):
- **Tasks verified**: 23/23 checked and cross-verified against source
- **Specs verified**: 9 requirements / 18 scenarios, all covered by passing runtime tests
- **Design verified**: All 8 architecture decisions present in source
- **Gate commands**: `pnpm --filter api test` 451/451, `pnpm test:integration` 151/151 (real Docker Postgres), `pnpm --filter web test` 441/441, `pnpm typecheck` clean, `pnpm lint` clean, `pnpm contract:check` clean
- **Follow-up PR #132**: Independently verified; atomicity test corrected to prove real rollback guarantee

### Non-Blocking Findings

**WARNING 1 (cosmetic)**: Motivo-length guard implemented as hand-written `AppError` throw in `ventas/service.ts` rather than Zod validation. Tasks phrasing suggested Zod; implementation is functionally equivalent and was flagged in apply-progress. Self-disclosed deviation.

**WARNING 2 (cosmetic)**: Design.md Open Question 4 ("Confirming that exposing `anuladaPor`/`anuladaEn`/`motivoAnulacion` on `ventaDto` is wanted") was resolved in practice (fields implemented, verified in apply/verify) but its checkbox was never ticked. **Ticked at archive time** with confirmation note.

**SUGGESTION**: BACKLOG.md row 9 correctly still marked "Pendiente" during apply — flip to "Archivado" belongs in archive phase per #6/#7/#8 convention. **Flipped at archive time** per this convention.

## Git Status

- **Current HEAD**: 7ebe04c (main)
- **Merged PRs**: #130 (backend), #131 (web), #132 (test-fidelity fix)
- **Tree state at archive**: Clean, all implementation committed and merged

## Deployment Notes

**Manual pre-deploy step**: `pnpm db:migrate` must run against Neon before deploying the API, or all anulación routes will 500. Migration was shipped with PR #130 (Phase 1). Schema already migrated in backend PR merge.

**No new code in PR #132 affects production**: Follow-up fix is test-only (corrected atomicity-test fidelity); web-side PR #131 has no backend dependencies.

## Deviations from Tasks Artifact

Per verify-report and final-state authority:

1. **Motivo validation mechanism**: Tasks described "Zod `VALIDATION_ERROR`"; implementation throws direct `AppError` in service. Functionally equivalent, was flagged in apply-progress; not a blocker.
2. **All other tasks executed exactly as specified**: 23/23 complete, no unchecked implementation tasks.

## Archive Contents

```
openspec/changes/archive/2026-09-01-anulacion-venta/
├── proposal.md                 (original proposal with 5 product decisions)
├── design.md                   (technical design with 10 architecture decisions; OQ4 ticked at archive)
├── specs/
│   ├── point-of-sale/spec.md   (delta + merged into main spec)
│   └── recibo-ui/spec.md       (delta + merged into main spec)
├── tasks.md                    (23 complete tasks)
├── verify-report.md            (PASS, 0 CRITICAL, 2 WARNINGs, 1 SUGGESTION)
└── archive-report.md           (this file)
```

## Next Steps

1. **Deployment**: Merge to production; run `pnpm db:migrate` against Neon first.
2. **No follow-up**: Cycle is complete. Ready for backlog #10 (Motor de alertas).

---

**Archive Cycle Closed**: 2026-09-01 per SDD archive phase
**Traceability**: All artifact IDs recorded for audit trail
**Final Authority**: Orchestrator launch prompt + persisted tasks + verify-report
