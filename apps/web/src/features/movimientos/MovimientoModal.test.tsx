import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MovimientoModal, toWireSubmission } from './MovimientoModal.js';
import { EMPTY_MOVIMIENTO_FORM } from './schemas.js';

/**
 * S7a scope: step 1 only (choice cards, role hiding, shell wiring). Steps 2
 * and 3 are placeholders in this slice (generic cantidad/motivo controls),
 * completed with D9's full per-choice UI in S7b — this file's flow tests
 * drive through those placeholders only far enough to prove the step-1
 * mapping to the wire shape (movimientos-ui spec: "Step 1 Offers Four
 * Operator-Facing Choices Mapped To Three Wire Types").
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

    await user.type(screen.getByLabelText('Cantidad'), '5');
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

    await user.type(screen.getByLabelText('Cantidad'), '3');
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
