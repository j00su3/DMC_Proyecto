import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { productos, proveedores, usuarios } from '../db/schema.js';
import {
  FIELD_CLASSIFICATION,
  PSEUDONYM_DOMAIN_TAGS,
  type PseudonymizedField,
} from './fields.js';
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

  // backlog #2.5 / SEC-012 and D-22: `pseudonymizedFields` sits outside the
  // exclude/auditable partition above — `email` and `nombre` stay listed in
  // `auditableFields` (they are NOT omitted), so the exhaustiveness assertion
  // above needs no change. This just proves `pseudonymizedFields` names a
  // real subset of it, so `recordAudit` never gets asked to pseudonymize a
  // field it also excludes.
  it('lists usuarios pseudonymizedFields as a subset of auditableFields, including email and nombre', () => {
    const { auditableFields, pseudonymizedFields } =
      FIELD_CLASSIFICATION.usuarios;

    expect(pseudonymizedFields).toEqual(['email', 'nombre']);
    for (const field of pseudonymizedFields ?? []) {
      expect(auditableFields).toContain(field);
    }
  });

  // nombre-seudonimizado D1-D3: every listed field resolves to its own
  // domain-separation tag, and no tag can be a prefix of another, so no
  // `tag + value` input can collide across fields.
  it('gives every pseudonymized field a distinct, well-formed tag, none a prefix of another', () => {
    const listed = new Set<string>();
    for (const entity of Object.values(FIELD_CLASSIFICATION)) {
      for (const field of entity.pseudonymizedFields ?? []) {
        listed.add(field);
      }
    }
    const tags = Object.values(PSEUDONYM_DOMAIN_TAGS);

    expect(listed.size).toBeGreaterThan(0);
    for (const field of listed) {
      expect(Object.keys(PSEUDONYM_DOMAIN_TAGS)).toContain(field);
    }
    expect(new Set(tags).size).toBe(tags.length);
    for (const tag of tags) {
      expect(tag).toMatch(/^audit-[a-z]+-pseudonym:$/);
      for (const other of tags) {
        if (other !== tag) {
          expect(other.startsWith(tag)).toBe(false);
        }
      }
    }
  });

  // Compile-level: a field with no tag cannot be listed (D3). Never called;
  // its only job is to make `pnpm typecheck` fail if `PseudonymizedField`
  // widens to `string`.
  function _untaggedFieldIsRejected() {
    // @ts-expect-error — 'contacto' has no entry in PSEUDONYM_DOMAIN_TAGS
    const _x: PseudonymizedField = 'contacto';
    return _x;
  }
  void _untaggedFieldIsRejected;

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
