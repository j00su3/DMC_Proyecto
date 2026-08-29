import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { proveedores, usuarios } from '../db/schema.js';
import { FIELD_CLASSIFICATION } from './fields.js';

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
});
