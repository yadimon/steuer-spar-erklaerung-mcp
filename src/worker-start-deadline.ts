const deadlineKey = "__desktopStartDeadlineUnixMs";

/** Dispatch time, not prewarm birth time: each worker executes exactly one job. */
export function bindDesktopStartDeadline(
  operation: string,
  args: Record<string, unknown>,
  timeoutMs: number,
  nowMs: number = Date.now(),
): Record<string, unknown> {
  if (Object.hasOwn(args, deadlineKey)) throw new TypeError("Caller-supplied internal startup deadline is forbidden.");
  if (operation !== "desktop_start") return args;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 6500 ||
      !Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isSafeInteger(nowMs + timeoutMs)) {
    throw new TypeError("Desktop start requires a bounded deadline including verified cleanup.");
  }
  return { ...args, [deadlineKey]: nowMs + timeoutMs };
}
