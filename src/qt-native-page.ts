import { performance } from "node:perf_hooks";
import type { WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import { QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import { qtNativeContentBounds, qtNativeHeading } from "./qt-native-pages.js";
import { readBoundWindows, readOwnedWindowSubtrees } from "./qt-native-owned-windows.js";
import { byPosition, navigationSelection, psEquals, splitWindowScope, transmissionName } from "./qt-native-projections.js";
import { readQtNativeSnapshot, type QtSnapshotNode } from "./qt-native-snapshot.js";

/**
 * Direct Qt port of the worker's 'page' branch: one snapshot describes heading,
 * writable fields, the visible table, triggerable actions and the blocking state.
 * Every projection below mirrors the worker's PowerShell expression over the same
 * node fields, so the result contract stays byte-identical for the API callers.
 */

const fail = (kind: string, error: string): WorkerResult => ({ ok: false, backend: "qt", kind, error });
const FIELD_TYPES = new Set(["Edit", "ComboBox", "CheckBox", "RadioButton"]);
// The worker compares these with -notin, which is case-insensitive.
const CHECKER_NOISE = new Set(["Eingabehilfe", "Steuertipps", "Prüfer", "Mehr Details", "Zurzeit keine Hinweise zu diesem Dialog."]
  .map(name => name.toLowerCase()));
const TABLE_HINT = "Nur die SICHTBAREN Zeilen. Bei mehr Zeilen sse_table_read benutzen.";
const UNLABELLED_HINT = "Kein Feld dieser Seite hat eine Beschriftung - die Beschriftungsspalte liegt ausserhalb des erkannten Inhaltsbereichs. "
  + "Felder hier nur ueber rid ansprechen; ein Zugriff ueber die Beschriftung scheitert mit bad-target. "
  + "Abhilfe: Navigationsspalte einblenden oder das Fenster maximieren.";

type Bounds = ReturnType<typeof qtNativeContentBounds>;
interface PageField {
  label: string; typ: string; wert: QtSnapshotNode["checked"] | QtSnapshotNode["val"]; schreibgeschuetzt: boolean | null;
  aid: string; rid: string; y: number;
}
interface PageAction { name: string; typ: string; bereich: string; aktiviert: boolean; gesperrt: boolean; werkzeug: string }

const inContent = (node: QtSnapshotNode, bounds: Bounds) => node.x >= bounds.minX && node.x <= bounds.maxX;

/** A field's caption is the nearest named text to its left on the same screen line; a farther text never replaces a nearer one. */
function pageFields(own: readonly QtSnapshotNode[], bounds: Bounds, textMinX: number): PageField[] {
  const texts = own.filter(node => node.type === "Text" && node.name && node.x >= textMinX && node.x <= bounds.maxX);
  return own.filter(node => FIELD_TYPES.has(node.type) && inContent(node, bounds)).sort(byPosition).map(field => {
    const caption = texts.filter(text => Math.abs(text.y - field.y) <= 14 && text.x < field.x)
      .sort((a, b) => (field.x - a.x) - (field.x - b.x))[0];
    return {
      label: caption?.name || field.name,
      typ: field.type,
      wert: field.type === "CheckBox" ? field.checked : field.type === "RadioButton" ? field.selected : field.val,
      schreibgeschuetzt: field.ro,
      aid: field.aid.split(".").at(-1) ?? field.aid,
      rid: field.rid,
      y: field.y,
    };
  });
}

/** Visible table head and rows; a row starts whenever a cell lies more than 10 px below the row's first cell. */
function pageTable(own: readonly QtSnapshotNode[]) {
  const heads = own.filter(node => node.type === "Header" && node.name && node.w > 0).sort((a, b) => a.x - b.x);
  const cells = own.filter(node => node.type === "DataItem" && node.w > 0).sort(byPosition);
  const rows: { y: number; zellen: { x: number; text: string; rid: string }[] }[] = [];
  for (const cell of cells) {
    const current = rows.at(-1);
    if (!current || Math.abs(cell.y - current.y) > 10) rows.push({ y: cell.y, zellen: [] });
    rows.at(-1)!.zellen.push({ x: cell.x, text: cell.name, rid: cell.rid });
  }
  const free = rows.filter(row => !row.zellen.some(cell => cell.text && cell.text !== "0,00" && cell.text !== "0"));
  if (!heads.length && !rows.length) return null;
  return {
    kopf: heads.map(head => head.name),
    // The worker pipes each row's cell array through ForEach-Object, which unrolls it: 'zeilen' is one flat list of cell texts.
    zeilen: rows.flatMap(row => row.zellen.map(cell => cell.text)),
    sichtbareZeilen: rows.length,
    ersteFreieZeile: free.length ? free[0]!.zellen.map(cell => ({ x: cell.x, rid: cell.rid })) : null,
    hinweis: TABLE_HINT,
  };
}

/** Buttons and links by line, a link before its equally named button, deduplicated per name and area. */
function pageActions(own: readonly QtSnapshotNode[], bounds: Bounds, windowTop: number): PageAction[] {
  const candidates = own.filter(node => (node.type === "Button" || node.type === "Hyperlink") && node.name)
    .sort((a, b) => a.y - b.y || Number(a.type !== "Hyperlink") - Number(b.type !== "Hyperlink") || a.x - b.x);
  const actions: PageAction[] = [];
  for (const node of candidates) {
    const gesperrt = transmissionName(node.name);
    const bereich = node.y < windowTop + 160 ? "werkzeugleiste" : inContent(node, bounds) ? "seite" : "hilfespalte";
    if (actions.some(action => psEquals(action.name, node.name) && action.bereich === bereich)) continue;
    actions.push({
      name: node.name, typ: node.type, bereich, aktiviert: node.on, gesperrt,
      // UIA invoke works on buttons; links and tree entries need a real click.
      werkzeug: gesperrt ? "(gesperrt)" : node.type === "Button" ? "sse_click" : "sse_click_point",
    });
  }
  return actions;
}

/** Checker entries right of the content area; Select-Object -Unique keeps case-sensitive distinct names. */
function checkerMessages(own: readonly QtSnapshotNode[], bounds: Bounds): string[] {
  return [...new Set(own
    .filter(node => node.type === "TreeItem" && node.name && node.x > bounds.maxX && node.name.length < 90)
    .map(node => node.name)
    .filter(name => !CHECKER_NOISE.has(name.toLowerCase())))];
}

/** The worker's 'page' read from one fresh Qt snapshot plus the bound process's window inventory. */
export async function executeQtNativePage(
  client: QtNativeClient,
  args: Readonly<Record<string, unknown>>,
  timeoutMs: number,
  signal?: AbortSignal,
  profile?: ProductProfile,
): Promise<WorkerResult> {
  if (!profile) return fail("bad-args", "page requires a product profile.");
  if (args.hwnd !== undefined && args.hwnd !== client.binding.hwnd) {
    throw new QtNativeTransportError("Requested window differs from the verified native session.", "stale-window");
  }
  const started = performance.now();
  const budget = () => {
    const remaining = Math.floor(timeoutMs - (performance.now() - started));
    if (remaining < 1) throw new QtNativeTransportError("Native page deadline exceeded before reading.", "native-timeout");
    return remaining;
  };
  // The worker reads its dialog inventory for the bound process; this path can only prove that no
  // unknown window exists, so anything it cannot classify fails closed before the page is read.
  const bound = await readBoundWindows(client, profile, "Seite", budget, signal);
  if (bound.failure) return bound.failure;
  const { inventory, owned } = bound.windows;
  const snapshot = await readQtNativeSnapshot(client, { hwnd: args.hwnd, maxNodes: 5000 }, budget(), signal);
  if (!snapshot.windowEnabled || snapshot.modalBlocked) {
    return fail("dialog-open", "Ein modaler Dialog blockiert die gebundene Seite; keine Werte ausgegeben. Dialoge mit sse_dialog_list lesen.");
  }
  if (snapshot.stats.truncated) {
    return fail("native-incomplete", "Der native Seitenbaum ueberschreitet die Lesegrenze; keine unvollstaendige Seite ausgegeben.");
  }
  // The worker treats an empty bulk snapshot as a failed read, never as an empty page.
  if (!snapshot.nodes.length) return fail("native-incomplete", "Der native Seitenbaum ist leer; keine Seite ausgegeben.");
  const scope = splitWindowScope(snapshot.nodes);
  const own = scope.own;
  // Walk-BoundTree lists the owned windows it excluded; the Qt tree never contains them, so they are read by title.
  const ownedRead = await readOwnedWindowSubtrees(client, owned, 5000, "Seite", snapshot.nodes.length, budget, signal);
  if (ownedRead.failure) return ownedRead.failure;
  const bounds = qtNativeContentBounds(own, snapshot.windowRect);
  // Get-CaptionMinX: without a recognised navigation tree the caption column lies left of the guessed content edge.
  const textMinX = bounds.navErkannt ? bounds.minX : bounds.winX;
  const ueberschrift = qtNativeHeading(own, profile);
  const felder = pageFields(own, bounds, textMinX);
  const tabelle = pageTable(own);
  const aktionen = pageActions(own, bounds, snapshot.windowRect.y);
  const prueferMeldungen = checkerMessages(own, bounds);
  const leerePflichtfelder = felder.filter(field => field.typ === "ComboBox" && !String(field.wert ?? "").trim()).map(field => field.label);
  // Every field unlabelled means the caption column was not found; that must not pass silently.
  const hinweis = felder.length && felder.every(field => !String(field.label ?? "").trim()) ? UNLABELLED_HINT : null;
  // Get-Windows counts every visible window of the process, titled or not; the classified list above is narrower.
  const offeneFenster = inventory.visibleWindowCount;
  return {
    hinweis,
    ok: true,
    ueberschrift,
    ueberschriftQuelle: ueberschrift === null ? "nicht-gefunden" : "clientHeader",
    navigationAuswahl: navigationSelection(own),
    ausgeschlosseneFenster: [...scope.foreign, ...ownedRead.subtrees.scopes],
    felder,
    tabelle,
    aktionen,
    blockiert: prueferMeldungen.length > 0 || offeneFenster > 2,
    prueferMeldungen,
    leerePflichtfelder,
    // Unknown windows and modal dialogs already failed closed above; only catalogued auxiliary windows remain.
    dialoge: [],
    offeneFenster,
    stats: snapshot.stats,
    backend: "qt",
    nativeDurationMs: inventory.durationMs + snapshot.nativeDurationMs + ownedRead.subtrees.durationMs,
  };
}
