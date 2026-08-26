import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AnyRouter } from '@tanstack/react-router';
import { RouterProvider } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

/** Fresh `QueryClient` per test — no cross-test cache leakage, no retries. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

type RenderWithProvidersOptions = {
  queryClient?: QueryClient;
  /** Optional memory router wiring for route-level tests (Phase 5B onward). */
  router?: AnyRouter;
};

/**
 * Renders `ui` under a fresh `QueryClientProvider`. When `router` is
 * supplied, renders `RouterProvider` instead of `ui` (route-level tests
 * render whatever the router resolves).
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
) {
  const queryClient = options.queryClient ?? createTestQueryClient();

  const tree = options.router ? <RouterProvider router={options.router} /> : ui;

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>{tree}</QueryClientProvider>,
    ),
  };
}
