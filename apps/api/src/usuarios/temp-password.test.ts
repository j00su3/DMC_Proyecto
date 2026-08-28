import * as crypto from 'node:crypto';
import { type Mock, afterEach, describe, expect, it, vi } from 'vitest';
import { generateTempPassword } from './temp-password.js';

// Mock node:crypto behind a real spy wrapping the actual implementation, so
// every test still gets genuine randomness unless it explicitly overrides
// the return value — Vitest cannot spy on a frozen ESM namespace directly
// (`Cannot redefine property: randomBytes`), so the wrapping has to happen
// at mock-factory time instead.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomBytes: vi.fn((size: number) => actual.randomBytes(size)),
  };
});

// The real `randomBytes` has an overloaded (callback) signature that the
// single-arg mock above does not share; this narrows the type back to what
// the mock actually is (a plain 1-arg spy) for use by the assertions below.
const randomBytesMock = crypto.randomBytes as unknown as Mock<
  (size: number) => Buffer
>;

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const EXCLUDED_LETTERS = ['I', 'L', 'O', 'U'];

afterEach(() => {
  randomBytesMock.mockClear();
});

describe('generateTempPassword', () => {
  it('returns exactly 16 symbols', () => {
    const password = generateTempPassword();

    expect(password).toHaveLength(16);
  });

  it('uses only symbols from the 32-character Crockford alphabet', () => {
    const password = generateTempPassword();

    for (const symbol of password) {
      expect(CROCKFORD_ALPHABET).toContain(symbol);
    }
  });

  it('never produces the excluded letters I, L, O, U (design.md D7)', () => {
    // Run many draws so a hypothetical accidental inclusion of the excluded
    // letters (e.g. swapping in a plain base32 alphabet) would surface.
    for (let i = 0; i < 500; i++) {
      const password = generateTempPassword();
      for (const excluded of EXCLUDED_LETTERS) {
        expect(password).not.toContain(excluded);
      }
    }
  });

  it('produces a wide spread of symbols across many generations, not a constant value', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      seen.add(generateTempPassword());
    }

    // 500 draws from an 80-bit space should never repeat, and should exercise
    // a broad swath of the 32-symbol alphabet across all positions.
    const allSymbolsSeen = new Set<string>();
    for (const password of seen) {
      for (const symbol of password) {
        allSymbolsSeen.add(symbol);
      }
    }

    expect(allSymbolsSeen.size).toBeGreaterThan(20);
  });

  it('does not collide across repeated calls', () => {
    const generated = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      generated.add(generateTempPassword());
    }

    expect(generated.size).toBe(1000);
  });

  it('calls randomBytes with 10 bytes (80 bits) and never calls Math.random', () => {
    const mathRandomSpy = vi.spyOn(Math, 'random');

    generateTempPassword();

    expect(randomBytesMock).toHaveBeenCalledWith(10);
    expect(mathRandomSpy).not.toHaveBeenCalled();

    mathRandomSpy.mockRestore();
  });
});

describe('generateTempPassword — bias-free bit mapping (design.md D7)', () => {
  it('maps each 5-bit group directly to an alphabet index with no modulo/rejection artifact', () => {
    // 80 bits from randomBytes(10) split into 16 groups of 5 bits each map
    // 1:1 onto the 32-symbol alphabet (2^5 = 32) — deterministic given a
    // fixed byte sequence, so this exercises the actual bit-slicing logic
    // rather than restating it.
    const fixedBytes = Buffer.from([
      0b00000000, 0b00000000, 0b00000000, 0b00000000, 0b00000000, 0b11111111,
      0b11111111, 0b11111111, 0b11111111, 0b11111111,
    ]);
    randomBytesMock.mockReturnValueOnce(fixedBytes);

    const password = generateTempPassword();

    // First 40 bits are all zero -> first 8 symbols are alphabet[0] = '0'.
    expect(password.slice(0, 8)).toBe('00000000');
    // Last 40 bits are all one -> last 8 symbols are alphabet[31] = 'Z'.
    expect(password.slice(8, 16)).toBe('ZZZZZZZZ');
  });
});
