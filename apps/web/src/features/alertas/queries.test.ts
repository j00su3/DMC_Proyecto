import { describe, expect, it } from 'vitest';
import {
  alertasConteoQueryOptions,
  alertasKeys,
  alertasListQueryOptions,
} from './queries.js';

/**
 * PD-4: `refetchInterval: 60_000` lives on the query OPTIONS object, not
 * inside the hook, so it is assertable without advancing 60 seconds of
 * fake timers (design.md's Frontend note).
 */
describe('alertasConteoQueryOptions', () => {
  it('sets refetchInterval to 60_000 on the options object', () => {
    const options = alertasConteoQueryOptions();

    expect(options.refetchInterval).toBe(60_000);
  });

  it('keys the query under alertasKeys.conteo()', () => {
    const options = alertasConteoQueryOptions();

    expect(options.queryKey).toEqual(alertasKeys.conteo());
  });
});

describe('alertasListQueryOptions', () => {
  it('keys the query under alertasKeys.list(page, estado) — page 1, no filter', () => {
    const options = alertasListQueryOptions(1);

    expect(options.queryKey).toEqual(alertasKeys.list(1, undefined));
  });

  it('keys the query differently when an estado filter is applied', () => {
    const withFilter = alertasListQueryOptions(1, 'activa');
    const withoutFilter = alertasListQueryOptions(1);

    expect(withFilter.queryKey).not.toEqual(withoutFilter.queryKey);
  });

  it('does not set refetchInterval on the list options (only conteo polls)', () => {
    const options = alertasListQueryOptions(1);

    expect(options.refetchInterval).toBeUndefined();
  });
});
