import React, { useRef, useState } from 'react';
import { getLoadingButtonText, getProcessingButtonProps } from '../utils/buttonLoading';

export interface ActionButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /** Controlled loading state. If omitted and onClick returns a Promise, ActionButton manages loading automatically. */
  loading?: boolean;
  /** Optional explicit text while loading (defaults to smart label derived from idleText/children). */
  loadingText?: string;
  /** Optional explicit idle text label. If omitted and children is a string, uses children. */
  idleText?: string;
  /** Click handler; if async (returns a Promise) and `loading` prop is omitted, ActionButton locks against double-clicks & pulses until settled. */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void | Promise<unknown>;
}

export const ActionButton: React.FC<ActionButtonProps> = ({
  loading,
  loadingText,
  idleText,
  disabled = false,
  className = '',
  children,
  onClick,
  type = 'button',
  ...rest
}) => {
  const [internalLoading, setInternalLoading] = useState(false);
  const inFlightRef = useRef(false);

  const isControlled = typeof loading === 'boolean';
  const isBusy = isControlled ? Boolean(loading) : internalLoading;

  const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (isBusy || disabled) {
      event.preventDefault();
      return;
    }
    if (!onClick) return;

    const maybePromise = onClick(event);
    if (!isControlled && maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setInternalLoading(true);
      try {
        await maybePromise;
      } finally {
        inFlightRef.current = false;
        setInternalLoading(false);
      }
    }
  };

  const resolvedIdle = idleText ?? (typeof children === 'string' ? children : 'Submit');
  const displayContent = isBusy
    ? getLoadingButtonText(resolvedIdle, loadingText)
    : idleText ?? children;

  const processingProps = getProcessingButtonProps(isBusy, className, disabled);

  return (
    <button
      {...rest}
      type={type}
      disabled={processingProps.disabled}
      aria-busy={processingProps['aria-busy']}
      data-loading={processingProps['data-loading']}
      className={processingProps.className}
      onClick={handleClick}
    >
      {displayContent}
    </button>
  );
};
