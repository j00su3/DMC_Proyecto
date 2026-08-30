import { desc, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.js';
import { movimientos } from '../db/schema.js';

export interface Movimiento {
  id: string;
  productoId: string;
  tipo: 'entrada' | 'salida' | 'ajuste' | 'venta' | 'anulacion';
  cantidad: number;
  motivo: string | null;
  esDiscrepancia: boolean;
  esMerma: boolean;
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
  esMerma: boolean;
  usuarioId: string;
  ventaId?: string | null;
  stockResultante: number;
}

// Two methods, deliberately narrow. `create` is from #5 (S2b). `listByProducto`
// is from #6 (S2). The port is still narrow enough for a fake to be a full
// replacement — every future writer (#7, #9) is forced to state `esMerma`.
export interface MovimientosRepo {
  create(input: NuevoMovimiento): Promise<Movimiento>;
  listByProducto(
    productoId: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: Movimiento[]; total: number }>;
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
        esMerma: input.esMerma,
        usuarioId: input.usuarioId,
        ventaId: input.ventaId ?? null,
        stockResultante: input.stockResultante,
      })
      .returning();
    return expectOneRow(rows, 'create');
  }

  async listByProducto(
    productoId: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: Movimiento[]; total: number }> {
    const condition = eq(movimientos.productoId, productoId);

    const rows = await this.db
      .select()
      .from(movimientos)
      .where(condition)
      .orderBy(desc(movimientos.fecha), desc(movimientos.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const totalRows = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(movimientos)
      .where(condition);

    return { rows, total: totalRows[0]?.total ?? 0 };
  }
}
