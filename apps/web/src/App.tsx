import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api/client.js';
import type { paths } from './api/schema.js';

type HealthResponse =
  paths['/api/health']['get']['responses']['200']['content']['application/json'];

export function App() {
  const { data, isLoading } = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/health'),
  });

  return (
    <main>
      <h1>InvenTienda</h1>
      <p>
        {isLoading
          ? 'Checking API status…'
          : `API status: ${data?.status ?? 'unknown'}`}
      </p>
    </main>
  );
}
