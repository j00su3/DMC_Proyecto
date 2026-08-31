// D1 (design.md): integer minor-unit money arithmetic. Byte-identical twin
// at apps/web/src/lib/dinero.ts — keep both files in sync; drift between
// them is caught by the shared test-vector table in each `dinero.test.ts`.
// A third consumer of this module promotes it to a shared `packages/`
// workspace instead of a third copy (design.md D1 rationale).
//
// numeric(12,2) decimal strings remain the only representation in the
// database and on the wire. Arithmetic happens exclusively on `number`
// values that are safe-integer centavos. Number()/parseFloat is NEVER
// applied to a money string as a whole — aCentavos parses by splitting on
// '.', never by coercing the entire string.

export type Centavos = number;

// The numeric(12,2) ceiling: up to 10 integer digits, 2 decimal digits.
export const MAX_CENTAVOS = 999_999_999_999;

const MONTO_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export class MontoInvalidoError extends Error {
  constructor(valor: string) {
    super(`Malformed monto: "${valor}"`);
    this.name = 'MontoInvalidoError';
  }
}

// Raised by the overflow guard on every operation below. This module stays
// free of any api-only import (no apps/api/src/lib/errors.ts dependency) so
// the web twin can remain byte-identical; the caller at the ventas service
// layer (tasks.md 2.4, once it exists) is expected to catch this and map it
// to the SALE_AMOUNT_OUT_OF_RANGE wire code (design.md D12/RECONCILE-1,
// factory added in tasks.md 2.1).
export class MontoFueraDeRangoError extends Error {
  constructor(valor: number) {
    super(`Amount ${valor} is out of the representable range`);
    this.name = 'MontoFueraDeRangoError';
  }
}

function asegurarDentroDeRango(valor: number): Centavos {
  if (!Number.isSafeInteger(valor) || valor < 0 || valor > MAX_CENTAVOS) {
    throw new MontoFueraDeRangoError(valor);
  }
  return valor;
}

// "10.5" and "10.50" both -> 1050. Splits on '.' first, then converts each
// part with Number() only after MONTO_PATTERN has proven both parts are
// plain digit sequences (entero <= 1e10, frac < 100) — the multiply and add
// below are exact in IEEE-754 because both operands are small integers.
export function aCentavos(monto: string): Centavos {
  if (!MONTO_PATTERN.test(monto)) {
    throw new MontoInvalidoError(monto);
  }

  const [entero, frac = ''] = monto.split('.');
  const centavos = Number(entero) * 100 + Number(frac.padEnd(2, '0'));

  return asegurarDentroDeRango(centavos);
}

// 1050 -> "10.50". Integer ops only: Math.trunc for the whole part, modulo
// + padStart for the always-two-digit fractional part.
export function aMonto(centavos: Centavos): string {
  asegurarDentroDeRango(centavos);

  const enteros = Math.trunc(centavos / 100);
  const frac = String(centavos % 100).padStart(2, '0');

  return `${enteros}.${frac}`;
}

export function multiplicar(monto: string, unidades: number): Centavos {
  if (!Number.isInteger(unidades) || unidades < 0) {
    throw new MontoInvalidoError(String(unidades));
  }

  return asegurarDentroDeRango(aCentavos(monto) * unidades);
}

export function sumar(valores: readonly Centavos[]): Centavos {
  return valores.reduce<Centavos>(
    (total, valor) =>
      asegurarDentroDeRango(total + asegurarDentroDeRango(valor)),
    0,
  );
}
