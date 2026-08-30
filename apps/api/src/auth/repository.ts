import { and, eq, gt, lte, ne } from 'drizzle-orm';
import type { DbExecutor } from '../db/client.js';
import { sesiones, usuarios } from '../db/schema.js';
import type { Usuario } from '../usuarios/repository.js';
import { hashToken } from './session.js';

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
  // S2b — revokes EVERY session of a user, the caller's included (D10).
  deleteAllForUser(usuarioId: string): Promise<void>;
}

/**
 * Every method here takes the PLAINTEXT token — the value that lives in the
 * cookie — and hashes it before touching the table (SEC-008). Hashing lives in
 * the adapter, not at the call sites, so no caller can forget it and no future
 * caller has to remember: the port's contract is "hand me the cookie value".
 * `sesiones.id` therefore never holds a usable credential.
 */
export class DrizzleSesionesRepo implements SesionesRepo {
  constructor(private readonly db: DbExecutor) {}

  async create(sesion: NuevaSesion): Promise<void> {
    await this.db.insert(sesiones).values({
      id: hashToken(sesion.id),
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
          eq(sesiones.id, hashToken(id)),
          gt(sesiones.expiraEn, now),
          eq(usuarios.activo, true),
        ),
      )
      .limit(1);
    return rows[0]?.usuario as Usuario | undefined;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(sesiones).where(eq(sesiones.id, hashToken(id)));
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
      .where(
        and(
          eq(sesiones.usuarioId, usuarioId),
          ne(sesiones.id, hashToken(exceptId)),
        ),
      );
  }

  // Revokes EVERY session, the caller's included (design.md D10). The
  // asymmetry with deleteOthers is the point: there the actor IS the
  // subject and owns a session worth keeping; on an admin reset or
  // deactivate the actor is a different principal, and the trigger is
  // normally a lost or suspected-compromised credential, so a surviving
  // session leaves the attacker in.
  //
  // Deactivate calls it too, even though findValid already joins
  // `activo = true`: that makes revocation a fact in the table rather than
  // a property of a join a refactor could drop, and without it a
  // deactivated user's rows are immortal — purgeExpired runs only on
  // login, which that user can never perform again.
  async deleteAllForUser(usuarioId: string): Promise<void> {
    await this.db.delete(sesiones).where(eq(sesiones.usuarioId, usuarioId));
  }
}
