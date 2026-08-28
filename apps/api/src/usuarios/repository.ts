import { eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.js';
import { usuarios } from '../db/schema.js';

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

export interface UsuariosRepo {
  findByEmail(email: string): Promise<Usuario | undefined>;
  registerFailedAttempt(id: string): Promise<LockoutResult>;
  resetAttempts(id: string): Promise<void>;
  updatePassword(id: string, hash: string): Promise<void>;
}

interface LockoutRow {
  intentos_fallidos: number;
  bloqueado_hasta: string | Date | null;
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
}
