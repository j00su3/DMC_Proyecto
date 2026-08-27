import { describe, expect, it, vi } from 'vitest';
import type { AuditEvent } from './service.js';
import { recordAudit } from './service.js';

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
