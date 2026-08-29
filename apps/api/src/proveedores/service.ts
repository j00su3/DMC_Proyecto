import { recordAudit } from '../auditoria/service.js';
import type { UnitOfWork } from '../db/uow.js';
import { supplierNotFound } from '../lib/errors.js';
import type {
  CambiosProveedor,
  Proveedor,
  ProveedoresRepo,
} from './repository.js';

// Local read-only shape, mirroring usuarios/service.ts's ReadRepos: the read
// paths do not depend on the Fastify plugin layer. The write paths take a
// `UnitOfWork` instead and never see a repo they did not get from `run`.
export interface ReadRepos {
  proveedores: ProveedoresRepo;
}

export interface ListProveedoresInput {
  page: number;
  pageSize: number;
}

export interface CreateProveedorInput {
  nombre: string;
  contacto?: string | null;
  actorId: string;
}

export interface UpdateProveedorInput {
  id: string;
  cambios: CambiosProveedor;
  actorId: string;
}

export interface SetProveedorActivoInput {
  id: string;
  activo: boolean;
  actorId: string;
}

interface Diff {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

// Changed fields only, in both directions — mirrors usuarios/service.ts's
// changedFields(). The emptiness of `after` is also what makes a no-op
// PATCH/deactivate/reactivate write nothing and audit nothing: `actualizar`/
// `baja_logica`/`reactivar` name a TRANSITION, and filing one that did not
// happen would pollute the trail.
function changedFields(
  previo: Record<string, unknown>,
  cambios: Record<string, unknown>,
): Diff {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cambios)) {
    if (previo[key] !== value) {
      before[key] = previo[key];
      after[key] = value;
    }
  }
  return { before, after };
}

function isEmpty(diff: Diff): boolean {
  return Object.keys(diff.after).length === 0;
}

export async function listProveedores(
  repos: ReadRepos,
  input: ListProveedoresInput,
): Promise<{ rows: Proveedor[]; total: number }> {
  return repos.proveedores.list(input.page, input.pageSize);
}

export async function getProveedor(
  repos: ReadRepos,
  id: string,
): Promise<Proveedor> {
  const proveedor = await repos.proveedores.findById(id);
  if (!proveedor) {
    throw supplierNotFound();
  }
  return proveedor;
}

// No `findByIdForUpdate` lock needed here (unlike update/setActivo): a
// create cannot race against a read-then-diff sequence on a row that does
// not exist yet, and the unique-name race is already resolved at the
// database (design.md D2/D13) — the repo throws `supplierNameInUse()`
// itself on a caught 23505.
export async function createProveedor(
  uow: UnitOfWork,
  input: CreateProveedorInput,
): Promise<Proveedor> {
  return uow.run(async (repos) => {
    const creado = await repos.proveedores.create({
      nombre: input.nombre,
      contacto: input.contacto ?? null,
    });
    await recordAudit(repos.auditoria, {
      entidad: 'proveedores',
      entidadId: creado.id,
      accion: 'crear',
      usuarioId: input.actorId,
      datosPrevios: null,
      datosPosteriores: { ...creado },
    });
    return creado;
  });
}

export async function updateProveedor(
  uow: UnitOfWork,
  input: UpdateProveedorInput,
): Promise<Proveedor> {
  return uow.run(async (repos) => {
    const previo = await repos.proveedores.findByIdForUpdate(input.id);
    if (!previo) {
      throw supplierNotFound();
    }

    const diff = changedFields(
      previo as unknown as Record<string, unknown>,
      input.cambios as Record<string, unknown>,
    );
    if (isEmpty(diff)) {
      return previo;
    }

    const posterior = await repos.proveedores.update(input.id, input.cambios);
    await recordAudit(repos.auditoria, {
      entidad: 'proveedores',
      entidadId: input.id,
      accion: 'actualizar',
      usuarioId: input.actorId,
      datosPrevios: diff.before,
      datosPosteriores: diff.after,
    });
    return posterior;
  });
}

// Deactivate and reactivate are the same repo call with the verb determined
// by which one was invoked, not inferred from the diff — mirroring
// usuarios/service.ts's setUsuarioActivo(). Deliberately no last-active-
// supplier guard, no lock-set query, and no predicate lock beyond the
// existing findByIdForUpdate: deactivating the last supplier breaks
// nothing (products keep their FK, history keeps its rows), unlike losing
// every active encargado, so there is no invariant here to protect.
export async function setProveedorActivo(
  uow: UnitOfWork,
  input: SetProveedorActivoInput,
): Promise<Proveedor> {
  return uow.run(async (repos) => {
    const previo = await repos.proveedores.findByIdForUpdate(input.id);
    if (!previo) {
      throw supplierNotFound();
    }

    const diff = changedFields(previo as unknown as Record<string, unknown>, {
      activo: input.activo,
    });
    if (isEmpty(diff)) {
      return previo;
    }

    const posterior = await repos.proveedores.setActivo(input.id, input.activo);
    const accion = input.activo ? 'reactivar' : 'baja_logica';
    await recordAudit(repos.auditoria, {
      entidad: 'proveedores',
      entidadId: input.id,
      accion,
      usuarioId: input.actorId,
      datosPrevios: diff.before,
      datosPosteriores: diff.after,
    });
    return posterior;
  });
}
