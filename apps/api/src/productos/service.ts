import { recordAudit } from '../auditoria/service.js';
import type { UnitOfWork } from '../db/uow.js';
import {
  fieldReservedForEncargado,
  supplierInactive,
  supplierNotFound,
  unauthorized,
} from '../lib/errors.js';
import type { ProveedoresRepo } from '../proveedores/repository.js';
import type { Producto } from './repository.js';

// `actualizarProducto`/`setProductoActivo`/`listProductos`/`getProducto` are
// Phase 5 (S3b) — this slice ships `crearProducto` only (tasks.md task 4.2).

// Local read-only shape, mirroring proveedores/service.ts's ReadRepos: the
// inactive-supplier guard must run BEFORE `uow.run` opens (rule 3), so it
// needs a proveedores repo the caller can supply outside the transaction —
// the same repo `app.repos.proveedores` already is.
export interface ReadRepos {
  proveedores: ProveedoresRepo;
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

  return uow.run(async (txRepos) => {
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
      await txRepos.movimientos.create({
        productoId: creado.id,
        tipo: 'ajuste',
        cantidad: input.stockInicial,
        motivo: 'stock inicial (alta de producto)',
        esDiscrepancia: false,
        usuarioId: input.actor.id,
        stockResultante: stockActual,
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
