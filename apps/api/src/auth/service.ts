import { recordAudit } from '../auditoria/service.js';
import type { UnitOfWork } from '../db/uow.js';
import {
  accountInactive,
  accountLocked,
  invalidCredentials,
  invalidCurrentPassword,
} from '../lib/errors.js';
import type { Usuario, UsuariosRepo } from '../usuarios/repository.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password.js';
import type { SesionesRepo } from './repository.js';
import { SESSION_TTL_SECONDS, createToken } from './session.js';

// Local repo-pair shape so this module has no dependency on the Fastify
// plugin layer (plugins/repos.ts) — matches design.md's "functions over
// repository interfaces" framing.
export interface Repos {
  usuarios: UsuariosRepo;
  sesiones: SesionesRepo;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  usuario: Usuario;
  token: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Business rules over repository interfaces (design.md's POST
// /api/auth/login data-flow diagram, D9-D11, D14). Order matters:
// lockout is checked before the password verify, and `activo` is checked
// AFTER a successful verify so ACCOUNT_INACTIVE never becomes a
// user-enumeration oracle (D10).
export async function login(
  repos: Repos,
  input: LoginInput,
): Promise<LoginResult> {
  const email = normalizeEmail(input.email);
  const usuario = await repos.usuarios.findByEmail(email);

  if (!usuario) {
    // D11: run argon2.verify against a fixed dummy hash so the timing
    // profile matches a wrong-password attempt (no user enumeration).
    await verifyPassword(DUMMY_HASH, input.password);
    throw invalidCredentials();
  }

  // SEC-001 / ADR-0007 § Actualizado 2026-08-29: the lockout is evaluated
  // AFTER the password, never before. Checking it first made the control a
  // denial of service against its own beneficiary — anyone who knew the only
  // encargado's email could hold the account shut with five requests every
  // five minutes, far under the route's 10/min limit, while the counter's
  // only reset was a successful login they were being prevented from making.
  //
  // Verifying first makes the lockout what it was meant to be: a defence
  // against guessing. Whoever guesses wrong stays locked; whoever knows their
  // own password is never locked out. Accepted cost, on the record in the
  // ADR: argon2.verify now also runs for locked accounts, bounded by the
  // login route's rate limit (SEC-004).
  const passwordOk = await verifyPassword(
    usuario.hashContrasena,
    input.password,
  );

  if (!passwordOk) {
    // `bloqueadoHasta` is the pre-attempt state read above, so an account
    // already locked is refused without extending its own window: the
    // owner's remaining wait never grows because an attacker kept trying.
    if (
      usuario.bloqueadoHasta &&
      usuario.bloqueadoHasta.getTime() > Date.now()
    ) {
      const retryAfter = Math.ceil(
        (usuario.bloqueadoHasta.getTime() - Date.now()) / 1000,
      );
      throw accountLocked(retryAfter);
    }
    await repos.usuarios.registerFailedAttempt(usuario.id);
    throw invalidCredentials();
  }

  if (!usuario.activo) {
    throw accountInactive();
  }

  await repos.usuarios.resetAttempts(usuario.id);
  // D14: opportunistic cleanup of this user's expired sessions on login,
  // no background scheduler.
  await repos.sesiones.purgeExpired(usuario.id);

  const token = createToken();
  await repos.sesiones.create({
    id: token,
    usuarioId: usuario.id,
    expiraEn: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
  });

  return { usuario, token };
}

export async function logout(repos: Repos, token: string): Promise<void> {
  await repos.sesiones.delete(token);
}

export async function resolveSession(
  repos: Repos,
  token: string,
): Promise<Usuario | undefined> {
  return repos.sesiones.findValid(token, new Date());
}

export interface ChangePasswordInput {
  usuario: Usuario;
  sessionId: string;
  currentPassword: string;
  newPassword: string;
}

// Single funnel every password mutation passes through (design.md D9) — the
// hook point backlog #2.2's audit change uses, now that immutable
// `auditoria` rows exist.
//
// Order matters. `verifyPassword`/`hashPassword` run OUTSIDE the transaction
// (design.md D3) — argon2 hashing is deliberately slow and depends on
// nothing in the database, so holding a pooled connection open across it is
// pure contention for zero atomicity benefit. Once verified, the hash
// update, the session revocation and the audit write all run inside one
// `uow.run` (design.md D1, D4, D8): the capability's promise that another
// session's cookie stops working is not kept if `deleteOthers` can fail on
// its own while the password change commits (spec R1), so it is folded into
// the same transaction as the audit write.
export async function changePassword(
  uow: UnitOfWork,
  input: ChangePasswordInput,
): Promise<void> {
  const { usuario, sessionId, currentPassword, newPassword } = input;

  const currentOk = await verifyPassword(
    usuario.hashContrasena,
    currentPassword,
  );
  if (!currentOk) {
    throw invalidCurrentPassword();
  }

  const hash = await hashPassword(newPassword);

  await uow.run(async (repos) => {
    await repos.usuarios.updatePassword(usuario.id, hash);
    await repos.sesiones.deleteOthers(usuario.id, sessionId);
    // D7's non-symmetric case: datosPrevios carries the actual prior value
    // of the one field that changes as a side effect of updatePassword;
    // datosPosteriores is always `false` because updatePassword always
    // clears the flag. hash_contrasena itself never reaches either snapshot
    // (design.md D6/D11 denylist, enforced in recordAudit).
    await recordAudit(repos.auditoria, {
      entidad: 'usuarios',
      entidadId: usuario.id,
      accion: 'cambiar_password',
      usuarioId: usuario.id,
      datosPrevios: { debeCambiarPassword: usuario.debeCambiarPassword },
      datosPosteriores: { debeCambiarPassword: false },
    });
  });
}
