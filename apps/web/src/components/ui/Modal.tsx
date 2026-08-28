import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from 'react';
import styles from './Modal.module.css';

export interface ModalProps {
  title: string;
  /**
   * REQUIRED and undefaulted on purpose (D13): the dangerous policy must
   * not be reachable by omission. `'explicit-only'` suppresses Escape and
   * overlay-click dismissal — used by the credential dialog, where
   * dismissal destroys the only copy of a one-time secret. `'casual'`
   * behaves like an ordinary dialog.
   */
  closePolicy: 'explicit-only' | 'casual';
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * `<div role="dialog" aria-modal="true" aria-labelledby>` over an overlay
 * div (D13). Hand-rolled focus trap and restore — no native `<dialog>`
 * (jsdom support for `showModal()` was not verified, see design.md's open
 * questions). Focus moves to the heading, not the first focusable child,
 * on open: a stray Enter still held from the click that opened the modal
 * must not immediately dismiss it.
 */
export function Modal({ title, closePolicy, onClose, children }: ModalProps) {
  const headingId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    triggerRef.current = document.activeElement;
    headingRef.current?.focus();

    return () => {
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    };
  }, []);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      if (closePolicy === 'casual') {
        onClose();
      }
      return;
    }

    if (event.key !== 'Tab' || !modalRef.current || !headingRef.current) {
      return;
    }

    // The heading carries `tabIndex={-1}` (programmatically focusable only,
    // to receive initial focus on open) and is therefore excluded by
    // `FOCUSABLE_SELECTOR`'s natural tab order — it is still the trap's
    // logical first stop, since that is where focus lands on open.
    const focusable = [
      headingRef.current,
      ...Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ),
    ];

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      return;
    }

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleOverlayClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (closePolicy === 'casual') {
      onClose();
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: decorative, non-focusable backdrop — Escape is handled by the dialog panel's own onKeyDown below (D13)
    <div
      className={styles.overlay}
      data-testid="modal-overlay"
      onClick={handleOverlayClick}
    >
      <div
        // biome-ignore lint/a11y/useSemanticElements: <dialog>/showModal() deliberately rejected (D13) — jsdom's HTMLDialogElement support was never verified
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className={styles.modal}
        onKeyDown={handleKeyDown}
      >
        <h2
          id={headingId}
          tabIndex={-1}
          ref={headingRef}
          className={styles.title}
        >
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
