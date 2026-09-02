import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.js';
import { alertas } from '../db/schema.js';

// design.md D5: the pgEnum carries all four values from day one (PD-1, no
// enum migration when #11/sugerencia_reposicion lands). This cycle's
// evaluator and `create` are typed against `TipoAlertaEvaluada` — a compile
// gate, not a convention — so no #10 code path can emit
// `sugerencia_reposicion`.
export type TipoAlerta =
  | 'stock_bajo'
  | 'quiebre'
  | 'discrepancia'
  | 'sugerencia_reposicion';
export type TipoAlertaEvaluada = Exclude<TipoAlerta, 'sugerencia_reposicion'>;
export type EstadoAlerta = 'activa' | 'vista' | 'resuelta';

export interface Alerta {
  id: string;
  productoId: string;
  tipo: TipoAlerta;
  estado: EstadoAlerta;
  movimientoId: string | null;
  creadaEn: Date;
  resueltaEn: Date | null;
  resueltaPor: string | null;
}

export interface NuevaAlerta {
  productoId: string;
  tipo: TipoAlertaEvaluada;
  movimientoId?: string | null;
}

export interface FiltroAlertas {
  estado?: EstadoAlerta;
}

export interface AlertasRepo {
  /** `undefined` => an open alert already existed (A10 rule 2, D4). */
  create(input: NuevaAlerta): Promise<Alerta | undefined>;
  /** One UPDATE, no prior read. `resuelta_por` stays null (A10 rule 3). */
  autoResolve(
    productoId: string,
    tipo: TipoAlertaEvaluada,
  ): Promise<Alerta | undefined>;
  /** encargado-only (A10 rule 4). `undefined` => no OPEN alert with that id. */
  manualResolve(id: string, resueltaPor: string): Promise<Alerta | undefined>;
  /**
   * Owner-ratified 2026-09-02: one UPDATE, `estado = 'vista' WHERE estado =
   * 'activa'`, no id list needed. Returns the count transitioned. Called
   * once per Alertas screen mount, both roles.
   */
  marcarVistas(): Promise<number>;
  /** Classify-on-undefined (rechazarVenta precedent): 404 vs 409 vs wrong tipo. */
  findById(id: string): Promise<Alerta | undefined>;
  list(
    filtro: FiltroAlertas,
    page: number,
    pageSize: number,
  ): Promise<{ rows: Alerta[]; total: number }>;
  countAbiertas(): Promise<number>;
}

export class DrizzleAlertasRepo implements AlertasRepo {
  constructor(private readonly db: DbExecutor) {}

  // D4 — the partial unique index alertas_producto_tipo_abierta_unique is
  // the only dedup authority. ON CONFLICT ... DO NOTHING, not a
  // SELECT-then-INSERT pre-check (window a concurrent insert could take)
  // and not a caught 23505 (would abort the whole transaction into 25P02,
  // forcing a savepoint rollback that also discards sibling work for the
  // same movement — see design.md D4).
  async create(input: NuevaAlerta): Promise<Alerta | undefined> {
    const rows = await this.db
      .insert(alertas)
      .values({
        productoId: input.productoId,
        tipo: input.tipo,
        movimientoId: input.movimientoId ?? null,
      })
      .onConflictDoNothing({
        target: [alertas.productoId, alertas.tipo],
        where: sql`${alertas.estado} <> 'resuelta'::alerta_estado`,
      })
      .returning();
    return rows[0];
  }

  // Evaluator-triggered resolution (spec: "Auto-Resolution On Stock
  // Recovery"). `resuelta_por` stays null (A10 rule 3) — distinguishes it
  // from manualResolve at the row level, not just by call site.
  async autoResolve(
    productoId: string,
    tipo: TipoAlertaEvaluada,
  ): Promise<Alerta | undefined> {
    const rows = await this.db
      .update(alertas)
      .set({ estado: 'resuelta', resueltaEn: new Date(), resueltaPor: null })
      .where(
        and(
          eq(alertas.productoId, productoId),
          eq(alertas.tipo, tipo),
          ne(alertas.estado, 'resuelta'),
        ),
      )
      .returning();
    return rows[0];
  }

  // A10 rule 4 — the service (Phase 3) refuses this for stock_bajo/quiebre
  // before it ever reaches the repository; this method itself is
  // tipo-agnostic. `undefined` => no OPEN row with that id (classify-on-undefined,
  // rechazarVenta precedent — the service maps 404 vs 409).
  async manualResolve(
    id: string,
    resueltaPor: string,
  ): Promise<Alerta | undefined> {
    const rows = await this.db
      .update(alertas)
      .set({ estado: 'resuelta', resueltaEn: new Date(), resueltaPor })
      .where(and(eq(alertas.id, id), ne(alertas.estado, 'resuelta')))
      .returning();
    return rows[0];
  }

  // Owner-ratified 2026-09-02: one UPDATE, no id list. `returning().length`
  // is the transitioned count — no separate COUNT query.
  async marcarVistas(): Promise<number> {
    const rows = await this.db
      .update(alertas)
      .set({ estado: 'vista' })
      .where(eq(alertas.estado, 'activa'))
      .returning();
    return rows.length;
  }

  async findById(id: string): Promise<Alerta | undefined> {
    const rows = await this.db
      .select()
      .from(alertas)
      .where(eq(alertas.id, id))
      .limit(1);
    return rows[0];
  }

  // Mirrors proveedores/repository.ts's list() D9 precedent: the same
  // filter condition applied to BOTH the page query and the count query —
  // applying it to only one is the single most likely defect here.
  async list(
    filtro: FiltroAlertas,
    page: number,
    pageSize: number,
  ): Promise<{ rows: Alerta[]; total: number }> {
    const condition = filtro.estado
      ? eq(alertas.estado, filtro.estado)
      : undefined;

    const rows = await this.db
      .select()
      .from(alertas)
      .where(condition)
      .orderBy(desc(alertas.creadaEn), desc(alertas.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const totalRows = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(alertas)
      .where(condition);

    return { rows, total: totalRows[0]?.total ?? 0 };
  }

  async countAbiertas(): Promise<number> {
    const rows = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(alertas)
      .where(ne(alertas.estado, 'resuelta'));
    return rows[0]?.total ?? 0;
  }
}
