import type { DbExecutor } from '../db/client.js';
import { itemsVenta, pagos, ventas } from '../db/schema.js';

export type VentaEstado = 'confirmada' | 'anulada';
export type PagoEstado = 'registrado' | 'revertido';
export type MedioPago = 'efectivo' | 'tarjeta' | 'transferencia' | 'qr';

export interface Venta {
  id: string;
  numeroCorrelativo: number;
  usuarioId: string;
  estado: VentaEstado;
  total: string;
  creadoEn: Date;
}

export interface NuevaVenta {
  usuarioId: string;
  total: string; // decimal string, produced by dinero.aMonto (D1) — never a raw JS number
}

export interface ItemVenta {
  id: string;
  ventaId: string;
  productoId: string;
  cantidad: number;
  precioUnitario: string;
  subtotal: string;
}

export interface NuevoItemVenta {
  ventaId: string;
  productoId: string;
  cantidad: number;
  precioUnitario: string; // read from productos.precio at confirmation (D5), never the client value
  subtotal: string;
}

export interface Pago {
  id: string;
  ventaId: string;
  medio: MedioPago;
  monto: string;
  vuelto: string;
  estado: PagoEstado;
}

export interface NuevoPago {
  ventaId: string;
  medio: MedioPago;
  monto: string;
  vuelto?: string; // omitted/'0' on every row except the cash row (D6/PD-2)
}

// Deliberately narrow (design.md's Interfaces/Contracts section): create,
// createItems, createPagos — a fake is a full replacement, the same rule
// MovimientosRepo states. findCatalogo does NOT live here (D11): the POS
// catalog read is an additive `opts.soloActivos` on `ProductosRepo.list`
// (tasks.md task 3.1, a later PR), not a VentasRepo method.
export interface VentasRepo {
  create(input: NuevaVenta): Promise<Venta>;
  createItems(items: NuevoItemVenta[]): Promise<ItemVenta[]>;
  createPagos(pagos: NuevoPago[]): Promise<Pago[]>;
}

// Mirrors proveedores/repository.ts's expectOneRow precedent.
function expectOneRow<T>(rows: T[], operation: string): T {
  const row = rows[0];
  if (!row) {
    throw new Error(`${operation}: no row returned`);
  }
  return row;
}

// Deliberately asymmetric with DrizzleProveedoresRepo/DrizzleProductosRepo
// (mirroring DrizzleMovimientosRepo's precedent): no try/catch, no domain-
// error mapping. Every duplicate this schema could reject
// (items_venta_venta_id_producto_id_unique, pagos_venta_id_medio_unique) is
// already refused by the service BEFORE this repo is ever called
// (D13/RECONCILE-1's DUPLICATE_SALE_ITEM/PAYMENT_MEDIUM_DUPLICATED guards),
// so a unique violation reaching here would be an internal bug, not user
// input — same class as movimientos_signo_tipo.
export class DrizzleVentasRepo implements VentasRepo {
  constructor(private readonly db: DbExecutor) {}

  async create(input: NuevaVenta): Promise<Venta> {
    const rows = await this.db
      .insert(ventas)
      .values({
        usuarioId: input.usuarioId,
        total: input.total,
      })
      .returning();
    return expectOneRow(rows, 'create');
  }

  async createItems(items: NuevoItemVenta[]): Promise<ItemVenta[]> {
    if (items.length === 0) {
      return [];
    }
    return this.db
      .insert(itemsVenta)
      .values(
        items.map((item) => ({
          ventaId: item.ventaId,
          productoId: item.productoId,
          cantidad: item.cantidad,
          precioUnitario: item.precioUnitario,
          subtotal: item.subtotal,
        })),
      )
      .returning();
  }

  async createPagos(input: NuevoPago[]): Promise<Pago[]> {
    if (input.length === 0) {
      return [];
    }
    return this.db
      .insert(pagos)
      .values(
        input.map((pago) => ({
          ventaId: pago.ventaId,
          medio: pago.medio,
          monto: pago.monto,
          vuelto: pago.vuelto ?? '0',
        })),
      )
      .returning();
  }
}
