import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { productos, proveedores, usuarios } from '../db/schema.js';
import { FIELD_CLASSIFICATION } from './fields.js';
import type { AuditoriaRepo } from './repository.js';
import { recordAudit } from './service.js';

describe('FIELD_CLASSIFICATION', () => {
  it('classifies every usuarios column as auditable or excluded, failing by name when one is missing', () => {
    const realColumns = Object.keys(getTableColumns(usuarios)).sort();
    const { auditableFields, excludedFields } = FIELD_CLASSIFICATION.usuarios;
    const classified: string[] = [...auditableFields, ...excludedFields].sort();

    const missing = realColumns.filter(
      (column) => !classified.includes(column),
    );
    const stale = classified.filter((column) => !realColumns.includes(column));

    expect(missing).toEqual([]);
    expect(stale).toEqual([]);
    expect(classified).toEqual(realColumns);
  });

  it('excludes hashContrasena from usuarios auditable fields', () => {
    const { auditableFields, excludedFields } = FIELD_CLASSIFICATION.usuarios;

    expect(auditableFields).not.toContain('hashContrasena');
    expect(excludedFields).toContain('hashContrasena');
  });

  // backlog #2.5 / SEC-012: `pseudonymizedFields` sits outside the
  // exclude/auditable partition above — `email` stays listed in
  // `auditableFields` (it is NOT omitted), so the exhaustiveness assertion
  // above needs no change. This just proves `pseudonymizedFields` names a
  // real subset of it, so `recordAudit` never gets asked to pseudonymize a
  // field it also excludes.
  it('lists usuarios pseudonymizedFields as a subset of auditableFields, including email', () => {
    const { auditableFields, pseudonymizedFields } =
      FIELD_CLASSIFICATION.usuarios;

    expect(pseudonymizedFields).toEqual(['email']);
    for (const field of pseudonymizedFields ?? []) {
      expect(auditableFields).toContain(field);
    }
  });

  // design.md D5: the proposal's "call site, nothing more" claim about the
  // audit trail was wrong — `AuditableEntidad = keyof typeof
  // FIELD_CLASSIFICATION` has exactly one key before this entry exists, so
  // `recordAudit({ entidad: 'proveedores' })` would not even compile.
  it('classifies every proveedores column as auditable or excluded, failing by name when one is missing', () => {
    const realColumns = Object.keys(getTableColumns(proveedores)).sort();
    const { auditableFields, excludedFields } =
      FIELD_CLASSIFICATION.proveedores;
    const classified: string[] = [...auditableFields, ...excludedFields].sort();

    const missing = realColumns.filter(
      (column) => !classified.includes(column),
    );
    const stale = classified.filter((column) => !realColumns.includes(column));

    expect(missing).toEqual([]);
    expect(stale).toEqual([]);
    expect(classified).toEqual(realColumns);
  });

  // tasks.md task 1.8, backlog #5 (productos-ledger-base), S1b. R1 (settled
  // by the owner 2026-08-29): stockActual belongs in excludedFields — a
  // change in physical units belongs to movimientos (ADR-0012 rule 1), and
  // a movement already audits itself (rule 2). This assertion fails by
  // column name, not just count, when stockActual is missing from either
  // list or when any other column is missing/extra.
  it('classifies every productos column as auditable or excluded, excluding stockActual', () => {
    const realColumns = Object.keys(getTableColumns(productos)).sort();
    const { auditableFields, excludedFields } = FIELD_CLASSIFICATION.productos;
    const classified: string[] = [...auditableFields, ...excludedFields].sort();

    const missing = realColumns.filter(
      (column) => !classified.includes(column),
    );
    const stale = classified.filter((column) => !realColumns.includes(column));

    expect(missing).toEqual([]);
    expect(stale).toEqual([]);
    expect(classified).toEqual(realColumns);
    expect(auditableFields).not.toContain('stockActual');
    expect(excludedFields).toContain('stockActual');
  });

  // Compile-level proof that `AuditableEntidad = keyof typeof
  // FIELD_CLASSIFICATION` — not the `entidadAuditoria` pgEnum — is what
  // gates `recordAudit({ entidad: 'productos' })`. The pgEnum already lists
  // 'productos' and would let this compile with no fields.ts entry at all;
  // only adding the entry in task 1.9 makes this line type-check
  // (`pnpm typecheck`). This function is never called — its only job is to
  // exist and compile.
  function _compileGateProof(repo: AuditoriaRepo) {
    return recordAudit(repo, {
      entidad: 'productos',
      entidadId: 'x',
      accion: 'crear',
      usuarioId: 'x',
      datosPrevios: null,
      datosPosteriores: {},
    });
  }
  void _compileGateProof;
});
