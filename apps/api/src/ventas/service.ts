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
  cashlessPaymentMustMatchTotal,
  duplicateSaleItem,
  insufficientStock,
  paymentBelowTotal,
  paymentMediumDuplicated,
  priceChanged,
  productInactive,
  productNotFound,
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

  return uow.run(async (txRepos) => {
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

      await txRepos.movimientos.create({
        productoId: itemComputado.productoId,
        tipo: 'venta',
        cantidad: -itemComputado.cantidad,
        esDiscrepancia: false,
        esMerma: false,
        usuarioId: input.actor.id,
        ventaId: venta.id,
        stockResultante: nuevoStock,
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
