import {
  accountInactive,
  accountLocked,
  invalidCredentials,
} from '../lib/errors.js';
import { DUMMY_HASH, verifyPassword } from './password.js';
import type { SesionesRepo, Usuario, UsuariosRepo } from './repository.js';
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

  if (usuario.bloqueadoHasta && usuario.bloqueadoHasta.getTime() > Date.now()) {
    const retryAfter = Math.ceil(
      (usuario.bloqueadoHasta.getTime() - Date.now()) / 1000,
    );
    throw accountLocked(retryAfter);
  }

  const passwordOk = await verifyPassword(
    usuario.hashContrasena,
    input.password,
  );
  if (!passwordOk) {
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
