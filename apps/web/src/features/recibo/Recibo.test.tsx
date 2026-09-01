import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cwd } from 'node:process';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Recibo, type ReciboData } from './Recibo.js';

const BASE_RECIBO: ReciboData = {
  venta: {
    id: 'venta-1',
    numeroCorrelativo: 42,
    usuarioId: 'usr-1',
    estado: 'confirmada',
    total: '150.00',
    creadoEn: '2026-08-31T15:30:00.000Z',
  },
  cajero: { id: 'usr-1', nombre: 'Ana Torres' },
  items: [
    {
      id: 'item-1',
      ventaId: 'venta-1',
      productoId: 'prod-1',
      cantidad: 2,
      precioUnitario: '50.00',
      subtotal: '100.00',
      nombre: 'Martillo',
    },
    {
      id: 'item-2',
      ventaId: 'venta-1',
      productoId: 'prod-2',
      cantidad: 1,
      precioUnitario: '50.00',
      subtotal: '50.00',
      nombre: 'Destornillador',
    },
  ],
  pagos: [
    {
      id: 'pago-1',
      ventaId: 'venta-1',
      medio: 'efectivo',
      monto: '150.00',
      vuelto: '0.00',
      estado: 'registrado',
    },
  ],
};

function readStyles(relativePath: string): string {
  return readFileSync(resolve(cwd(), relativePath), 'utf8');
}

/** recibo-ui / Printable Receipt Route (field list), Estado Shown As Plain
 * Text (PD-6), Receipt Omits Store Identity (PD-2), Correlativo Search's
 * PD-12 payment-row list. Component-level (Phase 3, Task 3.1). */
describe('Recibo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders every PD-2 field, with no store name or address anywhere', () => {
    render(<Recibo recibo={BASE_RECIBO} />);

    expect(screen.getByText('Martillo')).toBeInTheDocument();
    expect(screen.getByText('Destornillador')).toBeInTheDocument();
    expect(screen.getAllByText('$150.00').length).toBeGreaterThan(0); // importe
    expect(screen.getByText('Efectivo')).toBeInTheDocument(); // medio de pago
    expect(screen.getByText('Ana Torres')).toBeInTheDocument(); // cajero
    expect(screen.getByText('42')).toBeInTheDocument(); // numero correlativo
    expect(screen.getByText('confirmada')).toBeInTheDocument(); // estado

    expect(
      screen.queryByText(/tienda|inventienda|dirección/i),
    ).not.toBeInTheDocument();
  });

  it('shows an anulada estado as plain text among the other fields, no banner or watermark', () => {
    render(
      <Recibo
        recibo={{
          ...BASE_RECIBO,
          venta: { ...BASE_RECIBO.venta, estado: 'anulada' },
        }}
      />,
    );

    const estado = screen.getByText('anulada');
    expect(estado).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders confirmada the same way, with no distinct visual treatment', () => {
    render(<Recibo recibo={BASE_RECIBO} />);

    expect(screen.getByText('confirmada')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders every pagos row, showing vuelto only on the cash row when nonzero', () => {
    render(
      <Recibo
        recibo={{
          ...BASE_RECIBO,
          pagos: [
            {
              id: 'pago-1',
              ventaId: 'venta-1',
              medio: 'efectivo',
              monto: '65.00',
              vuelto: '10.00',
              estado: 'registrado',
            },
            {
              id: 'pago-2',
              ventaId: 'venta-1',
              medio: 'tarjeta',
              monto: '85.00',
              vuelto: '0.00',
              estado: 'registrado',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Efectivo')).toBeInTheDocument();
    expect(screen.getByText('Tarjeta')).toBeInTheDocument();
    expect(screen.getByText('$65.00')).toBeInTheDocument();
    expect(screen.getByText('$85.00')).toBeInTheDocument();
    expect(screen.getByText('Vuelto $10.00')).toBeInTheDocument();
    expect(screen.queryByText(/Vuelto \$0\.00/)).not.toBeInTheDocument();
  });

  it('calls onVolver when Volver is activated, instead of relying on browser history', async () => {
    const onVolver = vi.fn();
    const user = userEvent.setup();
    render(<Recibo recibo={BASE_RECIBO} onVolver={onVolver} />);

    await user.click(screen.getByRole('button', { name: 'Volver' }));

    expect(onVolver).toHaveBeenCalledTimes(1);
  });

  it('falls back to window.history.back() when no onVolver is supplied', async () => {
    const backSpy = vi.fn();
    vi.stubGlobal('history', { ...window.history, back: backSpy });
    const user = userEvent.setup();
    render(<Recibo recibo={BASE_RECIBO} />);

    await user.click(screen.getByRole('button', { name: 'Volver' }));

    expect(backSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('calls window.print() directly when Imprimir is activated, no auto-print on mount (PD-9)', async () => {
    const printSpy = vi.fn();
    vi.stubGlobal('print', printSpy);
    const user = userEvent.setup();
    render(<Recibo recibo={BASE_RECIBO} />);

    expect(printSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Imprimir' }));

    expect(printSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('D6: print CSS sets @page margin only, no size, hides controls, and avoids row breaks', () => {
    const css = readStyles('src/features/recibo/Recibo.module.css');

    expect(css).toMatch(/@page\s*\{\s*margin:\s*12mm;\s*\}/);
    expect(css).not.toMatch(/@page\s*\{[^}]*size:/);
    expect(css).toMatch(/@media print[\s\S]*display:\s*none/);
    expect(css).toMatch(/break-inside:\s*avoid/);
  });
});
