import { z } from "zod";
import type { WorkerResult } from "./api-contract.js";
import { QtNativeClient, QtNativeTransportError } from "./qt-native-client.js";

const NODE = z.object({
  id: z.number().int().positive(),
  parentId: z.number().int().nonnegative(),
  class: z.string(),
  name: z.string(),
  kind: z.string().optional(),
  visible: z.boolean().optional(),
  enabled: z.boolean().optional(),
  value: z.string().optional(),
  readOnly: z.boolean().optional(),
  sensitive: z.boolean().optional(),
  checkable: z.boolean().optional(),
}).passthrough();
const OBJECTS = z.object({
  ok: z.literal(true), complete: z.literal(true), controllerBound: z.literal(true),
  projection: z.literal("values"), visibleOnly: z.literal(true),
  windowEnabled: z.boolean(), modalBlocked: z.boolean(), objects: z.array(NODE).max(50_000),
});
type NativeNode = z.infer<typeof NODE>;

function controlType(node: NativeNode): string | null {
  if (["lineEdit", "spinBox", "plainTextEdit"].includes(node.kind ?? "")) return "Edit";
  if (node.kind === "label") return "Text";
  if (node.kind === "comboBox") return "ComboBox";
  if (node.kind === "button") return node.checkable ? "CheckBox" : "Button";
  return null;
}

function failure(kind: string, error: string): WorkerResult { return { ok: false, kind, error }; }

/** Read a fresh Qt value-control projection; no values survive between calls. */
export async function executeQtNativeGetValue(
  client: QtNativeClient,
  args: Readonly<Record<string, unknown>>,
  timeoutMs = 5_000,
  signal?: AbortSignal,
): Promise<WorkerResult> {
  if (args.hwnd !== undefined && args.hwnd !== client.binding.hwnd) {
    return failure("stale-window", "Requested window differs from the verified native session.");
  }
  if (![args.name, args.aid, args.rid].some(value => typeof value === "string" && value.length > 0)) {
    return failure("bad-args", "get_value requires name, aid or rid.");
  }
  try {
    const read = await client.request("objects", { projection: "values", visibleOnly: true }, timeoutMs, signal);
    if (!read.result.ok) return { ...read.result, kind: String(read.result.code ?? "native-read"), backend: "qt" };
    const parsed = OBJECTS.parse(read.result);
    if (!parsed.windowEnabled || parsed.modalBlocked) {
      return failure("window-obstructed", "The bound native window is disabled or blocked by a modal dialog.");
    }
    const rid = (node: NativeNode) => `qt:${client.binding.pid}:${client.binding.creationTime}:${client.binding.hwnd}:${node.id}`;
    const nodes = parsed.objects.filter(node => node.visible && controlType(node));
    const candidates = nodes.filter(node => {
      if (typeof args.aid === "string" && args.aid
        && (!node.name || (!args.aid.endsWith(node.name) && !node.name.endsWith(args.aid)))) return false;
      if (typeof args.rid === "string" && args.rid && args.rid !== rid(node)) return false;
      if (typeof args.type === "string" && args.type && controlType(node)?.toLowerCase() !== args.type.toLowerCase()) return false;
      if (typeof args.name === "string" && args.name) {
        const label = (node.value ?? "").toLowerCase();
        const sought = args.name.toLowerCase();
        if (args.contains ? !label.includes(sought) : label !== sought) return false;
      }
      return true;
    });
    if (candidates.length === 0) return failure("not-found", "No native control matches the selector.");
    if (candidates.length !== 1) return failure("ambiguous", "Native control selector is not unique.");
    let selected = candidates[0]!;
    let resolvedVia = "selektor";
    if (selected.kind === "label" && args.name && !args.aid && !args.rid) {
      const fields = nodes.filter(node => node.parentId === selected.parentId
        && ["lineEdit", "spinBox", "plainTextEdit", "comboBox"].includes(node.kind ?? ""));
      if (fields.length !== 1) {
        return failure(fields.length ? "ambiguous" : "not-found", "The observed Qt label has no unique value control in its group.");
      }
      selected = fields[0]!;
      resolvedVia = "beschriftung";
    }
    if (selected.sensitive || !["lineEdit", "spinBox", "plainTextEdit", "comboBox"].includes(selected.kind ?? "")
      || typeof selected.value !== "string") {
      return failure("no-readable-value", "The selected native control does not expose a readable text value.");
    }
    return {
      ok: true,
      backend: "qt",
      value: selected.value,
      readOnly: selected.readOnly ?? null,
      aufgeloestUeber: resolvedVia,
      node: {
        type: controlType(selected), name: selected.value, val: selected.value,
        aid: selected.name, rid: rid(selected), enabled: selected.enabled,
        nativeClass: selected.class,
      },
      nativeDurationMs: read.durationMs,
    };
  } catch (error) {
    if (error instanceof QtNativeTransportError) {
      return { ...failure(error.kind, error.message), outcomeUnknown: error.outcomeUnknown, backend: "qt" };
    }
    return failure("native-contract", error instanceof Error ? error.message : "Invalid native object response.");
  }
}
