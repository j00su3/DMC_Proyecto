import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProveedorSelector } from './ProveedorSelector.js';

function stubFetchWithProveedores(
  data: { id: string; nombre: string; activo: boolean }[],
) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/proveedores')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data,
            page: 1,
            pageSize: 100,
            total: data.length,
          }),
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

function renderSelector() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  }

  return render(<ProveedorSelector id="proveedorId" label="Proveedor" />, {
    wrapper: Wrapper,
  });
}

/**
 * productos-ui / Create/Edit Form's "Supplier selector excludes inactive
 * suppliers" scenario. Standalone slice (`feat/productos-s7a-selector`),
 * split out ahead of the create form to stay under the review budget.
 */
describe('ProveedorSelector', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers only suppliers with activo: true', async () => {
    stubFetchWithProveedores([
      { id: 'p1', nombre: 'Activo Uno', activo: true },
      { id: 'p2', nombre: 'Inactivo Dos', activo: false },
      { id: 'p3', nombre: 'Activo Tres', activo: true },
    ]);

    renderSelector();

    const select = screen.getByLabelText('Proveedor');
    await within(select).findByRole('option', { name: 'Activo Uno' });
    expect(
      within(select).getByRole('option', { name: 'Activo Tres' }),
    ).toBeInTheDocument();
    expect(
      within(select).queryByRole('option', { name: 'Inactivo Dos' }),
    ).not.toBeInTheDocument();
  });

  it('fetches from GET /api/proveedores', async () => {
    stubFetchWithProveedores([{ id: 'p1', nombre: 'Solo', activo: true }]);

    renderSelector();

    await screen.findByRole('option', { name: 'Solo' });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/proveedores'),
      expect.anything(),
    );
  });
});
