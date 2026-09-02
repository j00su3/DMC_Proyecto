import { registrarSiCorresponde } from '../alertas/service.js';
import { recordAudit } from '../auditoria/service.js';
import type { UnitOfWork } from '../db/uow.js';
import {
  fieldReservedForEncargado,
  productNotFound,
  supplierInactive,
  supplierNotFound,
  unauthorized,
} from '../lib/errors.js';
import type { ProveedoresRepo } from '../proveedores/repository.js';
import type { CambiosProducto, Producto, ProductosRepo } from './repository.js';

// Local read-only shape, mirroring proveedores/service.ts's ReadRepos: the
// inactive-supplier guard must run BEFORE `uow.run` opens (rule 3), so it
// needs a proveedores repo the caller can supply outside the transaction —
// the same repo `app.repos.proveedores` already is. Widened in Phase 5 (S3b)
// with `productos` for the read paths (`listProductos`/`getProducto`).
export interface ReadRepos {
  proveedores: ProveedoresRepo;
  productos: ProductosRepo;
}

type Rol = 'encargado' | 'deposito';

// Generalised from routes/proveedores.ts:76-81's requireActorId (D6): this
// version also returns `rol`, which crearProducto's field guard needs. Kept
// here rather than in a routes file because no productos routes file exists
// yet in this slice (Phase 6 owns it) — it imports this from here then.
export function requireActor(user: { id: string; rol: Rol } | null): {
  id: string;
  rol: Rol;
} {
  if (!user) {
    throw unauthorized();
  }
  return { id: user.id, rol: user.rol };
}

export interface CrearProductoInput {
  nombre: string;
  sku: string;
  categoria?: string | null;
  // Optional at the type level, but the guard below is a key-presence
  // check at runtime (`Object.hasOwn`), not a `!== undefined` check — a
  // `deposito` payload carrying `{ stockMinimo: null }` must still be
  // refused (tasks.md task 4.1's rule 2).
  stockMinimo?: number | null;
  precio: string;
  proveedorId: string;
  stockInicial: number;
  actor: { id: string; rol: Rol };
}

// Satisfies spec.md's "Product Creation Writes stock_actual And Its Initial
// Movement In One Transaction", the create half of "Field-Level Permission",
// "New Products May Not Reference An Inactive Supplier", and the create half
// of "Audit Trail Recorded For Every Mutation".
//
// Ordering, all load-bearing (tasks.md task 4.1's six rules):
//   1. The field guard runs BEFORE uow.run opens.
//   2. It is a key-presence check, not `!== undefined`.
//   3. The inactive-supplier guard also runs before uow.run.
//   4. Everything else happens inside exactly one uow.run invocation.
//   5. stockResultante comes from aplicarDelta's return value, never
//      recomputed.
//   6. recordAudit is the last statement inside uow.run.
export async function crearProducto(
  repos: ReadRepos,
  uow: UnitOfWork,
  input: CrearProductoInput,
): Promise<Producto> {
  if (Object.hasOwn(input, 'stockMinimo') && input.actor.rol !== 'encargado') {
    throw fieldReservedForEncargado();
  }

  const proveedor = await repos.proveedores.findById(input.proveedorId);
  if (!proveedor) {
    throw supplierNotFound();
  }
  if (!proveedor.activo) {
    throw supplierInactive();
  }

  return uow.run(async (txRepos, tx) => {
    const creado = await txRepos.productos.create({
      nombre: input.nombre,
      sku: input.sku,
      categoria: input.categoria ?? null,
      stockMinimo: input.stockMinimo ?? null,
      precio: input.precio,
      proveedorId: input.proveedorId,
    });

    let stockActual = creado.stockActual;
    if (input.stockInicial > 0) {
      const nuevoStock = await txRepos.productos.aplicarDelta(
        creado.id,
        input.stockInicial,
      );
      if (nuevoStock === undefined) {
        // Cannot happen for a product just created active with no prior
        // stock: aplicarDelta only returns undefined for an inactive
        // product or a result that would go negative, neither possible
        // here. A broken invariant, not a domain error to map.
        throw new Error(
          'crearProducto: aplicarDelta returned undefined for a just-created, active product',
        );
      }
      stockActual = nuevoStock;
      const movimiento = await txRepos.movimientos.create({
        productoId: creado.id,
        tipo: 'ajuste',
        cantidad: input.stockInicial,
        motivo: 'stock inicial (alta de producto)',
        esDiscrepancia: false,
        esMerma: false,
        usuarioId: input.actor.id,
        stockResultante: stockActual,
      });

      // design.md D3/PD-2: always upward from 0 today (a known v1
      // limitation — stockInicial === 0 raises no alert at all), but wired
      // per the evaluator's generic crossing rule for whenever that ceases
      // to be true.
      await registrarSiCorresponde(txRepos, tx, {
        movimiento,
        stockMinimo: creado.stockMinimo,
        actorId: input.actor.id,
      });
    }

    const productoFinal: Producto = { ...creado, stockActual };

    await recordAudit(txRepos.auditoria, {
      entidad: 'productos',
      entidadId: creado.id,
      accion: 'crear',
      usuarioId: input.actor.id,
      datosPrevios: null,
      datosPosteriores: { ...productoFinal },
    });

    return productoFinal;
  });
}

// Phase 5 (S3b): read/update/deactivate paths.

interface Diff {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

// Mirrors proveedores/service.ts's changedFields()/isEmpty() exactly (D10):
// only keys present in `cambios` are compared, and an empty `after` is what
// makes a no-op PATCH write nothing and audit nothing.
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

export interface ActualizarProductoInput {
  id: string;
  cambios: CambiosProducto;
  actor: { id: string; rol: Rol };
}

// Satisfies spec.md's "Field-Level Permission" (update half) and "New
// Products May Not Reference An Inactive Supplier" (update-only-when-
// proveedorId-present half — D8's TOCTOU-avoidance clause, the assertion the
// proposal calls "the one that matters more").
//
// Ordering, mirroring crearProducto's rules:
//   1. The field guard (stockMinimo key presence) runs BEFORE uow.run opens.
//   2. The inactive-supplier guard runs BEFORE uow.run opens too, and is
//      keyed on whether `proveedorId` is a key of the INCOMING `cambios`,
//      never on the product's currently-stored supplier — a PATCH that
//      omits the key must never re-run it, even when the row's existing
//      supplier is already inactive. Re-validating unconditionally looks
//      more careful and is wrong: it would make a product whose supplier
//      was later deactivated permanently uneditable, unable even to have
//      its name corrected.
//   3. findByIdForUpdate, the empty-diff no-op check, the write, and
//      recordAudit all happen inside exactly one uow.run invocation.
export async function actualizarProducto(
  repos: ReadRepos,
  uow: UnitOfWork,
  input: ActualizarProductoInput,
): Promise<Producto> {
  if (
    Object.hasOwn(input.cambios, 'stockMinimo') &&
    input.actor.rol !== 'encargado'
  ) {
    throw fieldReservedForEncargado();
  }

  if (Object.hasOwn(input.cambios, 'proveedorId')) {
    // biome-ignore lint/style/noNonNullAssertion: hasOwn just proved the key
    const proveedorId = input.cambios.proveedorId!;
    const proveedor = await repos.proveedores.findById(proveedorId);
    if (!proveedor) {
      throw supplierNotFound();
    }
    if (!proveedor.activo) {
      throw supplierInactive();
    }
  }

  return uow.run(async (txRepos) => {
    const previo = await txRepos.productos.findByIdForUpdate(input.id);
    if (!previo) {
      throw productNotFound();
    }

    const diff = changedFields(
      previo as unknown as Record<string, unknown>,
      input.cambios as Record<string, unknown>,
    );
    if (isEmpty(diff)) {
      return previo;
    }

    const posterior = await txRepos.productos.update(input.id, input.cambios);
    await recordAudit(txRepos.auditoria, {
      entidad: 'productos',
      entidadId: input.id,
      accion: 'actualizar',
      usuarioId: input.actor.id,
      datosPrevios: diff.before,
      datosPosteriores: diff.after,
    });

    // D7 (owner-ratified 2026-09-02): when stockMinimo changes from a
    // non-null value to null, any open stock_bajo alert for this product
    // no longer has a threshold to violate. A direct repo call, no
    // SAVEPOINT — this path has no stockActual staleness risk (single-row
    // update, not a multi-item sale loop) and no evaluator SQL to isolate
    // from. `quiebre`/`discrepancia` alerts are untouched (they never
    // depended on stockMinimo).
    if (
      Object.hasOwn(input.cambios, 'stockMinimo') &&
      input.cambios.stockMinimo === null &&
      previo.stockMinimo !== null
    ) {
      await txRepos.alertas.autoResolve(input.id, 'stock_bajo');
    }

    return posterior;
  });
}

export interface SetProductoActivoInput {
  id: string;
  activo: boolean;
  actor: { id: string; rol: Rol };
}

// Satisfies spec.md's "Logical Deactivation And Reactivation" — one repo
// call (setActivo) and one recordAudit call, both inside a single uow.run.
// Unlike proveedores' setProveedorActivo, there is no findByIdForUpdate/diff
// step here (tasks.md task 5.1/5.2): setActivo never deletes, so a missing
// row is a broken invariant for the repo to surface, not a 404 this service
// maps (mirrors repository.ts's expectOneRow precedent).
export async function setProductoActivo(
  uow: UnitOfWork,
  input: SetProductoActivoInput,
): Promise<Producto> {
  return uow.run(async (txRepos) => {
    const posterior = await txRepos.productos.setActivo(input.id, input.activo);
    const accion = input.activo ? 'reactivar' : 'baja_logica';
    await recordAudit(txRepos.auditoria, {
      entidad: 'productos',
      entidadId: input.id,
      accion,
      usuarioId: input.actor.id,
      datosPrevios: { activo: !input.activo },
      datosPosteriores: { activo: input.activo },
    });
    return posterior;
  });
}

export interface ListProductosInput {
  page: number;
  pageSize: number;
  q?: string;
}

// Satisfies spec.md's "List Products Supports Pagination And Search" — `q`
// passes through to the repository unchanged; the repository owns the
// ILIKE/escaping logic (D7).
export async function listProductos(
  repos: ReadRepos,
  input: ListProductosInput,
): Promise<{ rows: Producto[]; total: number }> {
  return repos.productos.list(input.page, input.pageSize, input.q);
}

export async function getProducto(
  repos: ReadRepos,
  id: string,
): Promise<Producto> {
  const producto = await repos.productos.findById(id);
  if (!producto) {
    throw productNotFound();
  }
  return producto;
}
