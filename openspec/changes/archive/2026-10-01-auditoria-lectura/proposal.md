# Proposal: Audit Trail Read-Back Endpoint

## Intent

Close drift finding D-01 (`docs/DRIFT.md`): the `auditoria` table is write-only from the
application's perspective — `AuditoriaRepo` exposes only `record()`, no route reads it back — yet
ADR-0012's own rationale for the sensitive-field denylist assumes an encargado will read this
table. Today, an encargado who needs to answer "who changed this record, and to what" has no
in-app path and must fall back to direct SQL against Neon. This closes that gap with the shape
DRIFT.md itself suggests.

## Scope

### In Scope
- `AuditoriaRepo.list(filtros, page, pageSize)` — filterable by `entidad`+`entidadId` and by
  `usuarioId`, composable (AND), using the two indexes that already exist and are proven live
  (`auditoria_entidad_entidad_id_creado_en_idx`, `auditoria_usuario_id_creado_en_idx`).
- A thin service read wrapper that enriches each row with a human-readable label: `usuarioId` →
  `usuarios.nombre` (one join/`IN` lookup), and `entidadId` → a label resolved from whichever table
  `entidad` names, batched per page (group the page's rows by `entidad`, one `IN (...)` per
  represented table — never a per-row query). Design phase must settle the exact label shape per
  `entidad` value, in particular for `entidad = 'alertas'`, which has no single obvious display
  column.
- `GET /api/auditoria`, `roles: ['encargado']`, one endpoint, paginated with the standard
  `{ data, page, pageSize, total }` envelope.
- Updating the `record-audit-trail` spec's "Write-Only Scope (No Read Path)" requirement, which
  currently states v1 must expose no read path — this proposal reverses that requirement.

### Out of Scope
- Any change to what gets written or filtered at write time (`FIELD_CLASSIFICATION` in
  `apps/api/src/auditoria/fields.ts` stays as-is; it already makes stored data safe to read back
  verbatim).
- Depósito visibility into the audit trail (PRD's permission matrix already scopes their report
  access to operational-only; nothing here changes that).
- A UI/SPA screen for this endpoint — this proposal covers the API only, unless the owner asks to
  fold a UI slice in during spec.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `record-audit-trail`: the "Write-Only Scope (No Read Path)" requirement changes from "MUST NOT
  expose any endpoint... to read the trail in v1" to a requirement describing the new read path
  (route, RBAC, filters, pagination). This is a genuine requirement reversal, not an addition —
  flag explicitly for the spec phase.

## Approach

Copy the `GET /api/reportes/discrepancias` shape for RBAC/pagination: `roles: ['encargado']`, Zod
query schema via `pageQuerySchema`, repo `list()` using `and()`-composed optional `eq()` predicates
over the two already-indexed columns, `paginated()` envelope. No `UnitOfWork` needed — read-only,
and `app.repos.auditoria` is already available outside any transaction. No migration required.

The service wrapper additionally enriches the page: after fetching the page's rows, group them by
`entidad`, issue one batched `IN (...)` lookup per table represented on that page (never a per-row
query — the same N+1 trap `reportes/service.ts`'s `productoNombre` idiom already had to avoid), and
attach the resolved label alongside the raw ids (both returned — enrichment is additive, not a
replacement for the ids).

## Affected Areas

| Area | Impact | Description |
|------|--------|--------------|
| `apps/api/src/auditoria/repository.ts` | Modified | Add `list(filtros, page, pageSize)` (composable `entidad`+`entidadId`/`usuarioId` filters) |
| `apps/api/src/auditoria/service.ts` | Modified | Add read wrapper: batched per-`entidad` label enrichment on top of `list()` |
| `apps/api/src/routes/auditoria.ts` | New | `GET /api/auditoria`, `roles: ['encargado']` |
| `apps/api/src/app.ts` | Modified | Register new route group |
| `openspec/specs/record-audit-trail/spec.md` | Modified | Reverse write-only-scope requirement |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Requirement reversal reads as contradicting the original ADR-0011/0012 decision record | Low | Spec delta explicitly documents the reversal and cites this drift closure as the reason |
| Read endpoint accidentally exposes a denylisted/pseudonymized field despite write-time filtering | Low | Filtering is proven applied at write time (`recordAudit`); route projects stored JSONB as-is, no new logic to get wrong |
| Depósito gains unintended visibility | Low | Direct copy of `reportes/discrepancias`'s `roles: ['encargado']` gate, plus a route test asserting depósito gets 403 with no data |
| Enrichment turns into a hidden N+1 (one lookup query per row instead of per page) | Medium | Explicit batched-`IN`-per-`entidad` design, spec'd as a scenario with a paginated page spanning multiple `entidad` values, not left as an implementation afterthought |
| `entidad = 'alertas'` has no single natural label column, enrichment logic silently falls back to something unhelpful (e.g. just the id again) | Medium | Design phase must explicitly define the `alertas` label (likely derived via `productos` through `alertas.producto_id`) rather than leave it implicit |

## Rollback Plan

Revert the new route registration and repository/service additions; no migration or destructive
schema change is introduced, so rollback is a pure code revert with no data cleanup needed.

## Dependencies

None — both required indexes already exist and are proven live.

## Success Criteria

- [ ] `GET /api/auditoria` returns paginated, filtered audit rows to `encargado`, 403 to `deposito`
- [ ] Filtering by `entidad`+`entidadId` and by `usuarioId` compose (AND) and both use their
      respective existing index
- [ ] Each row is enriched with a resolved human-readable label for `usuarioId` and `entidadId`
      (including a defined answer for `entidad = 'alertas'`), without a per-row query — proven via
      a test asserting query count stays flat as page size grows
- [ ] `record-audit-trail` spec's write-only requirement is formally reversed, not left contradictory

## Proposal question round — RATIFIED 2026-09-11

These were open design questions surfaced during exploration. The owner has ratified all three;
recorded here so the (parallel, non-communicating) spec and design phases both build against the
same decisions:

1. **Row enrichment vs raw IDs — RATIFIED: enrich.** The response resolves a human-readable label
   for both `usuarioId` (join to `usuarios.nombre`) and `entidadId` (a label from whichever table
   `entidad` names) instead of returning bare UUIDs.

   **Scope note the ratification surfaces:** `entidad` is polymorphic (`usuarios` | `proveedores` |
   `productos` | `alertas`), so this is not one join — it's a per-row lookup that branches on
   `entidad` across **four different tables**, each with its own "label" column (`usuarios.nombre`,
   `proveedores.nombre`, `productos.nombre`, and `alertas` has no natural single label — likely
   `tipo` + `producto_id` resolved through `productos` again). This must be batched (group rows by
   `entidad`, one `IN (...)` query per table represented on the page), not resolved with a per-row
   query — an N+1 across a paginated list is exactly the kind of thing this codebase's own
   `reportes/service.ts` precedent already had to avoid. Spec/design must treat this as a real
   design surface, not a one-line addition: what happens when the referenced row was hard-deleted
   (only `usuarios`/`proveedores`/`productos` support baja lógica, so the row itself should still
   exist — but design should confirm this rather than assume it) and what the label looks like for
   `entidad = 'alertas'` specifically, since alerts have no obvious single display name.

2. **Filter composition — RATIFIED: composable (AND).** `usuarioId` and `entidad`+`entidadId` can
   be supplied together in the same request; the repository query ANDs whichever predicates are
   present, following the `alertas.list()` optional-`and()` precedent.

3. **One endpoint vs two — RATIFIED: one endpoint.** `GET /api/auditoria` with two optional filter
   groups (mirroring `alertas.list(filtro, page, pageSize)`), not two separate routes — consistent
   with decision 2: if the filters compose, they belong in one query, not two routes hitting the
   same table.
