import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  type ProductoReporteRow,
  StockActualTable,
} from './StockActualTable.js';

const row: ProductoReporteRow = {
  id: '1',
  nombre: 'Harina 000',
  sku: 'HAR-000',
  categoria: 'Almacén',
  stockActual: 12,
  stockMinimo: 5,
  precio: '150.00',
  proveedorId: 'p1',
  activo: true,
  creadoEn: '2026-09-01T00:00:00.000Z',
};

describe('StockActualTable', () => {
  it('renders one row per producto with its name and stock actual visible', () => {
    render(<StockActualTable productos={[row]} />);

    expect(screen.getByText('Harina 000')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('shows an empty state message when there are no productos', () => {
    render(<StockActualTable productos={[]} />);

    expect(
      screen.getByText('No hay productos para mostrar.'),
    ).toBeInTheDocument();
  });
});
