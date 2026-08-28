import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal.js';

/**
 * P4 (design.md Testing Strategy) — D13's required, non-defaulted
 * `closePolicy` prop and its focus-management contract. `explicit-only`
 * suppresses Escape and overlay click; `casual` allows both. Focus lands on
 * the heading (not the acknowledge button) on open, so a stray Enter held
 * from the click that opened the modal cannot dismiss it.
 */
describe('Modal', () => {
  function renderTrigger(
    onClose: () => void,
    closePolicy: 'explicit-only' | 'casual',
  ) {
    function Harness() {
      return (
        <div>
          <button type="button">Abrir</button>
          <Modal title="Título" closePolicy={closePolicy} onClose={onClose}>
            <button type="button" onClick={onClose}>
              Entendido
            </button>
          </Modal>
        </div>
      );
    }
    return render(<Harness />);
  }

  it('explicit-only: Escape does not call onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderTrigger(onClose, 'explicit-only');

    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
  });

  it('explicit-only: an overlay click does not call onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderTrigger(onClose, 'explicit-only');

    await user.click(screen.getByTestId('modal-overlay'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('explicit-only: the acknowledge button still calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderTrigger(onClose, 'explicit-only');

    await user.click(screen.getByRole('button', { name: 'Entendido' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('casual: Escape calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderTrigger(onClose, 'casual');

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('casual: an overlay click calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderTrigger(onClose, 'casual');

    await user.click(screen.getByTestId('modal-overlay'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses the heading, not the acknowledge button, on open', () => {
    renderTrigger(vi.fn(), 'explicit-only');

    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Título' }),
    );
  });

  it('wraps Tab from the last focusable element to the first', async () => {
    const user = userEvent.setup();
    renderTrigger(vi.fn(), 'explicit-only');

    const heading = screen.getByRole('heading', { name: 'Título' });
    const button = screen.getByRole('button', { name: 'Entendido' });
    button.focus();
    expect(document.activeElement).toBe(button);

    await user.tab();

    expect(document.activeElement).toBe(heading);
  });

  it('wraps Shift+Tab from the first focusable element to the last', async () => {
    const user = userEvent.setup();
    renderTrigger(vi.fn(), 'explicit-only');

    const heading = screen.getByRole('heading', { name: 'Título' });
    const button = screen.getByRole('button', { name: 'Entendido' });
    heading.focus();
    expect(document.activeElement).toBe(heading);

    await user.tab({ shift: true });

    expect(document.activeElement).toBe(button);
  });

  it('restores focus to the trigger on unmount', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Abrir
          </button>
          {open ? (
            <Modal
              title="Título"
              closePolicy="explicit-only"
              onClose={() => setOpen(false)}
            >
              <button type="button" onClick={() => setOpen(false)}>
                Entendido
              </button>
            </Modal>
          ) : null}
        </div>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Abrir' });
    await user.click(trigger);
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Título' }),
    );

    await user.click(screen.getByRole('button', { name: 'Entendido' }));

    expect(document.activeElement).toBe(trigger);
  });
});
