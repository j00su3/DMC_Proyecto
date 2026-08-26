import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

type ButtonVariant = 'primary' | 'secondary';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant: ButtonVariant;
  isPending?: boolean;
  children: ReactNode;
};

export function Button({
  variant,
  isPending = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = [styles.button, styles[variant], className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled || isPending}
      aria-busy={isPending || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
