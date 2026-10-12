import { randomBytes } from "node:crypto";

const environmentKey = "SSE_INTERNAL_TABLE_CAPABILITY";
const argumentKey = "__tableTransportCapability";

/** One worker process, one job; never derive its authority from caller configuration. */
export function createTableWorkerCapability(): string {
  return randomBytes(32).toString("hex");
}

export function tableWorkerEnvironment(capability: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!/^[a-f0-9]{64}$/u.test(capability)) throw new TypeError("Invalid internal worker capability.");
  return { ...base, [environmentKey]: capability };
}

/** Called after selecting the concrete warm/cold worker, below the public argument schemas. */
export function bindTableWorkerArguments(args: Record<string, unknown>, capability: string): Record<string, unknown> {
  if (Object.hasOwn(args, argumentKey)) throw new TypeError("Caller-supplied internal worker capability is forbidden.");
  if (!Object.hasOwn(args, "__tableCursorPlan") && !Object.hasOwn(args, "__tableMutationBinding")) return args;
  if (!/^[a-f0-9]{64}$/u.test(capability)) throw new TypeError("Invalid internal worker capability.");
  return { ...args, [argumentKey]: capability };
}
