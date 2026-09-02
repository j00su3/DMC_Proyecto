import { registrarSiCorresponde } from '../alertas/service.js';
import type { UnitOfWork } from '../db/uow.js';
import {
  insufficientStock,
  movementReasonRequired,
  productInactive,
  productNotFound,
} from '../lib/errors.js';
import type { Repos } from '../plugins/repos.js';
import type { Producto } from '../productos/repository.js';
import type { Movimiento } from './repository.js';

// design.md D8, RECONCILE-2 (resolved): 3, not the 5 the design originally
// proposed — 5 rejects "robo", one of the most ordinary merma reasons a shop
// will ever type.
export const MOTIVO_MIN_LENGTH = 3;

type Rol = 'encargado' | 'deposito';

export type TipoOperacion = 'entrada' | 'salida' | 'ajuste';

// design.md's Interfaces/Contracts section, verbatim (D7). `cantidad` is
// always a positive magnitude on the wire; the service derives the signed
// delta. `esMerma`/`esDiscrepancia` are caller-set per D7's table — the
// three route wrappers (S4) are responsible for setting them correctly per
// operation; this service passes them through to the ledger unchanged.
export interface RegistrarMovimientoInput {
  productoId: string;
  operacion: TipoOperacion;
  cantidad: number;
  direccion?: 'sumar' | 'restar';
  esMerma: boolean;
  esDiscrepancia: boolean;
  motivo?: string;
  actor: { id: string; rol: Rol };
}

// D1: aplicarDelta (productos/repository.ts:205-218) is not modified. On
// undefined, and only then, this classifies the rejection via a second read
// inside the same transaction, in a fixed precedence. Always throws, so
// TypeScript narrows the caller's `nuevoStock` to `number` after the call.
async function rechazarMovimiento(
  repos: Pick<Repos, 'productos'>,
  productoId: string,
): Promise<never> {
  const producto = await repos.productos.findById(productoId);
  if (!producto) {
    throw productNotFound();
  }
  if (!producto.activo) {
    throw productInactive();
  }
  throw insufficientStock(producto.stockActual);
}

// D7: cantidad on the wire is always a positive magnitude; the sign is a
// ledger encoding the service owns. ajuste's sign is genuinely bidirectional
// (direccion), entrada is always positive, salida (ordinary or merma) is
// always negative.
function calcularDelta(input: RegistrarMovimientoInput): number {
  if (input.operacion === 'entrada') {
    return input.cantidad;
  }
  if (input.operacion === 'salida') {
    return -input.cantidad;
  }
  return input.direccion === 'restar' ? -input.cantidad : input.cantidad;
}

// Satisfies spec.md's Role Gate (encargado-registers-ajuste half — the
// deposito-refused half is S4's route config), Motivo Mandatory Only On
// Ajuste And Merma Salidas, Motivo Is Free Text, Zero-Quantity Ajuste Is Not
// Representable (service half — the wire's positive-magnitude ≥1 shape is
// S4's), A Movement Against An Inactive Product Is Refused, Salida Below
// Zero Names Available Quantity, Stock And Ledger Write Atomicity, No Audit
// Row Is Ever Written.
//
// Ordering, all load-bearing (design.md D7):
//   1. The D8 motivo guard runs BEFORE uow.run opens — it is a payload-only
//      check that touches no database.
//   2. Everything else happens inside exactly one uow.run invocation.
//   3. stockResultante comes from aplicarDelta's return value, verbatim,
//      never recomputed.
//   4. No recordAudit call exists anywhere in this file (ADR-0012 rule 2) —
//      a movement's own row is its complete audit trail.
//   5. No try/catch anywhere inside uow.run (ADR-0008) — a failed statement
//      aborts the whole Postgres transaction (25P02); an application catch
//      does not isolate a future alert evaluator.
export async function registrarMovimiento(
  uow: UnitOfWork,
  input: RegistrarMovimientoInput,
): Promise<{ movimiento: Movimiento; producto: Producto }> {
  const motivoRequerido = input.operacion === 'ajuste' || input.esMerma;
  const motivoTrimmed = input.motivo?.trim() ?? '';
  if (motivoRequerido && motivoTrimmed.length < MOTIVO_MIN_LENGTH) {
    throw movementReasonRequired();
  }

  const delta = calcularDelta(input);

  return uow.run(async (txRepos, tx) => {
    const nuevoStock = await txRepos.productos.aplicarDelta(
      input.productoId,
      delta,
    );
    if (nuevoStock === undefined) {
      // `return`, not a bare `await`: TypeScript only narrows `nuevoStock`
      // to `number` below when this branch's control flow definitively
      // terminates via an explicit `return`/`throw` statement — a bare
      // `await rechazarMovimiento(...)` (typed `never`) does not, by itself,
      // narrow the merged type after the `if` (verified against tsc).
      return rechazarMovimiento(txRepos, input.productoId);
    }

    const movimiento = await txRepos.movimientos.create({
      productoId: input.productoId,
      tipo: input.operacion,
      cantidad: delta,
      motivo: input.motivo ?? null,
      esDiscrepancia: input.esDiscrepancia,
      esMerma: input.esMerma,
      usuarioId: input.actor.id,
      stockResultante: nuevoStock,
    });

    const producto = await txRepos.productos.findById(input.productoId);
    if (!producto) {
      throw new Error(
        'registrarMovimiento: producto vanished inside the transaction',
      );
    }

    // ── SEAM (backlog #10, ADR-0008) ──────────────────────────────────────
    // EvaluadorDeAlertas.evaluar(movimiento, producto) runs HERE, wrapped in
    // SAVEPOINT alertas / ROLLBACK TO SAVEPOINT alertas via
    // registrarSiCorresponde (design.md D1/D2). Both arguments are already
    // in scope and the transaction is still open. C1: an evaluator failure
    // never rolls back this movimiento.
    // ──────────────────────────────────────────────────────────────────────
    await registrarSiCorresponde(txRepos, tx, {
      movimiento,
      stockMinimo: producto.stockMinimo,
      actorId: input.actor.id,
    });

    return { movimiento, producto };
  });
}
