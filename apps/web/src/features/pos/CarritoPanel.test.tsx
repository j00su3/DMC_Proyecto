import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CarritoPanel } from './CarritoPanel.js';
import type { CarritoLinea } from './carrito.js';

const LINEA_A: CarritoLinea = {
  productoId: '11111111-1111-4111-8111-111111111111',
  nombre: 'Producto A',
  sku: 'SKU-A',
  precioSnapshot: '10.00',
  cantidad: 2,
  stockActual: 5,
};

const LINEA_B: CarritoLinea = {
  productoId: '22222222-2222-4222-8222-222222222222',
  nombre: 'Producto B',
  sku: 'SKU-B',
  precioSnapshot: '5.50',
  cantidad: 1,
  stockActual: 3,
};

describe('CarritoPanel', () => {
  it('renders empty state with no lines and no total row content beyond $0.00', () => {
    render(
      <CarritoPanel
        items={[]}
        onActualizarCantidad={vi.fn()}
        onQuitar={vi.fn()}
        onVaciar={vi.fn()}
      />,
    );

    expect(screen.getByText('El carrito está vacío')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Vaciar carrito' }),
    ).toBeDisabled();
  });

  it('renders each line with its name and per-line subtotal (dinero.ts, precio × cantidad)', () => {
    render(
      <CarritoPanel
        items={[LINEA_A, LINEA_B]}
        onActualizarCantidad={vi.fn()}
        onQuitar={vi.fn()}
        onVaciar={vi.fn()}
      />,
    );

    expect(screen.getByText('Producto A')).toBeInTheDocument();
    expect(screen.getByText('$20.00')).toBeInTheDocument(); // 10.00 * 2
    expect(screen.getByText('Producto B')).toBeInTheDocument();
    expect(screen.getByText('$5.50')).toBeInTheDocument(); // 5.50 * 1
  });

  it('shows the summed total across all lines', () => {
    render(
      <CarritoPanel
        items={[LINEA_A, LINEA_B]}
        onActualizarCantidad={vi.fn()}
        onQuitar={vi.fn()}
        onVaciar={vi.fn()}
      />,
    );

    expect(screen.getByText('$25.50')).toBeInTheDocument();
  });

  it('calls onQuitar with the line productoId when its remove control is clicked', async () => {
    const user = userEvent.setup();
    const onQuitar = vi.fn();
    render(
      <CarritoPanel
        items={[LINEA_A]}
        onActualizarCantidad={vi.fn()}
        onQuitar={onQuitar}
        onVaciar={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Quitar Producto A' }));

    expect(onQuitar).toHaveBeenCalledWith(LINEA_A.productoId);
  });

  it('calls onActualizarCantidad when the quantity input changes to a valid integer', () => {
    const onActualizarCantidad = vi.fn();
    render(
      <CarritoPanel
        items={[LINEA_A]}
        onActualizarCantidad={onActualizarCantidad}
        onQuitar={vi.fn()}
        onVaciar={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Cantidad de Producto A');
    fireEvent.change(input, { target: { value: '4' } });

    expect(onActualizarCantidad).toHaveBeenCalledWith(LINEA_A.productoId, 4);
  });

  it('calls onVaciar (PD-9 explicit empty action) when the cart is non-empty', async () => {
    const user = userEvent.setup();
    const onVaciar = vi.fn();
    render(
      <CarritoPanel
        items={[LINEA_A]}
        onActualizarCantidad={vi.fn()}
        onQuitar={vi.fn()}
        onVaciar={onVaciar}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Vaciar carrito' }));

    expect(onVaciar).toHaveBeenCalledOnce();
  });
});
