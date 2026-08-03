export async function withCombinedAbortSignal<T>(
  signals: Array<AbortSignal | undefined>,
  action: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const active = [...new Set(signals.filter((signal): signal is AbortSignal => Boolean(signal)))];
  const listeners = new Map<AbortSignal, () => void>();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const abort = () => controller.abort(signal.reason);
    listeners.set(signal, abort);
    signal.addEventListener("abort", abort, { once: true });
  }
  try {
    return await action(controller.signal);
  } finally {
    for (const [signal, abort] of listeners) signal.removeEventListener("abort", abort);
  }
}
