import { Button } from '../../components/ui/Button.js';
import { Modal } from '../../components/ui/Modal.js';
import styles from './CredentialDialog.module.css';
import type { CredentialHandoff } from './useCrearUsuario.js';

type CredentialDialogProps = {
  credential: CredentialHandoff;
  onAcknowledge: () => void;
};

/** Groups a plaintext credential into 4-character chunks for display. */
function groupPassword(password: string): string {
  return password.match(/.{1,4}/g)?.join('-') ?? password;
}

/**
 * Wraps `Modal` with `closePolicy="explicit-only"` (D13): dismissal destroys
 * the only copy of a one-time credential, so Escape and overlay-click are
 * suppressed. No auto-dismiss, no navigation blocker, and deliberately no
 * copy-to-clipboard button (D14) — the OS clipboard is a durable copy
 * outside the page, synced by Windows Cloud Clipboard and Apple Universal
 * Clipboard, that this design refuses to create silently. `user-select: all`
 * still makes a deliberate copy one click plus Ctrl+C, the user's own
 * clipboard action, not one the app performs.
 */
export function CredentialDialog({
  credential,
  onAcknowledge,
}: CredentialDialogProps) {
  return (
    <Modal
      title="Contraseña temporal generada"
      closePolicy="explicit-only"
      onClose={onAcknowledge}
    >
      <p className={styles.intro}>
        Contraseña temporal para <strong>{credential.nombre}</strong>:
      </p>
      <p className={styles.password}>
        {groupPassword(credential.passwordTemporal)}
      </p>
      <p className={styles.notice}>
        Anote esta contraseña. No podrá volver a verla. Si la pierde, genere una
        nueva desde la ficha del usuario.
      </p>
      <Button variant="primary" onClick={onAcknowledge}>
        Entendido
      </Button>
    </Modal>
  );
}
