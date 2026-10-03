import { describe, expect, it, vi } from 'vitest';
import type { UnitOfWork } from '../db/uow.js';
import type { Repos } from '../plugins/repos.js';
import type { Usuario, UsuarioResumen } from './repository.js';
import { rescatarEncargado } from './rescate.js';

const TARGET_ID = '11111111-1111-4111-8111-111111111111';
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo';

function usuario(over: Partial<Usuario> = {}): Usuario {
  return {
    id: TARGET_ID,
    nombre: 'Ana Encargada',
    email: 'ana@example.com',
    hashContrasena: HASH,
    rol: 'encargado',
    activo: true,
    intentosFallidos: 5,
    bloqueadoHasta: new Date('2026-02-01T00:00:00.000Z'),
    creadoEn: new Date('2026-01-01T00:00:00.000Z'),
    debeCambiarPassword: false,
    ...over,
  };
}

function resumen(over: Partial<UsuarioResumen> = {}): UsuarioResumen {
  return {
    id: TARGET_ID,
    nombre: 'Ana Encargada',
    email: 'ana@example.com',
    rol: 'encargado',
    activo: true,
    debeCambiarPassword: true,
    creadoEn: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

// Read-phase fake keyed on the EXACT stored email, like the real adapter, so
// a missing normalization shows up as a miss rather than a lucky hit.
function readRepos(
  options: { stored?: Usuario | undefined; activeEncargados?: number } = {},
) {
  const stored = 'stored' in options ? options.stored : usuario();
  const findByEmail = vi.fn(async (email: string) =>
    stored !== undefined && stored.email === email ? stored : undefined,
  );
  const countActiveEncargados = vi.fn(
    async () => options.activeEncargados ?? 1,
  );
  return {
    repos: { usuarios: { findByEmail, countActiveEncargados } },
    findByEmail,
    countActiveEncargados,
  };
}

// A uow that fails loudly if a refusal or dry run ever reaches it.
function untouchableUow() {
  const run = vi.fn(async () => {
    throw new Error('uow.run must not be reached');
  });
  return { uow: { run } as unknown as UnitOfWork, run };
}

// A uow whose transaction hands out stub repos, so the write phase
// (resetUsuarioPassword) runs for real against them.
function writableUow() {
  const record = vi.fn(async () => {});
  const deleteAllForUser = vi.fn(async () => {});
  const repos = {
    usuarios: {
      findByIdForUpdate: vi.fn(async () =>
        resumen({ debeCambiarPassword: false }),
      ),
      findLockoutState: vi.fn(async () => ({
        intentosFallidos: 5,
        bloqueadoHasta: new Date('2026-02-01T00:00:00.000Z'),
      })),
      resetPassword: vi.fn(async () => resumen()),
    },
    sesiones: { deleteAllForUser },
    auditoria: { record },
  } as unknown as Repos;
  const run = vi.fn(async (work: Parameters<UnitOfWork['run']>[0]) =>
    work(repos, { savepoint: async (_name, fn) => fn() }),
  );
  return {
    uow: { run } as unknown as UnitOfWork,
    run,
    record,
    deleteAllForUser,
  };
}

describe('rescatarEncargado refusals', () => {
  it('refuses an unknown email without reaching the uow', async () => {
    const { repos } = readRepos({ stored: undefined });
    const { uow, run } = untouchableUow();

    const result = await rescatarEncargado(repos, uow, {
      email: 'nadie@example.com',
      confirmar: true,
    });

    expect(result).toEqual({ estado: 'rechazado', motivo: 'no_encontrado' });
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a non-encargado', async () => {
    const { repos } = readRepos({ stored: usuario({ rol: 'deposito' }) });
    const { uow, run } = untouchableUow();

    const result = await rescatarEncargado(repos, uow, {
      email: 'ana@example.com',
      confirmar: true,
    });

    expect(result).toEqual({ estado: 'rechazado', motivo: 'no_es_encargado' });
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses an inactive encargado', async () => {
    const { repos } = readRepos({ stored: usuario({ activo: false }) });
    const { uow, run } = untouchableUow();

    const result = await rescatarEncargado(repos, uow, {
      email: 'ana@example.com',
      confirmar: true,
    });

    expect(result).toEqual({ estado: 'rechazado', motivo: 'inactivo' });
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses an inactive encargado before offering the preview', async () => {
    const { repos } = readRepos({ stored: usuario({ activo: false }) });
    const { uow, run } = untouchableUow();

    const result = await rescatarEncargado(repos, uow, {
      email: 'ana@example.com',
      confirmar: false,
    });

    expect(result).toEqual({ estado: 'rechazado', motivo: 'inactivo' });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('rescatarEncargado email normalization', () => {
  it('looks the target up by the normalized email', async () => {
    const { repos, findByEmail } = readRepos();
    const { uow } = untouchableUow();

    const result = await rescatarEncargado(repos, uow, {
      email: '  ANA@Example.COM ',
      confirmar: false,
    });

    expect(findByEmail).toHaveBeenCalledWith('ana@example.com');
    expect(result.estado).toBe('simulado');
  });

  it('does not find a stored mixed-case email, which login could never match either', async () => {
    const { repos, findByEmail } = readRepos({
      stored: usuario({ email: 'Admin@Tienda.com' }),
    });
    const { uow, run } = untouchableUow();

    const result = await rescatarEncargado(repos, uow, {
      email: 'Admin@Tienda.com',
      confirmar: true,
    });

    expect(findByEmail).toHaveBeenCalledWith('admin@tienda.com');
    expect(result).toEqual({ estado: 'rechazado', motivo: 'no_encontrado' });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('rescatarEncargado dry run', () => {
  it('returns the target and writes nothing without confirmar', async () => {
    const { repos } = readRepos();
    const { uow, run } = untouchableUow();

    const result = await rescatarEncargado(repos, uow, {
      email: 'ana@example.com',
      confirmar: false,
    });

    expect(result).toEqual({
      estado: 'simulado',
      objetivo: {
        id: TARGET_ID,
        nombre: 'Ana Encargada',
        email: 'ana@example.com',
      },
      hayOtroEncargadoActivo: false,
    });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('rescatarEncargado confirmed rescue', () => {
  it('rescues through the reset with the target as its own actor and the rescue marker', async () => {
    const { repos } = readRepos();
    const { uow, record, deleteAllForUser } = writableUow();

    const result = await rescatarEncargado(repos, uow, {
      email: 'ana@example.com',
      confirmar: true,
    });

    expect(result.estado).toBe('rescatado');
    if (result.estado !== 'rescatado') {
      throw new Error('unreachable');
    }
    expect(result.passwordTemporal).toMatch(/^[0-9A-Z]{16}$/);
    expect(deleteAllForUser).toHaveBeenCalledWith(TARGET_ID);
    expect(record).toHaveBeenCalledTimes(1);
    const event = (
      record.mock.calls[0] as unknown as [Record<string, unknown>]
    )[0];
    expect(event).toMatchObject({
      entidad: 'usuarios',
      entidadId: TARGET_ID,
      usuarioId: TARGET_ID,
      accion: 'cambiar_password',
    });
    expect((event.datosPosteriores as Record<string, unknown>).origen).toBe(
      'rescate',
    );
    expect(event.datosPrevios as Record<string, unknown>).not.toHaveProperty(
      'origen',
    );
  });

  it('generates a different password on every rescue', async () => {
    const { repos } = readRepos();
    const first = await rescatarEncargado(repos, writableUow().uow, {
      email: 'ana@example.com',
      confirmar: true,
    });
    const second = await rescatarEncargado(repos, writableUow().uow, {
      email: 'ana@example.com',
      confirmar: true,
    });

    if (first.estado !== 'rescatado' || second.estado !== 'rescatado') {
      throw new Error('expected two rescues');
    }
    expect(first.passwordTemporal).not.toBe(second.passwordTemporal);
  });

  it('never returns the stored hash', async () => {
    const { repos } = readRepos();
    const preview = await rescatarEncargado(repos, untouchableUow().uow, {
      email: 'ana@example.com',
      confirmar: false,
    });
    const rescued = await rescatarEncargado(repos, writableUow().uow, {
      email: 'ana@example.com',
      confirmar: true,
    });

    for (const result of [preview, rescued]) {
      if (result.estado === 'rechazado') {
        throw new Error('unexpected refusal');
      }
      expect(result.objetivo).not.toHaveProperty('hashContrasena');
      expect(JSON.stringify(result)).not.toContain(HASH);
    }
  });
});

describe('rescatarEncargado other-encargado notice', () => {
  it.each([
    [1, false],
    [2, true],
  ])(
    'with %i active encargado(s) hayOtroEncargadoActivo is %s in both modes',
    async (count, expected) => {
      const { repos } = readRepos({ activeEncargados: count });

      const preview = await rescatarEncargado(repos, untouchableUow().uow, {
        email: 'ana@example.com',
        confirmar: false,
      });
      const rescued = await rescatarEncargado(repos, writableUow().uow, {
        email: 'ana@example.com',
        confirmar: true,
      });

      if (preview.estado !== 'simulado' || rescued.estado !== 'rescatado') {
        throw new Error('expected a preview and a rescue');
      }
      expect(preview.hayOtroEncargadoActivo).toBe(expected);
      expect(rescued.hayOtroEncargadoActivo).toBe(expected);
    },
  );
});
