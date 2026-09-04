import { describe, expect, it } from 'vitest';
import { dashboardKeys, dashboardResumenQueryOptions } from './queries.js';

describe('dashboardKeys / dashboardResumenQueryOptions', () => {
  it('keys the resumen query under dashboardKeys.resumen()', () => {
    const options = dashboardResumenQueryOptions();

    expect(options.queryKey).toEqual(dashboardKeys.resumen());
  });

  it('is a zero-arg query — two calls key identically', () => {
    const first = dashboardResumenQueryOptions();
    const second = dashboardResumenQueryOptions();

    expect(first.queryKey).toEqual(second.queryKey);
  });
});
