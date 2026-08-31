// Vector table shared byte-for-byte with apps/web/src/lib/dinero.test.ts
// (design.md D1 dup rationale): any drift between the two workspaces must
// fail here first, not silently diverge between server and cashier UI.
import { describe, expect, it } from 'vitest';
import {
  MAX_CENTAVOS,
  MontoFueraDeRangoError,
  MontoInvalidoError,
  aCentavos,
  aMonto,
  multiplicar,
  sumar,
} from './dinero.js';

// [monto de entrada, centavos esperados, forma canonica (2 decimales)]
const VECTOR_TABLE: ReadonlyArray<readonly [string, number, string]> = [
  ['0', 0, '0.00'],
  ['0.00', 0, '0.00'],
  ['10', 1000, '10.00'],
  ['10.5', 1050, '10.50'],
  ['10.50', 1050, '10.50'],
  ['0.01', 1, '0.01'],
  ['0.1', 10, '0.10'],
  ['9999999999.99', MAX_CENTAVOS, '9999999999.99'],
];

const MALFORMED_MONTOS: readonly string[] = [
  '',
  'abc',
  '10.555',
  '-5.00',
  '.5',
  '5.',
  '1,000.00',
  ' 10.00',
  '10.00 ',
  '1e10',
  '99999999999.99',
];

describe('aCentavos', () => {
  it.each(VECTOR_TABLE)('converts "%s" to %i centavos', (monto, centavos) => {
    expect(aCentavos(monto)).toBe(centavos);
  });

  it.each(MALFORMED_MONTOS)('rejects malformed monto "%s"', (monto) => {
    expect(() => aCentavos(monto)).toThrow(MontoInvalidoError);
  });
});

describe('aMonto', () => {
  it.each(VECTOR_TABLE)(
    'formats %i centavos back to the canonical "%s"',
    (_monto, centavos, canonico) => {
      expect(aMonto(centavos)).toBe(canonico);
    },
  );

  it('round-trips every vector through aCentavos then aMonto', () => {
    for (const [monto, , canonico] of VECTOR_TABLE) {
      expect(aMonto(aCentavos(monto))).toBe(canonico);
    }
  });

  it('rejects a negative centavos value', () => {
    expect(() => aMonto(-1)).toThrow(MontoFueraDeRangoError);
  });

  it('rejects a centavos value above MAX_CENTAVOS', () => {
    expect(() => aMonto(MAX_CENTAVOS + 1)).toThrow(MontoFueraDeRangoError);
  });
});

describe('multiplicar', () => {
  it('multiplies a monto string by an integer quantity', () => {
    expect(multiplicar('10.50', 3)).toBe(3150);
  });

  it('multiplies by zero to zero centavos', () => {
    expect(multiplicar('10.50', 0)).toBe(0);
  });

  it('throws MontoFueraDeRangoError when the product overflows MAX_CENTAVOS', () => {
    expect(() => multiplicar('9999999999.99', 2)).toThrow(
      MontoFueraDeRangoError,
    );
  });

  it('throws MontoInvalidoError for a non-integer quantity', () => {
    expect(() => multiplicar('10.50', 1.5)).toThrow(MontoInvalidoError);
  });

  it('throws MontoInvalidoError for a negative quantity', () => {
    expect(() => multiplicar('10.50', -1)).toThrow(MontoInvalidoError);
  });
});

describe('sumar', () => {
  it('sums a list of centavos values', () => {
    expect(sumar([1050, 250, 100])).toBe(1400);
  });

  it('sums an empty list to zero', () => {
    expect(sumar([])).toBe(0);
  });

  it('throws MontoFueraDeRangoError when the running total overflows MAX_CENTAVOS', () => {
    expect(() => sumar([MAX_CENTAVOS, 1])).toThrow(MontoFueraDeRangoError);
  });

  it('throws MontoFueraDeRangoError when an individual value is negative', () => {
    expect(() => sumar([100, -50])).toThrow(MontoFueraDeRangoError);
  });
});

describe('MAX_CENTAVOS', () => {
  it('matches the numeric(12,2) ceiling', () => {
    expect(MAX_CENTAVOS).toBe(999_999_999_999);
  });
});
