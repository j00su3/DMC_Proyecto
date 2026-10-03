import type { UnitOfWork } from '../db/uow.js';
import type { UsuariosRepo } from './repository.js';
import { normalizeEmail, resetUsuarioPassword } from './service.js';

// Pool-bound, read phase only: two plain SELECTs, no lock, so the refusals
// and the dry run also work under a read-only role (rescate-encargado D5).
export interface RescateRepos {
  usuarios: Pick<UsuariosRepo, 'findByEmail' | 'countActiveEncargados'>;
}

export interface RescatarEncargadoInput {
  email: string;
  confirmar: boolean;
}

export type MotivoRechazo = 'no_encontrado' | 'no_es_encargado' | 'inactivo';

// Projected field by field so the stored hash cannot leave this module.
export interface ObjetivoRescate {
  id: string;
  nombre: string;
  email: string;
}

// Refusals are values, not errors: the Spanish wording belongs to the script,
// and a dry run is not a failure. Unexpected failures (DB down,
// AUDIT_WRITE_FAILED) still throw.
export type ResultadoRescate =
  | { estado: 'rechazado'; motivo: MotivoRechazo }
  | {
      estado: 'simulado';
      objetivo: ObjetivoRescate;
      hayOtroEncargadoActivo: boolean;
    }
  | {
      estado: 'rescatado';
      objetivo: ObjetivoRescate;
      hayOtroEncargadoActivo: boolean;
      passwordTemporal: string;
    };

// Every refusal and the dry run are decided here, before any `uow.run` and
// before a password is hashed, so "writes nothing" holds by construction.
// No outer transaction: resetUsuarioPassword opens its own, and a second
// pool connection would block on a row lock held by the first (D5).
export async function rescatarEncargado(
  repos: RescateRepos,
  uow: UnitOfWork,
  input: RescatarEncargadoInput,
): Promise<ResultadoRescate> {
  const objetivo = await repos.usuarios.findByEmail(
    normalizeEmail(input.email),
  );
  if (!objetivo) {
    return { estado: 'rechazado', motivo: 'no_encontrado' };
  }
  if (objetivo.rol !== 'encargado') {
    return { estado: 'rechazado', motivo: 'no_es_encargado' };
  }
  if (!objetivo.activo) {
    return { estado: 'rechazado', motivo: 'inactivo' };
  }

  const hayOtroEncargadoActivo =
    (await repos.usuarios.countActiveEncargados()) > 1;
  const proyeccion: ObjetivoRescate = {
    id: objetivo.id,
    nombre: objetivo.nombre,
    email: objetivo.email,
  };

  if (!input.confirmar) {
    return {
      estado: 'simulado',
      objetivo: proyeccion,
      hayOtroEncargadoActivo,
    };
  }

  // A script has no authenticated actor and auditoria.usuario_id is NOT NULL,
  // so the rescued account files its own row, marked as a rescue (D2, D5).
  const { passwordTemporal } = await resetUsuarioPassword(
    uow,
    { id: objetivo.id, actorId: objetivo.id },
    'rescate',
  );
  return {
    estado: 'rescatado',
    objetivo: proyeccion,
    hayOtroEncargadoActivo,
    passwordTemporal,
  };
}
