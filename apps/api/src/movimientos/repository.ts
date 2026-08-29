import type { DbExecutor } from '../db/client.js';
import { movimientos } from '../db/schema.js';

export interface Movimiento {
  id: string;
  productoId: string;
  tipo: 'entrada' | 'salida' | 'ajuste' | 'venta' | 'anulacion';
  cantidad: number;
  motivo: string | null;
  esDiscrepancia: boolean;
  usuarioId: string;
  fecha: Date;
  ventaId: string | null;
  stockResultante: number;
}

export interface NuevoMovimiento {
  productoId: string;
  tipo: Movimiento['tipo'];
  cantidad: number;
  motivo?: string | null;
  esDiscrepancia: boolean;
  usuarioId: string;
  ventaId?: string | null;
  stockResultante: number;
}

// `create` only, deliberately (tasks.md task 3.2, backlog #5 S2b). No other
// method exists on this port yet — #6 extends it. This narrow port is what
// makes the forced-failure fake in the Phase 6 atomicity test an honest full
// replacement.
export interface MovimientosRepo {
  create(input: NuevoMovimiento): Promise<Movimiento>;
}

// Mirrors proveedores/repository.ts's expectOneRow precedent.
function expectOneRow(rows: Movimiento[], operation: string): Movimiento {
  const row = rows[0];
  if (!row) {
    throw new Error(`${operation}: no row returned`);
  }
  return row;
}

// Deliberately asymmetric with DrizzleProductosRepo (tasks.md task 3.1): no
// try/catch, no domain-error mapping. A CHECK violation (e.g.
// movimientos_signo_tipo) surfaces the raw Postgres error uncaught.
export class DrizzleMovimientosRepo implements MovimientosRepo {
  constructor(private readonly db: DbExecutor) {}

  async create(input: NuevoMovimiento): Promise<Movimiento> {
    const rows = await this.db
      .insert(movimientos)
      .values({
        productoId: input.productoId,
        tipo: input.tipo,
        cantidad: input.cantidad,
        motivo: input.motivo ?? null,
        esDiscrepancia: input.esDiscrepancia,
        usuarioId: input.usuarioId,
        ventaId: input.ventaId ?? null,
        stockResultante: input.stockResultante,
      })
      .returning();
    return expectOneRow(rows, 'create');
  }
}
