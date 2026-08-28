import { describe, expect, it } from 'vitest';
import { formatFecha } from './format.js';

describe('formatFecha', () => {
  it('formats an ISO string into a stable es date', () => {
    expect(formatFecha('2026-01-15T12:00:00.000Z')).toBe('15/1/2026');
  });

  it('formats a different ISO string into a distinct es date', () => {
    expect(formatFecha('2025-12-01T12:00:00.000Z')).toBe('1/12/2025');
  });

  it('returns a placeholder, not "Invalid Date", for a malformed string', () => {
    expect(formatFecha('not-a-date')).toBe('—');
  });
});
