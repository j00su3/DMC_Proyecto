import { and, eq, sql } from 'drizzle-orm';
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
  // backlog #9 (anulacion-venta) design.md's File Changes table. All three
  // null on every `confirmada` row (schema.ts's
  // ventas_anulacion_datos_solo_anulada CHECK enforces this).
  anuladaPor: string | null;
  anuladaEn: Date | null;
  motivoAnulacion: string | null;
}

export interface MarcarAnuladaInput {
  ventaId: string;
  anuladaPor: string;
  motivoAnulacion: string;
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
// recibo-interno (backlog #8) design.md D7: four narrow read methods, no
// join. `getRecibo` (ventas/service.ts) composes cajero/item names from
// UsuariosRepo/ProductosRepo per-row (accepted N+1, matches confirmarVenta's
// existing pattern), so this repo never needs to reach across domains.
export interface VentasRepo {
  create(input: NuevaVenta): Promise<Venta>;
  createItems(items: NuevoItemVenta[]): Promise<ItemVenta[]>;
  createPagos(pagos: NuevoPago[]): Promise<Pago[]>;
  findById(id: string): Promise<Venta | undefined>;
  findByNumeroCorrelativo(
    numeroCorrelativo: number,
  ): Promise<Venta | undefined>;
  findItems(ventaId: string): Promise<ItemVenta[]>;
  findPagos(ventaId: string): Promise<Pago[]>;
  // backlog #9 (anulacion-venta) design.md's Interfaces/Contracts. One
  // conditional UPDATE (`where id = :id and estado = 'confirmada'`) — the
  // serialization point (design.md's ADR-0005 precedent). `undefined` means
  // "the guard rejected" (not confirmada, or missing), never "row missing"
  // alone; the service classifies which via a second read (rechazarVenta-
  // style, mirrors D4's rechazarVenta precedent).
  marcarAnulada(input: MarcarAnuladaInput): Promise<Venta | undefined>;
  // where estado = 'registrado' — every matching row moves to 'revertido'
  // and is returned; an empty array means there was nothing left to revert.
  revertirPagos(ventaId: string): Promise<Pago[]>;
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

  async findById(id: string): Promise<Venta | undefined> {
    const rows = await this.db
      .select()
      .from(ventas)
      .where(eq(ventas.id, id))
      .limit(1);
    return rows[0];
  }

  async findByNumeroCorrelativo(
    numeroCorrelativo: number,
  ): Promise<Venta | undefined> {
    const rows = await this.db
      .select()
      .from(ventas)
      .where(eq(ventas.numeroCorrelativo, numeroCorrelativo))
      .limit(1);
    return rows[0];
  }

  async findItems(ventaId: string): Promise<ItemVenta[]> {
    return this.db
      .select()
      .from(itemsVenta)
      .where(eq(itemsVenta.ventaId, ventaId));
  }

  async findPagos(ventaId: string): Promise<Pago[]> {
    return this.db.select().from(pagos).where(eq(pagos.ventaId, ventaId));
  }

  // backlog #9 (anulacion-venta) design.md: the ONE conditional UPDATE that
  // makes a concurrent second anulación attempt serialize on this row and
  // then see 0 rows, instead of both transactions racing through full stock
  // work before one loses (ADR-0005 idiom). `anuladaEn` is set via SQL
  // `now()`, never a JS-computed timestamp.
  async marcarAnulada(input: MarcarAnuladaInput): Promise<Venta | undefined> {
    const rows = await this.db
      .update(ventas)
      .set({
        estado: 'anulada',
        anuladaPor: input.anuladaPor,
        anuladaEn: sql`now()`,
        motivoAnulacion: input.motivoAnulacion,
      })
      .where(and(eq(ventas.id, input.ventaId), eq(ventas.estado, 'confirmada')))
      .returning();
    return rows[0];
  }

  // backlog #9 (anulacion-venta): bulk revert, scoped to `registrado` rows
  // only — a second anulación attempt (already refused by marcarAnulada's
  // guard before this ever runs) would otherwise re-touch already-revertido
  // rows.
  async revertirPagos(ventaId: string): Promise<Pago[]> {
    return this.db
      .update(pagos)
      .set({ estado: 'revertido' })
      .where(and(eq(pagos.ventaId, ventaId), eq(pagos.estado, 'registrado')))
      .returning();
  }
}
