import { registrarSiCorresponde } from '../alertas/service.js';
import type { UnitOfWork } from '../db/uow.js';
import type { Centavos } from '../lib/dinero.js';
import {
  MontoFueraDeRangoError,
  aCentavos,
  aMonto,
  multiplicar,
  sumar,
} from '../lib/dinero.js';
import {
  AppError,
  cashlessPaymentMustMatchTotal,
  duplicateSaleItem,
  insufficientStock,
  paymentBelowTotal,
  paymentMediumDuplicated,
  priceChanged,
  productInactive,
  productNotFound,
  saleAlreadyVoided,
  saleAmountOutOfRange,
  saleNotFound,
} from '../lib/errors.js';
import type { Repos } from '../plugins/repos.js';
import type { ProductosRepo } from '../productos/repository.js';
import type { UsuariosRepo } from '../usuarios/repository.js';
import type {
  ItemVenta,
  MedioPago,
  NuevoItemVenta,
  NuevoPago,
  Pago,
  Venta,
  VentasRepo,
} from './repository.js';

export type { MedioPago } from './repository.js';

type Rol = 'encargado' | 'deposito';

export interface ItemVentaInput {
  productoId: string;
  cantidad: number; // positive integer; the service derives the negative delta
  precioUnitarioEsperado: string; // what the cashier saw (D5) — never trusted as the price
}

export interface PagoInput {
  medio: MedioPago;
  monto: string;
}

export interface ConfirmarVentaInput {
  items: ItemVentaInput[]; // >= 1, no duplicate productoId (D13)
  pagos: PagoInput[]; // >= 1
  actor: { id: string; rol: Rol };
}

// D3 (ADR-0005/A3): a named helper, called once, so both passes iterate
// only its result. `producto_id` ascending — plain string comparison is a
// correct total order for UUID text.
export function ordenarItems(items: ItemVentaInput[]): ItemVentaInput[] {
  return [...items].sort((a, b) =>
    a.productoId < b.productoId ? -1 : a.productoId > b.productoId ? 1 : 0,
  );
}

// D4: classification helper for when `aplicarDelta` returns `undefined`,
// mirroring `movimientos/service.ts`'s `rechazarMovimiento` precedent
// exactly — a second read inside the same transaction, fixed precedence.
// Always throws, so the caller's `nuevoStock` narrows to `number` after an
// explicit `return rechazarVenta(...)`.
export async function rechazarVenta(
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

// Wraps the dinero module's overflow guard (design.md D1/D12): any
// MontoFueraDeRangoError raised while computing prices/totals is mapped to
// the SALE_AMOUNT_OUT_OF_RANGE wire code rather than a raw arithmetic
// exception.
function conGuardaDeRango<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof MontoFueraDeRangoError) {
      throw saleAmountOutOfRange();
    }
    throw error;
  }
}

interface ItemComputado {
  productoId: string;
  cantidad: number;
  precioUnitario: string; // producto.precio read during Pass A (D5)
  subtotal: string;
  // Pass-A snapshot (design.md's critical correctness note): the evaluator
  // at Pass B reads THIS stockMinimo, never a Pass-B re-read of stockActual
  // — stockMinimo does not change within the sale's own transaction, but
  // stockActual is stale by Pass B by construction (Pass A ran before any
  // aplicarDelta call in this sale).
  stockMinimo: number | null;
}

// design.md D2: two passes inside one uow.run. Pass A (read-only, sorted):
// findById per item -> not found / inactive / price comparison -> compute
// total; then validate payments; then insert `ventas`. Pass B (same sorted
// array): aplicarDelta -> classify-on-undefined -> movimientos.create ->
// items_venta insert; then pagos insert.
export async function confirmarVenta(
  uow: UnitOfWork,
  input: ConfirmarVentaInput,
): Promise<{ venta: Venta; items: ItemVenta[]; pagos: Pago[] }> {
  // D13/RECONCILE-1: duplicate producto_id is refused, never merged
  // server-side. Payload-only check — no database read needed, so it runs
  // BEFORE uow.run opens (movementReasonRequired precedent).
  const productoIds = input.items.map((i) => i.productoId);
  if (new Set(productoIds).size !== productoIds.length) {
    throw duplicateSaleItem();
  }

  // RECONCILE-1: duplicate `medio` in the payload is refused, never
  // combined server-side (combining is the cart/client's job, PD-7).
  const medios = input.pagos.map((p) => p.medio);
  if (new Set(medios).size !== medios.length) {
    throw paymentMediumDuplicated();
  }

  const itemsOrdenados = ordenarItems(input.items);

  return uow.run(async (txRepos, tx) => {
    // ── Pass A: read-only, sorted — price check, total, payment rules ──
    const mismatches: Array<{
      productoId: string;
      precioEsperado: string;
      precioActual: string;
    }> = [];
    const itemsComputados: ItemComputado[] = [];

    for (const item of itemsOrdenados) {
      const producto = await txRepos.productos.findById(item.productoId);
      if (!producto) {
        throw productNotFound();
      }
      if (!producto.activo) {
        throw productInactive();
      }

      const precioActualCentavos = aCentavos(producto.precio);
      const precioEsperadoCentavos = aCentavos(item.precioUnitarioEsperado);
      if (precioActualCentavos !== precioEsperadoCentavos) {
        mismatches.push({
          productoId: item.productoId,
          precioEsperado: item.precioUnitarioEsperado,
          precioActual: producto.precio,
        });
        continue;
      }

      const subtotalCentavos = conGuardaDeRango(() =>
        multiplicar(producto.precio, item.cantidad),
      );

      itemsComputados.push({
        productoId: item.productoId,
        cantidad: item.cantidad,
        precioUnitario: producto.precio,
        subtotal: aMonto(subtotalCentavos),
        stockMinimo: producto.stockMinimo,
      });
    }

    // D5/PD-6: every mismatched line is reported at once — no partial
    // acceptance, and nothing is persisted on this attempt.
    if (mismatches.length > 0) {
      throw priceChanged(mismatches);
    }

    const totalCentavos = conGuardaDeRango(() =>
      sumar(itemsComputados.map((i) => aCentavos(i.subtotal))),
    );

    // PD-1/PD-10/PD-2: payment rules, all computed from the same read.
    const pagosCentavos = input.pagos.map((p) => ({
      medio: p.medio,
      montoCentavos: conGuardaDeRango(() => aCentavos(p.monto)),
    }));

    const nonCashCentavos: Centavos = conGuardaDeRango(() =>
      sumar(
        pagosCentavos
          .filter((p) => p.medio !== 'efectivo')
          .map((p) => p.montoCentavos),
      ),
    );

    // RECONCILE-1 (card-only exceeds total, spec L85-88) + PD-10 (non-cash
    // payments cannot exceed the total even alongside a cash row) — a
    // single check covers both: a cash row can only ever add change, never
    // correct a non-cash overcharge.
    if (nonCashCentavos > totalCentavos) {
      throw cashlessPaymentMustMatchTotal();
    }

    const totalPagadoCentavos: Centavos = conGuardaDeRango(() =>
      sumar(pagosCentavos.map((p) => p.montoCentavos)),
    );

    // PD-1: a sum below the total is refused before any write. Combined
    // with the nonCash <= total check above, a sale with no cash row is
    // forced to sum EXACTLY to the total (spec's card-only-must-match-
    // exactly scenario), without a separate branch for that case.
    if (totalPagadoCentavos < totalCentavos) {
      throw paymentBelowTotal(
        aMonto(totalCentavos),
        aMonto(totalPagadoCentavos),
      );
    }

    const vueltoCentavos: Centavos = totalPagadoCentavos - totalCentavos;

    const venta = await txRepos.ventas.create({
      usuarioId: input.actor.id,
      total: aMonto(totalCentavos),
    });

    // ── Pass B: same sorted array — aplicarDelta, classify, ledger, rows ──
    const nuevosItems: NuevoItemVenta[] = [];

    for (const itemComputado of itemsComputados) {
      const nuevoStock = await txRepos.productos.aplicarDelta(
        itemComputado.productoId,
        -itemComputado.cantidad,
      );
      if (nuevoStock === undefined) {
        return rechazarVenta(txRepos, itemComputado.productoId);
      }

      const movimiento = await txRepos.movimientos.create({
        productoId: itemComputado.productoId,
        tipo: 'venta',
        cantidad: -itemComputado.cantidad,
        esDiscrepancia: false,
        esMerma: false,
        usuarioId: input.actor.id,
        ventaId: venta.id,
        stockResultante: nuevoStock,
      });

      // D3: ONE savepoint PER ITEM, not one for the whole sale — a sale's
      // items are guaranteed distinct products (duplicateSaleItem refuses
      // duplicates), so evaluation is inherently per-producto. A single
      // sale-wide savepoint would discard earlier items' alerts if a LATER
      // item's evaluator failed.
      await registrarSiCorresponde(txRepos, tx, {
        movimiento,
        stockMinimo: itemComputado.stockMinimo,
        actorId: input.actor.id,
      });

      nuevosItems.push({
        ventaId: venta.id,
        productoId: itemComputado.productoId,
        cantidad: itemComputado.cantidad,
        precioUnitario: itemComputado.precioUnitario,
        subtotal: itemComputado.subtotal,
      });
    }

    const items = await txRepos.ventas.createItems(nuevosItems);

    // D6/PD-2: vuelto lands on the efectivo row and nowhere else.
    const nuevosPagos: NuevoPago[] = input.pagos.map((p) => ({
      ventaId: venta.id,
      medio: p.medio,
      monto: p.monto,
      vuelto: p.medio === 'efectivo' ? aMonto(vueltoCentavos) : '0',
    }));

    const pagos = await txRepos.ventas.createPagos(nuevosPagos);

    return { venta, items, pagos };
  });
}

// backlog #9 (anulacion-venta) design.md's ratified Open Question 1: the
// motivo bound mirrors movimientos.ts's MOTIVO_MIN_LENGTH/MOTIVO_MAX_LENGTH
// exactly (trim().min(3).max(500)). This is the SAME bound the route's Zod
// schema enforces (task 4.2) — kept here too as a payload-only guard so the
// service is safe standalone and refuses before uow.run ever opens, mirroring
// confirmarVenta's duplicateSaleItem/paymentMediumDuplicated precedent.
export const MOTIVO_ANULACION_MIN_LENGTH = 3;
export const MOTIVO_ANULACION_MAX_LENGTH = 500;

// design.md: unconditionally required, so it is wire shape — VALIDATION_ERROR
// (400), never a new domain error factory (the design's own stated
// rationale, distinguishing it from movementReasonRequired()'s conditional
// case).
export interface AnularVentaInput {
  ventaId: string;
  actorId: string;
  motivoAnulacion: string;
}

// design.md's Technical Approach: confirmarVenta's mirror image. One
// uow.run: marcarAnulada FIRST (the serialization point, ADR-0005 idiom —
// see repository.ts's marcarAnulada doc comment), then a per-item loop
// (revertirStockPorAnulacion + one `anulacion` movimiento each), then a bulk
// pagos revert. No recordAudit call anywhere (ventas is not an
// AuditableEntidad, #7 D9) — the movimientos rows plus
// anuladaPor/anuladaEn/motivoAnulacion ARE the audit trail.
export async function anularVenta(
  uow: UnitOfWork,
  input: AnularVentaInput,
): Promise<{ venta: Venta; items: ItemVenta[]; pagos: Pago[] }> {
  const motivoTrimmed = input.motivoAnulacion.trim();
  if (
    motivoTrimmed.length < MOTIVO_ANULACION_MIN_LENGTH ||
    motivoTrimmed.length > MOTIVO_ANULACION_MAX_LENGTH
  ) {
    throw new AppError(
      'VALIDATION_ERROR',
      `motivoAnulacion must be between ${MOTIVO_ANULACION_MIN_LENGTH} and ${MOTIVO_ANULACION_MAX_LENGTH} characters after trimming`,
      400,
    );
  }

  return uow.run(async (txRepos, tx) => {
    // The serialization point (design.md): a concurrent second anulación
    // attempt blocks on this row's own UPDATE, then sees 0 rows once this
    // one commits — never a SELECT ... FOR UPDATE followed by a plain SET.
    const venta = await txRepos.ventas.marcarAnulada({
      ventaId: input.ventaId,
      anuladaPor: input.actorId,
      motivoAnulacion: input.motivoAnulacion,
    });

    if (!venta) {
      // D4 classify-on-undefined (rechazarVenta precedent): a second read
      // inside the same transaction distinguishes "no such venta" (404) from
      // "venta exists but the guard rejected it — already anulada" (409).
      const existing = await txRepos.ventas.findById(input.ventaId);
      if (!existing) {
        throw saleNotFound();
      }
      throw saleAlreadyVoided();
    }

    // v1 is total-only (spec.md's "Anulación Is Total, Not Partial"): every
    // item on the venta reverses, no selection param exists on this
    // function's signature.
    const items = await txRepos.ventas.findItems(venta.id);

    for (const item of items) {
      const stockResultante = await txRepos.productos.revertirStockPorAnulacion(
        item.productoId,
        item.cantidad,
      );

      // A8: tipo 'anulacion', positive cantidad — the reversal's mirror of
      // confirmarVenta's tipo 'venta' negative-cantidad row. motivo: null,
      // ventaId set — the venta row is the single home of the reason (design
      // decision, no duplication across N movimientos rows).
      const movimiento = await txRepos.movimientos.create({
        productoId: item.productoId,
        tipo: 'anulacion',
        cantidad: item.cantidad,
        motivo: null,
        esDiscrepancia: false,
        esMerma: false,
        usuarioId: input.actorId,
        ventaId: venta.id,
        stockResultante,
      });

      const producto = await txRepos.productos.findById(item.productoId);
      if (!producto) {
        throw new Error(
          `anularVenta: producto ${item.productoId} vanished inside the transaction`,
        );
      }

      // D3: no `tipo === 'anulacion'` special case — the generic crossing
      // rule already yields resolve-only behaviour in practice, since
      // revertirStockPorAnulacion only ever adds a positive item.cantidad
      // (esDiscrepancia is never set on an anulacion movimiento). One
      // savepoint per item, mirroring confirmarVenta's Pass B loop.
      await registrarSiCorresponde(txRepos, tx, {
        movimiento,
        stockMinimo: producto.stockMinimo,
        actorId: input.actorId,
      });
    }

    const pagos = await txRepos.ventas.revertirPagos(venta.id);

    return { venta, items, pagos };
  });
}

// recibo-interno (backlog #8) — design.md D2/D7. Read-only shape, mirroring
// productos/service.ts's ReadRepos: no write path needs any of these repos
// outside a transaction, so a narrow interface documents the actual
// dependency instead of accepting the full `Repos`.
export interface GetReciboRepos {
  ventas: VentasRepo;
  usuarios: UsuariosRepo;
  productos: ProductosRepo;
}

export type ReciboSelector = { id: string } | { numeroCorrelativo: number };

export interface ReciboItem extends ItemVenta {
  nombre: string;
}

export interface Recibo {
  venta: Venta;
  cajero: { id: string; nombre: string };
  items: ReciboItem[];
  pagos: Pago[];
}

// design.md D2: one code (`SALE_NOT_FOUND`) for both selectors, thrown here
// (never the repository) — mirrors productos/service.ts's getProducto
// precedent. D7: no repo join — cajero and per-item names are resolved with
// a per-item ProductosRepo.findById, the same accepted N+1 confirmarVenta
// already runs (Pass A above). Every pagos row is returned unfiltered
// (PROD-F, deferred to backlog #9).
export async function getRecibo(
  repos: GetReciboRepos,
  selector: ReciboSelector,
): Promise<Recibo> {
  const venta =
    'id' in selector
      ? await repos.ventas.findById(selector.id)
      : await repos.ventas.findByNumeroCorrelativo(selector.numeroCorrelativo);
  if (!venta) {
    throw saleNotFound();
  }

  const [cajero, items, pagos] = await Promise.all([
    repos.usuarios.findById(venta.usuarioId),
    repos.ventas.findItems(venta.id),
    repos.ventas.findPagos(venta.id),
  ]);
  // `usuarioId` is an FK to a row `confirmarVenta` always writes with the
  // confirming actor's real id — a missing cajero here is a broken
  // invariant, not a user-facing 404 (mirrors repository.ts's
  // expectOneRow idiom for "should never happen" states).
  if (!cajero) {
    throw new Error(`getRecibo: cajero ${venta.usuarioId} not found`);
  }

  const reciboItems: ReciboItem[] = [];
  for (const item of items) {
    const producto = await repos.productos.findById(item.productoId);
    reciboItems.push({
      ...item,
      nombre: producto?.nombre ?? '',
    });
  }

  return {
    venta,
    cajero: { id: cajero.id, nombre: cajero.nombre },
    items: reciboItems,
    pagos,
  };
}
