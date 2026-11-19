import { useCallback, useRef, useState } from 'react';

const ACTION_TEXT_RULES: Array<[RegExp, string]> = [
  [/^verify\s+payment/i, 'Verifying Payment...'],
  [/^verify\s+razorpay/i, 'Verifying Razorpay...'],
  [/^verify\s+otp/i, 'Verifying OTP...'],
  [/^verify\b/i, 'Verifying...'],
  [/^re-verify\b/i, 'Re-verifying...'],
  [/^login\b|^log\s+in\b/i, 'Logging in...'],
  [/^sign\s+in\b/i, 'Signing in...'],
  [/^register\b|^create\b/i, 'Creating Account...'],
  [/^send\s+otp\b/i, 'Sending OTP...'],
  [/^resend\b/i, 'Resending...'],
  [/^submit\b/i, 'Submitting...'],
  [/^save\b/i, 'Saving...'],
  [/^update\b/i, 'Updating...'],
  [/^publish\b/i, 'Publishing...'],
  [/^approve\b/i, 'Approving...'],
  [/^reject\b/i, 'Rejecting...'],
  [/^delete\b|^remove\b/i, 'Deleting...'],
  [/^apply\b/i, 'Applying...'],
  [/^pay\b|^subscribe\b/i, 'Processing Payment...'],
  [/^sync\b|^store\b/i, 'Syncing...'],
  [/^post\b|^send\b/i, 'Sending...'],
  [/^connect\b/i, 'Connecting...'],
  [/^unlock\b/i, 'Unlocking...'],
  [/^retry\b/i, 'Retrying...'],
];

/**
 * Returns a dynamic loading label derived from an idle button label
 * (e.g. "Login" -> "Logging in...", "Verify" -> "Verifying..."), or uses customLoadingText.
 */
export function getLoadingButtonText(idleText: string, customLoadingText?: string): string {
  if (customLoadingText && customLoadingText.trim().length > 0) {
    return customLoadingText;
  }
  const clean = idleText.trim();
  for (const [pattern, label] of ACTION_TEXT_RULES) {
    if (pattern.test(clean)) {
      return label;
    }
  }
  return 'Processing...';
}

export interface ProcessingButtonProps {
  disabled?: boolean;
  'aria-busy': boolean;
  'data-loading': 'true' | 'false';
  className: string;
}

/**
 * Generates standard props to attach to any <button> while loading:
 * - Applies smooth pulsing/blinking (.btn-processing)
 * - Disables double-clicks & applies not-allowed/wait cursor
 * - Sets aria-busy & data-loading attributes
 */
export function getProcessingButtonProps(
  isLoading: boolean,
  baseClassName = '',
  extraDisabled = false
): ProcessingButtonProps {
  const loadingClass = isLoading ? 'btn-processing disabled:cursor-not-allowed' : '';
  return {
    disabled: Boolean(isLoading || extraDisabled),
    'aria-busy': Boolean(isLoading),
    'data-loading': isLoading ? 'true' : 'false',
    className: [baseClassName, loadingClass].filter(Boolean).join(' ').trim(),
  };
}

/**
 * Combines a base className with processing feedback classes when isLoading is true.
 */
export function processingClass(isLoading: boolean, baseClassName = ''): string {
  return isLoading
    ? `${baseClassName} btn-processing disabled:cursor-not-allowed`.trim()
    : baseClassName;
}

/**
 * React hook for wrapping any async button click/submit action with:
 * - Synchronous double-click guard (useRef lock)
 * - Loading state for smooth CSS pulse animation
 * - Automatic state cleanup on success OR failure (finally block)
 */
export function useButtonAction<TArgs extends any[] = any[], TResult = void>(
  action: (...args: TArgs) => Promise<TResult>,
  options?: { idleText?: string; loadingText?: string }
) {
  const [isLoading, setIsLoading] = useState(false);
  const inFlightRef = useRef(false);

  const run = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      if (inFlightRef.current) return undefined;
      inFlightRef.current = true;
      setIsLoading(true);
      try {
        return await action(...args);
      } finally {
        inFlightRef.current = false;
        setIsLoading(false);
      }
    },
    [action]
  );

  const label = useCallback(
    (idleOverride?: string, loadingOverride?: string) => {
      const idle = idleOverride ?? options?.idleText ?? 'Submit';
      if (!isLoading) return idle;
      return getLoadingButtonText(idle, loadingOverride ?? options?.loadingText);
    },
    [isLoading, options?.idleText, options?.loadingText]
  );

  const buttonProps = useCallback(
    (baseClassName = '', extraDisabled = false) =>
      getProcessingButtonProps(isLoading, baseClassName, extraDisabled),
    [isLoading]
  );

  return { isLoading, run, label, buttonProps };
}

/**
 * React hook for tracking per-item async button loading states in lists/tables
 * (e.g., Approve/Reject rows, Episode Read buttons, Comment delete buttons).
 */
export function useButtonLoadingMap() {
  const [loadingKeys, setLoadingKeys] = useState<Record<string, boolean>>({});
  const inFlightKeysRef = useRef<Record<string, boolean>>({});

  const isLoading = useCallback(
    (key: string) => Boolean(loadingKeys[key]),
    [loadingKeys]
  );

  const runWithKey = useCallback(
    async <TResult = void>(key: string, fn: () => Promise<TResult>): Promise<TResult | undefined> => {
      if (inFlightKeysRef.current[key]) return undefined;
      inFlightKeysRef.current[key] = true;
      setLoadingKeys((prev) => ({ ...prev, [key]: true }));
      try {
        return await fn();
      } finally {
        delete inFlightKeysRef.current[key];
        setLoadingKeys((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    []
  );

  return { isLoading, runWithKey };
}
