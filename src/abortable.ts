export function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

/**
 * Bindet eine nicht nativ abortierbare Promise an ein Signal. Falls das
 * Ergebnis erst nach dem Abbruch eintrifft, kann der Aufrufer den spaeten
 * Handle oder eine andere Ressource gezielt freigeben.
 */
export function abortable<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  cleanupLateResult?: (value: T) => void | Promise<void>,
): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (): boolean => {
      if (settled) return false;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      return true;
    };
    const onAbort = (): void => {
      if (finish()) rejectPromise(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    operation.then(
      (value) => {
        if (finish()) resolvePromise(value);
        else void cleanupLateResult?.(value);
      },
      (error: unknown) => {
        if (finish()) rejectPromise(error);
      },
    );
  });
}
