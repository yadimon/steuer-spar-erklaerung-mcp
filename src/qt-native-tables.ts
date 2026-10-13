import { z } from "zod";
import type { WorkerResult } from "./api-contract.js";
import { QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";

const SCALAR = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const CELL = z.object({ display: SCALAR, edit: SCALAR, checkState: z.number().int().nullable(), flags: z.number().int().nonnegative() });
export const QT_TABLE_FOCUS_BINDING = z.object({
  tableId: z.number().int().safe().positive(), modelId: z.number().int().safe().positive(),
  tableAid: z.string().min(1), tableName: z.string().min(1),
  currentIndex: z.tuple([z.number().int().min(-1), z.number().int().min(-1)]),
  selectedIndexes: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])).max(100_000),
  modelFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
const TABLE = z.object({
  ok: z.literal(true), controllerBound: z.literal(true), windowEnabled: z.boolean(), modalBlocked: z.boolean(),
  rows: z.number().int().nonnegative(), readRows: z.number().int().min(0).max(1001), columns: z.number().int().min(1).max(100),
  headers: z.array(SCALAR).max(100), values: z.array(z.array(CELL).max(100)).max(1001),
  rowFingerprints: z.array(z.string().regex(/^[a-f0-9]{64}$/u)).max(1001),
  hiddenColumns: z.array(z.number().int().nonnegative()).max(100), hiddenRows: z.array(z.number().int().nonnegative()).max(1001),
  complete: z.boolean(), canFetchMore: z.boolean(), tableCount: z.number().int().positive(),
  table: z.object({ id: z.number().int().positive(), name: z.string(), class: z.string(), visible: z.literal(true) }).passthrough(),
  summary: z.string().nullable(), binding: z.record(z.unknown()).nullable(),
  summaries: z.array(z.object({ label: z.string(), vorkommen: z.number().int().positive(), wert: z.string().nullable() })).max(12),
  cursorFocusBinding: QT_TABLE_FOCUS_BINDING.nullable().optional(),
});
const text = (value: z.infer<typeof SCALAR>): string => value === null ? "" : String(value);
const fail = (kind: string, error: string): WorkerResult => ({ ok: false, backend: "qt", kind, error });

/** Normalize an atomic Qt model snapshot to the existing table result contract. */
function normalizeTable(raw: z.infer<typeof TABLE>, maxRows: number): WorkerResult {
  const uniqueBounded = (indices: number[], length: number) => new Set(indices).size === indices.length && indices.every(index => index < length);
  if (raw.readRows > raw.rows || raw.readRows > maxRows + 1 || raw.values.length !== raw.readRows
    || raw.headers.length !== raw.columns || raw.rowFingerprints.length !== raw.readRows
    || raw.values.some(row => row.length !== raw.columns)
    || !uniqueBounded(raw.hiddenColumns, raw.columns) || !uniqueBounded(raw.hiddenRows, raw.readRows)
    || (raw.complete && (raw.readRows !== raw.rows || raw.canFetchMore))) {
    return fail("native-contract", "Native table dimensions or completeness evidence are inconsistent.");
  }
  if (!raw.windowEnabled || raw.modalBlocked) return fail("window-obstructed", "The native table is disabled or blocked by a modal dialog.");
  const columns = Array.from({ length: raw.columns }, (_, index) => index).filter(index => !raw.hiddenColumns.includes(index));
  const rows = raw.values.map((cells, modelRowIndex) => ({ modelRowIndex, cells: columns.map(index => cells[index]!) }))
    .filter(row => !raw.hiddenRows.includes(row.modelRowIndex))
    .filter(row => row.cells.some(cell => {
      const value = text(cell.display);
      return value.trim() && value !== "0,00" && value !== "0";
    }));
  const limitReached = rows.length > maxRows || raw.readRows < raw.rows;
  const included = rows.slice(0, maxRows);
  const rowDetails = included.map((row, rowIndex) => {
    const cells = row.cells.map((cell, column) => {
      if ((cell.flags & 16) !== 0 || cell.checkState !== null) {
        if (![0, 1, 2].includes(cell.checkState ?? -1)) {
          return { type: "unknown", value: null, state: null, error: { column, error: "Checkbox state was not exposed by the model." } };
        }
        return { type: "boolean", value: cell.checkState === 1 ? null : cell.checkState === 2,
          state: cell.checkState === 0 ? "Off" : cell.checkState === 2 ? "On" : "Indeterminate", error: null };
      }
      return { type: "text", value: text(cell.display), state: null, error: null };
    });
    return {
      rowIndex, modelRowIndex: row.modelRowIndex, rowFingerprint: raw.rowFingerprints[row.modelRowIndex],
      modelCellFlags: row.cells.map(cell => cell.flags),
      typedValues: cells.map(cell => cell.value), checkboxStates: cells.map(cell => cell.state), cellTypes: cells.map(cell => cell.type),
      semanticsComplete: cells.every(cell => !cell.error), semanticReadErrors: cells.flatMap(cell => cell.error ? [cell.error] : []),
    };
  });
  return {
    ok: true, backend: "qt", kopf: columns.map(column => text(raw.headers[column]!)),
    zeilen: included.map(row => row.cells.map(cell => text(cell.display))), anzahl: included.length, rowDetails,
    summe: raw.summary, summen: raw.summaries, bindung: raw.binding, tabelleAnzahl: 1,
    vollstaendig: raw.complete && !limitReached, limitReached,
    stopKind: limitReached ? "max-rows" : raw.complete ? "end-of-model" : "model-incomplete",
    schritte: 0, steps: 0, physicalInputUsed: false,
    nativeTable: { id: raw.table.id, aid: raw.table.name, modelRows: raw.rows, modelColumns: raw.columns,
      visibleColumns: columns, tableCount: raw.tableCount, readModelRows: raw.readRows,
      rowFilter: "nonempty-nonzero-display", dirtyStateVerified: false },
  };
}

/** Project already verified private model evidence without another native read. */
export function projectQtNativeCompleteTable(raw: Awaited<ReturnType<typeof readQtNativeCompleteTable>>, maxRows = 1000): WorkerResult {
  return normalizeTable(raw, maxRows);
}

/** Exact, unique enabled/selectable model cell; hidden, disabled and checkbox cells cannot be targets. */
export function findQtNativeTableTarget(raw: Awaited<ReturnType<typeof readQtNativeCompleteTable>>, wanted: string) {
  const matches: { row: number; column: number }[] = [];
  for (let row = 0; row < raw.rows; row++) {
    if (raw.hiddenRows.includes(row)) continue;
    for (let column = 0; column < raw.columns; column++) {
      const value = raw.values[row]![column]!;
      if (!raw.hiddenColumns.includes(column) && (value.flags & 33) === 33 && (value.flags & 16) === 0 && value.checkState === null
        && text(value.display) === wanted) matches.push({ row, column });
    }
  }
  return matches.length === 1 ? matches[0]! : null;
}

/** Private, unfiltered model evidence for a guarded cursor transaction. */
export async function readQtNativeCompleteTable(
  client: QtNativeClient, args: Readonly<Record<string, unknown>>, timeoutMs: number, signal?: AbortSignal,
) {
  if (args.hwnd !== client.binding.hwnd) throw new Error("Cursor proof targets another native window.");
  const read = await client.request("table_snapshot", {
    // Cursor transactions alone need accessibility geometry and selection proof.
    // Ordinary public model reads must not activate that separate read path.
    withCursorFocusBinding: true, maxRows: 1000, ...(args.sumLabel ? { sumLabel: args.sumLabel } : {}),
    ...(args.sumOccurrence ? { sumOccurrence: args.sumOccurrence } : {}),
  }, timeoutMs, signal);
  const raw = TABLE.parse(read.result);
  if (normalizeTable(raw, 1000).ok !== true || !raw.complete || raw.canFetchMore || raw.readRows !== raw.rows) {
    throw new Error("Cursor proof requires a complete, unfiltered native model.");
  }
  return raw;
}

export async function executeQtNativeTableRead(
  client: QtNativeClient, args: Readonly<Record<string, unknown>>, timeoutMs = 5_000, signal?: AbortSignal,
): Promise<WorkerResult> {
  if (args.hwnd !== undefined && args.hwnd !== client.binding.hwnd) return fail("stale-window", "Requested window differs from the native session.");
  const maxRows = typeof args.maxRows === "number" ? args.maxRows : 200;
  try {
    const read = await client.request("table_snapshot", {
      maxRows, ...(args.sumLabel ? { sumLabel: args.sumLabel } : {}), ...(args.sumOccurrence ? { sumOccurrence: args.sumOccurrence } : {}),
    }, timeoutMs, signal);
    if (!read.result.ok) return { ...read.result, kind: String(read.result.code ?? "native-read"), backend: "qt" };
    return { ...normalizeTable(TABLE.parse(read.result), maxRows), nativeDurationMs: read.durationMs };
  } catch (error) {
    if (error instanceof QtNativeTransportError) return { ...fail(error.kind, error.message), outcomeUnknown: error.outcomeUnknown };
    return fail("native-contract", error instanceof Error ? error.message : "Invalid native table response.");
  }
}
