import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import type { AnyRouter } from '@tanstack/react-router';
import { isApiError } from '../api/errors.js';

/**
 * Late-bound via `setRouter()` once the router is constructed. `queryClient`
 * and `router` cannot reference each other at construction time: the router
 * needs the query client as context, and the client needs the router to
 * call `invalidate()` on a session-invalidating error (D12/D13, Data Flow).
 */
let router: AnyRouter | undefined;

export function setRouter(instance: AnyRouter) {
  router = instance;
}

/**
 * A 401/403 `PASSWORD_CHANGE_REQUIRED` anywhere in the app means the
 * session cache is stale — invalidate it and re-run the guards so the
 * router redirects to the correct place.
 */
function handleSessionInvalidatingError(error: unknown) {
  if (!isApiError(error)) return;
  if (
    error.code !== 'UNAUTHORIZED' &&
    error.code !== 'PASSWORD_CHANGE_REQUIRED'
  ) {
    return;
  }
  void queryClient.invalidateQueries({ queryKey: ['session'] });
  void router?.invalidate();
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleSessionInvalidatingError }),
  mutationCache: new MutationCache({ onError: handleSessionInvalidatingError }),
});
