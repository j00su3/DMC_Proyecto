import { describe, expect, it } from 'vitest';
import { posCatalogoKeys } from './queries.js';

/**
 * CLAUDE.md, "Testing": a `list()` key that does not nest under `lists()`
 * is invisible to a prefix-based `invalidateQueries` call — see
 * `features/movimientos/queries.test.ts` for the incident that motivated
 * this guard. `useConfirmarVenta` does not invalidate this catalog (only
 * `productosKeys.all`, per design.md's Data Flow), but a future PR that
 * adds a catalog-refreshing mutation depends on this nesting holding.
 */
describe('posCatalogoKeys', () => {
  it('nests list() under lists() so invalidating lists() matches it', () => {
    const listKey = posCatalogoKeys.list(1);
    const listsKey = posCatalogoKeys.lists();

    expect(listKey.slice(0, listsKey.length)).toEqual([...listsKey]);
  });

  it('nests lists() under all() for the same reason', () => {
    const listsKey = posCatalogoKeys.lists();
    const allKey = posCatalogoKeys.all;

    expect(listsKey.slice(0, allKey.length)).toEqual([...allKey]);
  });

  it('separates two pages', () => {
    expect(posCatalogoKeys.list(1)).not.toEqual(posCatalogoKeys.list(2));
  });
});
