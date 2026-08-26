import { createRouter } from '@tanstack/react-router';
import { routeTree } from '../routes/routeTree.js';
import { queryClient, setRouter } from './queryClient.js';

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
});

setRouter(router);

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
