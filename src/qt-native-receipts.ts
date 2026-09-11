import { createHash } from "node:crypto";
import { z } from "zod";
import type { WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import type { QtNativeClient } from "./qt-native-client.js";
import { readQtNativeSnapshot, type QtSnapshotNode } from "./qt-native-snapshot.js";

export const receiptPolicySchema = z.object({
  title: z.string().min(1).max(4096),
  role: z.literal("nonmodal-tool-window"),
  states: z.record(z.object({
    requiredAutomationIdSuffixes: z.array(z.string().min(1)).min(1),
  }).passthrough()),
  actions: z.record(z.object({
    fromState: z.string().min(1),
    toState: z.string().min(1),
    automationIdSuffix: z.string().min(1),
    expectedName: z.string().min(1).optional(),
  }).passthrough()),
  list: z.object({
    tableAutomationIdSuffix: z.string().min(1),
    countLabelAutomationIdSuffixes: z.array(z.string().min(1)).length(3),
    searchAutomationIdSuffix: z.string().min(1),
    primaryTextColumn: z.number().int().nonnegative(),
    documentNumberColumn: z.number().int().nonnegative(),
    draftMarker: z.string().min(1),
  }).strict(),
  controls: z.object({
    detailClose: z.object({
      automationIdSuffix: z.string().min(1),
      expectedName: z.string().min(1),
    }).passthrough(),
    editableFields: z.object({
      title: z.object({ automationIdSuffix: z.string().min(1), controlType: z.string().min(1), valueKind: z.string().min(1) }).passthrough(),
      date: z.object({ automationIdSuffix: z.string().min(1), controlType: z.string().min(1), valueKind: z.string().min(1) }).passthrough(),
      documentNumber: z.object({ automationIdSuffix: z.string().min(1), controlType: z.string().min(1), valueKind: z.string().min(1) }).passthrough(),
      amount: z.object({ automationIdSuffix: z.string().min(1), controlType: z.string().min(1), valueKind: z.string().min(1) }).passthrough(),
      vatRate: z.object({ automationIdSuffix: z.string().min(1), controlType: z.string().min(1), valueKind: z.string().min(1) }).passthrough(),
      net: z.object({ automationIdSuffix: z.string().min(1), controlType: z.string().min(1), valueKind: z.string().min(1) }).passthrough(),
      note: z.object({ automationIdSuffix: z.string().min(1), controlType: z.string().min(1), valueKind: z.string().min(1) }).passthrough(),
    }).strict(),
  }).passthrough(),
}).passthrough();

const filterSchema = z.object({
  exactTitle: z.string().optional(),
  titleContains: z.string().optional(),
  draft: z.boolean().optional(),
}).strict();

const processWindowInventorySchema = z.object({
  ok: z.literal(true),
  windows: z.array(z.object({
    hwnd: z.number().int().positive(),
    pid: z.number().int().positive(),
    class: z.string().min(1).max(255),
    title: z.string().min(1).max(4095),
    minimized: z.boolean(),
    hung: z.boolean(),
  }).strict()).max(256),
}).passthrough();

export const fail = (kind: string, error: string): WorkerResult => ({ ok: false, backend: "qt", kind, error });

/** Match Windows PowerShell 5.1 ConvertTo-Json so native and worker guards hash identical bytes. */
export function canonicalReceiptJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Receipt fingerprint value is not JSON serializable.");
  return serialized.replace(/[&<>'\u2028\u2029]/gu,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export const receiptTextFingerprint = (text: string) => createHash("sha256")
  .update(text, "utf8").digest("hex").toUpperCase();
export const receiptFingerprint = (value: unknown) => receiptTextFingerprint(canonicalReceiptJson(value));

function receiptToolAidSuffixes(policy: z.infer<typeof receiptPolicySchema>): string[] {
  return [...new Set([
    ...Object.values(policy.states).flatMap(state => state.requiredAutomationIdSuffixes),
    ...Object.values(policy.actions).map(action => action.automationIdSuffix),
    policy.list.tableAutomationIdSuffix,
    ...policy.list.countLabelAutomationIdSuffixes,
    policy.list.searchAutomationIdSuffix,
  ])];
}

export async function receiptToolSnapshot(
  client: QtNativeClient, policy: z.infer<typeof receiptPolicySchema>, timeoutMs: number, signal?: AbortSignal,
) {
  return readQtNativeSnapshot(client, {
    maxNodes: 5000,
    toolTitle: policy.title,
    aidSuffixes: receiptToolAidSuffixes(policy),
  }, timeoutMs, signal);
}

export async function receiptDetailSnapshot(
  client: QtNativeClient, policy: z.infer<typeof receiptPolicySchema>, timeoutMs: number, signal?: AbortSignal,
) {
  return readQtNativeSnapshot(client, {
    maxNodes: 5000,
    toolTitle: policy.title,
    aidSuffixes: [...new Set([
      ...receiptToolAidSuffixes(policy),
      policy.controls.detailClose.automationIdSuffix,
      ...Object.values(policy.controls.editableFields).map(field => field.automationIdSuffix),
    ])],
    aidContains: [".widget_detailPanel."],
  }, timeoutMs, signal);
}

export async function receiptDirtyState(
  client: QtNativeClient, hwnd: unknown, allowedModalTitle: string, timeoutMs: number, signal?: AbortSignal,
) {
  const main = await readQtNativeSnapshot(client, {
    hwnd,
    maxNodes: 32,
    aidSuffixes: [".MainToolBar.tb_sichern"],
    allowedModalTitle,
  }, timeoutMs, signal);
  if (!main.windowEnabled || main.modalBlocked || main.stats.truncated) return { error: fail("window-obstructed", "The bound main window cannot provide a complete dirty-state readback.") };
  const matches = main.nodes.filter(node => node.type === "Button" && node.aid.endsWith(".MainToolBar.tb_sichern"));
  if (matches.length !== 1) return { error: fail("precondition-failed", "The bound main-window dirty state is not unique.") };
  return { dirty: matches[0]!.on, durationMs: main.nativeDurationMs };
}

export async function receiptWindowSet(client: QtNativeClient, timeoutMs: number, signal?: AbortSignal) {
  const measured = await client.request("window_inventory", {}, timeoutMs, signal);
  const parsed = processWindowInventorySchema.safeParse(measured.result);
  if (!parsed.success) return { error: fail("native-contract", "The process window inventory is incomplete or invalid.") };
  const windows = parsed.data.windows.map(window => ({
    hwnd: window.hwnd,
    pid: window.pid,
    cls: window.class,
    titleFingerprint: receiptTextFingerprint(window.title),
    minimiert: window.minimized,
    hung: window.hung,
  }));
  return { windows, fingerprint: receiptFingerprint(windows), durationMs: measured.durationMs };
}

export function receiptState(nodes: QtSnapshotNode[], hwnd: number, policy: z.infer<typeof receiptPolicySchema>) {
  const visible = nodes.filter(node => node.w > 0 && node.h > 0);
  const requirements = Object.entries(policy.states).map(([name, state]) => ({
    name,
    required: state.requiredAutomationIdSuffixes,
  }));
  const matched = requirements.filter(state => state.required.every(suffix => {
    const matches = visible.filter(node => node.aid.endsWith(suffix));
    return matches.length === 1 && matches[0]!.on;
  }));
  if (matched.length !== 1) return { error: fail("state-unknown", `BelegManager state is not unique (${matched.length} matches).`) };
  const suffixes = new Set([
    ...requirements.flatMap(state => state.required),
    ...Object.values(policy.actions).flatMap(action => action.automationIdSuffix ? [action.automationIdSuffix] : []),
  ]);
  const stableNodes = visible.filter(node => [...suffixes].some(suffix => node.aid.endsWith(suffix)))
    .sort((left, right) => left.aid.localeCompare(right.aid))
    .map(node => ({
      aid: node.aid,
      name: node.name,
      type: node.type,
      enabled: node.on,
      checked: node.checked,
      selected: node.selected,
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
    }));
  const state = matched[0]!.name;
  return { state, fingerprint: receiptFingerprint({ hwnd, state, nodes: stableNodes }) };
}

function toggleState(node: QtSnapshotNode): string | null {
  if (node.checked === "unbestimmt") return "Indeterminate";
  if (node.checked === true) return "On";
  if (node.checked === false) return "Off";
  return null;
}

export interface ReceiptCell {
  name: string; rid: string; selected: boolean | null; toggleState: string | null;
  x: number; y: number; w: number; h: number;
}
export interface ReceiptRow {
  index: number; rowRid: string; rowFingerprint: string; contentFingerprint: string;
  primaryText: string; documentNumber: string; cells: ReceiptCell[]; draft: boolean; selected: boolean;
}
export interface ReceiptListProjection {
  count: number; countSource: string; countText: string; headers: string[]; rows: ReceiptRow[];
  draftCount: number; listFingerprint: string; rowsComplete: boolean; gridProjectionError: string | null;
}

export function receiptList(nodes: QtSnapshotNode[], policy: z.infer<typeof receiptPolicySchema>): ReceiptListProjection | { error: WorkerResult } {
  const tableSuffix = policy.list.tableAutomationIdSuffix;
  const visible = nodes.filter(node => node.w > 0 && node.h > 0);
  const tables = visible.filter(node => node.type === "Table" && node.aid.endsWith(tableSuffix) && node.on);
  if (tables.length !== 1) return { error: fail("profile-contract", `${tables.length} visible receipt tables found.`) };
  const table = tables[0]!;
  const countLabels: QtSnapshotNode[] = [];
  for (const [index, suffix] of policy.list.countLabelAutomationIdSuffixes.entries()) {
    const matches = visible.filter(node => node.aid.endsWith(suffix));
    if (matches.length > 1 || (index === 0 && matches.length !== 1)) {
      return { error: fail("profile-contract", `${matches.length} receipt count labels '${suffix}' found.`) };
    }
    if (matches.length === 1) countLabels.push(matches[0]!);
  }
  const countText = countLabels.map(node => node.name).join(" ").replace(/\s+/gu, " ").trim();
  const countMatch = /MEINE BELEGE\s*\((?:\d+\s+von\s+)?(?<total>\d+)\)/u.exec(countText);
  if (!countMatch?.groups?.total) return { error: fail("profile-contract", `Unknown receipt count format: '${countText}'.`) };
  const count = Number.parseInt(countMatch.groups.total, 10);
  const headers = visible.filter(node => ["Header", "HeaderItem"].includes(node.type) && node.aid === table.aid)
    .sort((left, right) => left.x - right.x).map(node => node.name);
  const groups = new Map<number, QtSnapshotNode[]>();
  for (const node of visible.filter(candidate => candidate.type === "DataItem"
    && candidate.aid === table.aid && candidate.y >= table.y)) {
    const group = groups.get(node.y) ?? [];
    group.push(node);
    groups.set(node.y, group);
  }
  const rows = [...groups.entries()].sort(([left], [right]) => left - right).map(([, group], offset) => {
    const cells = group.sort((left, right) => left.x - right.x).map(node => ({
      name: node.name,
      rid: node.rid,
      selected: node.selected,
      toggleState: toggleState(node),
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
    }));
    const named = cells.filter(cell => cell.name);
    const rowRid = (named[0] ?? cells[0])!.rid;
    const names = cells.map(cell => cell.name);
    const index = offset + 1;
    const primaryText = named[0]?.name ?? "";
    const documentNumber = cells.length > policy.list.documentNumberColumn
      ? cells[policy.list.documentNumberColumn]!.name : "";
    return {
      index,
      rowRid,
      rowFingerprint: receiptFingerprint({ index, rid: rowRid, cells: names }),
      contentFingerprint: receiptFingerprint({ primaryText }),
      primaryText,
      documentNumber,
      cells,
      draft: names.some(name => name.endsWith(policy.list.draftMarker)),
      selected: cells.some(cell => cell.selected === true),
    };
  });
  const listFingerprint = receiptFingerprint({ count, rows: rows.map(row => row.rowFingerprint) });
  return {
    count,
    countSource: "info-label",
    countText,
    headers,
    rows,
    draftCount: rows.filter(row => row.draft).length,
    listFingerprint,
    rowsComplete: rows.length === count,
    gridProjectionError: rows.length === count ? null : "Qt accessibility exposes only the current receipt rows.",
  };
}

export function receiptDetailFields(nodes: QtSnapshotNode[]) {
  return nodes.filter(node => node.aid.includes(".widget_detailPanel.") && node.w > 0 && node.h > 0
    && (["Edit", "Spinner", "CheckBox", "ComboBox", "Button"].includes(node.type) || node.name || node.val !== null))
    .sort((left, right) => left.aid.localeCompare(right.aid))
    .map(node => ({
      automationId: node.aid,
      name: node.name,
      type: node.type,
      value: node.val,
      readOnly: node.ro,
      enabled: node.on,
      checked: node.checked,
      selected: node.selected,
    }));
}

export function receiptEditableValues(nodes: QtSnapshotNode[], policy: z.infer<typeof receiptPolicySchema>) {
  const values: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(policy.controls.editableFields)) {
    const matches = nodes.filter(node => node.aid.endsWith(field.automationIdSuffix)
      && node.type === field.controlType && node.w > 0 && node.h > 0 && node.on);
    if (matches.length !== 1) return { complete: false, values: null };
    const node = matches[0]!;
    if (field.valueKind === "boolean") {
      if (typeof node.checked !== "boolean") return { complete: false, values: null };
      values[name] = node.checked;
      continue;
    }
    let value = String(node.val ?? node.name);
    if (field.valueKind === "date") {
      const match = /^(?<day>\d{2})\.(?<month>\d{2})\.(?<year>\d{4})$/u.exec(value.trim());
      if (match?.groups) value = `${match.groups.year}-${match.groups.month}-${match.groups.day}`;
      else value = value.trim();
    } else if (field.valueKind === "vat-rate") {
      value = value.replace(/[^0-9]/gu, "") || "0";
    }
    values[name] = value;
  }
  return { complete: true, values };
}

function receiptDetailTitle(row: ReceiptRow,
  policy: z.infer<typeof receiptPolicySchema>) {
  const title = String(row.primaryText);
  return row.draft && title.endsWith(policy.list.draftMarker)
    ? title.slice(0, -policy.list.draftMarker.length) : title;
}

function stableCellNames(row: Pick<ReceiptRow, "cells">) {
  return row.cells.filter((_, index) => index !== 5 && index !== 6).map(cell => cell.name);
}

export function sameSemanticRow(left: ReceiptRow, right: ReceiptRow) {
  return left.primaryText === right.primaryText && left.documentNumber === right.documentNumber
    && left.contentFingerprint === right.contentFingerprint
    && JSON.stringify(stableCellNames(left)) === JSON.stringify(stableCellNames(right));
}

export function exactDetailClose(nodes: QtSnapshotNode[], policy: z.infer<typeof receiptPolicySchema>) {
  return nodes.filter(node => node.type === "Button" && node.aid.endsWith(policy.controls.detailClose.automationIdSuffix)
    && node.name === policy.controls.detailClose.expectedName && node.w > 0 && node.h > 0 && node.on);
}

export function detailIdentityMatches(values: Record<string, unknown> | null, row: ReceiptRow,
  policy: z.infer<typeof receiptPolicySchema>) {
  return Boolean(values && values.title === receiptDetailTitle(row, policy)
    && (!row.documentNumber || values.documentNumber === row.documentNumber));
}

export function detailBindingFingerprint(values: Record<string, unknown> | null) {
  if (!values) return null;
  return receiptFingerprint({
    title: String(values.title),
    date: String(values.date),
    documentNumber: String(values.documentNumber),
    amount: String(values.amount),
    vatRate: String(values.vatRate),
    net: Boolean(values.net),
    note: String(values.note),
  });
}

/** Read the nonmodal receipt list from the in-process Qt accessibility tree. */
export async function executeQtNativeReceiptManagerList(
  client: QtNativeClient,
  args: Readonly<Record<string, unknown>>,
  timeoutMs: number,
  signal?: AbortSignal,
  profile?: ProductProfile,
): Promise<WorkerResult> {
  const parsedPolicy = receiptPolicySchema.safeParse(profile?.pageObjectsCatalog.windows.receiptManager);
  if (!parsedPolicy.success) return fail("invalid-catalog", "The active profile has no complete receipt-manager read policy.");
  const limit = args.limit === undefined ? 50 : Number(args.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) return fail("bad-args", "limit must be an integer from 1 through 200.");
  const parsedFilter = args.filter === undefined ? undefined : filterSchema.safeParse(args.filter);
  if (parsedFilter && (!parsedFilter.success || Object.keys(parsedFilter.data).length === 0)) {
    return fail("bad-args", "filter requires exactTitle, titleContains or draft and accepts no other fields.");
  }
  const started = performance.now();
  const tool = await receiptToolSnapshot(client, parsedPolicy.data, timeoutMs, signal);
  if (!tool.windowEnabled || tool.modalBlocked) return fail("window-obstructed", "The receipt manager is disabled or blocked by a modal dialog.");
  if (tool.stats.truncated) return fail("native-incomplete", "The receipt-manager tree exceeds the native read bound.");
  const state = receiptState(tool.nodes, tool.hwnd, parsedPolicy.data);
  if (state.error) return state.error;
  if (state.state !== "list") return fail("precondition-failed", `Receipt list requires state 'list', current state is '${state.state}'.`);
  const list = receiptList(tool.nodes, parsedPolicy.data);
  if ("error" in list) return list.error;
  const remaining = Math.floor(timeoutMs - (performance.now() - started));
  if (remaining < 1) return fail("native-timeout", "Native receipt read deadline expired before dirty-state verification.");
  const dirtyState = await receiptDirtyState(client, args.hwnd, parsedPolicy.data.title, remaining, signal);
  if (dirtyState.error) return dirtyState.error;
  let matches = [...list.rows];
  const filter = parsedFilter?.success ? parsedFilter.data : undefined;
  if (filter && Object.hasOwn(filter, "exactTitle")) matches = matches.filter(row => row.primaryText === filter.exactTitle);
  if (filter && Object.hasOwn(filter, "titleContains")) {
    const wanted = filter.titleContains!.toLocaleLowerCase("de-DE");
    matches = matches.filter(row => row.primaryText.toLocaleLowerCase("de-DE").includes(wanted));
  }
  if (filter && Object.hasOwn(filter, "draft")) matches = matches.filter(row => row.draft === filter.draft);
  const matchedCount = matches.length;
  const compactMatches = matches.slice(0, limit).map(row => ({
    index: row.index,
    title: row.primaryText,
    documentNumber: row.documentNumber,
    draft: row.draft,
    rowRid: row.rowRid,
    rowFingerprint: row.rowFingerprint,
    contentFingerprint: row.contentFingerprint,
  }));
  return {
    ok: true,
    backend: "qt",
    pid: client.binding.pid,
    hwnd: tool.hwnd,
    mainHwnd: client.binding.hwnd,
    managerHwnd: tool.hwnd,
    state: state.state,
    stateFingerprint: state.fingerprint,
    count: list.count,
    countSource: list.countSource,
    headers: list.headers,
    rows: list.rows,
    draftCount: list.draftCount,
    listFingerprint: list.listFingerprint,
    rowsComplete: list.rowsComplete,
    gridProjectionError: list.gridProjectionError,
    matchedCount,
    matches: compactMatches,
    matchesComplete: matchedCount <= limit,
    ungespeichert: dirtyState.dirty,
    physicalInputUsed: false,
    hinweis: list.rowsComplete
      ? "Alle vom BelegManager gezaehlten Zeilen sind im Qt-Baum enthalten."
      : `BelegManager zaehlt ${list.count} Belege, aber Qt exponiert aktuell ${list.rows.length} Zeilen; Ergebnis ist sichtbar, nicht vollstaendig.`,
    nativeDurationMs: tool.nativeDurationMs + dirtyState.durationMs!,
  };
}
