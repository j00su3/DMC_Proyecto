import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
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

// design.md D5 (backlog #11) — one conditional-aggregation query over the
// existing `movimientos_producto_id_fecha_idx`, no new index/migration.
export interface ResumenRotacion {
  unidadesSalida30d: number;
  diasHistoria: number;
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
// design.md D2 (backlog #12) — cross-producto period query for the
// movimientos report. Bare `Movimiento[]` rows, same shape as
// `listByProducto`; `productoNombre` resolution is a `reportes/service.ts`
// concern (D6 N+1-lookup idiom), not this repo's.
export interface FiltroMovimientosPeriodo {
  fechaDesde: Date;
  fechaHastaExclusiva: Date;
  usuarioId?: string;
}

// design.md D1 (backlog #14, consistency-check half) — one row per producto
// whose `stockActual` diverges from the sum of its own movimientos' cantidad.
export interface InconsistenciaStock {
  productoId: string;
  sku: string;
  stockActual: number;
  sumaMovimientos: number;
  delta: number; // stockActual - sumaMovimientos
}

export interface MovimientosRepo {
  create(input: NuevoMovimiento): Promise<Movimiento>;
  listByProducto(
    productoId: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: Movimiento[]; total: number }>;
  resumenRotacion(productoId: string): Promise<ResumenRotacion>;
  listByPeriodo(
    filtro: FiltroMovimientosPeriodo,
    page: number,
    pageSize: number,
  ): Promise<{ rows: Movimiento[]; total: number }>;
  /**
   * backlog #13 (dashboard-kpis) design.md D1: fixed top-N, no `usuarioId`
   * (unfiltered for both roles), no pagination envelope. `productoNombre`
   * resolution is a `dashboard/service.ts` concern (same N+1 idiom as
   * `reportes/service.ts::listarMovimientosPeriodo`), not this repo's.
   */
  listRecientes(limit: number): Promise<Movimiento[]>;
  /**
   * design.md D1 (backlog #14, consistency-check half) — read-only, no
   * pagination: one LEFT JOIN + GROUP BY + HAVING, server-side filtering so
   * only mismatching productos are ever returned.
   */
  verificarConsistenciaStock(): Promise<InconsistenciaStock[]>;
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

  // design.md D5 — one query, conditional aggregation, existing
  // `movimientos_producto_id_fecha_idx` (productoId, fecha) serves both the
  // equality predicate and the `fecha` range filter inside the CASE. Exactly
  // `venta`+`salida` count toward unidadesSalida30d, per S7's literal text
  // (`entrada`/`ajuste`/`anulacion` never count); `-cantidad` is safe without
  // `abs()` because `movimientos_signo_tipo` guarantees a negative cantidad
  // for both tipos. diasHistoria is unbounded by the 30-day window and uses
  // Postgres `now()` (transaction-start time) rather than a JS clock.
  async resumenRotacion(productoId: string): Promise<ResumenRotacion> {
    const result = await this.db.execute(sql`
      select
        coalesce(sum(case when tipo in ('venta', 'salida') and fecha >= now() - interval '30 days'
                           then -cantidad else 0 end), 0)::int as unidades_salida_30d,
        floor(extract(epoch from (now() - min(fecha))) / 86400)::int as dias_historia
      from movimientos
      where producto_id = ${productoId}
    `);
    const rows = (
      result as unknown as {
        rows: { unidades_salida_30d: number; dias_historia: number }[];
      }
    ).rows;
    const row = rows[0];
    if (!row) {
      throw new Error(
        `resumenRotacion: no row returned for producto ${productoId}`,
      );
    }
    return {
      unidadesSalida30d: row.unidades_salida_30d,
      diasHistoria: row.dias_historia,
    };
  }

  // design.md D2 (backlog #12) — half-open interval
  // `[fechaDesde, fechaHastaExclusiva)`, optional actor scope. Predicate
  // applied identically to page and count query (this file's own D7/D11
  // trap, extended to a third repo). Uses the new `movimientos_fecha_idx`
  // index — no `productoId` predicate here, so the existing
  // `(productoId, fecha)` index cannot serve this query.
  async listByPeriodo(
    filtro: FiltroMovimientosPeriodo,
    page: number,
    pageSize: number,
  ): Promise<{ rows: Movimiento[]; total: number }> {
    const condition = and(
      gte(movimientos.fecha, filtro.fechaDesde),
      lt(movimientos.fecha, filtro.fechaHastaExclusiva),
      filtro.usuarioId
        ? eq(movimientos.usuarioId, filtro.usuarioId)
        : undefined,
    );

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

  // design.md D1 (backlog #13) — reuses `movimientos_fecha_idx`, no
  // predicate. `id DESC` is the same tie-break convention as
  // `listByProducto`/`listByPeriodo`. No new index/migration.
  async listRecientes(limit: number): Promise<Movimiento[]> {
    return this.db
      .select()
      .from(movimientos)
      .orderBy(desc(movimientos.fecha), desc(movimientos.id))
      .limit(limit);
  }

  // design.md D1 (backlog #14, consistency-check half) — LEFT JOIN so a
  // producto with zero movimientos still appears in the aggregation
  // (`count`/`sum` over an unmatched right side), and `COALESCE` is
  // load-bearing: a bare `sum()` over an empty group is NULL, and
  // `HAVING x <> NULL` is never true, so an untouched producto whose
  // `stockActual` really diverged from 0 would silently pass without it.
  async verificarConsistenciaStock(): Promise<InconsistenciaStock[]> {
    const result = await this.db.execute(sql`
      select
        p.id as producto_id,
        p.sku as sku,
        p.stock_actual as stock_actual,
        coalesce(sum(m.cantidad), 0)::int as suma_movimientos
      from productos p
      left join movimientos m on m.producto_id = p.id
      group by p.id, p.sku, p.stock_actual
      having p.stock_actual <> coalesce(sum(m.cantidad), 0)
    `);
    const rows = (
      result as unknown as {
        rows: {
          producto_id: string;
          sku: string;
          stock_actual: number;
          suma_movimientos: number;
        }[];
      }
    ).rows;
    return rows.map((row) => ({
      productoId: row.producto_id,
      sku: row.sku,
      stockActual: row.stock_actual,
      sumaMovimientos: row.suma_movimientos,
      delta: row.stock_actual - row.suma_movimientos,
    }));
  }
}
