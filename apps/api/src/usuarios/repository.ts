import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.js';
import { usuarios } from '../db/schema.js';
import { emailAlreadyInUse } from '../lib/errors.js';

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  hashContrasena: string;
  rol: 'encargado' | 'deposito';
  activo: boolean;
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
  creadoEn: Date;
  debeCambiarPassword: boolean;
}

export interface LockoutResult {
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
}

// The projection every user-management read returns. No hashContrasena
// member, so no read path can leak the hash even by accident (design.md
// D15) — the RED test asserts the absence of the key, not of a value.
export interface UsuarioResumen {
  id: string;
  nombre: string;
  email: string;
  rol: 'encargado' | 'deposito';
  activo: boolean;
  debeCambiarPassword: boolean;
  creadoEn: Date;
}

// No field here admits a plaintext password — the service hashes before it
// calls (design.md D6, D8).
export interface NuevoUsuario {
  nombre: string;
  email: string;
  rol: 'encargado' | 'deposito';
  hashContrasena: string;
}

export interface CambiosUsuario {
  nombre?: string;
  email?: string;
  rol?: 'encargado' | 'deposito';
}

export interface UsuariosRepo {
  findByEmail(email: string): Promise<Usuario | undefined>;
  registerFailedAttempt(id: string): Promise<LockoutResult>;
  resetAttempts(id: string): Promise<void>;
  updatePassword(id: string, hash: string): Promise<void>;
  // S2a — CRUD (design.md D9, D15, D17)
  list(
    page: number,
    pageSize: number,
  ): Promise<{ rows: UsuarioResumen[]; total: number }>;
  findById(id: string): Promise<UsuarioResumen | undefined>;
  findByIdForUpdate(id: string): Promise<UsuarioResumen | undefined>;
  // S2b — the D2 predicate lock. Returns the ids it locked.
  lockActiveEncargados(): Promise<string[]>;
  // S3b — the lockout columns UsuarioResumen deliberately omits. D12's
  // reset audit needs their PRIOR values, and `UPDATE … RETURNING` returns
  // the new ones, so they have to be read before the write.
  findLockoutState(id: string): Promise<LockoutResult | undefined>;
  create(input: NuevoUsuario): Promise<UsuarioResumen>; // maps 23505 -> 409 (D9)
  update(id: string, cambios: CambiosUsuario): Promise<UsuarioResumen>; // maps 23505 -> 409
  setActivo(id: string, activo: boolean): Promise<UsuarioResumen>;
  resetPassword(id: string, hash: string): Promise<UsuarioResumen>; // + clears lockout (D11)
}

interface LockoutRow {
  intentos_fallidos: number;
  bloqueado_hasta: string | Date | null;
}

// The explicit no-hash projection used by every read/write that returns a
// UsuarioResumen (design.md D15). Never `select *` / `returning()` here.
const usuarioResumenColumns = {
  id: usuarios.id,
  nombre: usuarios.nombre,
  email: usuarios.email,
  rol: usuarios.rol,
  activo: usuarios.activo,
  debeCambiarPassword: usuarios.debeCambiarPassword,
  creadoEn: usuarios.creadoEn,
};

// Every write here runs after the caller has locked the row (design.md D3),
// so a missing row is a broken invariant, not a 404 the service should map.
// Follows the existing `registerFailedAttempt` precedent in this file.
function expectOneRow(
  rows: UsuarioResumen[],
  operation: string,
): UsuarioResumen {
  const row = rows[0];
  if (!row) {
    throw new Error(`${operation}: no row returned`);
  }
  return row;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// node-postgres carries the Postgres SQLSTATE on `.code`; 23505 is
// unique_violation, which the usuarios_email_unique index raises.
//
// The chain walk is not defensive padding. Drizzle wraps every driver error
// in a `DrizzleQueryError` and hangs the `pg` error off `.cause`, so the
// SQLSTATE is one level down and a top-level `.code` read finds nothing —
// which would have turned every duplicate email into a 500 instead of a 409.
// Both levels are checked so the mapping survives Drizzle changing its mind
// about wrapping. Depth is bounded because a `cause` chain can be cyclic.
function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }
    if ((current as { code?: unknown }).code === '23505') {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export class DrizzleUsuariosRepo implements UsuariosRepo {
  constructor(private readonly db: DbExecutor) {}

  async findByEmail(email: string): Promise<Usuario | undefined> {
    const rows = await this.db
      .select()
      .from(usuarios)
      .where(eq(usuarios.email, email))
      .limit(1);
    return rows[0] as Usuario | undefined;
  }

  // Single atomic UPDATE, no read-modify-write (design.md "Atomic lockout
  // UPDATE"). The elapsed-lockout branch prevents a stale counter of 5 from
  // re-locking on the first attempt after the 5-minute window.
  async registerFailedAttempt(id: string): Promise<LockoutResult> {
    const result = await this.db.execute(sql`
      update usuarios set
        intentos_fallidos = case when bloqueado_hasta is not null and bloqueado_hasta <= now()
                                 then 1 else intentos_fallidos + 1 end,
        bloqueado_hasta   = case when (case when bloqueado_hasta is not null and bloqueado_hasta <= now()
                                            then 1 else intentos_fallidos + 1 end) >= 5
                                 then now() + interval '5 minutes'
                                 when bloqueado_hasta <= now() then null else bloqueado_hasta end
      where id = ${id} returning intentos_fallidos, bloqueado_hasta
    `);
    const rows = (result as unknown as { rows: LockoutRow[] }).rows;
    const row = rows[0];
    if (!row) {
      throw new Error(`registerFailedAttempt: no row returned for id ${id}`);
    }
    return {
      intentosFallidos: row.intentos_fallidos,
      bloqueadoHasta: row.bloqueado_hasta
        ? new Date(row.bloqueado_hasta)
        : null,
    };
  }

  async resetAttempts(id: string): Promise<void> {
    await this.db
      .update(usuarios)
      .set({ intentosFallidos: 0, bloqueadoHasta: null })
      .where(eq(usuarios.id, id));
  }

  // Single UPDATE sets the hash and clears debe_cambiar_password together
  // (design.md D6) — two statements would allow a partial failure that
  // changes the password but leaves the flag set, trapping the user in a
  // redirect loop while holding the new password.
  async updatePassword(id: string, hash: string): Promise<void> {
    await this.db
      .update(usuarios)
      .set({ hashContrasena: hash, debeCambiarPassword: false })
      .where(eq(usuarios.id, id));
  }

  // Two statements, not one windowed query: `count(*) over ()` returns no
  // row at all on an out-of-range page, which would report total 0 for a
  // non-empty table. The `::int` cast keeps the count a number — node-postgres
  // hands back bigint as a string.
  //
  // `id desc` is not decoration (design.md D17). `creado_en` has no
  // uniqueness guarantee, and OFFSET pagination over an order that ties is
  // free to return a row on two pages or on none.
  async list(
    page: number,
    pageSize: number,
  ): Promise<{ rows: UsuarioResumen[]; total: number }> {
    const rows = await this.db
      .select(usuarioResumenColumns)
      .from(usuarios)
      .orderBy(desc(usuarios.creadoEn), desc(usuarios.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const totalRows = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(usuarios);

    return { rows, total: totalRows[0]?.total ?? 0 };
  }

  async findById(id: string): Promise<UsuarioResumen | undefined> {
    const rows = await this.db
      .select(usuarioResumenColumns)
      .from(usuarios)
      .where(eq(usuarios.id, id))
      .limit(1);
    return rows[0];
  }

  // The row lock that closes the last-encargado write skew (design.md D2,
  // D3). Callers take it AFTER locking the active-encargado set, never
  // before — the reverse order is a real deadlock cycle.
  async findByIdForUpdate(id: string): Promise<UsuarioResumen | undefined> {
    const rows = await this.db
      .select(usuarioResumenColumns)
      .from(usuarios)
      .where(eq(usuarios.id, id))
      .limit(1)
      .for('update');
    return rows[0];
  }

  // The D2 predicate lock, and the reason the guard is two statements
  // instead of one conditional UPDATE. The last-encargado invariant spans
  // rows, so a WHERE-clause EXISTS evaluates against a snapshot where a
  // concurrent transaction's uncommitted write is invisible: both see a
  // second active encargado, both commit, zero remain. FOR UPDATE closes
  // it because after a lock wait Postgres re-evaluates the predicate
  // against the NEW row version, so the row the other transaction just
  // deactivated drops out of this set.
  //
  // `order by id` is the total lock order of D3, taken here and then on
  // the target — never the reverse, which is a real deadlock cycle.
  async lockActiveEncargados(): Promise<string[]> {
    const rows = await this.db
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(and(eq(usuarios.rol, 'encargado'), eq(usuarios.activo, true)))
      .orderBy(asc(usuarios.id))
      .for('update');
    return rows.map((row) => row.id);
  }

  // The lockout columns UsuarioResumen omits on purpose (D15), read
  // separately so they never enter a route DTO. D12's reset audit needs
  // their PRIOR values and `UPDATE … RETURNING` hands back the new ones.
  async findLockoutState(id: string): Promise<LockoutResult | undefined> {
    const rows = await this.db
      .select({
        intentosFallidos: usuarios.intentosFallidos,
        bloqueadoHasta: usuarios.bloqueadoHasta,
      })
      .from(usuarios)
      .where(eq(usuarios.id, id))
      .limit(1);
    return rows[0];
  }

  // No findByEmail pre-check (design.md D9). A read-then-insert leaves a
  // window in which a concurrent insert takes the email between the two
  // statements; the unique index is the only authority, so we let it fire
  // and translate its SQLSTATE.
  async create(input: NuevoUsuario): Promise<UsuarioResumen> {
    try {
      const rows = await this.db
        .insert(usuarios)
        .values({
          nombre: input.nombre,
          email: normalizeEmail(input.email),
          rol: input.rol,
          hashContrasena: input.hashContrasena,
          debeCambiarPassword: true,
        })
        .returning(usuarioResumenColumns);
      return expectOneRow(rows, 'create');
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw emailAlreadyInUse();
      }
      throw error;
    }
  }

  async update(id: string, cambios: CambiosUsuario): Promise<UsuarioResumen> {
    try {
      const rows = await this.db
        .update(usuarios)
        .set({
          ...(cambios.nombre !== undefined ? { nombre: cambios.nombre } : {}),
          ...(cambios.email !== undefined
            ? { email: normalizeEmail(cambios.email) }
            : {}),
          ...(cambios.rol !== undefined ? { rol: cambios.rol } : {}),
        })
        .where(eq(usuarios.id, id))
        .returning(usuarioResumenColumns);
      return expectOneRow(rows, 'update');
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw emailAlreadyInUse();
      }
      throw error;
    }
  }

  // Touches `activo` and nothing else. Reactivation deliberately leaves
  // `intentos_fallidos`/`bloqueado_hasta` alone (design.md D11): a user
  // locked out by brute force must not be handed a clean slate just because
  // an encargado flipped them back on. Rescuing a locked account is what
  // resetPassword is for.
  async setActivo(id: string, activo: boolean): Promise<UsuarioResumen> {
    const rows = await this.db
      .update(usuarios)
      .set({ activo })
      .where(eq(usuarios.id, id))
      .returning(usuarioResumenColumns);
    return expectOneRow(rows, 'setActivo');
  }

  // One statement, four columns (design.md D11). Splitting the lockout clear
  // into a second UPDATE would let a partial failure leave the account
  // holding the new temporary password while still locked out — and
  // `auth/service.ts` checks the lockout BEFORE verifying the password, so
  // the user could never spend the credential the encargado just issued.
  async resetPassword(id: string, hash: string): Promise<UsuarioResumen> {
    const rows = await this.db
      .update(usuarios)
      .set({
        hashContrasena: hash,
        debeCambiarPassword: true,
        intentosFallidos: 0,
        bloqueadoHasta: null,
      })
      .where(eq(usuarios.id, id))
      .returning(usuarioResumenColumns);
    return expectOneRow(rows, 'resetPassword');
  }
}
