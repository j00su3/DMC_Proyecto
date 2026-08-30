import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  MovimientoModal,
  buildSummaryLine,
  computeStockResultante,
  toWireSubmission,
} from './MovimientoModal.js';
import { EMPTY_MOVIMIENTO_FORM } from './schemas.js';

/**
 * S7a covered step 1 only (choice cards, role hiding, shell wiring). S7b
 * (this file, extended) adds D9's full steps 2-3: quantity variant by
 * choice, the ajuste `Sumar/Restar` control + discrepancy checkbox, the
 * motivo textarea and its conditional label, the summary line, and
 * `serverError` surfacing (movimientos-ui spec: "Step 2 Refuses To Progress
 * When Motivo Or Quantity Rules Are Violated", "Step 3 Confirms And
 * Submits, Surfacing Server Refusals To Either Role").
 */
describe('MovimientoModal', () => {
  it('renders exactly four choices for an encargado session, none disabled', () => {
    render(
      <MovimientoModal
        actorRol="encargado"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    for (const radio of radios) {
      expect(radio).toBeEnabled();
    }
    expect(screen.getByRole('radio', { name: 'Entrada' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Salida' })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Salida por merma' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Ajuste' })).toBeInTheDocument();
  });

  it('renders Ajuste disabled with a lock affordance for a deposito session (UX only)', () => {
    render(
      <MovimientoModal
        actorRol="deposito"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(screen.getByRole('radio', { name: 'Ajuste' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Entrada' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Salida' })).toBeEnabled();
    expect(
      screen.getByRole('radio', { name: 'Salida por merma' }),
    ).toBeEnabled();
    expect(screen.getByText('🔒')).toBeInTheDocument();
  });

  it('Continuar is disabled until a step-1 choice is made', async () => {
    const user = userEvent.setup();
    render(
      <MovimientoModal
        actorRol="encargado"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const continuar = screen.getByRole('button', { name: 'Continuar' });
    expect(continuar).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: 'Entrada' }));

    expect(continuar).toBeEnabled();
  });

  it('selecting "Salida por merma" and completing the flow submits tipo salida with esMerma true', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <MovimientoModal
        actorRol="encargado"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('radio', { name: 'Salida por merma' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    await user.type(screen.getByLabelText('Cantidad a retirar'), '5');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    await user.type(screen.getByLabelText('Motivo'), 'rotura');
    await user.click(
      screen.getByRole('button', { name: 'Registrar movimiento' }),
    );

    expect(onSubmit).toHaveBeenCalledWith({
      operacion: 'salida',
      body: { cantidad: 5, esMerma: true, motivo: 'rotura' },
    });
  });

  it('selecting "Ajuste" and completing the flow submits tipo ajuste with no merma indicator', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <MovimientoModal
        actorRol="encargado"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('radio', { name: 'Ajuste' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    await user.type(screen.getByLabelText('Unidades'), '3');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    await user.type(screen.getByLabelText('Motivo'), 'conteo físico');
    await user.click(
      screen.getByRole('button', { name: 'Registrar movimiento' }),
    );

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [submission] = onSubmit.mock.calls.at(0) ?? [];
    expect(submission?.operacion).toBe('ajuste');
    expect(submission?.body).not.toHaveProperty('esMerma');
    expect(submission?.body.cantidad).toBe(3);
  });

  it('the audit note is shown on step 1', () => {
    render(
      <MovimientoModal
        actorRol="encargado"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        'Este movimiento queda registrado con su usuario y la fecha. No puede editarse ni eliminarse.',
      ),
    ).toBeInTheDocument();
  });

  it('Ajuste with quantity 0 is refused before submit, no request sent', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <MovimientoModal
        actorRol="encargado"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('radio', { name: 'Ajuste' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    await user.type(screen.getByLabelText('Unidades'), '0');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    // Still on step 2 — the "Unidades" field is still rendered, and a
    // validation error is shown; the wizard never advanced to step 3.
    expect(screen.getByLabelText('Unidades')).toBeInTheDocument();
    expect(
      screen.getByText('La cantidad debe ser al menos 1.'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a merma salida with blank motivo is refused before submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <MovimientoModal
        actorRol="encargado"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('radio', { name: 'Salida por merma' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.type(screen.getByLabelText('Cantidad a retirar'), '3');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    await user.click(
      screen.getByRole('button', { name: 'Registrar movimiento' }),
    );

    expect(
      await screen.findByText('Ingrese un motivo (mínimo 3 caracteres).'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('an ordinary salida with blank motivo is allowed to progress to step 3', async () => {
    const user = userEvent.setup();
    render(
      <MovimientoModal
        actorRol="encargado"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('radio', { name: 'Salida' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.type(screen.getByLabelText('Cantidad a retirar'), '2');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(screen.getByLabelText('Motivo (opcional)')).toBeInTheDocument();
  });

  it('the discrepancy checkbox is present and functional on the ajuste step', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <MovimientoModal
        actorRol="encargado"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('radio', { name: 'Ajuste' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.type(screen.getByLabelText('Unidades'), '4');
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Marcar como discrepancia de inventario',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.type(screen.getByLabelText('Motivo'), 'conteo físico');
    await user.click(
      screen.getByRole('button', { name: 'Registrar movimiento' }),
    );

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [submission] = onSubmit.mock.calls.at(0) ?? [];
    expect(submission?.body.esDiscrepancia).toBe(true);
  });

  it('step 3 renders a summary line derived from the entered movement', async () => {
    const user = userEvent.setup();
    render(
      <MovimientoModal
        actorRol="encargado"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        stockActual={12}
      />,
    );

    await user.click(screen.getByRole('radio', { name: 'Salida por merma' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.type(screen.getByLabelText('Cantidad a retirar'), '3');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(
      screen.getByText('Salida por merma · 3 unidades · stock resultante 9'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Registrar movimiento' }),
    ).toBeInTheDocument();
  });

  it('a stock preview shows Stock disponible and a live Stock resultante on step 2', async () => {
    const user = userEvent.setup();
    render(
      <MovimientoModal
        actorRol="encargado"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        stockActual={10}
      />,
    );

    await user.click(screen.getByRole('radio', { name: 'Salida' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(screen.getByText('Stock disponible: 10')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Cantidad a retirar'), '4');

    expect(screen.getByText('Stock resultante: 6')).toBeInTheDocument();
  });

  it('renders a serverError message without closing the modal', () => {
    const onClose = vi.fn();
    render(
      <MovimientoModal
        actorRol="encargado"
        onClose={onClose}
        onSubmit={vi.fn()}
        serverError="Stock insuficiente, hay 5 disponibles"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('5');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('computeStockResultante', () => {
  it('adds the magnitude for an entrada', () => {
    expect(computeStockResultante(10, 'entrada', '5', 'sumar')).toBe(15);
  });

  it('subtracts the magnitude for a salida', () => {
    expect(computeStockResultante(10, 'salida', '5', 'sumar')).toBe(5);
  });

  it('subtracts the magnitude for a merma salida', () => {
    expect(computeStockResultante(12, 'merma', '3', 'sumar')).toBe(9);
  });

  it('adds for ajuste sumar, subtracts for ajuste restar', () => {
    expect(computeStockResultante(10, 'ajuste', '4', 'sumar')).toBe(14);
    expect(computeStockResultante(10, 'ajuste', '4', 'restar')).toBe(6);
  });
});

describe('buildSummaryLine', () => {
  it('formats the merma summary example from D9', () => {
    expect(buildSummaryLine('merma', '3', 9)).toBe(
      'Salida por merma · 3 unidades · stock resultante 9',
    );
  });

  it('formats an entrada summary with a different label and numbers', () => {
    expect(buildSummaryLine('entrada', '10', 20)).toBe(
      'Entrada · 10 unidades · stock resultante 20',
    );
  });
});

describe('toWireSubmission', () => {
  it('maps entrada straight through with the entrada operacion', () => {
    const result = toWireSubmission({
      ...EMPTY_MOVIMIENTO_FORM,
      eleccion: 'entrada',
      cantidad: '10',
      motivo: '',
    });

    expect(result).toEqual({
      operacion: 'entrada',
      body: { cantidad: 10, motivo: undefined },
    });
  });

  it('maps an ordinary salida with esMerma false', () => {
    const result = toWireSubmission({
      ...EMPTY_MOVIMIENTO_FORM,
      eleccion: 'salida',
      cantidad: '4',
      motivo: '',
    });

    expect(result).toEqual({
      operacion: 'salida',
      body: { cantidad: 4, esMerma: false, motivo: undefined },
    });
  });

  it('maps "merma" onto the salida operacion with esMerma true', () => {
    const result = toWireSubmission({
      ...EMPTY_MOVIMIENTO_FORM,
      eleccion: 'merma',
      cantidad: '2',
      motivo: 'rotura',
    });

    expect(result).toEqual({
      operacion: 'salida',
      body: { cantidad: 2, esMerma: true, motivo: 'rotura' },
    });
  });

  it('maps ajuste with direccion and esDiscrepancia, no esMerma key', () => {
    const result = toWireSubmission({
      ...EMPTY_MOVIMIENTO_FORM,
      eleccion: 'ajuste',
      cantidad: '7',
      direccion: 'restar',
      esDiscrepancia: true,
      motivo: 'conteo',
    });

    expect(result).toEqual({
      operacion: 'ajuste',
      body: {
        cantidad: 7,
        direccion: 'restar',
        esDiscrepancia: true,
        motivo: 'conteo',
      },
    });
    expect(result.body).not.toHaveProperty('esMerma');
  });
});
