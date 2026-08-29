import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './db-errors.js';

// Direct unit coverage the helper never had before (design.md D4 — the move
// is behaviour-neutral, and this file is the new coverage that proves the
// bound the walk depends on, not just the sentence describing it).
describe('isUniqueViolation', () => {
  it('returns true for a top-level 23505 error', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('returns true for a 23505 wrapped one level deep (Drizzle wrapping case)', () => {
    expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true);
  });

  it('returns true for a 23505 nested at depth 4', () => {
    const error = {
      cause: { cause: { cause: { code: '23505' } } },
    };
    expect(isUniqueViolation(error)).toBe(true);
  });

  it('returns false for a 23505 nested at depth 6 (beyond the bound)', () => {
    const error = {
      cause: {
        cause: { cause: { cause: { cause: { code: '23505' } } } },
      },
    };
    expect(isUniqueViolation(error)).toBe(false);
  });

  it('terminates instead of hanging on a self-referencing cause chain', () => {
    const cyclic: { code: string; cause?: unknown } = { code: '23503' };
    cyclic.cause = cyclic;
    expect(isUniqueViolation(cyclic)).toBe(false);
  });

  it('returns false for a different SQLSTATE (23503, foreign_key_violation)', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isUniqueViolation(null)).toBe(false);
  });

  it('returns false for a plain string', () => {
    expect(isUniqueViolation('not an error object')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});
