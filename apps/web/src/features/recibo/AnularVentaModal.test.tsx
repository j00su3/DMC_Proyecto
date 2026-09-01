import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AnularVentaModal } from './AnularVentaModal.js';

/**
 * Phase 7.1 — `AnularVentaModal` (design's stated working assumption: no
 * second "¿está seguro?" confirmation step beyond the typed mandatory
 * motivo, `MovimientoModal` precedent). recibo-ui spec: "Submission
 * without a reason is blocked client-side".
 */
describe('AnularVentaModal', () => {
  it('renders a motivo textarea and keeps submit disabled with no motivo entered', () => {
    render(
      <AnularVentaModal
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isPending={false}
      />,
    );

    expect(
      screen.getByRole('textbox', { name: /motivo/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /anular venta/i }),
    ).toBeDisabled();
  });

  it('does not call onSubmit when the submit control is activated with a blank motivo', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <AnularVentaModal
        onClose={vi.fn()}
        onSubmit={onSubmit}
        isPending={false}
      />,
    );

    await user.click(screen.getByRole('button', { name: /anular venta/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('enables submit and calls onSubmit with the trimmed motivo once a valid motivo is entered', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <AnularVentaModal
        onClose={vi.fn()}
        onSubmit={onSubmit}
        isPending={false}
      />,
    );

    await user.type(
      screen.getByRole('textbox', { name: /motivo/i }),
      'Cliente se retractó del pago',
    );
    const submitButton = screen.getByRole('button', { name: /anular venta/i });
    expect(submitButton).toBeEnabled();
    await user.click(submitButton);

    expect(onSubmit).toHaveBeenCalledWith({
      motivoAnulacion: 'Cliente se retractó del pago',
    });
  });

  it('keeps submit blocked for a too-short motivo (below the ratified minimum)', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <AnularVentaModal
        onClose={vi.fn()}
        onSubmit={onSubmit}
        isPending={false}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: /motivo/i }), 'xy');
    await user.click(screen.getByRole('button', { name: /anular venta/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders a server error without closing the modal', () => {
    render(
      <AnularVentaModal
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isPending={false}
        serverError="Esta venta ya fue anulada."
      />,
    );

    expect(screen.getByText('Esta venta ya fue anulada.')).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: /motivo/i }),
    ).toBeInTheDocument();
  });
});
