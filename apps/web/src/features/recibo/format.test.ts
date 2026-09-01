import { describe, expect, it } from 'vitest';
import { formatFechaHora } from './format.js';

describe('formatFechaHora', () => {
  it('formats a valid ISO string into a short es date + time', () => {
    expect(formatFechaHora('2026-01-15T12:30:00.000Z')).toMatch(
      /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}/,
    );
  });

  it('returns a placeholder, not "Invalid Date", for a malformed string', () => {
    expect(formatFechaHora('not-a-date')).toBe('—');
  });
});
