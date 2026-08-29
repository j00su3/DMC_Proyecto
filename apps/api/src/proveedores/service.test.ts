import { describe, expect, it, vi } from 'vitest';
import type { UnitOfWork } from '../db/uow.js';
import type { Repos } from '../plugins/repos.js';
import type { Proveedor } from './repository.js';
import {
  createProveedor,
  getProveedor,
  listProveedores,
  setProveedorActivo,
  updateProveedor,
} from './service.js';

const ACTOR_ID = '00000000-0000-4000-8000-0000000000ff';
const TARGET_ID = '11111111-1111-4111-8111-111111111111';

function proveedor(over: Partial<Proveedor> = {}): Proveedor {
  return {
    id: TARGET_ID,
    nombre: 'Distribuidora Norte',
    contacto: 'contacto@norte.example',
    activo: true,
    creadoEn: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

interface CallRecord {
  method: string;
  insideTransaction: boolean;
}

// Mirrors usuarios/service.test.ts's harness: a UnitOfWork whose run() really
// opens and closes, so the suite can assert WHERE each repo call happened,
// not just that it happened.
function harness(
  options: {
    previo?: Proveedor | undefined;
    setActivoResult?: Proveedor;
  } = {},
) {
  let transactionOpen = false;
  const calls: CallRecord[] = [];
  const runCount = { value: 0 };

  const spy = <T>(method: string, result: (...args: never[]) => T) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ method, insideTransaction: transactionOpen });
      return result(...(args as never[]));
    });

  const previo = 'previo' in options ? options.previo : proveedor();

  const proveedores = {
    list: spy('list', async () => ({ rows: [proveedor()], total: 1 })),
    findById: spy('findById', async () => previo),
    findByIdForUpdate: spy('findByIdForUpdate', async () => previo),
    create: spy('create', async () => proveedor()),
    update: spy('update', async () =>
      proveedor({ contacto: 'nuevo@example.com' }),
    ),
    setActivo: spy(
      'setActivo',
      async () => options.setActivoResult ?? proveedor({ activo: false }),
    ),
  };

  const auditoria = { record: spy('auditoria.record', async () => {}) };

  const repos = { proveedores, auditoria } as unknown as Repos;

  const uow: UnitOfWork = {
    async run(work) {
      runCount.value += 1;
      transactionOpen = true;
      try {
        return await work(repos);
      } finally {
        transactionOpen = false;
      }
    },
  };

  return { repos, uow, proveedores, auditoria, calls, runCount };
}

function auditEvent(auditoria: { record: ReturnType<typeof vi.fn> }) {
  return auditoria.record.mock.calls[0]?.[0];
}

describe('listProveedores / getProveedor', () => {
  it('passes pagination through and returns rows with the total', async () => {
    const h = harness();

    await expect(
      listProveedores(h.repos, { page: 2, pageSize: 25 }),
    ).resolves.toEqual({ rows: [proveedor()], total: 1 });
    expect(h.proveedores.list).toHaveBeenCalledWith(2, 25);
  });

  it('raises SUPPLIER_NOT_FOUND when the id matches no row', async () => {
    const h = harness({ previo: undefined });

    await expect(getProveedor(h.repos, TARGET_ID)).rejects.toMatchObject({
      code: 'SUPPLIER_NOT_FOUND',
      status: 404,
    });
  });

  it('returns the DTO when the id matches', async () => {
    const h = harness();

    await expect(getProveedor(h.repos, TARGET_ID)).resolves.toEqual(
      proveedor(),
    );
  });
});

describe('createProveedor', () => {
  it('creates inside one uow.run and files a crear audit row with a null previous snapshot', async () => {
    const h = harness();

    const result = await createProveedor(h.uow, {
      nombre: 'Distribuidora Norte',
      contacto: 'contacto@norte.example',
      actorId: ACTOR_ID,
    });

    expect(result).toEqual(proveedor());
    expect(h.runCount.value).toBe(1);
    expect(h.calls.find((c) => c.method === 'create')?.insideTransaction).toBe(
      true,
    );
    expect(
      h.calls.find((c) => c.method === 'auditoria.record')?.insideTransaction,
    ).toBe(true);
    expect(auditEvent(h.auditoria)).toMatchObject({
      entidad: 'proveedores',
      entidadId: TARGET_ID,
      accion: 'crear',
      usuarioId: ACTOR_ID,
      datosPrevios: null,
    });
  });
});

describe('updateProveedor', () => {
  it('writes nothing and files no audit row when the request changes nothing', async () => {
    const h = harness();

    const result = await updateProveedor(h.uow, {
      id: TARGET_ID,
      cambios: { nombre: 'Distribuidora Norte' },
      actorId: ACTOR_ID,
    });

    expect(result).toEqual(proveedor());
    expect(h.proveedores.update).not.toHaveBeenCalled();
    expect(h.auditoria.record).not.toHaveBeenCalled();
  });

  it('raises SUPPLIER_NOT_FOUND before any write when the id matches no row', async () => {
    const h = harness({ previo: undefined });

    await expect(
      updateProveedor(h.uow, {
        id: TARGET_ID,
        cambios: { nombre: 'Otro Nombre' },
        actorId: ACTOR_ID,
      }),
    ).rejects.toMatchObject({ code: 'SUPPLIER_NOT_FOUND', status: 404 });
    expect(h.proveedores.update).not.toHaveBeenCalled();
    expect(h.auditoria.record).not.toHaveBeenCalled();
  });

  it('writes only the changed fields and files an actualizar audit row with both directions', async () => {
    const h = harness();

    await updateProveedor(h.uow, {
      id: TARGET_ID,
      cambios: { contacto: 'nuevo@example.com' },
      actorId: ACTOR_ID,
    });

    expect(h.proveedores.update).toHaveBeenCalledWith(TARGET_ID, {
      contacto: 'nuevo@example.com',
    });
    expect(auditEvent(h.auditoria)).toMatchObject({
      entidad: 'proveedores',
      entidadId: TARGET_ID,
      accion: 'actualizar',
      usuarioId: ACTOR_ID,
      datosPrevios: { contacto: 'contacto@norte.example' },
      datosPosteriores: { contacto: 'nuevo@example.com' },
    });
  });
});

describe('setProveedorActivo', () => {
  it('writes nothing and files no audit row when activo already matches', async () => {
    const h = harness();

    const result = await setProveedorActivo(h.uow, {
      id: TARGET_ID,
      activo: true,
      actorId: ACTOR_ID,
    });

    expect(result).toEqual(proveedor());
    expect(h.proveedores.setActivo).not.toHaveBeenCalled();
    expect(h.auditoria.record).not.toHaveBeenCalled();
  });

  it('deactivating the only active supplier succeeds and records baja_logica, with no guard consulted', async () => {
    const h = harness();

    const result = await setProveedorActivo(h.uow, {
      id: TARGET_ID,
      activo: false,
      actorId: ACTOR_ID,
    });

    expect(result).toEqual(proveedor({ activo: false }));
    expect(h.proveedores.setActivo).toHaveBeenCalledWith(TARGET_ID, false);
    // D8 negative: there is no lock-set method on ProveedoresRepo for this
    // service to consult, and the harness's `proveedores` fake above has
    // none — this test would fail to compile if the service reached for one.
    expect(auditEvent(h.auditoria)).toMatchObject({
      entidad: 'proveedores',
      entidadId: TARGET_ID,
      accion: 'baja_logica',
      usuarioId: ACTOR_ID,
      datosPrevios: { activo: true },
      datosPosteriores: { activo: false },
    });
  });

  it('reactivating records reactivar', async () => {
    const h = harness({
      previo: proveedor({ activo: false }),
      setActivoResult: proveedor({ activo: true }),
    });

    await setProveedorActivo(h.uow, {
      id: TARGET_ID,
      activo: true,
      actorId: ACTOR_ID,
    });

    expect(h.proveedores.setActivo).toHaveBeenCalledWith(TARGET_ID, true);
    expect(auditEvent(h.auditoria)).toMatchObject({
      entidad: 'proveedores',
      entidadId: TARGET_ID,
      accion: 'reactivar',
      usuarioId: ACTOR_ID,
      datosPrevios: { activo: false },
      datosPosteriores: { activo: true },
    });
  });

  it('raises SUPPLIER_NOT_FOUND before any write when the id matches no row', async () => {
    const h = harness({ previo: undefined });

    await expect(
      setProveedorActivo(h.uow, {
        id: TARGET_ID,
        activo: false,
        actorId: ACTOR_ID,
      }),
    ).rejects.toMatchObject({ code: 'SUPPLIER_NOT_FOUND', status: 404 });
    expect(h.proveedores.setActivo).not.toHaveBeenCalled();
    expect(h.auditoria.record).not.toHaveBeenCalled();
  });
});
