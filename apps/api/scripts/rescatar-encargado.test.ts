import { describe, expect, it, vi } from 'vitest';
import type { ResultadoRescate } from '../src/usuarios/rescate.js';
import {
  type RescueIo,
  UsageError,
  describeTarget,
  parseArgs,
  renderResult,
  run,
} from './rescatar-encargado.js';

const SECRETO = 'Secreto123';
const TEMPORAL = 'Xk9-temporal-Pw42';
const URL_CON_CREDENCIALES =
  'postgres://rescue_op:s3cret@db.example.net:5432/inventienda?sslmode=require';
const objetivo = { id: 'u-1', nombre: 'Ana Pérez', email: 'ana@tienda.com' };

function mensaje(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(UsageError);
    return (e as Error).message;
  }
  throw new Error('expected a throw');
}

describe('parseArgs', () => {
  const passwordFlags = ['--password', '-p', '--contrasena', '--clave'];

  it.each(passwordFlags)(
    'refuses %s as "flag value" without echoing it',
    (f) => {
      const m = mensaje(() => parseArgs(['--email', 'a@b.c', f, SECRETO]));
      expect(m).toMatch(/contraseña/i);
      expect(m).not.toContain(SECRETO);
    },
  );

  it.each(passwordFlags)('refuses %s=value without echoing it', (f) => {
    const m = mensaje(() => parseArgs(['--email', 'a@b.c', `${f}=${SECRETO}`]));
    expect(m).toMatch(/contraseña/i);
    expect(m).not.toContain(SECRETO);
  });

  it('refuses an attached -pVALUE without echoing it', () => {
    const m = mensaje(() => parseArgs(['--email', 'a@b.c', `-p${SECRETO}`]));
    expect(m).toMatch(/contraseña/i);
    expect(m).not.toContain(SECRETO);
  });

  it('refuses a password flag even before an otherwise invalid --email', () => {
    const m = mensaje(() => parseArgs(['--password', SECRETO, '--email']));
    expect(m).toMatch(/contraseña/i);
    expect(m).not.toContain(SECRETO);
  });

  it('requires --email', () => {
    expect(mensaje(() => parseArgs([]))).toContain('--email');
    expect(mensaje(() => parseArgs(['--confirmar']))).toContain('--email');
  });

  it('rejects --email without a value or with a dash-led value', () => {
    expect(mensaje(() => parseArgs(['--email']))).toContain('--email');
    expect(mensaje(() => parseArgs(['--email', '--confirmar']))).toContain(
      '--email',
    );
  });

  it('rejects an empty or blank email', () => {
    expect(mensaje(() => parseArgs(['--email', '']))).toContain('--email');
    expect(mensaje(() => parseArgs(['--email', '   ']))).toContain('--email');
  });

  it.each(['--confirm', '--emial', '--email=x', 'suelto'])(
    'rejects unknown token %s',
    (token) => {
      expect(() => parseArgs(['--email', 'a@b.c', token])).toThrow(UsageError);
    },
  );

  it('does not echo a positional token that could be a secret', () => {
    expect(
      mensaje(() => parseArgs(['--email', 'a@b.c', SECRETO])),
    ).not.toContain(SECRETO);
  });

  it('rejects a repeated --email', () => {
    expect(() => parseArgs(['--email', 'a@b.c', '--email', 'd@e.f'])).toThrow(
      UsageError,
    );
  });

  it('defaults confirmar to false and returns the email untouched', () => {
    expect(parseArgs(['--email', '  Ana@Tienda.COM '])).toEqual({
      email: '  Ana@Tienda.COM ',
      confirmar: false,
    });
  });

  it('sets confirmar with the bare flag, in any order', () => {
    expect(parseArgs(['--confirmar', '--email', 'a@b.c'])).toEqual({
      email: 'a@b.c',
      confirmar: true,
    });
  });
});

describe('describeTarget', () => {
  it('shows host, port and database only', () => {
    const t = describeTarget(
      'postgres://user:s3cret@ep-x.neon.tech:5432/db?sslmode=require',
    );
    expect(t).toContain('ep-x.neon.tech');
    expect(t).toContain('5432');
    expect(t).toContain('db');
    for (const leak of ['user', 's3cret', 'sslmode']) {
      expect(t).not.toContain(leak);
    }
  });

  it('handles a URL without a port', () => {
    const t = describeTarget(
      'postgres://rescue_op:s3cret@db.example.net/inventienda',
    );
    expect(t).toBe('db.example.net/inventienda');
  });

  it('throws on garbage without echoing the input', () => {
    const m = mensaje(() => describeTarget('no es una url s3cret'));
    expect(m).not.toContain('s3cret');
    expect(m).not.toContain('no es una url');
  });
});

describe('renderResult', () => {
  const target = 'db.example.net/inventienda';
  const rescatado = (otro: boolean): ResultadoRescate => ({
    estado: 'rescatado',
    objetivo,
    hayOtroEncargadoActivo: otro,
    passwordTemporal: TEMPORAL,
  });
  const simulado = (otro: boolean): ResultadoRescate => ({
    estado: 'simulado',
    objetivo,
    hayOtroEncargadoActivo: otro,
  });
  const NOTICE = /desde la aplicación/;

  it('rescatado: exit 0, password on exactly one line, after the target line', () => {
    const { lines, exitCode } = renderResult(rescatado(false), target);
    expect(exitCode).toBe(0);
    const withPw = lines.filter((l) => l.includes(TEMPORAL));
    expect(withPw).toHaveLength(1);
    expect(lines.findIndex((l) => l.includes(target))).toBeLessThan(
      lines.indexOf(withPw[0] as string),
    );
    expect(lines.join('\n')).toMatch(/primer inicio de sesión/);
    expect(lines.join('\n')).toContain(objetivo.nombre);
    expect(lines.join('\n')).toContain(objetivo.email);
  });

  it('simulado: exit 0, names the account, says nothing was written, no password', () => {
    const { lines, exitCode } = renderResult(simulado(false), target);
    const text = lines.join('\n');
    expect(exitCode).toBe(0);
    expect(text).toContain(target);
    expect(text).toContain(objetivo.nombre);
    expect(text).toContain(objetivo.email);
    expect(text).toContain('--confirmar');
    expect(text).toContain('no se escribió nada');
    expect(text).not.toContain(TEMPORAL);
    expect(text).not.toMatch(/contraseña temporal/i);
  });

  it('simulado and rechazado never print a password even if the result carried one', () => {
    const smuggled = { passwordTemporal: TEMPORAL };
    const results = [
      { ...simulado(false), ...smuggled },
      { estado: 'rechazado', motivo: 'inactivo', ...smuggled },
    ] as unknown as ResultadoRescate[];
    for (const r of results) {
      expect(renderResult(r, target).lines.join('\n')).not.toContain(TEMPORAL);
    }
  });

  it('rechazado: exit 3, one distinct line per motive, no password', () => {
    const textos = (
      ['no_encontrado', 'no_es_encargado', 'inactivo'] as const
    ).map((motivo) => {
      const { lines, exitCode } = renderResult(
        { estado: 'rechazado', motivo },
        target,
      );
      expect(exitCode).toBe(3);
      expect(lines.join('\n')).toContain(target);
      expect(lines.join('\n')).toContain('no se escribió nada');
      expect(lines.join('\n')).not.toContain(TEMPORAL);
      return lines.join('\n');
    });
    expect(new Set(textos).size).toBe(3);
    expect(textos[2]).toMatch(/no la reactiva/);
  });

  it('adds the in-app notice in simulado and rescatado only when another encargado is active', () => {
    expect(renderResult(simulado(true), target).lines.join('\n')).toMatch(
      NOTICE,
    );
    expect(renderResult(rescatado(true), target).lines.join('\n')).toMatch(
      NOTICE,
    );
    expect(renderResult(simulado(false), target).lines.join('\n')).not.toMatch(
      NOTICE,
    );
    expect(renderResult(rescatado(false), target).lines.join('\n')).not.toMatch(
      NOTICE,
    );
  });

  it('never renders a credential or a hash, in any mode', () => {
    const all: ResultadoRescate[] = [
      rescatado(true),
      simulado(true),
      { estado: 'rechazado', motivo: 'inactivo' },
    ];
    for (const r of all) {
      const text = renderResult(r, target).lines.join('\n');
      expect(text).not.toMatch(/rescue_op|s3cret|hashContrasena/);
    }
  });
});

describe('run', () => {
  function harness() {
    const out: string[] = [];
    const err: string[] = [];
    const io: RescueIo = {
      out: (t) => out.push(t),
      err: (t) => err.push(t),
    };
    return { io, out, err };
  }
  const env = { DATABASE_URL: URL_CON_CREDENCIALES };
  const noDebeEjecutar = () =>
    vi.fn(async (): Promise<ResultadoRescate> => {
      throw new Error('ejecutar must not be reached');
    });

  it('usage error: exit 2, stderr only, nothing executed', async () => {
    const { io, out, err } = harness();
    const ejecutar = noDebeEjecutar();
    expect(await run([], env, io, ejecutar)).toBe(2);
    expect(ejecutar).not.toHaveBeenCalled();
    expect(out).toEqual([]);
    expect(err.join('')).toContain('--email');
  });

  it('password flag: exit 2 and the value is nowhere in the output', async () => {
    const { io, out, err } = harness();
    const ejecutar = noDebeEjecutar();
    const code = await run(
      ['--email', 'a@b.c', '--confirmar', '--password', SECRETO],
      env,
      io,
      ejecutar,
    );
    expect(code).toBe(2);
    expect(ejecutar).not.toHaveBeenCalled();
    expect(out.join('') + err.join('')).not.toContain(SECRETO);
  });

  it.each([{}, { DATABASE_URL: '' }])(
    'missing DATABASE_URL (%o): exit 2, Spanish message, nothing executed',
    async (e) => {
      const { io, out, err } = harness();
      const ejecutar = noDebeEjecutar();
      expect(await run(['--email', 'a@b.c'], e, io, ejecutar)).toBe(2);
      expect(ejecutar).not.toHaveBeenCalled();
      expect(out).toEqual([]);
      expect(err.join('')).toMatch(/DATABASE_URL.*no está configurad/);
    },
  );

  it('unparseable DATABASE_URL: exit 2 and the value is not echoed', async () => {
    const { io, out, err } = harness();
    const ejecutar = noDebeEjecutar();
    const code = await run(
      ['--email', 'a@b.c'],
      { DATABASE_URL: 'basura s3cret' },
      io,
      ejecutar,
    );
    expect(code).toBe(2);
    expect(ejecutar).not.toHaveBeenCalled();
    expect(out.join('') + err.join('')).not.toMatch(/s3cret|basura/);
  });

  it('rescatado: target line first, before any query; one stdout write carries the password', async () => {
    const { io, out, err } = harness();
    const ejecutar = vi.fn(async (): Promise<ResultadoRescate> => {
      expect(out).toHaveLength(1);
      expect(out[0]).toContain('db.example.net:5432/inventienda');
      return {
        estado: 'rescatado',
        objetivo,
        hayOtroEncargadoActivo: false,
        passwordTemporal: TEMPORAL,
      };
    });
    const code = await run(
      ['--email', 'Ana@Tienda.com', '--confirmar'],
      { ...env, RESCUE_PASSWORD: SECRETO },
      io,
      ejecutar,
    );
    expect(code).toBe(0);
    expect(ejecutar).toHaveBeenCalledWith({
      email: 'Ana@Tienda.com',
      confirmar: true,
    });
    // Two writes in total: the target line, then the whole result at once.
    expect(out).toHaveLength(2);
    expect(out.filter((t) => t.includes(TEMPORAL))).toHaveLength(1);
    const todo = out.join('') + err.join('');
    expect(todo.split(TEMPORAL)).toHaveLength(2);
    expect(todo).not.toMatch(/rescue_op|s3cret|sslmode|Secreto123/);
  });

  it('simulado: exit 0, no password; rechazado: exit 3', async () => {
    for (const [resultado, esperado] of [
      [{ estado: 'simulado', objetivo, hayOtroEncargadoActivo: false }, 0],
      [{ estado: 'rechazado', motivo: 'no_encontrado' }, 3],
    ] as const) {
      const { io, out, err } = harness();
      const code = await run(
        ['--email', 'a@b.c'],
        env,
        io,
        async () => resultado,
      );
      expect(code).toBe(esperado);
      expect(out.join('') + err.join('')).not.toMatch(/rescue_op|s3cret/);
    }
  });

  it('unexpected failure: exit 1, cause chain on stderr, no stdout beyond the target line', async () => {
    const { io, out, err } = harness();
    const code = await run(
      ['--email', 'a@b.c', '--confirmar'],
      env,
      io,
      async () => {
        throw new Error('AUDIT_WRITE_FAILED', {
          cause: new Error('conexion caida'),
        });
      },
    );
    expect(code).toBe(1);
    expect(out).toHaveLength(1);
    expect(err.join('')).toContain('AUDIT_WRITE_FAILED');
    expect(err.join('')).toContain('conexion caida');
    expect(out.join('') + err.join('')).not.toMatch(/s3cret|rescue_op/);
  });
});
