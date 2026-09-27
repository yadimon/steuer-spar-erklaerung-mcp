import { z } from "zod";
import type { WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import { QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";

const text = z.string().max(65_536);
const integer = z.number().int().safe();
const nodeSchema = z.object({
  i: integer.nonnegative(), p: integer.min(-1), d: integer.min(0).max(16),
  type: text, name: text, aid: text, rid: z.string().regex(/^42\.-?\d+(?:\.4\.-?\d+)?$/u),
  x: integer, y: integer, w: integer.nonnegative(), h: integer.nonnegative(), on: z.boolean(),
  val: text.nullable(), ro: z.boolean().nullable(), checked: z.union([z.boolean(), z.literal("unbestimmt")]).nullable(),
  selected: z.boolean().nullable(), scroll: z.null(),
}).strict();
export type QtSnapshotNode = z.infer<typeof nodeSchema>;
const snapshotSchema = z.object({
  ok: z.literal(true), controllerBound: z.literal(true), scope: z.literal("qt-accessibility-content"),
  hwnd: integer.positive(), windowEnabled: z.boolean(), modalBlocked: z.boolean(), nodes: z.array(nodeSchema).max(5000),
  foreground: z.boolean().optional(),
  windowRect: z.object({ x: integer, y: integer, w: integer.nonnegative(), h: integer.nonnegative() }).strict(),
  exactMatches: z.object({ name: z.array(integer.nonnegative()).optional(), aid: z.array(integer.nonnegative()).optional(),
    type: z.array(integer.nonnegative()).optional() }).strict(),
  stats: z.object({
    n: integer.nonnegative(), err: z.literal(0), cyc: z.literal(0), cycleRid: z.literal(""), cycleName: z.literal(""),
    truncated: z.boolean(), depthLimited: z.boolean(), valErr: z.literal(0), scrollErr: z.literal(0),
    source: z.literal("qt"), fallbackReason: z.literal(""), snapshotMs: z.number().finite().nonnegative(),
  }).strict(),
});
const fail = (kind: string, error: string): WorkerResult => ({ ok: false, backend: "qt", kind, error });

/** A fresh GUI-thread content tree with UIA-compatible runtime IDs. No UIA client or PowerShell process. */
export async function readQtNativeSnapshot(
  client: QtNativeClient, args: Readonly<Record<string, unknown>>, timeoutMs: number, signal?: AbortSignal,
) {
  if (args.hwnd !== undefined && args.hwnd !== client.binding.hwnd) {
    throw new QtNativeTransportError("Requested window differs from the verified native session.", "stale-window");
  }
  const maxNodes = typeof args.maxNodes === "number" ? args.maxNodes : 4000;
  const read = await client.request("accessibility_snapshot", {
    maxNodes, ...(typeof args.toolTitle === "string" ? { toolTitle: args.toolTitle } : {}),
    ...(typeof args.allowedModalTitle === "string" ? { allowedModalTitle: args.allowedModalTitle } : {}),
    ...(args.withValues === false ? { withValues: false } : {}),
    ...(args.withCellStates === true ? { withCellStates: true } : {}),
    ...(Array.isArray(args.aidSuffixes) ? { aidSuffixes: args.aidSuffixes } : {}),
    ...(Array.isArray(args.aidContains) ? { aidContains: args.aidContains } : {}),
    ...(args.equalitySelectors ? { equalitySelectors: args.equalitySelectors } : {}),
  }, timeoutMs, signal);
  if (!read.result.ok) throw new QtNativeTransportError(String(read.result.error ?? "Native snapshot failed."),
    String(read.result.code ?? "native-read"), read.result.outcomeUnknown === true);
  const parsed = snapshotSchema.parse(read.result);
  const invalid = (message: string) => { throw new QtNativeTransportError(message, "native-contract"); };
  if (args.toolTitle === undefined && parsed.hwnd !== client.binding.hwnd) invalid("Snapshot returned another window.");
  if (parsed.stats.n !== parsed.nodes.length || parsed.nodes.length > maxNodes
    || (parsed.stats.depthLimited && !parsed.stats.truncated)) invalid("Inconsistent native snapshot bounds.");
  const seen = new Set<string>();
  for (const [index, node] of parsed.nodes.entries()) {
    if (node.i !== index || node.p >= index || seen.has(node.rid)
      || (node.p < 0 ? node.d !== 0 : node.d !== parsed.nodes[node.p]!.d + 1)) invalid("Invalid native snapshot tree or identity.");
    seen.add(node.rid);
    if (args.withValues === false && [node.val, node.ro, node.checked, node.selected].some(value => value !== null))
      invalid("A structural snapshot unexpectedly returned values.");
  }
  const selectors = Object.keys((args.equalitySelectors ?? {}) as Record<string, unknown>).sort();
  if (JSON.stringify(Object.keys(parsed.exactMatches).sort()) !== JSON.stringify(selectors)) invalid("Missing native selector comparisons.");
  for (const matches of Object.values(parsed.exactMatches)) {
    if (matches && (new Set(matches).size !== matches.length || matches.some(index => index >= parsed.nodes.length)))
      invalid("Invalid native selector comparison indices.");
  }
  return { ...parsed, nativeDurationMs: read.durationMs };
}

/** The bridge folds its depth bound into `truncated`; a failure names the bound that was hit so the remedy fits. */
export function nativeTreeBoundReason(stats: { depthLimited: boolean }, subject = "Der native Seitenbaum"): string {
  return stats.depthLimited ? `${subject} ist tiefer als die Lesegrenze von 16 Ebenen` : `${subject} ueberschreitet die Lesegrenze`;
}

export function qtSnapshotArguments(args: Readonly<Record<string, unknown>>, profile: ProductProfile): Record<string, unknown> {
  if (args.toolWindow === undefined) return { ...args };
  const windows = profile.pageObjectsCatalog.windows;
  const definition = Object.hasOwn(windows, String(args.toolWindow)) ? windows[String(args.toolWindow)] : undefined;
  if (!definition) throw new QtNativeTransportError("Unknown catalogued tool window.", "bad-args");
  const window = z.object({ role: z.string(), title: z.string().min(1).max(4096) }).parse(definition);
  if (!window.role.startsWith("nonmodal-")) throw new QtNativeTransportError("The catalogued window is not nonmodal.", "blocked");
  return { ...args, toolTitle: window.title };
}

export async function executeQtNativeSnapshot(
  client: QtNativeClient, args: Readonly<Record<string, unknown>>, timeoutMs: number, signal?: AbortSignal,
): Promise<WorkerResult> {
  const result = await readQtNativeSnapshot(client, args, timeoutMs, signal);
  const types = Array.isArray(args.types) ? args.types.map(value => String(value).toLowerCase()) : [];
  const nodes = result.nodes.filter(node => (!types.length || types.includes(node.type.toLowerCase())) && (!args.namedOnly || node.name));
  return {
    ok: true, backend: "qt", hwnd: result.hwnd, toolWindow: args.toolWindow ?? "", canaryMs: null,
    stats: result.stats, count: nodes.length, nodes, nativeDurationMs: result.nativeDurationMs,
    scope: result.scope, responsivenessCheck: "bounded-gui-thread",
  };
}

/** Snapshot runtime IDs also resolve through a fresh native read; no cached value or guessed QObject path. */
export async function executeQtSnapshotGetValue(
  client: QtNativeClient, args: Readonly<Record<string, unknown>>, timeoutMs: number, signal?: AbortSignal,
): Promise<WorkerResult> {
  const result = await readQtNativeSnapshot(client, { hwnd: args.hwnd, maxNodes: 5000 }, timeoutMs, signal);
  if (!result.windowEnabled || result.modalBlocked) return fail("window-obstructed", "The native window is disabled or blocked by a modal dialog.");
  if (result.stats.truncated) return fail("native-incomplete", "The current tree exceeds the native read bound.");
  const nodes = result.nodes.filter(node => node.rid === args.rid
    && (!args.aid || node.aid.endsWith(String(args.aid)))
    && (!args.type || node.type.toLowerCase() === String(args.type).toLowerCase())
    && (!args.name || (args.contains ? node.name.toLowerCase().includes(String(args.name).toLowerCase())
      : node.name.toLowerCase() === String(args.name).toLowerCase())));
  if (nodes.length !== 1) return fail("not-found", "The current native tree does not contain the selected runtime ID.");
  const node = nodes[0]!;
  if (node.val === null) return fail("no-readable-value", "The selected control does not expose a readable text value.");
  return { ok: true, backend: "qt", value: node.val, readOnly: node.ro, aufgeloestUeber: "selektor",
    node, nativeDurationMs: result.nativeDurationMs };
}
