import { describe, expect, it, vi } from 'vitest';
import type { AlertasRepo } from '../alertas/repository.js';
import type { ProductosRepo } from '../productos/repository.js';
import type { ProveedoresRepo } from '../proveedores/repository.js';
import type { UsuariosRepo } from '../usuarios/repository.js';
import type { AuditoriaRepo, RegistroAuditoria } from './repository.js';
import type { AuditEvent } from './service.js';
import { listar, pseudonymizeFields, recordAudit } from './service.js';

// Minimal stub satisfying the AuditoriaRepo port (`repository.ts`, task 3.6
// — not implemented yet at this point in the TDD cycle, only its interface
// type is needed here).
function stubRepo(record: (event: AuditEvent) => Promise<void>) {
  return { record, list: async () => ({ rows: [], total: 0 }) };
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

function makeRow(
  overrides: Partial<RegistroAuditoria> = {},
): RegistroAuditoria {
  return {
    id: 'auditoria-1',
    entidad: 'productos',
    entidadId: 'entidad-1',
    accion: 'actualizar',
    usuarioId: 'usuario-1',
    datosPrevios: null,
    datosPosteriores: {},
    creadoEn: new Date('2026-09-10T00:00:00.000Z'),
    ...overrides,
  };
}

// Never-called guard for the empty-bucket tests (design.md D3): a fake that
// throws if invoked proves the service actually skipped the call, rather
// than merely returning an empty array from a call that still happened.
function neverCalled(name: string): () => Promise<never> {
  return async () => {
    throw new Error(
      `${name}.findManyByIds must not be called for an empty bucket`,
    );
  };
}

describe('listar', () => {
  it('no-N+1 pin: 4-row and 40-row pages spanning all entidad values issue the same call counts', async () => {
    const rows4 = [
      makeRow({
        id: 'a1',
        entidad: 'usuarios',
        entidadId: 'u1',
        usuarioId: 'actor1',
      }),
      makeRow({
        id: 'a2',
        entidad: 'proveedores',
        entidadId: 'pv1',
        usuarioId: 'actor1',
      }),
      makeRow({
        id: 'a3',
        entidad: 'productos',
        entidadId: 'pr1',
        usuarioId: 'actor2',
      }),
      makeRow({
        id: 'a4',
        entidad: 'alertas',
        entidadId: 'al1',
        usuarioId: 'actor2',
      }),
    ];
    // 40-row page spanning the same four entidad values, many duplicate ids.
    const rows40 = Array.from({ length: 40 }, (_, i) =>
      makeRow({
        id: `b${i}`,
        entidad: (['usuarios', 'proveedores', 'productos', 'alertas'] as const)[
          i % 4
        ],
        entidadId: `entidad-${i % 4}`,
        usuarioId: `actor-${i % 2}`,
      }),
    );

    for (const rows of [rows4, rows40]) {
      const usuariosFind = vi.fn(async (_ids: string[]) => []);
      const proveedoresFind = vi.fn(async (_ids: string[]) => []);
      const productosFind = vi.fn(async (_ids: string[]) => []);
      const alertasFind = vi.fn(async (_ids: string[]) => []);

      const repos = {
        auditoria: { list: async () => ({ rows, total: rows.length }) } as Pick<
          AuditoriaRepo,
          'list'
        >,
        usuarios: { findManyByIds: usuariosFind } as unknown as Pick<
          UsuariosRepo,
          'findManyByIds'
        >,
        proveedores: { findManyByIds: proveedoresFind } as unknown as Pick<
          ProveedoresRepo,
          'findManyByIds'
        >,
        productos: { findManyByIds: productosFind } as unknown as Pick<
          ProductosRepo,
          'findManyByIds'
        >,
        alertas: { findManyByIds: alertasFind } as unknown as Pick<
          AlertasRepo,
          'findManyByIds'
        >,
      };

      await listar(repos, {}, 1, rows.length);

      expect(usuariosFind).toHaveBeenCalledTimes(1);
      expect(proveedoresFind).toHaveBeenCalledTimes(1);
      expect(productosFind).toHaveBeenCalledTimes(1);
      expect(alertasFind).toHaveBeenCalledTimes(1);

      // Each call must have received a deduped id array.
      for (const call of [
        usuariosFind.mock.calls[0],
        proveedoresFind.mock.calls[0],
        productosFind.mock.calls[0],
        alertasFind.mock.calls[0],
      ]) {
        const ids = call?.[0] as string[] | undefined;
        expect(ids).toBeDefined();
        expect(new Set(ids).size).toBe(ids?.length);
      }
    }
  });

  it('unions productos ids with alertas-referenced producto ids into one call', async () => {
    const rows = [
      makeRow({
        id: 'a1',
        entidad: 'productos',
        entidadId: 'prod-direct',
        usuarioId: 'u1',
      }),
      makeRow({
        id: 'a2',
        entidad: 'alertas',
        entidadId: 'alerta-1',
        usuarioId: 'u1',
      }),
    ];
    const productosFind = vi.fn(async (_ids: string[]) => []);

    const repos = {
      auditoria: { list: async () => ({ rows, total: rows.length }) } as Pick<
        AuditoriaRepo,
        'list'
      >,
      usuarios: { findManyByIds: async () => [] } as unknown as Pick<
        UsuariosRepo,
        'findManyByIds'
      >,
      proveedores: {
        findManyByIds: neverCalled('proveedores'),
      } as unknown as Pick<ProveedoresRepo, 'findManyByIds'>,
      productos: { findManyByIds: productosFind } as unknown as Pick<
        ProductosRepo,
        'findManyByIds'
      >,
      alertas: {
        findManyByIds: async () => [
          {
            id: 'alerta-1',
            tipo: 'stock_bajo' as const,
            productoId: 'prod-from-alerta',
          },
        ],
      } as unknown as Pick<AlertasRepo, 'findManyByIds'>,
    };

    await listar(repos, {}, 1, rows.length);

    expect(productosFind).toHaveBeenCalledTimes(1);
    const ids = productosFind.mock.calls[0]?.[0] as string[] | undefined;
    expect(new Set(ids)).toEqual(new Set(['prod-direct', 'prod-from-alerta']));
  });

  it('skips the call entirely for an empty bucket', async () => {
    // Only a proveedores row on this page; the actor id equals the same
    // proveedor-owning usuario id is irrelevant here — usuarios bucket +
    // actor set are both empty because there is exactly one row and its
    // usuarioId is resolved separately: use a row whose usuarioId is looked
    // up, but assert productos/alertas (truly empty here) never get called.
    const rows = [
      makeRow({
        id: 'a1',
        entidad: 'proveedores',
        entidadId: 'pv1',
        usuarioId: 'u1',
      }),
    ];

    const repos = {
      auditoria: { list: async () => ({ rows, total: rows.length }) } as Pick<
        AuditoriaRepo,
        'list'
      >,
      usuarios: {
        findManyByIds: async () => [{ id: 'u1', nombre: 'Ana' }],
      } as unknown as Pick<UsuariosRepo, 'findManyByIds'>,
      proveedores: {
        findManyByIds: async () => [{ id: 'pv1', nombre: 'Distribuidora' }],
      } as unknown as Pick<ProveedoresRepo, 'findManyByIds'>,
      productos: { findManyByIds: neverCalled('productos') } as unknown as Pick<
        ProductosRepo,
        'findManyByIds'
      >,
      alertas: { findManyByIds: neverCalled('alertas') } as unknown as Pick<
        AlertasRepo,
        'findManyByIds'
      >,
    };

    const result = await listar(repos, {}, 1, 20);
    expect(result.rows[0]?.entidadEtiqueta).toBe('Distribuidora');
  });

  it('resolves alertas label as `tipo: productoNombre` when both resolve', async () => {
    const rows = [
      makeRow({
        id: 'a1',
        entidad: 'alertas',
        entidadId: 'alerta-1',
        usuarioId: 'u1',
      }),
    ];

    const repos = {
      auditoria: { list: async () => ({ rows, total: 1 }) } as Pick<
        AuditoriaRepo,
        'list'
      >,
      usuarios: { findManyByIds: async () => [] } as unknown as Pick<
        UsuariosRepo,
        'findManyByIds'
      >,
      proveedores: {
        findManyByIds: neverCalled('proveedores'),
      } as unknown as Pick<ProveedoresRepo, 'findManyByIds'>,
      productos: {
        findManyByIds: async () => [{ id: 'prod-1', nombre: 'Café 500g' }],
      } as unknown as Pick<ProductosRepo, 'findManyByIds'>,
      alertas: {
        findManyByIds: async () => [
          { id: 'alerta-1', tipo: 'stock_bajo' as const, productoId: 'prod-1' },
        ],
      } as unknown as Pick<AlertasRepo, 'findManyByIds'>,
    };

    const result = await listar(repos, {}, 1, 20);
    expect(result.rows[0]?.entidadEtiqueta).toBe('stock_bajo: Café 500g');
  });

  it('falls back to bare tipo when the alerta resolves but its producto does not', async () => {
    const rows = [
      makeRow({
        id: 'a1',
        entidad: 'alertas',
        entidadId: 'alerta-1',
        usuarioId: 'u1',
      }),
    ];

    const repos = {
      auditoria: { list: async () => ({ rows, total: 1 }) } as Pick<
        AuditoriaRepo,
        'list'
      >,
      usuarios: { findManyByIds: async () => [] } as unknown as Pick<
        UsuariosRepo,
        'findManyByIds'
      >,
      proveedores: {
        findManyByIds: neverCalled('proveedores'),
      } as unknown as Pick<ProveedoresRepo, 'findManyByIds'>,
      productos: { findManyByIds: async () => [] } as unknown as Pick<
        ProductosRepo,
        'findManyByIds'
      >,
      alertas: {
        findManyByIds: async () => [
          {
            id: 'alerta-1',
            tipo: 'quiebre' as const,
            productoId: 'prod-missing',
          },
        ],
      } as unknown as Pick<AlertasRepo, 'findManyByIds'>,
    };

    const result = await listar(repos, {}, 1, 20);
    expect(result.rows[0]?.entidadEtiqueta).toBe('quiebre');
  });

  it('resolves entidadEtiqueta to null when the alerta itself is not found', async () => {
    const rows = [
      makeRow({
        id: 'a1',
        entidad: 'alertas',
        entidadId: 'alerta-missing',
        usuarioId: 'u1',
      }),
    ];

    const repos = {
      auditoria: { list: async () => ({ rows, total: 1 }) } as Pick<
        AuditoriaRepo,
        'list'
      >,
      usuarios: { findManyByIds: async () => [] } as unknown as Pick<
        UsuariosRepo,
        'findManyByIds'
      >,
      proveedores: {
        findManyByIds: neverCalled('proveedores'),
      } as unknown as Pick<ProveedoresRepo, 'findManyByIds'>,
      productos: { findManyByIds: neverCalled('productos') } as unknown as Pick<
        ProductosRepo,
        'findManyByIds'
      >,
      alertas: { findManyByIds: async () => [] } as unknown as Pick<
        AlertasRepo,
        'findManyByIds'
      >,
    };

    const result = await listar(repos, {}, 1, 20);
    expect(result.rows[0]?.entidadEtiqueta).toBeNull();
  });

  it('resolves entidadEtiqueta to null (not empty string) for an unresolved usuarios/proveedores/productos referent', async () => {
    const rows = [
      makeRow({
        id: 'a1',
        entidad: 'usuarios',
        entidadId: 'usuario-missing',
        usuarioId: 'actor1',
      }),
      makeRow({
        id: 'a2',
        entidad: 'proveedores',
        entidadId: 'proveedor-missing',
        usuarioId: 'actor1',
      }),
      makeRow({
        id: 'a3',
        entidad: 'productos',
        entidadId: 'producto-missing',
        usuarioId: 'actor1',
      }),
    ];

    const repos = {
      auditoria: { list: async () => ({ rows, total: rows.length }) } as Pick<
        AuditoriaRepo,
        'list'
      >,
      usuarios: { findManyByIds: async () => [] } as unknown as Pick<
        UsuariosRepo,
        'findManyByIds'
      >,
      proveedores: { findManyByIds: async () => [] } as unknown as Pick<
        ProveedoresRepo,
        'findManyByIds'
      >,
      productos: { findManyByIds: async () => [] } as unknown as Pick<
        ProductosRepo,
        'findManyByIds'
      >,
      alertas: { findManyByIds: neverCalled('alertas') } as unknown as Pick<
        AlertasRepo,
        'findManyByIds'
      >,
    };

    const result = await listar(repos, {}, 1, 20);
    for (const row of result.rows) {
      expect(row.entidadEtiqueta).toBeNull();
      expect(row.entidadEtiqueta).not.toBe('');
    }
  });

  it('is additive: raw ids stay present alongside the resolved labels', async () => {
    const rows = [
      makeRow({
        id: 'a1',
        entidad: 'productos',
        entidadId: 'producto-1',
        usuarioId: 'usuario-1',
      }),
    ];

    const repos = {
      auditoria: { list: async () => ({ rows, total: 1 }) } as Pick<
        AuditoriaRepo,
        'list'
      >,
      usuarios: {
        findManyByIds: async () => [{ id: 'usuario-1', nombre: 'Ana' }],
      } as unknown as Pick<UsuariosRepo, 'findManyByIds'>,
      proveedores: {
        findManyByIds: neverCalled('proveedores'),
      } as unknown as Pick<ProveedoresRepo, 'findManyByIds'>,
      productos: {
        findManyByIds: async () => [{ id: 'producto-1', nombre: 'Harina' }],
      } as unknown as Pick<ProductosRepo, 'findManyByIds'>,
      alertas: { findManyByIds: neverCalled('alertas') } as unknown as Pick<
        AlertasRepo,
        'findManyByIds'
      >,
    };

    const result = await listar(repos, {}, 1, 20);
    const row = result.rows[0];
    expect(row?.entidadId).toBe('producto-1');
    expect(row?.usuarioId).toBe('usuario-1');
    expect(row?.usuarioNombre).toBe('Ana');
    expect(row?.entidadEtiqueta).toBe('Harina');
  });
});
