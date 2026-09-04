import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BajoMinimoTable } from './BajoMinimoTable.js';
import type { ProductoReporteRow } from './StockActualTable.js';

const row: ProductoReporteRow = {
  id: '1',
  nombre: 'Azúcar 1kg',
  sku: 'AZU-1KG',
  categoria: 'Almacén',
  stockActual: 3,
  stockMinimo: 3,
  precio: '90.00',
  proveedorId: 'p1',
  activo: true,
  creadoEn: '2026-09-01T00:00:00.000Z',
};

describe('BajoMinimoTable', () => {
  it('renders one row per producto bajo mínimo with its name visible', () => {
    render(<BajoMinimoTable productos={[row]} />);

    expect(screen.getByText('Azúcar 1kg')).toBeInTheDocument();
  });

  it('shows an empty state message when there are no productos bajo mínimo', () => {
    render(<BajoMinimoTable productos={[]} />);

    expect(
      screen.getByText('No hay productos para mostrar.'),
    ).toBeInTheDocument();
  });
});
