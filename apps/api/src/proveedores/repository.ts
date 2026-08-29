import { desc, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.js';
import { proveedores } from '../db/schema.js';
import { isUniqueViolation } from '../lib/db-errors.js';
import { supplierNameInUse } from '../lib/errors.js';

export interface Proveedor {
  id: string;
  nombre: string;
  contacto: string | null;
  activo: boolean;
  creadoEn: Date;
}

export interface NuevoProveedor {
  nombre: string;
  contacto?: string | null;
}

export interface CambiosProveedor {
  nombre?: string;
  contacto?: string | null;
}

export interface ProveedoresRepo {
  list(
    page: number,
    pageSize: number,
  ): Promise<{ rows: Proveedor[]; total: number }>; // D9
  findById(id: string): Promise<Proveedor | undefined>;
  findByIdForUpdate(id: string): Promise<Proveedor | undefined>; // the only lock (D7)
  create(input: NuevoProveedor): Promise<Proveedor>; // maps 23505 -> 409 (D13)
  update(id: string, cambios: CambiosProveedor): Promise<Proveedor>; // maps 23505 -> 409
  setActivo(id: string, activo: boolean): Promise<Proveedor>; // never DELETE (D8)
  // No findByNombre, deliberately (D2): case folding happens only in the
  // database, so there is no method here to fold in TypeScript. When a
  // future selector needs one, it MUST be written
  // `where lower(nombre) = lower($1)`.
  // No lock* method, deliberately (D7, D8): the only invariant here is
  // per-row, so the single findByIdForUpdate lock is the entire locking
  // surface.
}

// Mirrors usuarios/repository.ts's expectOneRow precedent: every write here
// runs after the caller has locked the row (or is an insert), so a missing
// row is a broken invariant, not a 404 the service should map.
function expectOneRow(rows: Proveedor[], operation: string): Proveedor {
  const row = rows[0];
  if (!row) {
    throw new Error(`${operation}: no row returned`);
  }
  return row;
}

export class DrizzleProveedoresRepo implements ProveedoresRepo {
  constructor(private readonly db: DbExecutor) {}

  // Two statements, mirroring usuarios/repository.ts's list() (design.md
  // D9, itself mirrored from gestion-usuarios D17) rather than
  // re-deriving: `count(*) over ()` returns no row at all on an
  // out-of-range page, which would report total 0 for a non-empty table.
  // `desc(creadoEn), desc(id)` — creadoEn alone is not a total order,
  // suppliers are entered in batches by one person on one afternoon so ties
  // are routine, and OFFSET pagination over a tying order is free to return
  // a row on two pages or on none.
  async list(
    page: number,
    pageSize: number,
  ): Promise<{ rows: Proveedor[]; total: number }> {
    const rows = await this.db
      .select()
      .from(proveedores)
      .orderBy(desc(proveedores.creadoEn), desc(proveedores.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const totalRows = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(proveedores);

    return { rows, total: totalRows[0]?.total ?? 0 };
  }

  async findById(id: string): Promise<Proveedor | undefined> {
    const rows = await this.db
      .select()
      .from(proveedores)
      .where(eq(proveedores.id, id))
      .limit(1);
    return rows[0];
  }

  // The only row lock this repo takes (design.md D7). The service reads
  // this, diffs against the incoming change, then writes inside the same
  // transaction — without the lock two concurrent PATCHes would each diff
  // against a stale snapshot.
  async findByIdForUpdate(id: string): Promise<Proveedor | undefined> {
    const rows = await this.db
      .select()
      .from(proveedores)
      .where(eq(proveedores.id, id))
      .limit(1)
      .for('update');
    return rows[0];
  }

  // No findByNombre pre-check (design.md D2): a read-then-insert leaves a
  // window in which a concurrent insert takes the name between the two
  // statements. The unique index is the only authority; its 23505 is
  // caught and mapped here.
  async create(input: NuevoProveedor): Promise<Proveedor> {
    try {
      const rows = await this.db
        .insert(proveedores)
        .values({
          nombre: input.nombre,
          contacto: input.contacto ?? null,
        })
        .returning();
      return expectOneRow(rows, 'create');
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw supplierNameInUse();
      }
      throw error;
    }
  }

  async update(id: string, cambios: CambiosProveedor): Promise<Proveedor> {
    try {
      const rows = await this.db
        .update(proveedores)
        .set({
          ...(cambios.nombre !== undefined ? { nombre: cambios.nombre } : {}),
          ...(cambios.contacto !== undefined
            ? { contacto: cambios.contacto }
            : {}),
        })
        .where(eq(proveedores.id, id))
        .returning();
      return expectOneRow(rows, 'update');
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw supplierNameInUse();
      }
      throw error;
    }
  }

  // Touches activo and nothing else — never a DELETE (design.md D8), so any
  // existing or future reference to this id (including a future
  // productos.proveedor_id foreign key) and the audit history both stay
  // intact.
  async setActivo(id: string, activo: boolean): Promise<Proveedor> {
    const rows = await this.db
      .update(proveedores)
      .set({ activo })
      .where(eq(proveedores.id, id))
      .returning();
    return expectOneRow(rows, 'setActivo');
  }
}
