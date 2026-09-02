import { useQuery } from '@tanstack/react-query';
import { proveedoresListQueryOptions } from './queries.js';

/**
 * Full, unpaginated supplier catalog (active and inactive) — D3/PD-1. Feeds
 * both the master list and the detail pane, which derives its record from
 * this same list rather than issuing a second request.
 */
export function useProveedores() {
  return useQuery(proveedoresListQueryOptions());
}
