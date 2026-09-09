import { z } from "zod";
import type { WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import { QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import { readQtNativeSnapshot, type QtSnapshotNode } from "./qt-native-snapshot.js";

const byPosition = (a: QtSnapshotNode, b: QtSnapshotNode) => a.y - b.y || a.x - b.x;
// PowerShell's [int] conversion uses midpoint-to-even rounding, including negative coordinates.
function roundEven(value: number): number {
  const floor = Math.floor(value);
  return value - floor === 0.5 ? floor + (Math.abs(floor) % 2) : Math.round(value);
}
function contentBounds(nodes: QtSnapshotNode[], rect: { x: number; w: number }) {
  const nav = nodes.filter(node => node.type === "Tree" && node.w > 100).sort((a, b) => a.x - b.x)[0];
  const minX = nav ? nav.x + nav.w + 5 : roundEven(rect.x + rect.w * 0.28);
  const help = nodes.filter(node => ["eingabehilfe", "steuertipps"].includes(node.name.toLowerCase()) && node.x > minX)
    .sort((a, b) => a.x - b.x)[0];
  return { minX, maxX: help ? help.x - 10 : roundEven(rect.x + rect.w * 0.79), winX: rect.x, winW: rect.w, navErkannt: !!nav };
}
function heading(nodes: QtSnapshotNode[], profile?: ProductProfile): string | null {
  const parsed = z.object({ headingContainerAutomationIdSuffix: z.string().min(1) }).safeParse(profile?.pageObjectsCatalog.windows.main);
  if (!parsed.success) throw new QtNativeTransportError("Page catalogue has no heading container selector.", "invalid-catalog");
  const containers = nodes.filter(node => node.aid.endsWith(parsed.data.headingContainerAutomationIdSuffix));
  if (containers.length !== 1) return null;
  const descendants = new Set([containers[0]!.i]);
  const texts: QtSnapshotNode[] = [];
  for (const node of nodes) {
    if (descendants.has(node.p)) {
      descendants.add(node.i);
      if (node.type === "Text") texts.push(node);
    }
  }
  return texts.sort(byPosition)[0]?.name ?? null;
}

export async function executeQtNativeReadPage(
  client: QtNativeClient, args: Readonly<Record<string, unknown>>, timeoutMs: number, signal?: AbortSignal, profile?: ProductProfile,
): Promise<WorkerResult> {
  const result = await readQtNativeSnapshot(client, args, timeoutMs, signal);
  const bounds = contentBounds(result.nodes, result.windowRect);
  const minX = typeof args.minX === "number" ? args.minX : bounds.minX;
  const maxX = typeof args.maxX === "number" ? args.maxX : bounds.maxX;
  const keep = new Set(["Text", "DataItem", "Edit", "CheckBox", "Header", "RadioButton", "Button", "Hyperlink", "ComboBox"]);
  const rows = result.nodes.filter(node => (node.name || node.val?.trim()) && node.x >= minX && node.x <= maxX && keep.has(node.type)).sort(byPosition);
  const lines: { y: number; cells: string[] }[] = [];
  let anchor: QtSnapshotNode | undefined;
  for (const node of rows) {
    const overlap = anchor ? Math.min(node.y + node.h, anchor.y + anchor.h) - Math.max(node.y, anchor.y) : 0;
    if (!anchor || (Math.abs(node.y - anchor.y) > 12 && overlap <= Math.max(1, Math.min(node.h, anchor.h)) / 2)) {
      anchor = node;
      lines.push({ y: node.y, cells: [] });
    }
    lines.at(-1)!.cells.push(node.val?.trim() ? (node.name ? `${node.name} = ${node.val}` : node.val) : node.name);
  }
  return { ok: true, backend: "qt", heading: heading(result.nodes, profile), bounds, lines, stats: result.stats,
    nativeDurationMs: result.nativeDurationMs };
}

/** Same transmission-name boundary as Test-Versand; this projection never offers a blocked action. */
function transmissionName(name: string): boolean {
  const normalized = name.toLowerCase().replaceAll("ä", "a").replaceAll("ö", "o").replaceAll("ü", "u").replaceAll("ß", "ss")
    .replace(/[^\p{L}\p{N}]/gu, "");
  return ["elster", "versend", "versand", "ubermittl", "ubermittel", "abschick", "nachreich", "abschliess", "datenubertrag", "transfer"]
    .some(stem => normalized.includes(stem)) || normalized.startsWith("senden");
}

export async function executeQtNativeSubpages(
  client: QtNativeClient, args: Readonly<Record<string, unknown>>, timeoutMs: number, signal?: AbortSignal,
): Promise<WorkerResult> {
  const result = await readQtNativeSnapshot(client, args, timeoutMs, signal);
  const bounds = contentBounds(result.nodes, result.windowRect);
  if (result.stats.truncated) throw new QtNativeTransportError("The subpage tree exceeds the native read bound.", "native-incomplete");
  const pageNodes = result.nodes.filter(node => node.aid.toLowerCase().includes(".redthreadcontent.") && node.x >= bounds.minX && node.x <= bounds.maxX);
  const texts = pageNodes.filter(node => node.type === "Text" && node.name), values = pageNodes.filter(node => node.type === "Edit");
  const buttons = pageNodes.filter(node => (node.type === "Button" && (node.name || node.aid.toLowerCase().endsWith(".button")))
    || (node.type === "Hyperlink" && node.name))
    .filter(node => !["zurück", "weiter"].includes(node.name.toLowerCase()))
    .sort((a, b) => a.y - b.y || Number(a.type !== "Hyperlink") - Number(b.type !== "Hyperlink") || a.x - b.x);
  const seen = new Set<string>();
  const subpages: Record<string, unknown>[] = [];
  for (const button of buttons) {
    if (transmissionName(button.name)) continue;
    const caption = texts.filter(node => node.p === button.p).sort((a, b) => a.x - b.x)[0]
      ?? texts.filter(node => Math.abs(node.y - button.y) <= 14 && node.x < button.x).sort((a, b) => b.x - a.x)[0];
    const value = values.filter(node => node.p === button.p).sort((a, b) => a.x - b.x)[0];
    const name = button.name || "Öffnen", key = `${name}|${caption?.name ?? ""}|${button.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    subpages.push({ schalter: name, fuehrt_zu: caption?.name ?? null, wert: value?.val ?? null, typ: button.type,
      aktiviert: button.on, aid: button.aid, rid: button.rid, y: button.y,
      werkzeug: button.type === "Button" ? "sse_click (rid)" : "sse_click_point (nicht versteckt)" });
  }
  return { ok: true, backend: "qt", anzahl: subpages.length, unterseiten: subpages, nativeDurationMs: result.nativeDurationMs,
    hinweis: "Hyperlinks sind bei doppelt exponierten Qt-Unterseiten der bevorzugte, PID-/Root-verifizierte Weg per sse_click_point. "
      + "Reine oder unbeschriftete Buttons per rid mit sse_click oeffnen. "
      + "Zurueck ueber sse_click name='Zurück' oder den Verlaufspfeil (aid HistoryToolbarBtnSSE)." };
}
