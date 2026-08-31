import { type SQL, and, asc, desc, eq, or, sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.js';
import { productos } from '../db/schema.js';
import { isUniqueViolation } from '../lib/db-errors.js';
import { skuAlreadyInUse } from '../lib/errors.js';

export interface Producto {
  id: string;
  nombre: string;
  sku: string;
  categoria: string | null;
  stockActual: number;
  stockMinimo: number | null;
  precio: string;
  proveedorId: string;
  activo: boolean;
  creadoEn: Date;
}

export interface NuevoProducto {
  nombre: string;
  sku: string;
  categoria?: string | null;
  stockMinimo?: number | null;
  precio: string;
  proveedorId: string;
}

// No stockActual key, ever (design.md's interface, tasks.md task 2.1's
// compile-level assertion). aplicarDelta is the only seam through which
// stock_actual ever changes (D1) — a PATCH that could set it directly would
// bypass the conditional-UPDATE guard entirely.
export interface CambiosProducto {
  nombre?: string;
  sku?: string;
  categoria?: string | null;
  stockMinimo?: number | null;
  precio?: string;
  proveedorId?: string;
}

export interface ListProductosOpts {
  // D11: additive-only. Undefined/false preserves today's behaviour
  // (no `activo` filter, `creadoEn desc` order) — GET /api/productos is
  // untouched. `true` is exercised by the new POS catalog read
  // (routes/ventas.ts GET /api/ventas/catalogo, PD-8/PD-12): excludes
  // `activo = false` entirely and orders alphabetically by `nombre` instead,
  // since that ordering only makes sense once inactive rows are excluded.
  soloActivos?: boolean;
}

export interface ProductosRepo {
  list(
    page: number,
    pageSize: number,
    q?: string,
    opts?: ListProductosOpts,
  ): Promise<{ rows: Producto[]; total: number }>;
  findById(id: string): Promise<Producto | undefined>;
  findByIdForUpdate(id: string): Promise<Producto | undefined>;
  create(input: NuevoProducto): Promise<Producto>; // maps 23505 -> SKU_ALREADY_IN_USE
  update(id: string, cambios: CambiosProducto): Promise<Producto>; // maps 23505 -> SKU_ALREADY_IN_USE
  setActivo(id: string, activo: boolean): Promise<Producto>; // never DELETE
  // D1: one conditional UPDATE, never a SELECT ... FOR UPDATE plus a plain
  // SET. Returns the new stock_actual, or undefined when the guard
  // rejected (inactive product or a result that would go negative) — the
  // service maps undefined to a domain error; it never means "row missing"
  // alone, because the caller has already read the row.
  aplicarDelta(id: string, delta: number): Promise<number | undefined>;
  // No findBySku, deliberately (D5's folding rule, mirroring
  // proveedores/repository.ts's no-findByNombre precedent): any future SKU
  // selector must be written `where lower(sku) = lower($1)` at the call
  // site.
}

// Mirrors proveedores/repository.ts's expectOneRow precedent: every write
// here runs after the caller has locked the row (or is an insert), so a
// missing row is a broken invariant, not a 404 the service should map.
function expectOneRow(rows: Producto[], operation: string): Producto {
  const row = rows[0];
  if (!row) {
    throw new Error(`${operation}: no row returned`);
  }
  return row;
}

// Neutralises `\`, `%` and `_` for a literal ILIKE match (design.md D7).
// Order matters: the backslash itself must be escaped first, or escaping
// `%`/`_` afterwards would double-escape the backslashes it just inserted.
function escapeLikePattern(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export class DrizzleProductosRepo implements ProductosRepo {
  constructor(private readonly db: DbExecutor) {}

  // D7: the search predicate is built once and composed into BOTH the page
  // query and the count query. Applying it to only one is the single most
  // likely defect here — it makes data.length small but total wrong.
  async list(
    page: number,
    pageSize: number,
    q?: string,
    opts?: ListProductosOpts,
  ): Promise<{ rows: Producto[]; total: number }> {
    const searchCondition: SQL | undefined = q
      ? or(
          sql`${productos.nombre} ilike ${`%${escapeLikePattern(q)}%`}`,
          sql`${productos.sku} ilike ${`%${escapeLikePattern(q)}%`}`,
        )
      : undefined;

    // D11: same condition applied to BOTH the page query and the count
    // query — the D7 trap this file already documents applies equally here.
    const whereCondition: SQL | undefined = opts?.soloActivos
      ? searchCondition
        ? and(eq(productos.activo, true), searchCondition)
        : eq(productos.activo, true)
      : searchCondition;

    const rows = await this.db
      .select()
      .from(productos)
      .where(whereCondition)
      .orderBy(
        ...(opts?.soloActivos
          ? [asc(productos.nombre), asc(productos.id)]
          : [desc(productos.creadoEn), desc(productos.id)]),
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const totalRows = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(productos)
      .where(whereCondition);

    return { rows, total: totalRows[0]?.total ?? 0 };
  }

  async findById(id: string): Promise<Producto | undefined> {
    const rows = await this.db
      .select()
      .from(productos)
      .where(eq(productos.id, id))
      .limit(1);
    return rows[0];
  }

  async findByIdForUpdate(id: string): Promise<Producto | undefined> {
    const rows = await this.db
      .select()
      .from(productos)
      .where(eq(productos.id, id))
      .limit(1)
      .for('update');
    return rows[0];
  }

  // No findBySku pre-check (mirrors proveedores' no-findByNombre reasoning):
  // a read-then-insert leaves a window a concurrent insert could take. The
  // unique index is the only authority; its 23505 is caught and mapped
  // here.
  async create(input: NuevoProducto): Promise<Producto> {
    try {
      const rows = await this.db
        .insert(productos)
        .values({
          nombre: input.nombre,
          sku: input.sku,
          categoria: input.categoria ?? null,
          stockMinimo: input.stockMinimo ?? null,
          precio: input.precio,
          proveedorId: input.proveedorId,
        })
        .returning();
      return expectOneRow(rows, 'create');
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw skuAlreadyInUse();
      }
      throw error;
    }
  }

  async update(id: string, cambios: CambiosProducto): Promise<Producto> {
    try {
      const rows = await this.db
        .update(productos)
        .set({
          ...(cambios.nombre !== undefined ? { nombre: cambios.nombre } : {}),
          ...(cambios.sku !== undefined ? { sku: cambios.sku } : {}),
          ...(cambios.categoria !== undefined
            ? { categoria: cambios.categoria }
            : {}),
          ...(cambios.stockMinimo !== undefined
            ? { stockMinimo: cambios.stockMinimo }
            : {}),
          ...(cambios.precio !== undefined ? { precio: cambios.precio } : {}),
          ...(cambios.proveedorId !== undefined
            ? { proveedorId: cambios.proveedorId }
            : {}),
        })
        .where(eq(productos.id, id))
        .returning();
      return expectOneRow(rows, 'update');
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw skuAlreadyInUse();
      }
      throw error;
    }
  }

  // Touches activo and nothing else — never a DELETE, so any existing
  // movimientos row and the audit history both stay intact.
  async setActivo(id: string, activo: boolean): Promise<Producto> {
    const rows = await this.db
      .update(productos)
      .set({ activo })
      .where(eq(productos.id, id))
      .returning();
    return expectOneRow(rows, 'setActivo');
  }

  // D1: exactly one conditional UPDATE. This is what makes two concurrent
  // calls serialize on the row's own write, never a SELECT ... FOR UPDATE
  // followed by a plain SET.
  async aplicarDelta(id: string, delta: number): Promise<number | undefined> {
    const rows = await this.db
      .update(productos)
      .set({ stockActual: sql`${productos.stockActual} + ${delta}` })
      .where(
        and(
          eq(productos.id, id),
          eq(productos.activo, true),
          sql`${productos.stockActual} + ${delta} >= 0`,
        ),
      )
      .returning({ stockActual: productos.stockActual });
    return rows[0]?.stockActual;
  }
}
