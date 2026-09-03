import { useQuery } from '@tanstack/react-query';
import { alertasConteoQueryOptions } from './queries.js';

/**
 * Polling count hook (PD-4). `refetchInterval: 60_000` lives on the options
 * object in `queries.ts`, not here — this hook is a thin `useQuery` wrapper
 * so the interval stays assertable without advancing timers.
 */
export function useConteoAlertas() {
  return useQuery(alertasConteoQueryOptions());
}
