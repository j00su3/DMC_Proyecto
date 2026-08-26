import type { InputHTMLAttributes } from 'react';
import { useId } from 'react';
import styles from './TextField.module.css';

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: string;
};

export function TextField({
  id,
  label,
  error,
  className,
  ...rest
}: TextFieldProps) {
  const generatedId = useId();
  const errorId = error ? `${id}-error-${generatedId}` : undefined;
  const inputClasses = [styles.input, error ? styles.invalid : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.wrapper}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        id={id}
        className={inputClasses}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        {...rest}
      />
      {error ? (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
