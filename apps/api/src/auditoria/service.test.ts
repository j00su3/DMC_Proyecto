import { describe, expect, it, vi } from 'vitest';
import type { AuditEvent } from './service.js';
import { pseudonymizeFields, recordAudit } from './service.js';

// Minimal stub satisfying the AuditoriaRepo port (`repository.ts`, task 3.6
// — not implemented yet at this point in the TDD cycle, only its interface
// type is needed here).
function stubRepo(record: (event: AuditEvent) => Promise<void>) {
  return { record };
}

const baseEvent: AuditEvent = {
  entidad: 'usuarios',
  entidadId: 'a3b1c2d3-0000-4000-8000-000000000001',
  accion: 'actualizar',
  usuarioId: 'a3b1c2d3-0000-4000-8000-000000000002',
  datosPrevios: { nombre: 'Old Name' },
  datosPosteriores: { nombre: 'New Name' },
};

describe('pseudonymizeFields', () => {
  const KEY = 'a-test-hmac-key-that-is-at-least-32-characters-long';

  it('replaces a listed string field with an hmac-sha256:<64 hex chars> pseudonym', () => {
    const result = pseudonymizeFields(
      { email: 'ana@example.com' },
      ['email'],
      KEY,
    );

    expect(result.email).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
  });

  it('is deterministic: the same value and key always produce the same pseudonym', () => {
    const first = pseudonymizeFields(
      { email: 'ana@example.com' },
      ['email'],
      KEY,
    );
    const second = pseudonymizeFields(
      { email: 'ana@example.com' },
      ['email'],
      KEY,
    );

    expect(first.email).toBe(second.email);
  });

  it('produces different pseudonyms for two different values', () => {
    const ana = pseudonymizeFields(
      { email: 'ana@example.com' },
      ['email'],
      KEY,
    );
    const beto = pseudonymizeFields(
      { email: 'beto@example.com' },
      ['email'],
      KEY,
    );

    // This is what makes an email-only audit change visibly show a diff
    // between datosPrevios/datosPosteriores instead of two identical values
    // (backlog #2.5).
    expect(ana.email).not.toBe(beto.email);
  });

  it('leaves a field not listed in pseudonymizedFields untouched', () => {
    const result = pseudonymizeFields(
      { email: 'ana@example.com', nombre: 'Ana' },
      ['email'],
      KEY,
    );

    expect(result.nombre).toBe('Ana');
  });

  it('leaves a missing field alone instead of crashing', () => {
    expect(() =>
      pseudonymizeFields({ nombre: 'Ana' }, ['email'], KEY),
    ).not.toThrow();
    expect(pseudonymizeFields({ nombre: 'Ana' }, ['email'], KEY)).toEqual({
      nombre: 'Ana',
    });
  });

  it('leaves a null field alone instead of crashing', () => {
    expect(pseudonymizeFields({ email: null }, ['email'], KEY)).toEqual({
      email: null,
    });
  });
});

describe('recordAudit', () => {
  it('never lets an excluded field (hashContrasena) reach either snapshot', async () => {
    let captured: AuditEvent | undefined;
    const repo = stubRepo(async (event) => {
      captured = event;
    });

    await recordAudit(repo, {
      ...baseEvent,
      accion: 'cambiar_password',
      datosPrevios: { hashContrasena: 'old-hash', debeCambiarPassword: true },
      datosPosteriores: {
        hashContrasena: 'new-hash',
        debeCambiarPassword: false,
      },
    });

    expect(captured?.datosPrevios).not.toHaveProperty('hashContrasena');
    expect(captured?.datosPosteriores).not.toHaveProperty('hashContrasena');
    expect(captured?.datosPrevios).toEqual({ debeCambiarPassword: true });
    expect(captured?.datosPosteriores).toEqual({ debeCambiarPassword: false });
  });

  it('on crear, passes datosPrevios through as null and keeps the whole created-row snapshot (minus excluded fields)', async () => {
    let captured: AuditEvent | undefined;
    const repo = stubRepo(async (event) => {
      captured = event;
    });

    await recordAudit(repo, {
      ...baseEvent,
      accion: 'crear',
      datosPrevios: null,
      datosPosteriores: {
        id: baseEvent.entidadId,
        nombre: 'New User',
        hashContrasena: 'irrelevant',
      },
    });

    expect(captured?.datosPrevios).toBeNull();
    expect(captured?.datosPosteriores).toEqual({
      id: baseEvent.entidadId,
      nombre: 'New User',
    });
  });

  // Regression test for backlog #2.5's exact edge case: an evaluation on
  // 2026-08-30 tried closing SEC-012 by moving `email` to `excludedFields`
  // and found that an email-only change then left BOTH snapshots empty —
  // the audit row recorded that something happened without saying what.
  // Pseudonymizing instead of excluding keeps `email` present in both
  // snapshots, so the row still shows a visible diff. COOKIE_SECRET here
  // comes from `vitest.config.ts`'s test env, same as every other
  // `recordAudit` call in this suite.
  it('pseudonymizes usuarios.email in both snapshots, so an email-only change still shows a visible diff (backlog #2.5)', async () => {
    let captured: AuditEvent | undefined;
    const repo = stubRepo(async (event) => {
      captured = event;
    });

    await recordAudit(repo, {
      ...baseEvent,
      datosPrevios: { email: 'old@example.com' },
      datosPosteriores: { email: 'new@example.com' },
    });

    const before = captured?.datosPrevios as Record<string, unknown>;
    const after = captured?.datosPosteriores as Record<string, unknown>;

    expect(before.email).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    expect(after.email).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    // The actual point of #2.5: two DIFFERENT pseudonyms, not two empty or
    // identical snapshots.
    expect(before.email).not.toBe(after.email);
  });

  it('never puts the plaintext email in either snapshot', async () => {
    let captured: AuditEvent | undefined;
    const repo = stubRepo(async (event) => {
      captured = event;
    });

    await recordAudit(repo, {
      ...baseEvent,
      datosPrevios: { email: 'old@example.com' },
      datosPosteriores: { email: 'new@example.com' },
    });

    expect(JSON.stringify(captured?.datosPrevios)).not.toContain(
      'old@example.com',
    );
    expect(JSON.stringify(captured?.datosPosteriores)).not.toContain(
      'new@example.com',
    );
  });

  it('wraps a repo failure as AUDIT_WRITE_FAILED, preserving the original cause', async () => {
    const originalError = new Error('insert violates check constraint');
    const repo = stubRepo(async () => {
      throw originalError;
    });

    await expect(recordAudit(repo, baseEvent)).rejects.toMatchObject({
      code: 'AUDIT_WRITE_FAILED',
      status: 500,
      cause: originalError,
    });
  });

  it('has no parameter through which a quantity of units can be passed (ADR-0012 rule 3, D15)', async () => {
    const repo = stubRepo(vi.fn());

    // @ts-expect-error — the audit event type has no quantity-shaped field;
    // this must fail to compile, not just fail at runtime.
    await recordAudit(repo, { ...baseEvent, cantidad: 5 });
  });
});
