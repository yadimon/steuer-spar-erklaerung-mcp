import type { WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import { QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import {
  auxiliaryWindowKind, readProcessWindowInventory, type ForeignWindowScope, type QtProcessWindow,
} from "./qt-native-projections.js";
import { nativeTreeBoundReason, readQtNativeSnapshot, type QtSnapshotNode } from "./qt-native-snapshot.js";

/**
 * Shared window binding for the direct Qt page reads. The worker's UIA walk of
 * the bound main window also contains every owned nonmodal window, and its
 * dialog inventory names each dialog of the process. The Qt tree contains
 * neither, so a page read first binds the Win32 inventory of the process: a
 * window this path cannot describe ends the read, and the catalogued owned
 * windows are read through their titles so their subtrees can be listed or
 * merged exactly where the worker would have seen them.
 */

const fail = (kind: string, error: string): WorkerResult => ({ ok: false, backend: "qt", kind, error });

export interface MainWindowBinding {
  inventory: Awaited<ReturnType<typeof readProcessWindowInventory>>;
  main: QtProcessWindow;
}

export interface BoundWindows extends MainWindowBinding {
  /** Owned catalogued windows in inventory order; a second case window or a system overlay is not owned. */
  owned: QtProcessWindow[];
}

/** Bind the process inventory to the session's main window as Resolve-Window does, without restoring it. */
export async function readMainWindowBinding(
  client: QtNativeClient, budget: () => number, signal?: AbortSignal,
): Promise<{ failure: WorkerResult; binding?: undefined } | { failure?: undefined; binding: MainWindowBinding }> {
  const inventory = await readProcessWindowInventory(client, budget(), signal);
  const main = inventory.windows.find(window => window.hwnd === client.binding.hwnd);
  if (!main) return { failure: fail("stale-window", "Das angegebene hwnd ist kein aktuelles Hauptfenster.") };
  if (main.pid !== client.binding.pid) throw new QtNativeTransportError("The bound main window belongs to another process.", "native-contract");
  // The worker restores a minimized main window before reading; this read-only path never moves a window.
  if (main.minimized) {
    return { failure: fail("minimized", "Das gebundene SSE-Hauptfenster ist minimiert; der direkte Qt-Pfad stellt es nicht wieder her.") };
  }
  return { binding: { inventory, main } };
}

/** Bind the process inventory to the session's main window, failing closed on anything the path cannot describe. */
export async function readBoundWindows(
  client: QtNativeClient, profile: ProductProfile, subject: string, budget: () => number, signal?: AbortSignal,
): Promise<{ failure: WorkerResult; windows?: undefined } | { failure?: undefined; windows: BoundWindows }> {
  const bound = await readMainWindowBinding(client, budget, signal);
  if (bound.failure) return { failure: bound.failure };
  const { inventory, main } = bound.binding;
  const others = inventory.windows.filter(window => window.pid === main.pid && window.hwnd !== main.hwnd)
    .map(window => ({ window, kind: auxiliaryWindowKind(window, profile) }));
  // A tooltip is an untitled window the worker's descriptor never turns into a blocking dialog; the page stays readable.
  const untitledUnknown = inventory.untitledWindows.filter(window => window.pid === main.pid && !/tooltip/iu.test(window.class));
  if (others.some(entry => entry.kind === null) || untitledUnknown.length) {
    return { failure: fail("dialog-open", `Ein nicht katalogisiertes Fenster des gebundenen Prozesses ist offen; ${subject} nicht gelesen. `
      + "Dialoge mit sse_dialog_list lesen und bewusst beantworten.") };
  }
  const owned = others.filter(entry => entry.kind !== "system-overlay" && entry.kind !== "case-window").map(entry => entry.window);
  return { windows: { inventory, main, owned } };
}

interface WindowRect { x: number; y: number; w: number; h: number }

/**
 * UIA lists an owned window as a Window node carrying the window's own name,
 * AutomationId and rectangle; the Qt snapshot omits that root but reports its
 * identity and rectangle, so the synthesized root and its subtree describe the
 * same moment.
 */
function ownedWindowNode(window: QtProcessWindow, root: { aid: string; name: string }, rect: WindowRect, index: number): QtSnapshotNode {
  return {
    i: index, p: -1, d: 0, type: "Window", name: root.name, aid: root.aid, rid: `42.${window.hwnd}`,
    x: rect.x, y: rect.y, w: rect.w, h: rect.h, on: true, val: null, ro: null, checked: null, selected: null, scroll: null,
  };
}

export interface OwnedWindowSubtrees {
  /** One Split-SSEWindowScope entry per owned window, named and identified like its UIA root. */
  scopes: ForeignWindowScope[];
  /** The window nodes followed by their subtrees, appended in inventory order after the main tree. */
  nodes: QtSnapshotNode[];
  durationMs: number;
}

/** Read every owned catalogued window through its exact title, in the same request budget as the main tree. */
export async function readOwnedWindowSubtrees(
  client: QtNativeClient, owned: readonly QtProcessWindow[], maxNodes: number, subject: string,
  firstIndex: number, budget: () => number, signal?: AbortSignal,
): Promise<{ failure: WorkerResult; subtrees?: undefined } | { failure?: undefined; subtrees: OwnedWindowSubtrees }> {
  const scopes: ForeignWindowScope[] = [];
  const nodes: QtSnapshotNode[] = [];
  let durationMs = 0;
  for (const window of owned) {
    const tool = await readQtNativeSnapshot(client, { maxNodes, toolTitle: window.title }, budget(), signal);
    durationMs += tool.nativeDurationMs;
    if (tool.hwnd !== window.hwnd) throw new QtNativeTransportError("The owned window snapshot returned another window.", "native-contract");
    if (!tool.windowEnabled || tool.modalBlocked) {
      return { failure: fail("dialog-open", `Ein modaler Dialog blockiert ein Nebenfenster der gebundenen Seite; ${subject} nicht gelesen.`) };
    }
    if (tool.stats.truncated) {
      return { failure: fail("native-incomplete", `${nativeTreeBoundReason(tool.stats, "Der native Baum eines Nebenfensters")}; ${subject} nicht gelesen.`) };
    }
    if (!tool.root) throw new QtNativeTransportError("The owned window snapshot carries no root identity.", "native-contract");
    const root = ownedWindowNode(window, tool.root, tool.windowRect, firstIndex + nodes.length);
    nodes.push(root, ...tool.nodes);
    scopes.push({ rid: root.rid, name: root.name, aid: root.aid, x: root.x, y: root.y, w: root.w, h: root.h, nodeCount: tool.nodes.length + 1 });
  }
  return { subtrees: { scopes, nodes, durationMs } };
}
