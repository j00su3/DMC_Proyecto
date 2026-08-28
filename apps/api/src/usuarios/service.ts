import type { AuditAccion } from '../auditoria/service.js';
import { recordAudit } from '../auditoria/service.js';
import { hashPassword } from '../auth/password.js';
import type { UnitOfWork } from '../db/uow.js';
import { lastActiveEncargado, userNotFound } from '../lib/errors.js';
import type {
  CambiosUsuario,
  UsuarioResumen,
  UsuariosRepo,
} from './repository.js';
import { generateTempPassword } from './temp-password.js';

// Local read-only shape so the read paths do not depend on the Fastify
// plugin layer, matching auth/service.ts. The write paths take a
// `UnitOfWork` instead and never see a repo they did not get from `run`.
export interface ReadRepos {
  usuarios: UsuariosRepo;
}

export interface ListUsuariosInput {
  page: number;
  pageSize: number;
}

export interface CreateUsuarioInput {
  nombre: string;
  email: string;
  rol: 'encargado' | 'deposito';
  actorId: string;
}

export interface UpdateUsuarioInput {
  id: string;
  cambios: CambiosUsuario;
  actorId: string;
}

export interface SetUsuarioActivoInput {
  id: string;
  activo: boolean;
  actorId: string;
}

export interface ResetUsuarioPasswordInput {
  id: string;
  actorId: string;
}

// The plaintext leaves the service exactly once, in this return value
// (D8). No repo argument, log line or audit snapshot carries it.
export interface UsuarioConPassword {
  usuario: UsuarioResumen;
  passwordTemporal: string;
}

interface Diff {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Changed fields only, in both directions (auditoria-general D6). The
// emptiness of `after` is also what D5 keys off: no change means no write
// and no audit row, because `actualizar`/`baja_logica`/`reactivar` name a
// TRANSITION, and filing one that did not happen is what breaks the "who
// deactivated this user" query the verbs exist for.
function changedFields(
  previo: Record<string, unknown>,
  cambios: Record<string, unknown>,
): Diff {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cambios)) {
    if (previo[key] !== value) {
      before[key] = previo[key];
      after[key] = value;
    }
  }
  return { before, after };
}

function isEmpty(diff: Diff): boolean {
  return Object.keys(diff.after).length === 0;
}

// The guard's own predicate, kept in one place so the two write paths that
// can remove admin capability cannot drift apart. `previo.activo` is what
// makes an already-inactive encargado skip the guard entirely (D5), and
// `previo.rol` is what makes a deposito user irrelevant to it.
function removesAdminCapability(
  previo: UsuarioResumen,
  next: { activo: boolean; rol: 'encargado' | 'deposito' },
): boolean {
  return (
    previo.rol === 'encargado' &&
    previo.activo &&
    (next.activo === false || next.rol !== 'encargado')
  );
}

function assertNotLastActiveEncargado(
  lockedIds: string[],
  targetId: string,
): void {
  if (lockedIds.filter((id) => id !== targetId).length === 0) {
    throw lastActiveEncargado();
  }
}

export async function listUsuarios(
  repos: ReadRepos,
  input: ListUsuariosInput,
): Promise<{ rows: UsuarioResumen[]; total: number }> {
  return repos.usuarios.list(input.page, input.pageSize);
}

export async function getUsuario(
  repos: ReadRepos,
  id: string,
): Promise<UsuarioResumen> {
  const usuario = await repos.usuarios.findById(id);
  if (!usuario) {
    throw userNotFound();
  }
  return usuario;
}

// Generation and hashing run OUTSIDE `uow.run` (D6): argon2id at
// memoryCost 19456 is deliberately expensive, depends on nothing in the
// database, and would otherwise hold a pooled connection open across it.
export async function createUsuario(
  uow: UnitOfWork,
  input: CreateUsuarioInput,
): Promise<UsuarioConPassword> {
  const passwordTemporal = generateTempPassword();
  const hashContrasena = await hashPassword(passwordTemporal);

  const usuario = await uow.run(async (repos) => {
    // No set lock: adding a user cannot remove admin capability (D3).
    const creado = await repos.usuarios.create({
      nombre: input.nombre,
      email: input.email,
      rol: input.rol,
      hashContrasena,
    });
    await recordAudit(repos.auditoria, {
      entidad: 'usuarios',
      entidadId: creado.id,
      accion: 'crear',
      usuarioId: input.actorId,
      // Null iff the verb is `crear` (D7) — the auditoria CHECK constraint
      // enforces the same equivalence at the database.
      datosPrevios: null,
      datosPosteriores: { ...creado },
    });
    return creado;
  });

  return { usuario, passwordTemporal };
}

export async function updateUsuario(
  uow: UnitOfWork,
  input: UpdateUsuarioInput,
): Promise<UsuarioResumen> {
  // Email is normalized here as well as in the repo, because the DIFF has
  // to compare what will actually be stored. Comparing raw input would see
  // a change in `ANA@EXAMPLE.COM` over `ana@example.com` and write a row —
  // and an audit entry — for a value the database already holds.
  const cambios: CambiosUsuario = {
    ...input.cambios,
    ...(input.cambios.email !== undefined
      ? { email: normalizeEmail(input.cambios.email) }
      : {}),
  };

  return uow.run(async (repos) => {
    // D3: the lock decision comes from the REQUEST SHAPE, before the target
    // is read. Reading first would lock a row that may itself be inside the
    // set, inverting the order against a transaction that took the set
    // first — a genuine deadlock cycle. Deciding from the shape needs no
    // read, so the order is unconditional.
    const lockedIds =
      cambios.rol === 'deposito'
        ? await repos.usuarios.lockActiveEncargados()
        : undefined;

    const previo = await repos.usuarios.findByIdForUpdate(input.id);
    if (!previo) {
      throw userNotFound();
    }

    if (
      lockedIds &&
      removesAdminCapability(previo, {
        activo: previo.activo,
        rol: cambios.rol ?? previo.rol,
      })
    ) {
      assertNotLastActiveEncargado(lockedIds, input.id);
    }

    const diff = changedFields(
      previo as unknown as Record<string, unknown>,
      cambios as Record<string, unknown>,
    );
    if (isEmpty(diff)) {
      return previo;
    }

    const posterior = await repos.usuarios.update(input.id, cambios);
    await recordAudit(repos.auditoria, {
      entidad: 'usuarios',
      entidadId: input.id,
      accion: 'actualizar',
      usuarioId: input.actorId,
      datosPrevios: diff.before,
      datosPosteriores: diff.after,
    });
    return posterior;
  });
}

export async function setUsuarioActivo(
  uow: UnitOfWork,
  input: SetUsuarioActivoInput,
): Promise<UsuarioResumen> {
  return uow.run(async (repos) => {
    const lockedIds = input.activo
      ? undefined
      : await repos.usuarios.lockActiveEncargados();

    const previo = await repos.usuarios.findByIdForUpdate(input.id);
    if (!previo) {
      throw userNotFound();
    }

    if (
      lockedIds &&
      removesAdminCapability(previo, { activo: input.activo, rol: previo.rol })
    ) {
      assertNotLastActiveEncargado(lockedIds, input.id);
    }

    const diff = changedFields(previo as unknown as Record<string, unknown>, {
      activo: input.activo,
    });
    if (isEmpty(diff)) {
      return previo;
    }

    const posterior = await repos.usuarios.setActivo(input.id, input.activo);
    if (!input.activo) {
      // D10: eager revocation even though findValid already joins
      // `activo = true`. It makes the revocation a fact in the table rather
      // than a property of a join a refactor could drop — and without it a
      // deactivated user's session rows are immortal, since purgeExpired
      // runs only on login, which that user can never perform again.
      await repos.sesiones.deleteAllForUser(input.id);
    }
    const accion: AuditAccion = input.activo ? 'reactivar' : 'baja_logica';
    await recordAudit(repos.auditoria, {
      entidad: 'usuarios',
      entidadId: input.id,
      accion,
      usuarioId: input.actorId,
      datosPrevios: diff.before,
      datosPosteriores: diff.after,
    });
    return posterior;
  });
}

export async function resetUsuarioPassword(
  uow: UnitOfWork,
  input: ResetUsuarioPasswordInput,
): Promise<UsuarioConPassword> {
  const passwordTemporal = generateTempPassword();
  const hashContrasena = await hashPassword(passwordTemporal);

  const usuario = await uow.run(async (repos) => {
    // No set lock: a password reset changes no rol and no activo, so it
    // cannot remove admin capability (D3).
    const previo = await repos.usuarios.findByIdForUpdate(input.id);
    if (!previo) {
      throw userNotFound();
    }
    // The lockout columns UsuarioResumen omits on purpose (D15). Read
    // before the write, because `UPDATE … RETURNING` hands back the new
    // values and D12's snapshot needs the old ones.
    const lockoutPrevio = await repos.usuarios.findLockoutState(input.id);

    const posterior = await repos.usuarios.resetPassword(
      input.id,
      hashContrasena,
    );
    await repos.sesiones.deleteAllForUser(input.id);

    // D12: the verb names the ACT, not who initiated it. An admin reset is
    // exactly the row where `usuario_id` (actor) and `entidad_id` (subject)
    // differ, so it needs no enum value of its own.
    await recordAudit(repos.auditoria, {
      entidad: 'usuarios',
      entidadId: input.id,
      accion: 'cambiar_password',
      usuarioId: input.actorId,
      datosPrevios: {
        debeCambiarPassword: previo.debeCambiarPassword,
        intentosFallidos: lockoutPrevio?.intentosFallidos ?? 0,
        bloqueadoHasta: lockoutPrevio?.bloqueadoHasta ?? null,
      },
      datosPosteriores: {
        debeCambiarPassword: true,
        intentosFallidos: 0,
        bloqueadoHasta: null,
      },
    });
    return posterior;
  });

  return { usuario, passwordTemporal };
}
