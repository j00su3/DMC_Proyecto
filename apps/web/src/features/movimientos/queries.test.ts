import { describe, expect, it } from 'vitest';
import { movimientosKeys } from './queries.js';

/**
 * CLAUDE.md, "Testing": "A mutation moving a query key out from under
 * `lists()` keeps fifteen hook tests green while the screen silently stops
 * updating — only a route test catches it."
 *
 * This file exists because that mutation was actually run against this
 * feature on 2026-08-30 and NOTHING caught it: the whole web suite stayed
 * green, `typecheck` passed, and the only complaint came from the formatter,
 * about line length.
 *
 * The guard matters because `useRegistrarMovimiento` refreshes the history by
 * invalidating `movimientosKeys.lists()`. TanStack Query matches
 * invalidations by key prefix, so a `list()` key that does not start with
 * `lists()` is simply never matched: every registration succeeds, the ledger
 * is written, and the table on screen keeps showing stale rows with no error
 * anywhere.
 *
 * This is the cheap structural half. The behavioural half — register a
 * movement through the real route and assert the history gains the row — is
 * task 8.1, and neither replaces the other.
 */
describe('movimientosKeys', () => {
  it('nests list() under lists() so invalidating lists() matches it', () => {
    const listKey = movimientosKeys.list('producto-1', 1);
    const listsKey = movimientosKeys.lists();

    expect(listKey.slice(0, listsKey.length)).toEqual([...listsKey]);
  });

  it('nests lists() under all() for the same reason', () => {
    const listsKey = movimientosKeys.lists();
    const allKey = movimientosKeys.all;

    expect(listsKey.slice(0, allKey.length)).toEqual([...allKey]);
  });

  it('separates two products under the same lists() prefix', () => {
    const first = movimientosKeys.list('producto-1', 1);
    const second = movimientosKeys.list('producto-2', 1);

    expect(first).not.toEqual(second);
    const listsKey = movimientosKeys.lists();
    expect(first.slice(0, listsKey.length)).toEqual([...listsKey]);
    expect(second.slice(0, listsKey.length)).toEqual([...listsKey]);
  });

  it('separates two pages of the same product', () => {
    expect(movimientosKeys.list('producto-1', 1)).not.toEqual(
      movimientosKeys.list('producto-1', 2),
    );
  });
});
