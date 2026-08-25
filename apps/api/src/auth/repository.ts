import { and, eq, gt, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sesiones, usuarios } from '../db/schema.js';

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
}

export interface LockoutResult {
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
}

export interface UsuariosRepo {
  findByEmail(email: string): Promise<Usuario | undefined>;
  registerFailedAttempt(id: string): Promise<LockoutResult>;
  resetAttempts(id: string): Promise<void>;
}

export interface NuevaSesion {
  id: string;
  usuarioId: string;
  expiraEn: Date;
}

export interface SesionesRepo {
  create(sesion: NuevaSesion): Promise<void>;
  findValid(id: string, now: Date): Promise<Usuario | undefined>;
  delete(id: string): Promise<void>;
  purgeExpired(usuarioId: string): Promise<void>;
}

interface LockoutRow {
  intentos_fallidos: number;
  bloqueado_hasta: string | Date | null;
}

export class DrizzleUsuariosRepo implements UsuariosRepo {
  constructor(private readonly db: Db) {}

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
}

export class DrizzleSesionesRepo implements SesionesRepo {
  constructor(private readonly db: Db) {}

  async create(sesion: NuevaSesion): Promise<void> {
    await this.db.insert(sesiones).values({
      id: sesion.id,
      usuarioId: sesion.usuarioId,
      expiraEn: sesion.expiraEn,
    });
  }

  async findValid(id: string, now: Date): Promise<Usuario | undefined> {
    const rows = await this.db
      .select({ usuario: usuarios })
      .from(sesiones)
      .innerJoin(usuarios, eq(sesiones.usuarioId, usuarios.id))
      .where(
        and(
          eq(sesiones.id, id),
          gt(sesiones.expiraEn, now),
          eq(usuarios.activo, true),
        ),
      )
      .limit(1);
    return rows[0]?.usuario as Usuario | undefined;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(sesiones).where(eq(sesiones.id, id));
  }

  async purgeExpired(usuarioId: string): Promise<void> {
    await this.db
      .delete(sesiones)
      .where(
        and(
          eq(sesiones.usuarioId, usuarioId),
          lte(sesiones.expiraEn, new Date()),
        ),
      );
  }
}
