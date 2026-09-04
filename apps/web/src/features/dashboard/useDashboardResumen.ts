import { useQuery } from '@tanstack/react-query';
import { dashboardResumenQueryOptions } from './queries.js';

/**
 * Thin `useQuery` wrapper (mirrors `useConteoAlertas`) — no options beyond
 * `dashboardResumenQueryOptions()` (D5).
 */
export function useDashboardResumen() {
  return useQuery(dashboardResumenQueryOptions());
}
