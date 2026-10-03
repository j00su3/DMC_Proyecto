import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getDb, getPool } from '../src/db/pool.js';
import { createUnitOfWork } from '../src/db/uow.js';
import { buildRepos } from '../src/plugins/repos.js';
import {
  type ResultadoRescate,
  rescatarEncargado,
} from '../src/usuarios/rescate.js';
import { formatError, requireDatabaseUrl } from './seed-demo.js';

// Operator rescue for the last locked-out encargado (ADR-0007, finding D-02).
// Human-invoked and out-of-band, like the seed scripts. The operator is the
// only gate: this script has no authenticated actor, so confirming who asked
// is a human step that happens before it runs.
//
// The generated temporary password is the only secret this script handles. It
// is printed once, in one write, on a committed rescue and nowhere else. No
// password is accepted from argv or from the environment.

export class UsageError extends Error {}

export interface RescueArgs {
  email: string;
  confirmar: boolean;
}

export interface RescueIo {
  out(text: string): void;
  err(text: string): void;
}

const PASSWORD_FLAGS = ['--password', '-p', '--contrasena', '--clave'];

const USO =
  'Uso: pnpm --filter @inventienda/api rescatar:encargado --email <correo> [--confirmar]';

function passwordFlagIn(token: string): string | undefined {
  return PASSWORD_FLAGS.find(
    (flag) =>
      token === flag ||
      token.startsWith(`${flag}=`) ||
      // `-pSecreto123`: a short flag with its value attached.
      (flag === '-p' && token.startsWith('-p')),
  );
}

// Stricter than seed-encargado's parser on purpose: a typo here must not be
// silently ignored, and no message may echo a token that could be a secret.
export function parseArgs(argv: string[]): RescueArgs {
  for (const token of argv) {
    const flag = passwordFlagIn(token);
    if (flag) {
      throw new UsageError(
        `Este script no acepta contraseñas por argumento (${flag}). La contraseña temporal se genera sola y se muestra una vez.`,
      );
    }
  }

  let email: string | undefined;
  let confirmar = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;
    if (token === '--confirmar') {
      confirmar = true;
    } else if (token === '--email') {
      const value = argv[i + 1];
      if (
        email !== undefined ||
        value === undefined ||
        value.startsWith('-') ||
        value.trim() === ''
      ) {
        throw new UsageError('Falta el valor de --email <correo>.');
      }
      email = value;
      i += 1;
    } else {
      // Only a plain `--name` is echoed; anything else could carry a secret.
      const nombre = /^--[a-z-]+$/.test(token) ? ` (${token})` : '';
      throw new UsageError(`Argumento no reconocido${nombre}.`);
    }
  }
  if (email === undefined) {
    throw new UsageError('Falta --email <correo>.');
  }
  return { email, confirmar };
}

// host[:port]/database from the URL's own parts. Never the username, the
// password, the query string or the raw input.
export function describeTarget(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new UsageError('DATABASE_URL no es una URL de conexión válida.');
  }
  if (!parsed.hostname) {
    throw new UsageError('DATABASE_URL no es una URL de conexión válida.');
  }
  const port = parsed.port ? `:${parsed.port}` : '';
  return `${parsed.hostname}${port}${parsed.pathname}`;
}

const AVISO_OTRO_ENCARGADO =
  'Hay otro encargado activo: restablecer la contraseña desde la aplicación es la vía normal.';

const MENSAJE_RECHAZO = {
  no_encontrado: 'No se encontró ningún usuario con ese correo.',
  no_es_encargado:
    'La cuenta existe pero no es de un encargado; este script solo rescata encargados.',
  inactivo: 'La cuenta de encargado está inactiva; este script no la reactiva.',
} as const;

function assertNever(value: never): never {
  throw new Error(`Resultado no contemplado: ${JSON.stringify(value)}`);
}

export function renderResult(
  result: ResultadoRescate,
  target: string,
): { lines: string[]; exitCode: number } {
  const base = `Base de datos: ${target}`;
  switch (result.estado) {
    case 'rechazado':
      return {
        lines: [
          base,
          MENSAJE_RECHAZO[result.motivo],
          'Rechazado: no se escribió nada.',
        ],
        exitCode: 3,
      };
    case 'simulado':
      return {
        lines: [
          base,
          `Cuenta a rescatar: ${result.objetivo.nombre} <${result.objetivo.email}>`,
          ...(result.hayOtroEncargadoActivo ? [AVISO_OTRO_ENCARGADO] : []),
          'SIMULACIÓN: no se escribió nada. Repita con --confirmar para aplicar el rescate.',
        ],
        exitCode: 0,
      };
    case 'rescatado':
      return {
        lines: [
          base,
          `Cuenta rescatada: ${result.objetivo.nombre} <${result.objetivo.email}>`,
          ...(result.hayOtroEncargadoActivo ? [AVISO_OTRO_ENCARGADO] : []),
          `Contraseña temporal (se muestra una sola vez): ${result.passwordTemporal}`,
          'Deberá cambiarla en su primer inicio de sesión.',
        ],
        exitCode: 0,
      };
    default:
      return assertNever(result);
  }
}

// Order is the contract: parse -> DATABASE_URL -> target line -> query ->
// render. Every failure before the query happens before any connection.
export async function run(
  argv: string[],
  env: NodeJS.ProcessEnv,
  io: RescueIo,
  ejecutar: (args: RescueArgs) => Promise<ResultadoRescate>,
): Promise<number> {
  let args: RescueArgs;
  let target: string;
  try {
    args = parseArgs(argv);
    try {
      target = describeTarget(requireDatabaseUrl(env));
    } catch (error) {
      if (error instanceof UsageError) throw error;
      throw new UsageError(
        'DATABASE_URL no está configurada en esta terminal. Defínala con la base de datos de destino antes de ejecutar este script.',
      );
    }
  } catch (error) {
    if (!(error instanceof UsageError)) {
      io.err(`${formatError(error)}\n`);
      return 1;
    }
    io.err(`${error.message}\n${USO}\n`);
    return 2;
  }

  io.out(`Base de datos objetivo: ${target}\n`);
  try {
    const { lines, exitCode } = renderResult(await ejecutar(args), target);
    io.out(`${lines.join('\n')}\n`);
    return exitCode;
  } catch (error) {
    io.err(`${formatError(error)}\n`);
    return 1;
  }
}

async function main(): Promise<void> {
  const io: RescueIo = {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  };
  const code = await run(process.argv.slice(2), process.env, io, (args) => {
    const db = getDb();
    return rescatarEncargado(buildRepos(db), createUnitOfWork(db), args);
  });
  // Close the pool and let stdout drain instead of process.exit(), which can
  // cut a piped write short.
  await getPool().end();
  process.exitCode = code;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    console.error(formatError(err));
    process.exitCode = 1;
  });
}
