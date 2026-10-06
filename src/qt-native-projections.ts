import { createHash } from "node:crypto";
import { z } from "zod";
import type { ProductProfile } from "./product-profiles.js";
import { QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import type { QtSnapshotNode } from "./qt-native-snapshot.js";

/**
 * Pure projections shared by the direct Qt read handlers. Each function mirrors
 * a worker helper over an already observed node set; none of them touches a
 * window, a pipe or a product process.
 */

export const byPosition = (a: QtSnapshotNode, b: QtSnapshotNode) => a.y - b.y || a.x - b.x;

/** Windows PowerShell `-eq` compares strings case-insensitively. */
export const psEquals = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/** Match Windows PowerShell 5.1 `ConvertTo-Json -Compress` bytes for the same property order. */
export function powershellCompactJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Fingerprint value is not JSON serializable.");
  // JavaScriptStringEncode also escapes U+0085 (NEL) besides the two Unicode line separators.
  return serialized.replace(/[&<>'\u0085\u2028\u2029]/gu,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Same bytes as the worker's Get-SSETextSha256: UTF-8 text, upper-case hex. */
export const textSha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex").toUpperCase();

const VERSAND = [
  "ELSTER", "Anmeldungen versenden", "Jahreserklärungen abschließen",
  "Belege nachreichen", "Kommunikation mit dem Finanzamt per ELSTER",
  "Senden", "Senden & Drucken", "Versenden", "Übermitteln", "Steuerdaten versenden",
  "Abschicken", "Elektronische Steuererklärung (ELSTER)",
];
const comparableForm = (text: string) => text.replaceAll("…", "").replaceAll("...", "").replaceAll("&", "").toLowerCase()
  .replaceAll("ä", "a").replaceAll("ö", "o").replaceAll("ü", "u").replaceAll("ß", "ss").replace(/[^\p{L}\p{N}]/gu, "");
const VERSAND_FORMS = new Set(VERSAND.map(comparableForm));

/** Same transmission boundary as the worker's Test-Versand; a projection never offers such an action as usable. */
export function transmissionName(name: string): boolean {
  if (!name) return false;
  const normalized = comparableForm(name);
  if (!normalized) return false;
  if (VERSAND_FORMS.has(normalized)) return true;
  return ["elster", "versend", "versand", "ubermittl", "ubermittel", "abschick", "nachreich", "abschliess", "datenubertrag", "transfer"]
    .some(stem => normalized.includes(stem)) || normalized.startsWith("senden");
}

/** Exactly one node whose automation ID ends with the suffix (optionally of one control type); ambiguity binds nothing. */
export function findContainerNode(nodes: readonly QtSnapshotNode[], aidSuffix: string, containerType = ""): QtSnapshotNode | null {
  if (!aidSuffix) return null;
  const hits = nodes.filter(node => (!containerType || node.type === containerType) && node.aid && node.aid.endsWith(aidSuffix));
  return hits.length === 1 ? hits[0]! : null;
}

/** All descendants of the uniquely bound container with the requested control type, sorted by y then x. */
export function containerDescendants(
  nodes: readonly QtSnapshotNode[], aidSuffix: string, childType: string, containerType = "",
): QtSnapshotNode[] {
  const container = findContainerNode(nodes, aidSuffix, containerType);
  if (!container) return [];
  const inSubtree = new Set([container.i]);
  const hits: QtSnapshotNode[] = [];
  for (const node of nodes) {
    if (node.i === container.i || !inSubtree.has(node.p)) continue;
    inSubtree.add(node.i);
    if (node.type === childType) hits.push(node);
  }
  return hits.sort(byPosition);
}

export function containerChild(nodes: readonly QtSnapshotNode[], aidSuffix: string, childType: string): QtSnapshotNode | null {
  return containerDescendants(nodes, aidSuffix, childType)[0] ?? null;
}

/** Name of the uniquely selected navigation entry; a missing or ambiguous selection is null, never guessed. */
export function navigationSelection(nodes: readonly QtSnapshotNode[]): string | null {
  const selected = nodes.filter(node => node.type === "TreeItem" && node.selected === true);
  return selected.length === 1 ? selected[0]!.name : null;
}

/** The enabled state of the main toolbar save button; null when the button is not part of the observed tree. */
export function dirtyState(nodes: readonly QtSnapshotNode[]): boolean | null {
  const save = nodes.find(node => node.type === "Button" && node.aid.endsWith(".MainToolBar.tb_sichern"));
  return save ? save.on : null;
}

export interface ForeignWindowScope {
  rid: string; name: string; aid: string; x: number; y: number; w: number; h: number; nodeCount: number;
}

/**
 * Separate the bound window's own content from the subtrees of other windows.
 * The snapshot is in pre-order, so a parent index is always smaller than its
 * child's; one forward pass marks every foreign window root and its descendants.
 */
export function splitWindowScope(nodes: readonly QtSnapshotNode[], keepRid = ""): { own: QtSnapshotNode[]; foreign: ForeignWindowScope[] } {
  const rootOf = new Map<number, number>();
  const foreignRoots = new Map<number, ForeignWindowScope>();
  const order: number[] = [];
  const own: QtSnapshotNode[] = [];
  for (const node of nodes) {
    const parentForeign = rootOf.has(node.p);
    const foreignWindow = node.type === "Window" && (!keepRid || node.rid !== keepRid);
    if (!parentForeign && !foreignWindow) { own.push(node); continue; }
    let rootIndex: number;
    if (parentForeign) rootIndex = rootOf.get(node.p)!;
    else {
      rootIndex = node.i;
      foreignRoots.set(node.i, { rid: node.rid, name: node.name, aid: node.aid, x: node.x, y: node.y, w: node.w, h: node.h, nodeCount: 0 });
      order.push(node.i);
    }
    rootOf.set(node.i, rootIndex);
    foreignRoots.get(rootIndex)!.nodeCount += 1;
  }
  return { own, foreign: order.map(index => foreignRoots.get(index)!) };
}

export const CHECKER_TREE_SUFFIX = "PrueferWidgetSSE.SteuerPruefer";

export interface CheckerItem { text: string; rid: string; y: number; aktiviert: boolean; aufgeklappt: boolean }
export interface CheckerResults {
  aktiv: boolean; leer: boolean;
  fragenWarnungenAngekuendigt: number; tippsAngekuendigt: number;
  fragenWarnungenGruppeGesehen: boolean; tippsGruppeGesehen: boolean;
  fragenWarnungen: CheckerItem[]; tippsZusatzinfos: CheckerItem[]; sonstige: CheckerItem[];
  gesamt: number; aufgeklappt: string[];
}

export function checkerTreeItems(nodes: readonly QtSnapshotNode[]): QtSnapshotNode[] {
  return containerDescendants(nodes, CHECKER_TREE_SUFFIX, "TreeItem", "Tree").filter(node => node.name);
}

/** The global checker's grouped result list as the worker projects it from one tree. */
export function checkerResults(nodes: readonly QtSnapshotNode[]): CheckerResults {
  const checkerTree = findContainerNode(nodes, CHECKER_TREE_SUFFIX, "Tree");
  const allItems = containerDescendants(nodes, CHECKER_TREE_SUFFIX, "TreeItem", "Tree");
  const raw = checkerTreeItems(nodes).sort(byPosition);
  if (!raw.length) {
    // A uniquely bound tree proves the checker is open. No descendants at all is
    // a finished empty result; unnamed items keep the result active but inconsistent.
    return {
      aktiv: checkerTree !== null, leer: checkerTree !== null && allItems.length === 0,
      fragenWarnungenAngekuendigt: 0, tippsAngekuendigt: 0, fragenWarnungenGruppeGesehen: false, tippsGruppeGesehen: false,
      fragenWarnungen: [], tippsZusatzinfos: [], sonstige: [], gesamt: 0, aufgeklappt: [],
    };
  }
  const left = Math.min(...raw.map(node => node.x));
  const top = raw.filter(node => node.x <= left + 6);
  const details = raw.filter(node => node.x > left + 6 && node.h >= 70);
  const warn: CheckerItem[] = [], tips: CheckerItem[] = [], other: CheckerItem[] = [];
  let group = "sonstige", warnDeclared = 0, tipsDeclared = 0, warnSeen = false, tipsSeen = false;
  for (const node of top) {
    // .NET's `$` also matches before one final newline; JavaScript's does not without the explicit alternative.
    const warnHeader = /^(\d+)\s+Fragen oder Warnungen\n?$/iu.exec(node.name);
    if (warnHeader) { warnDeclared = Number(warnHeader[1]); warnSeen = true; group = "fragenWarnungen"; continue; }
    const tipsHeader = /^(\d+)\s+Tipps oder Zusatzinformationen\n?$/iu.exec(node.name);
    if (tipsHeader) { tipsDeclared = Number(tipsHeader[1]); tipsSeen = true; group = "tippsZusatzinfos"; continue; }
    const item: CheckerItem = {
      text: node.name, rid: node.rid, y: node.y, aktiviert: node.on,
      aufgeklappt: details.some(detail => psEquals(detail.name, node.name)),
    };
    if (group === "fragenWarnungen") warn.push(item);
    else if (group === "tippsZusatzinfos") tips.push(item);
    else other.push(item);
  }
  return {
    aktiv: true, leer: false,
    fragenWarnungenAngekuendigt: warnDeclared, tippsAngekuendigt: tipsDeclared,
    fragenWarnungenGruppeGesehen: warnSeen, tippsGruppeGesehen: tipsSeen,
    fragenWarnungen: warn, tippsZusatzinfos: tips, sonstige: other,
    gesamt: warn.length + tips.length + other.length,
    aufgeklappt: [...new Set(details.map(detail => detail.name))],
  };
}

export function checkerResultComplete(result: CheckerResults): boolean {
  return result.aktiv && ((result.leer && result.gesamt === 0) || (
    result.fragenWarnungenGruppeGesehen && result.tippsGruppeGesehen
    && result.fragenWarnungenAngekuendigt === result.fragenWarnungen.length
    && result.tippsAngekuendigt === result.tippsZusatzinfos.length));
}

/** German money/percent display normalised to decimal text; unparsable text is skipped, never treated as zero. */
export function comparableDecimalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/gu, "").replaceAll(".", "").replaceAll(",", ".").replace(/[^0-9+\-.]/gu, "");
  if (!text || ["+", "-", "."].includes(text)) return null;
  return Number.isFinite(Number(text)) ? text : null;
}

/** German money/percent display to a comparable number; unparsable text is skipped, never treated as zero. */
export function comparableNumber(value: unknown): number | null {
  const text = comparableDecimalText(value);
  return text === null ? null : Number(text);
}

/** The decimal text as an integer count of 10^-scale units, exact like a [decimal] value. */
function scaledDecimal(text: string, scale: number): bigint {
  const negative = text.startsWith("-");
  const [whole = "", fraction = ""] = text.replace(/^[+-]/u, "").split(".");
  const magnitude = BigInt(`${whole || "0"}${fraction.padEnd(scale, "0").slice(0, scale)}`);
  return negative ? -magnitude : magnitude;
}

/** Convert-SSEComparableNumber parity: (aktuell - festgehalten) - differenz in exact decimal, cast to double at the end. */
export function comparisonInvariantResidual(actual: string, held: string, difference: string): number {
  const scale = Math.max(...[actual, held, difference].map(text => (text.split(".")[1] ?? "").length));
  const residual = scaledDecimal(actual, scale) - scaledDecimal(held, scale) - scaledDecimal(difference, scale);
  const digits = (residual < 0n ? -residual : residual).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale), fraction = digits.slice(digits.length - scale);
  return Number(`${residual < 0n ? "-" : ""}${whole}${scale ? `.${fraction}` : ""}`);
}

export interface ResultDetailRow { beobachteterWert: string; aktuell: string; festgehalten: string; differenz: string }
export interface ResultDetails {
  verfuegbar: boolean; fensterOffen: boolean; anzahl: number; vollstaendig: boolean; zeilen: ResultDetailRow[];
  unvollstaendigeZeilen: { y: number; cells: string[] }[]; nichtPositionierteZellenAnzahl: number;
  uiaKopfzeilen: string[]; kopfVollstaendig: boolean; vergleichsInvariantGeprueft: number;
  vergleichsInvariantFehler: ResultDetailRow[]; vertikalUnvollstaendig: boolean; fingerprint: string | null; hinweis: string;
}

const RESULT_TABLE_SUFFIX = "obj_Wertetabelle";

/** The Werte-Info comparison table as Read-ResultDetailsFromTree projects it from one observed tree. */
/**
 * Read-ResultDetailsFromTree parity. The worker's tree contains the owned Werte-Info, so the
 * table container alone proves the window; a caller that read the window's own tree passes
 * the inventory's proof instead, and a tree without the table is then 'open but unreadable'.
 */
export function resultDetailsFromNodes(
  nodes: readonly QtSnapshotNode[], stats: { truncated: boolean; cyc: number }, windowKnownOpen = false,
): ResultDetails {
  const allData = containerDescendants(nodes, RESULT_TABLE_SUFFIX, "DataItem", "Table");
  const unpositioned = allData.filter(node => node.w <= 0 || node.h <= 0);
  const data = allData.filter(node => node.w > 0 && node.h > 0).sort(byPosition);
  const headers = containerDescendants(nodes, RESULT_TABLE_SUFFIX, "Header", "Table")
    .filter(node => node.w > 0 && node.h > 0).sort((a, b) => a.x - b.x).map(node => node.name);
  const table = findContainerNode(nodes, RESULT_TABLE_SUFFIX, "Table");
  // Qt's UIA provider exposes no scroll pattern for item views, so the worker observes a null
  // scroll state here as well and can only report an incomplete vertical range when one exists.
  const scrollIncomplete = table !== null && table.scroll !== null;
  const windowOpen = table !== null || windowKnownOpen;
  if (!data.length) {
    return {
      verfuegbar: false, fensterOffen: windowOpen, anzahl: 0, vollstaendig: false, zeilen: [], unvollstaendigeZeilen: [],
      nichtPositionierteZellenAnzahl: unpositioned.length, uiaKopfzeilen: headers, kopfVollstaendig: headers.length === 4,
      vergleichsInvariantGeprueft: 0, vergleichsInvariantFehler: [], vertikalUnvollstaendig: scrollIncomplete, fingerprint: null,
      hinweis: windowOpen
        ? "Werte-Info ist offen, aber die Qt-Tabelle war in diesem Snapshot nicht lesbar."
        : "Werte-Info ist nicht offen. Einmal sse_result_details aufrufen; danach liest sse_ui_state die Werte ohne weiteren Fensterwechsel mit.",
    };
  }
  const groups = new Map<number, QtSnapshotNode[]>();
  for (const node of data) groups.set(node.y, [...(groups.get(node.y) ?? []), node]);
  const rows: ResultDetailRow[] = [], malformed: { y: number; cells: string[] }[] = [], invariantErrors: ResultDetailRow[] = [];
  let invariantChecked = 0;
  for (const y of [...groups.keys()].sort((a, b) => a - b)) {
    const cells = [...groups.get(y)!].sort((a, b) => a.x - b.x);
    if (cells.length !== 4) { malformed.push({ y, cells: cells.map(cell => cell.name) }); continue; }
    const row: ResultDetailRow = {
      beobachteterWert: cells[0]!.name, aktuell: cells[1]!.name, festgehalten: cells[2]!.name, differenz: cells[3]!.name,
    };
    rows.push(row);
    const actual = comparableDecimalText(row.aktuell), held = comparableDecimalText(row.festgehalten);
    const difference = comparableDecimalText(row.differenz);
    if (actual !== null && held !== null && difference !== null) {
      invariantChecked += 1;
      // The worker subtracts [decimal] values exactly and only casts the residual to double for the bound.
      if (Math.abs(comparisonInvariantResidual(actual, held, difference)) > 0.011) invariantErrors.push({ ...row });
    }
  }
  const complete = rows.length > 0 && !malformed.length && !unpositioned.length && headers.length === 4
    && !scrollIncomplete && !invariantErrors.length && !stats.truncated && !stats.cyc;
  // The worker pipes the row array into ConvertTo-Json: a single row serializes as one object.
  const fingerprintBody = powershellCompactJson(rows.length === 1 ? rows[0] : rows);
  return {
    verfuegbar: rows.length > 0, fensterOffen: windowOpen, anzahl: rows.length, vollstaendig: complete, zeilen: rows,
    unvollstaendigeZeilen: malformed, nichtPositionierteZellenAnzahl: unpositioned.length,
    uiaKopfzeilen: headers, kopfVollstaendig: headers.length === 4,
    vergleichsInvariantGeprueft: invariantChecked, vergleichsInvariantFehler: invariantErrors,
    vertikalUnvollstaendig: scrollIncomplete, fingerprint: rows.length ? textSha256(fingerprintBody) : null,
    hinweis: "Aktuell ist der gegenwaertige Wert; festgehalten ist der Vergleichsstand; Differenz ist die Wirkung gegen diesen Stand.",
  };
}

const processWindowSchema = z.object({
  hwnd: z.number().int().positive(),
  /** Enumeration (Z) order among the listed windows; Get-Windows breaks equal areas by it. */
  order: z.number().int().nonnegative(),
  pid: z.number().int().positive(),
  class: z.string().min(1).max(255),
  title: z.string().min(1).max(4095),
  x: z.number().int().safe(),
  y: z.number().int().safe(),
  w: z.number().int().nonnegative(),
  h: z.number().int().nonnegative(),
  minimized: z.boolean(),
  hung: z.boolean(),
}).strict();
export const processWindowInventorySchema = z.object({
  ok: z.literal(true),
  windows: z.array(processWindowSchema).max(256),
  /** Visible untitled windows that are no shadow windows; a title cannot classify them. */
  untitledWindows: z.array(processWindowSchema.omit({ title: true })).max(256),
  /** Every visible top-level window of the process, including untitled, shadow and tooltip windows. */
  visibleWindowCount: z.number().int().nonnegative(),
  /** The same population across every process whose executable and folder names match: what Get-Windows 'SSE' counts. */
  productWindowCount: z.number().int().nonnegative(),
}).passthrough();
export type QtProcessWindow = z.infer<typeof processWindowSchema>;
export type QtUntitledWindow = Omit<QtProcessWindow, "title">;

/** The bound process's visible titled top-level windows, read through Win32 inside the product process. */
export async function readProcessWindowInventory(
  client: QtNativeClient, timeoutMs: number, signal?: AbortSignal,
): Promise<{
  windows: QtProcessWindow[]; untitledWindows: QtUntitledWindow[]; visibleWindowCount: number; productWindowCount: number; durationMs: number;
}> {
  const measured = await client.request("window_inventory", {}, timeoutMs, signal);
  if (!measured.result.ok) {
    throw new QtNativeTransportError(String(measured.result.error ?? "Native window inventory failed."),
      String(measured.result.code ?? "native-read"), measured.result.outcomeUnknown === true);
  }
  const parsed = processWindowInventorySchema.safeParse(measured.result);
  if (!parsed.success) throw new QtNativeTransportError("The process window inventory is incomplete or invalid.", "native-contract");
  if (parsed.data.visibleWindowCount < parsed.data.windows.length + parsed.data.untitledWindows.length
    || parsed.data.productWindowCount < parsed.data.visibleWindowCount) {
    throw new QtNativeTransportError("The process window inventory counts fewer windows than it lists.", "native-contract");
  }
  return {
    windows: parsed.data.windows, untitledWindows: parsed.data.untitledWindows,
    visibleWindowCount: parsed.data.visibleWindowCount, productWindowCount: parsed.data.productWindowCount, durationMs: measured.durationMs,
  };
}

export const WERTE_INFO_TITLE = "Werte-Info: Werte vergleichen - Was wäre wenn";
export const TIPS_TITLE = "Steuer-Spar-Tipps";

const CLOSABLE_NONMODAL_ROLES = new Set(["nonmodal-help-window", "nonmodal-result-window", "nonmodal-tool-window"]);

/** The worker recognizes small Windows input indicators by class and size, even without a title. */
export function isSystemOverlay(window: { class: string; w: number; h: number }): boolean {
  return /^UAC[ _]/iu.test(window.class) && window.w <= 80 && window.h <= 80;
}

/**
 * Resolve-SSEToolWindowKind, the UAC overlay rule, the dialog descriptor's
 * 'main' rule for a second wide case window and the worker's closable nonmodal
 * window policy (role, close policy and case-sensitive title). Any other
 * window of the bound process is a dialog candidate this path cannot
 * describe, so callers must treat null as unknown.
 */
export function auxiliaryWindowKind(
  window: { title: string; class: string; w: number; h: number; minimized: boolean }, profile?: ProductProfile,
): "werte-info" | "steuer-tipps" | "system-overlay" | "case-window" | "known-nonmodal" | null {
  if (psEquals(window.title, WERTE_INFO_TITLE) && window.w <= 900 && window.h <= 700) return "werte-info";
  if (psEquals(window.title, TIPS_TITLE) && window.w <= 850 && window.h <= 650) return "steuer-tipps";
  if (isSystemOverlay(window)) return "system-overlay";
  if ((window.w >= 900 || window.minimized) && /SteuerSparErklärung/iu.test(window.title)) return "case-window";
  const catalogued = Object.values(profile?.pageObjectsCatalog.windows ?? {}).some(definition => {
    // The worker reads [string]$definition.role of a null entry as '' and skips it; a non-object is no window here either.
    if (typeof definition !== "object" || definition === null) return false;
    const entry = definition as Record<string, unknown>;
    return typeof entry.role === "string" && CLOSABLE_NONMODAL_ROLES.has(entry.role)
      && entry.closePolicy === "allow-exact-nonmodal-close" && typeof entry.title === "string" && window.title === entry.title;
  });
  return catalogued ? "known-nonmodal" : null;
}

/** The worker's window enumerator orders by area, largest first; the handle breaks ties deterministically. */
export function byWindowArea<T extends { order: number; w: number; h: number }>(left: T, right: T): number {
  return right.w * right.h - left.w * left.h || left.order - right.order;
}
