import { createHash } from "node:crypto";
import { z } from "zod";
import type { WorkerResult } from "./api-contract.js";
import type { QtNativeClient } from "./qt-native-client.js";
import { QT_TABLE_FOCUS_BINDING, readQtNativeCompleteTable } from "./qt-native-tables.js";
import { readQtNativeSnapshot } from "./qt-native-snapshot.js";

const uint = z.number().int().min(0).max(0xffff_ffff);
const rect = z.tuple([z.number().int(), z.number().int(), z.number().int().nonnegative(), z.number().int().nonnegative()]);
const nativePixel = z.number().finite().min(-0x8000_0000).max(0x7fff_ffff);
const nativeRect = z.tuple([nativePixel, nativePixel, nativePixel.nonnegative(), nativePixel.nonnegative()]);
export const bindingSchema = z.object({
  hwnd: z.number().int().positive(), pid: z.number().int().positive(), inputEpoch: uint,
  dirty: z.boolean(), dpi: z.number().int().min(96).max(768),
  clientOrigin: z.tuple([z.number().int(), z.number().int()]),
  windowTitle: z.string().min(1).max(4096),
  windowFingerprint: z.string().regex(/^[A-Fa-f0-9]{64}$/u),
  snapshot: z.object({
    kopf: z.array(z.string()).min(2).max(100),
    navigationBinding: z.object({
      complete: z.literal(true), editorFree: z.literal(true), heading: z.string().min(1),
      tableRootAid: z.string().min(1), tableRootRid: z.string().min(1),
      headers: z.array(z.object({ aid: z.string().min(1), rid: z.string().min(1), name: z.string().min(1) })).min(2).max(100),
      contentSignature: z.string().regex(/^[A-Fa-f0-9]{64}$/u),
    }).passthrough(),
  }).passthrough(),
}).strict();
export type CursorBinding = z.infer<typeof bindingSchema>;
export const leaseSchema = z.object({
  schemaVersion: z.literal(1), nonce: z.string().uuid(), rootHwnd: z.number().int().safe().positive(),
  targetPid: z.number().int().positive(), inputEpoch: uint,
  previous: z.object({ hwnd: z.number().int().safe().nonnegative(), pid: uint,
    start: z.string().regex(/^(0|[1-9][0-9]{0,19})$/u), class: z.string() }).strict(),
  previousCursor: z.object({ x: z.number().int(), y: z.number().int() }).strict().nullable(),
}).strict();
export type CursorLease = z.infer<typeof leaseSchema>;
export function publicCursorResult(result: WorkerResult): WorkerResult {
  const { cursorBinding: _binding, cursorLease: _lease, cursorInputEpoch: _epoch, selectedRids: _selection,
    cursorStep: _step, mutationTarget: _target, mutationPostProof: _post, ...publicResult } = result;
  return publicResult;
}
export class CursorProofFailure extends Error {
  constructor(readonly proofCheck: string, readonly nativeViewport?: Readonly<Record<string, unknown>>) { super("Cursor proof failed."); }
}
export const rejectProof = (check: string): never => { throw new CursorProofFailure(check); };
/** Only this bounded geometry projection leaves a rejected native proof. No cursor authority or control values. */
export function cursorProofActivation(error: unknown) {
  return error instanceof CursorProofFailure && error.nativeViewport ? {
    cursorActivation: { subphase: "native-viewport-dpi-geometry", source: "qt-native", activationAttempted: false,
      nativeViewport: error.nativeViewport },
  } : {};
}
export function sameContext(before: CursorBinding, after: CursorBinding) {
  return after.hwnd === before.hwnd && after.pid === before.pid && after.dpi === before.dpi
    && after.dirty === before.dirty && after.windowTitle === before.windowTitle
    && after.windowFingerprint === before.windowFingerprint
    && JSON.stringify(after.clientOrigin) === JSON.stringify(before.clientOrigin)
    && after.snapshot.navigationBinding.contentSignature === before.snapshot.navigationBinding.contentSignature;
}
export type CompleteModel = Awaited<ReturnType<typeof readQtNativeCompleteTable>>;
const objectSchema = z.object({
  id: z.number().int().positive(), parentId: z.number().int().nonnegative(), name: z.string(), class: z.string(),
  rootRect: rect.optional(), nativeScreenRect: nativeRect.nullable().optional(), visible: z.boolean().optional(), enabled: z.boolean().optional(),
}).passthrough();

/** Includes hidden/empty rows, edit roles, flags and structural evidence. No filtered public projection. */
export function tableCursorModelFingerprint(model: CompleteModel): string {
  return createHash("sha256").update(JSON.stringify({
    table: model.table, rows: model.rows, readRows: model.readRows, columns: model.columns, headers: model.headers,
    values: model.values, rowFingerprints: model.rowFingerprints, hiddenRows: model.hiddenRows, hiddenColumns: model.hiddenColumns,
    complete: model.complete, canFetchMore: model.canFetchMore, tableCount: model.tableCount,
    summary: model.summary, binding: model.binding, summaries: model.summaries,
    windowEnabled: model.windowEnabled, modalBlocked: model.modalBlocked,
  })).digest("hex");
}

export async function bindNativeViewport(client: QtNativeClient, binding: CursorBinding, model: CompleteModel,
  remaining: () => number, signal?: AbortSignal) {
  const snapshot = await readQtNativeSnapshot(client, { hwnd: binding.hwnd, maxNodes: 5000 }, remaining(), signal);
  if (snapshot.stats.truncated || !snapshot.windowEnabled || snapshot.modalBlocked) rejectProof("native-tree-complete-unblocked");
  const expected = binding.snapshot.navigationBinding;
  const tables = snapshot.nodes.filter(node => ["Table", "DataGrid"].includes(node.type)
    && node.rid === expected.tableRootRid && node.aid === expected.tableRootAid && node.on && node.w > 0 && node.h > 0);
  if (tables.length !== 1 || !expected.tableRootAid.includes(".RedThreadContent.")
    || !model.table.name.startsWith("/.") || !expected.tableRootAid.endsWith(model.table.name)) {
    rejectProof("native-accessible-table-identity");
  }
  const table = tables[0]!;
  const headers = expected.headers.map(header => {
    const matches = snapshot.nodes.filter(node => node.p === table.i && node.type === "Header" && node.w > 0
      && node.rid === header.rid && node.aid === header.aid && node.name === header.name);
    if (matches.length !== 1) rejectProof("native-column-header-identity");
    return matches[0]!;
  }).sort((a, b) => a.x - b.x);
  const columns = model.headers.filter((_, index) => !model.hiddenColumns.includes(index)).map(value => value === null ? "" : String(value));
  if (JSON.stringify(headers.map(node => node.name)) !== JSON.stringify(binding.snapshot.kopf)
    || JSON.stringify(columns) !== JSON.stringify(binding.snapshot.kopf)) rejectProof("native-column-headers");
  const reply = await client.request("objects", { projection: "full", visibleOnly: true, maxObjects: 20_000 }, remaining(), signal);
  const objects = z.object({ ok: z.literal(true), complete: z.literal(true), windowEnabled: z.literal(true),
    modalBlocked: z.literal(false), objects: z.array(objectSchema).max(20_000) }).parse(reply.result).objects;
  const namedTables = objects.filter(object => object.name === model.table.name && object.class === "DialogUITable");
  const nativeTables = namedTables.filter(object => object.id === model.table.id
    && object.class === "DialogUITable" && object.visible === true && object.enabled === true && object.rootRect && object.nativeScreenRect);
  if (namedTables.length !== 1 || nativeTables.length !== 1 || new Set(objects.map(object => object.id)).size !== objects.length) {
    rejectProof("native-qobject-table-identity");
  }
  const viewports = objects.filter(object => object.parentId === model.table.id && object.name === "qt_scrollarea_viewport"
    && object.class === "QWidget" && object.visible === true && object.enabled === true && object.rootRect && object.nativeScreenRect);
  if (viewports.length !== 1) rejectProof("native-genuine-viewport");
  const tableRect = nativeTables[0]!.rootRect!, viewportRect = viewports[0]!.rootRect!;
  const nativeTable = nativeTables[0]!.nativeScreenRect!, nativeViewport = viewports[0]!.nativeScreenRect!;
  // The producer uses the same Qt accessibility-window conversion as the
  // accessible tree. Do not derive Qt scaling from the Windows window DPI.
  const expectedPhysicalRect = nativeTable.map(value => Math.trunc(value));
  const nativeViewportRect = [Math.ceil(nativeViewport[0]), Math.ceil(nativeViewport[1]),
    Math.floor(nativeViewport[0] + nativeViewport[2]) - Math.ceil(nativeViewport[0]),
    Math.floor(nativeViewport[1] + nativeViewport[3]) - Math.ceil(nativeViewport[1])];
  const checks = {
    tablePositiveBounds: tableRect[2] > 0 && tableRect[3] > 0, viewportPositiveBounds: viewportRect[2] > 0 && viewportRect[3] > 0,
    nativeTablePositiveBounds: nativeTable[2] > 0 && nativeTable[3] > 0,
    nativeViewportPositiveBounds: nativeViewportRect[2]! > 0 && nativeViewportRect[3]! > 0,
    xMatch: Math.abs(table.x - expectedPhysicalRect[0]!) <= 1, yMatch: Math.abs(table.y - expectedPhysicalRect[1]!) <= 1,
    widthMatch: Math.abs(table.w - expectedPhysicalRect[2]!) <= 1, heightMatch: Math.abs(table.h - expectedPhysicalRect[3]!) <= 1,
    viewportLeftInside: viewportRect[0] >= tableRect[0], viewportTopInside: viewportRect[1] >= tableRect[1],
    viewportRightInside: viewportRect[0] + viewportRect[2] <= tableRect[0] + tableRect[2],
    viewportBottomInside: viewportRect[1] + viewportRect[3] <= tableRect[1] + tableRect[3],
    nativeViewportLeftInside: nativeViewport[0] >= nativeTable[0], nativeViewportTopInside: nativeViewport[1] >= nativeTable[1],
    nativeViewportRightInside: nativeViewport[0] + nativeViewport[2] <= nativeTable[0] + nativeTable[2],
    nativeViewportBottomInside: nativeViewport[1] + nativeViewport[3] <= nativeTable[1] + nativeTable[3],
  };
  if (Object.values(checks).some(value => !value)) throw new CursorProofFailure("native-viewport-dpi-geometry", {
    dpi: binding.dpi, clientOrigin: [...binding.clientOrigin], tableRect: [...tableRect], viewportRect: [...viewportRect],
    nativeTableRect: [...nativeTable], nativeViewportRect: [...nativeViewport],
    accessibleTableRect: [table.x, table.y, table.w, table.h], expectedPhysicalRect, checks,
  });
  return { coordinateSpace: "qt-native-screen", tableRect, viewportRect, nativeTableRect: expectedPhysicalRect, nativeViewportRect };
}

export function nativeFocusBinding(model: CompleteModel, binding: CursorBinding, requireCursor = false) {
  const parsed = QT_TABLE_FOCUS_BINDING.safeParse(model.cursorFocusBinding);
  if (!parsed.success) return rejectProof("native-focus-binding-schema");
  const focus = parsed.data;
  if (focus.tableId !== model.table.id || focus.tableName !== model.table.name
    || focus.tableAid !== binding.snapshot.navigationBinding.tableRootAid
    || (requireCursor && (focus.currentIndex.some(index => index < 0) || !focus.selectedIndexes.length))) {
    rejectProof("native-focus-table-cursor-identity");
  }
  if (requireCursor && !focus.selectedIndexes.some(index => index[0] === focus.currentIndex[0] && index[1] === focus.currentIndex[1])) {
    rejectProof("native-focus-current-selection-alignment");
  }
  return focus;
}

export type CursorPhase = (name: string, binding?: CursorBinding, extra?: Record<string, unknown>) => Promise<WorkerResult>;

export function numberPolicy(model: CompleteModel, binding: CursorBinding) {
  const headers = model.headers.filter((_, index) => !model.hiddenColumns.includes(index)).map(value => value === null ? "" : String(value));
  if (!/^\/\.[A-Za-z0-9_.-]{1,200}$/u.test(model.table.name)
    || !binding.snapshot.navigationBinding.tableRootAid.endsWith(model.table.name)
    || !binding.snapshot.navigationBinding.tableRootAid.includes(".RedThreadContent.")
    || !/^Nr\.?$/u.test(headers[0] ?? "") || headers.some(value => !value)
    || JSON.stringify(headers) !== JSON.stringify(binding.snapshot.kopf)) rejectProof("native-number-policy");
  return { tableName: model.table.name, headers };
}
