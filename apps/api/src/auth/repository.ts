import { and, eq, gt, lte, ne } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.js';
import { sesiones, usuarios } from '../db/schema.js';
import type { Usuario } from '../usuarios/repository.js';

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
  deleteOthers(usuarioId: string, exceptId: string): Promise<void>;
}

export class DrizzleSesionesRepo implements SesionesRepo {
  constructor(private readonly db: DbExecutor) {}

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

  // Revokes every session for a user except the one that performed the
  // password change (design.md D7 — update happens before this call).
  async deleteOthers(usuarioId: string, exceptId: string): Promise<void> {
    await this.db
      .delete(sesiones)
      .where(and(eq(sesiones.usuarioId, usuarioId), ne(sesiones.id, exceptId)));
  }
}
