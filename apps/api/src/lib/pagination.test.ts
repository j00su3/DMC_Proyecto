import { describe, expect, it } from 'vitest';
import { pageQuerySchema, paginated } from './pagination.js';

describe('pageQuerySchema', () => {
  it('defaults page to 1 and pageSize to 20 when omitted', () => {
    const result = pageQuerySchema.parse({});

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it('coerces and echoes explicit page and pageSize values', () => {
    const result = pageQuerySchema.parse({ page: '2', pageSize: '10' });

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
  });

  it('rejects a pageSize above the maximum of 100', () => {
    expect(() => pageQuerySchema.parse({ pageSize: '500' })).toThrow();
  });
});

describe('paginated', () => {
  it('wraps data with page, pageSize, and total', () => {
    const data = [{ id: 1 }, { id: 2 }];

    const result = paginated(data, 2, 10, 25);

    expect(result).toEqual({ data, page: 2, pageSize: 10, total: 25 });
  });

  it('reflects a different total for a different call', () => {
    const result = paginated([], 1, 20, 0);

    expect(result).toEqual({ data: [], page: 1, pageSize: 20, total: 0 });
  });
});
