const deadlineKey = "__ustvaReadDeadlineUnixMs";

/** Bind the private composition before worker borrowing/parsing consumes its deadline. */
export function bindUstvaReadDeadline(
  operation: string,
  args: Record<string, unknown>,
  timeoutMs: number,
  nowMs: number = Date.now(),
): Record<string, unknown> {
  if (Object.hasOwn(args, deadlineKey)) throw new TypeError("Caller-supplied internal read deadline is forbidden.");
  if (operation !== "page" || args.internalUstvaPage !== true) return args;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(nowMs)
    || nowMs < 0 || !Number.isSafeInteger(nowMs + timeoutMs)) {
    throw new TypeError("The private UStVA read requires a bounded caller deadline.");
  }
  return { ...args, [deadlineKey]: nowMs + timeoutMs };
}
