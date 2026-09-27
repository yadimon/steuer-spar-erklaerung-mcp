import type { WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import { QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import { readBoundWindows, readOwnedWindowSubtrees } from "./qt-native-owned-windows.js";
import { byPosition, psEquals, splitWindowScope } from "./qt-native-projections.js";
import { readQtNativeSnapshot, type QtSnapshotNode } from "./qt-native-snapshot.js";

/**
 * Direct Qt port of the worker branch 'read_table': the visible rows of a Qt
 * item view projected from one accessibility snapshot. Header cells define the
 * columns; data cells are assigned to columns by X position, never by order,
 * because Qt omits the DataItem of an empty text cell. Every string and every
 * field name is the worker's; only the tree source changed.
 */

const fail = (kind: string, error: string): WorkerResult => ({ ok: false, backend: "qt", kind, error });

const HEADER_MERGE_PX = 8;
const ROW_BAND_PX = 10;
const CELL_UNOBSERVED = "Zelle nicht beobachtet.";
const NOTE_TRUNCATED = "Baumlauf wurde abgeschnitten - es fehlen moeglicherweise Zeilen.";
const NOTE_VISIBLE_ONLY = "Nur die SICHTBAREN Zeilen. Qt virtualisiert Tabellen: mehr Zeilen erscheinen erst, wenn der Cursor sie in den Blick holt (Pfeiltaste).";

export type QtTableCheckboxState = "On" | "Off" | "Indeterminate";
export interface QtTableCellSemantic {
  type: "text" | "boolean";
  value: string | boolean | null;
  checkboxState: QtTableCheckboxState | null;
  ok: true;
  error: null;
}
export interface QtTableRowDetails {
  rowIndex: number;
  typedValues: Array<string | boolean | null>;
  checkboxStates: Array<QtTableCheckboxState | null>;
  cellTypes: Array<"text" | "boolean" | "unknown">;
  semanticsComplete: boolean;
  semanticReadErrors: Array<{ column: number; error: string }>;
}
export interface QtTableProjection {
  headers: string[];
  rows: string[][];
  rowCount: number;
  rowDetails: QtTableRowDetails[];
}

/**
 * Read-SSETableCellSemantic parity. The worker asks the live cell for its
 * TogglePattern; the bridge reports the same fact as 'checked' on a checkable
 * DataItem (withCellStates). A cell of the current snapshot is always observed,
 * so the worker's stale-cell errors cannot arise here.
 */
export function qtNativeTableCellSemantic(cell: QtSnapshotNode): QtTableCellSemantic {
  if (cell.checked === null) return { type: "text", value: cell.name, checkboxState: null, ok: true, error: null };
  const checkboxState: QtTableCheckboxState = cell.checked === true ? "On" : cell.checked === false ? "Off" : "Indeterminate";
  return { type: "boolean", value: cell.checked === true ? true : cell.checked === false ? false : null, checkboxState, ok: true, error: null };
}

/** New-SSETableRowDetails parity; a null slot is a column the tree did not show. */
export function qtNativeTableRowDetails(rowIndex: number, cells: ReadonlyArray<QtTableCellSemantic | null>): QtTableRowDetails {
  const errors: Array<{ column: number; error: string }> = [];
  cells.forEach((cell, column) => { if (!cell) errors.push({ column, error: CELL_UNOBSERVED }); });
  return {
    rowIndex,
    typedValues: cells.map(cell => cell ? cell.value : null),
    checkboxStates: cells.map(cell => cell ? cell.checkboxState : null),
    cellTypes: cells.map(cell => cell ? cell.type : "unknown"),
    semanticsComplete: errors.length === 0,
    semanticReadErrors: errors,
  };
}

/** Same header, column and row projection as the worker over the bound window's own nodes. */
export function qtNativeTableProjection(nodes: readonly QtSnapshotNode[]): QtTableProjection {
  // Qt occasionally exposes a header twice; headers closer than the merge band are one column.
  const headers: QtSnapshotNode[] = [];
  for (const header of nodes.filter(node => psEquals(node.type, "Header") && node.name && node.w > 0).sort((a, b) => a.x - b.x)) {
    if (!headers.length || Math.abs(header.x - headers[headers.length - 1]!.x) > HEADER_MERGE_PX) headers.push(header);
  }
  const columnOf = (x: number): number => {
    let best = -1, distance = Number.POSITIVE_INFINITY;
    headers.forEach((header, index) => {
      const candidate = Math.abs(x - header.x);
      if (candidate < distance) { distance = candidate; best = index; }
    });
    return best;
  };
  const cells = nodes.filter(node => psEquals(node.type, "DataItem") && node.w > 0).sort(byPosition);
  const rows: Array<Array<string | null>> = [];
  const rowDetails: QtTableRowDetails[] = [];
  let current: Array<string | null> | null = null;
  let semantics: Array<QtTableCellSemantic | null> = [];
  let anchorY = -9999;
  const close = () => {
    if (current === null) return;
    rowDetails.push(qtNativeTableRowDetails(rows.length, semantics));
    rows.push(current);
  };
  for (const cell of cells) {
    if (current === null || Math.abs(cell.y - anchorY) > ROW_BAND_PX) {
      close();
      anchorY = cell.y;
      current = new Array<string | null>(Math.max(1, headers.length)).fill(null);
      semantics = new Array<QtTableCellSemantic | null>(Math.max(1, headers.length)).fill(null);
    }
    const index = columnOf(cell.x);
    const semantic = qtNativeTableCellSemantic(cell);
    if (index >= 0 && index < current.length) { current[index] = cell.name; semantics[index] = semantic; }
    else { current.push(cell.name); semantics.push(semantic); }
  }
  close();
  return {
    headers: headers.map(header => header.name),
    // The worker casts every slot with [string]: an unobserved cell is '' here while typedValues keeps null.
    rows: rows.map(row => row.map(value => value === null ? "" : value)),
    rowCount: rows.length,
    rowDetails,
  };
}

/** Read the visible table rows of the bound window through one native snapshot instead of a UIA walk. */
export async function executeQtNativeReadTable(
  client: QtNativeClient,
  args: Readonly<Record<string, unknown>>,
  timeoutMs: number,
  signal?: AbortSignal,
  profile?: ProductProfile,
): Promise<WorkerResult> {
  if (!profile) return fail("bad-args", "read_table requires a product profile.");
  if (args.hwnd !== undefined && args.hwnd !== client.binding.hwnd) {
    throw new QtNativeTransportError("Requested window differs from the verified native session.", "stale-window");
  }
  const started = performance.now();
  const budget = () => {
    const remaining = Math.floor(timeoutMs - (performance.now() - started));
    if (remaining < 1) throw new QtNativeTransportError("Native read_table deadline exceeded before reading.", "native-timeout");
    return remaining;
  };
  const bound = await readBoundWindows(client, profile, "Tabelle", budget, signal);
  if (bound.failure) return bound.failure;
  const { inventory, owned } = bound.windows;
  const snapshot = await readQtNativeSnapshot(client, { hwnd: args.hwnd, maxNodes: 4000, withCellStates: true }, budget(), signal);
  if (!snapshot.windowEnabled || snapshot.modalBlocked) {
    return fail("dialog-open", "Ein modaler Dialog blockiert die gebundene Seite; keine Tabelle ausgegeben.");
  }
  // The worker treats an empty bulk snapshot as a failed read, never as an empty table.
  if (!snapshot.nodes.length) return fail("native-incomplete", "Der native Seitenbaum ist leer; keine Tabelle ausgegeben.");
  // A truncated walk is reported, not refused: the worker answers the same way and marks the gap.
  const scope = splitWindowScope(snapshot.nodes);
  // Walk-BoundTree lists the owned windows it excluded; the Qt tree never contains them, so they are read by title.
  const ownedRead = await readOwnedWindowSubtrees(client, owned, 4000, "Tabelle", snapshot.nodes.length, budget, signal);
  if (ownedRead.failure) return ownedRead.failure;
  return {
    ok: true,
    ...qtNativeTableProjection(scope.own),
    ausgeschlosseneFenster: [...scope.foreign, ...ownedRead.subtrees.scopes],
    stats: snapshot.stats,
    incomplete: snapshot.stats.truncated,
    note: snapshot.stats.truncated ? NOTE_TRUNCATED : NOTE_VISIBLE_ONLY,
    backend: "qt",
    nativeDurationMs: inventory.durationMs + snapshot.nativeDurationMs + ownedRead.subtrees.durationMs,
  };
}
