import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import type { QtNativeClient } from "./qt-native-client.js";
import { readQtNativeSnapshot, type QtSnapshotNode } from "./qt-native-snapshot.js";

const receiptPolicySchema = z.object({
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

const fail = (kind: string, error: string): WorkerResult => ({ ok: false, backend: "qt", kind, error });
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex").toUpperCase();

function receiptToolAidSuffixes(policy: z.infer<typeof receiptPolicySchema>): string[] {
  return [...new Set([
    ...Object.values(policy.states).flatMap(state => state.requiredAutomationIdSuffixes),
    ...Object.values(policy.actions).map(action => action.automationIdSuffix),
    policy.list.tableAutomationIdSuffix,
    ...policy.list.countLabelAutomationIdSuffixes,
    policy.list.searchAutomationIdSuffix,
  ])];
}

async function receiptToolSnapshot(
  client: QtNativeClient, policy: z.infer<typeof receiptPolicySchema>, timeoutMs: number, signal?: AbortSignal,
) {
  return readQtNativeSnapshot(client, {
    maxNodes: 5000,
    toolTitle: policy.title,
    aidSuffixes: receiptToolAidSuffixes(policy),
  }, timeoutMs, signal);
}

async function receiptDetailSnapshot(
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

async function receiptDirtyState(
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

function receiptState(nodes: QtSnapshotNode[], hwnd: number, policy: z.infer<typeof receiptPolicySchema>) {
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
  return { state, fingerprint: sha256({ hwnd, state, nodes: stableNodes }) };
}

function toggleState(node: QtSnapshotNode): string | null {
  if (node.checked === "unbestimmt") return "Indeterminate";
  if (node.checked === true) return "On";
  if (node.checked === false) return "Off";
  return null;
}

interface ReceiptCell {
  name: string; rid: string; selected: boolean | null; toggleState: string | null;
  x: number; y: number; w: number; h: number;
}
interface ReceiptRow {
  index: number; rowRid: string; rowFingerprint: string; contentFingerprint: string;
  primaryText: string; documentNumber: string; cells: ReceiptCell[]; draft: boolean; selected: boolean;
}
interface ReceiptListProjection {
  count: number; countSource: string; countText: string; headers: string[]; rows: ReceiptRow[];
  draftCount: number; listFingerprint: string; rowsComplete: boolean; gridProjectionError: string | null;
}

function receiptList(nodes: QtSnapshotNode[], policy: z.infer<typeof receiptPolicySchema>): ReceiptListProjection | { error: WorkerResult } {
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
      rowFingerprint: sha256({ index, rid: rowRid, cells: names }),
      contentFingerprint: sha256({ primaryText }),
      primaryText,
      documentNumber,
      cells,
      draft: names.some(name => name.endsWith(policy.list.draftMarker)),
      selected: cells.some(cell => cell.selected === true),
    };
  });
  const listFingerprint = sha256({ count, rows: rows.map(row => row.rowFingerprint) });
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

function receiptDetailFields(nodes: QtSnapshotNode[]) {
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

function receiptEditableValues(nodes: QtSnapshotNode[], policy: z.infer<typeof receiptPolicySchema>) {
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

function sameSemanticRow(left: ReceiptRow, right: ReceiptRow) {
  return left.primaryText === right.primaryText && left.documentNumber === right.documentNumber
    && left.contentFingerprint === right.contentFingerprint
    && JSON.stringify(stableCellNames(left)) === JSON.stringify(stableCellNames(right));
}

function exactDetailClose(nodes: QtSnapshotNode[], policy: z.infer<typeof receiptPolicySchema>) {
  return nodes.filter(node => node.type === "Button" && node.aid.endsWith(policy.controls.detailClose.automationIdSuffix)
    && node.name === policy.controls.detailClose.expectedName && node.w > 0 && node.h > 0 && node.on);
}

function detailIdentityMatches(values: Record<string, unknown> | null, row: ReceiptRow,
  policy: z.infer<typeof receiptPolicySchema>) {
  return Boolean(values && values.title === receiptDetailTitle(row, policy)
    && (!row.documentNumber || values.documentNumber === row.documentNumber));
}

function detailBindingFingerprint(values: Record<string, unknown> | null) {
  if (!values) return null;
  return sha256({
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

/** Read one exact receipt detail through acknowledged in-process Qt cell/close actions. */
export async function executeQtNativeReceiptManagerRead(
  client: QtNativeClient,
  args: Readonly<Record<string, unknown>>,
  timeoutMs: number,
  signal?: AbortSignal,
  profile?: ProductProfile,
): Promise<WorkerResult> {
  const parsedPolicy = receiptPolicySchema.safeParse(profile?.pageObjectsCatalog.windows.receiptManager);
  if (!parsedPolicy.success) return fail("invalid-catalog", "The active profile has no complete receipt-manager detail policy.");
  const rowRid = typeof args.rowRid === "string" ? args.rowRid : "";
  const rowFingerprint = typeof args.rowFingerprint === "string" ? args.rowFingerprint.toUpperCase() : "";
  const expectedListFingerprint = typeof args.expectedListFingerprint === "string"
    ? args.expectedListFingerprint.toUpperCase() : "";
  const waitMs = args.waitMs === undefined ? 2500 : Number(args.waitMs);
  if (!rowRid || !/^[A-F0-9]{64}$/u.test(rowFingerprint) || !/^[A-F0-9]{64}$/u.test(expectedListFingerprint)) {
    return fail("bad-args", "rowRid, rowFingerprint and expectedListFingerprint are required.");
  }
  if (!Number.isSafeInteger(waitMs) || waitMs < 100 || waitMs > 10_000) {
    return fail("bad-args", "waitMs must be an integer from 100 through 10000.");
  }
  const policy = parsedPolicy.data;
  const started = performance.now();
  const remaining = () => Math.floor(timeoutMs - (performance.now() - started));
  let nativeDurationMs = 0;
  const before = await receiptDetailSnapshot(client, policy, remaining(), signal);
  nativeDurationMs += before.nativeDurationMs;
  if (!before.windowEnabled || before.modalBlocked || before.stats.truncated) {
    return fail("window-obstructed", "The receipt manager is unavailable, obstructed or incomplete.");
  }
  const stateBefore = receiptState(before.nodes, before.hwnd, policy);
  if (stateBefore.error) return stateBefore.error;
  if (stateBefore.state !== "list") return fail("precondition-failed", `Receipt detail requires state 'list', current state is '${stateBefore.state}'.`);
  const listBefore = receiptList(before.nodes, policy);
  if ("error" in listBefore) return listBefore.error;
  if (listBefore.listFingerprint !== expectedListFingerprint) {
    return fail("stale", "The receipt list changed since receipt_manager_list; no native action was dispatched.");
  }
  const boundRows = listBefore.rows.filter(row => row.rowRid === rowRid && row.rowFingerprint === rowFingerprint);
  if (boundRows.length !== 1) return fail("stale", `${boundRows.length} exact bound receipt rows found; no native action was dispatched.`);
  const rowBefore = boundRows[0]!;
  const dirtyBefore = await receiptDirtyState(client, args.hwnd, policy.title, remaining(), signal);
  if (dirtyBefore.error) return dirtyBefore.error;
  nativeDurationMs += dirtyBefore.durationMs!;

  const action = async (node: QtSnapshotNode, kind: "press" | "activate-table-cell", method: string) => {
    const reply = await client.requestAcknowledged("accessibility_action", {
      toolTitle: policy.title,
      rid: node.rid,
      aid: node.aid,
      expectedName: node.name,
      action: kind,
    }, remaining(), signal);
    nativeDurationMs += reply.durationMs;
    return { reply, binding: { method, rid: node.rid, aid: node.aid, name: node.name,
      receiptAcknowledged: reply.receiptAcknowledged, mutationAckMs: reply.mutationAckMs } };
  };

  let detail = before;
  let fields = receiptDetailFields(detail.nodes);
  let editable = receiptEditableValues(detail.nodes, policy);
  let identityMatches = editable.complete && detailIdentityMatches(editable.values, rowBefore, policy)
    && listBefore.listFingerprint === expectedListFingerprint;
  let clickBinding: Record<string, unknown> = { method: "already-open-detail", clickCount: 0 };
  let rowVisibilityAttempts = 0;
  if (!identityMatches) {
    const targets = rowBefore.cells.filter(cell => cell.rid === rowBefore.rowRid && cell.name);
    if (targets.length !== 1) return fail("stale", `${targets.length} exact native receipt cells found; no action was dispatched.`);
    const target = before.nodes.filter(node => node.rid === targets[0]!.rid && node.aid.endsWith(policy.list.tableAutomationIdSuffix)
      && node.name === targets[0]!.name && node.type === "DataItem");
    if (target.length !== 1) return fail("stale", `${target.length} live exact native receipt cells found; no action was dispatched.`);
    const opened = await action(target[0]!, "activate-table-cell", "qt-table-cell-activate");
    clickBinding = opened.binding;
    rowVisibilityAttempts = 1;
    if (opened.reply.result.ok !== true) {
      return { ok: false, backend: "qt", kind: String(opened.reply.result.code ?? "native-action"),
        error: String(opened.reply.result.error ?? "The exact native receipt cell could not be activated; do not replay."),
        physicalInputUsed: false, foregroundLeaseUsed: false, clickBinding, nativeDurationMs };
    }
    const openDeadline = Math.min(started + timeoutMs, performance.now() + waitMs);
    do {
      await delay(Math.min(100, Math.max(1, openDeadline - performance.now())));
      detail = await receiptDetailSnapshot(client, policy, remaining(), signal);
      nativeDurationMs += detail.nativeDurationMs;
      fields = receiptDetailFields(detail.nodes);
      editable = receiptEditableValues(detail.nodes, policy);
      identityMatches = editable.complete && detailIdentityMatches(editable.values, rowBefore, policy);
      if (fields.length && identityMatches && exactDetailClose(detail.nodes, policy).length === 1) break;
    } while (performance.now() < openDeadline && remaining() > 0);
  }

  const detailFingerprint = editable.complete ? detailBindingFingerprint(editable.values) : null;
  const closeTargets = exactDetailClose(detail.nodes, policy);
  let closeBinding: Record<string, unknown> | null = null;
  let listAfter: ReceiptListProjection | null = null;
  let restored: Awaited<ReturnType<typeof receiptToolSnapshot>> | null = null;
  if (closeTargets.length === 1) {
    const closed = await action(closeTargets[0]!, "press", "qt-accessibility-press");
    closeBinding = closed.binding;
    if (closed.reply.result.ok === true) {
      const restoreDeadline = Math.min(started + timeoutMs, performance.now() + waitMs);
      const expectedSemanticRows = listBefore.rows.map(row => row.contentFingerprint).sort();
      do {
        await delay(Math.min(100, Math.max(1, restoreDeadline - performance.now())));
        restored = await receiptToolSnapshot(client, policy, remaining(), signal);
        nativeDurationMs += restored.nativeDurationMs;
        const candidate = receiptList(restored.nodes, policy);
        if (!("error" in candidate)) {
          listAfter = candidate;
          const actual = candidate.rows.map(row => row.contentFingerprint).sort();
          if (candidate.rowsComplete && candidate.count === listBefore.count
            && JSON.stringify(actual) === JSON.stringify(expectedSemanticRows)) break;
        }
      } while (performance.now() < restoreDeadline && remaining() > 0);
    }
  }

  const dirtyAfter = await receiptDirtyState(client, args.hwnd, policy.title, remaining(), signal);
  if (dirtyAfter.error) return dirtyAfter.error;
  nativeDurationMs += dirtyAfter.durationMs!;
  const expectedSemanticRows = listBefore.rows.map(row => row.contentFingerprint).sort();
  const actualSemanticRows = listAfter ? listAfter.rows.map(row => row.contentFingerprint).sort() : [];
  const exactRowsAfter = listAfter
    ? listAfter.rows.filter(row => row.rowRid === rowBefore.rowRid && row.rowFingerprint === rowBefore.rowFingerprint) : [];
  const semanticRowsAfter = listAfter
    ? listAfter.rows.filter(row => sameSemanticRow(row, rowBefore)) : [];
  const semanticListUnchanged = Boolean(listAfter && listAfter.rowsComplete
    && listAfter.count === listBefore.count && JSON.stringify(actualSemanticRows) === JSON.stringify(expectedSemanticRows)
    && semanticRowsAfter.length === 1);
  const windowSetUnchanged = Boolean(restored && restored.hwnd === before.hwnd);
  const dialogFreeAfter = Boolean(restored && restored.windowEnabled && !restored.modalBlocked);
  const dirtyStateUnchanged = dirtyAfter.dirty === dirtyBefore.dirty;
  const verified = Boolean(fields.length && detailFingerprint && editable.complete && identityMatches
    && semanticListUnchanged && windowSetUnchanged && dialogFreeAfter && dirtyStateUnchanged && closeBinding);
  const common = {
    backend: "qt",
    pid: client.binding.pid,
    hwnd: before.hwnd,
    mainHwnd: client.binding.hwnd,
    managerHwnd: before.hwnd,
    row: semanticRowsAfter.length === 1 ? semanticRowsAfter[0] : rowBefore,
    fields,
    values: editable.values,
    valuesComplete: editable.complete,
    listFingerprint: listAfter ? listAfter.listFingerprint : null,
    detailFingerprint,
    listFingerprintBefore: expectedListFingerprint,
    semanticListUnchanged,
    targetRowRebound: exactRowsAfter.length === 1,
    rowAfter: exactRowsAfter.length === 1 ? exactRowsAfter[0] : null,
    targetSemanticRebound: semanticRowsAfter.length === 1,
    semanticRowAfter: semanticRowsAfter.length === 1 ? semanticRowsAfter[0] : null,
    detailIdentityMatchesTarget: identityMatches,
    dialogFreeAfter,
    windowSetUnchanged,
    ungespeichertVorher: dirtyBefore.dirty,
    ungespeichertNachher: dirtyAfter.dirty,
    dirtyStateUnchanged,
    physicalInputUsed: false,
    foregroundLeaseUsed: false,
    rowVisibilityMethod: rowVisibilityAttempts ? "qt-table-cell-activate" : "already-open-detail",
    rowVisibilityAttempts,
    verified,
    clickBinding,
    closeBinding,
    nativeDurationMs,
  };
  if (verified) return { ok: true, ...common };
  const openConditions = [
    ...(!fields.length ? ["detail-fields-missing"] : []),
    ...(!identityMatches ? ["detail-identity-mismatch"] : []),
    ...(!semanticListUnchanged ? ["semantic-list-drift"] : []),
    ...(!windowSetUnchanged ? ["window-set-drift"] : []),
    ...(!dialogFreeAfter ? ["blocking-dialog"] : []),
    ...(!dirtyStateUnchanged ? ["dirty-state-drift"] : []),
    ...(!closeBinding ? ["detail-close-missing"] : []),
  ];
  return { ok: false, kind: "postcondition-failed",
    error: `The exact native receipt detail transaction was not fully proven (${openConditions.join(", ")}); do not replay.`,
    offeneBedingungen: openConditions, ...common };
}

/** Execute one catalogue-bound BelegManager navigation through an acknowledged in-process Qt action. */
export async function executeQtNativeReceiptManagerAction(
  client: QtNativeClient,
  args: Readonly<Record<string, unknown>>,
  timeoutMs: number,
  signal?: AbortSignal,
  profile?: ProductProfile,
): Promise<WorkerResult> {
  const parsedPolicy = receiptPolicySchema.safeParse(profile?.pageObjectsCatalog.windows.receiptManager);
  if (!parsedPolicy.success) return fail("invalid-catalog", "The active profile has no complete receipt-manager action policy.");
  const actionId = typeof args.actionId === "string" ? args.actionId : "";
  const action = Object.hasOwn(parsedPolicy.data.actions, actionId) ? parsedPolicy.data.actions[actionId] : undefined;
  if (!action) return fail("bad-args", `Unknown receipt-manager actionId '${actionId}'.`);
  const waitMs = args.waitMs === undefined ? 2500 : Number(args.waitMs);
  if (!Number.isSafeInteger(waitMs) || waitMs < 100 || waitMs > 10_000) return fail("bad-args", "waitMs must be an integer from 100 through 10000.");
  const started = performance.now();
  const remaining = () => Math.floor(timeoutMs - (performance.now() - started));
  const before = await receiptToolSnapshot(client, parsedPolicy.data, remaining(), signal);
  if (!before.windowEnabled || before.modalBlocked || before.stats.truncated) return fail("window-obstructed", "The receipt manager is unavailable or obstructed.");
  const stateBefore = receiptState(before.nodes, before.hwnd, parsedPolicy.data);
  if (stateBefore.error) return stateBefore.error;
  if (stateBefore.state !== action.fromState) return fail("precondition-failed", `Receipt-manager action '${actionId}' requires state '${action.fromState}', current state is '${stateBefore.state}'.`);
  const targets = before.nodes.filter(node => node.w > 0 && node.h > 0 && node.on && node.aid.endsWith(action.automationIdSuffix));
  if (targets.length !== 1 || (action.expectedName && targets[0]!.name !== action.expectedName)) {
    return fail("precondition-failed", `The catalogue-bound receipt-manager target '${action.automationIdSuffix}' is not unique and exact.`);
  }
  const dirtyBefore = await receiptDirtyState(client, args.hwnd, parsedPolicy.data.title, remaining(), signal);
  if (dirtyBefore.error) return dirtyBefore.error;
  const target = targets[0]!;
  const actionReply = await client.requestAcknowledged("accessibility_action", {
    toolTitle: parsedPolicy.data.title,
    rid: target.rid,
    aid: target.aid,
    ...(action.expectedName ? { expectedName: action.expectedName } : {}),
    action: "press",
  }, remaining(), signal);
  if (actionReply.result.ok !== true) {
    return fail(String(actionReply.result.code ?? "native-action"), String(actionReply.result.error ?? "Native receipt-manager action failed."));
  }
  const postconditionDeadline = Math.min(started + timeoutMs, performance.now() + waitMs);
  let after: Awaited<ReturnType<typeof receiptToolSnapshot>> | undefined;
  let stateAfter: ReturnType<typeof receiptState> | undefined;
  do {
    if (signal?.aborted) return fail("aborted", "Native receipt-manager action was cancelled after its acknowledged effect.");
    await delay(Math.min(100, Math.max(1, postconditionDeadline - performance.now())));
    after = await receiptToolSnapshot(client, parsedPolicy.data, remaining(), signal);
    stateAfter = receiptState(after.nodes, after.hwnd, parsedPolicy.data);
    if (!stateAfter.error && stateAfter.state === action.toState) break;
  } while (performance.now() < postconditionDeadline && remaining() > 0);
  const dirtyAfter = await receiptDirtyState(client, args.hwnd, parsedPolicy.data.title, remaining(), signal);
  if (dirtyAfter.error) return dirtyAfter.error;
  const verified = Boolean(after && stateAfter && !stateAfter.error && stateAfter.state === action.toState
    && after.hwnd === before.hwnd && after.windowEnabled && !after.modalBlocked && !after.stats.truncated
    && dirtyAfter.dirty === dirtyBefore.dirty);
  const windowSetFingerprint = sha256({ pid: client.binding.pid, mainHwnd: client.binding.hwnd,
    managerHwnd: before.hwnd, title: parsedPolicy.data.title });
  const common = {
    backend: "qt",
    actionId,
    pid: client.binding.pid,
    hwnd: before.hwnd,
    controlAutomationId: target.aid,
    controlName: target.name,
    stateBefore: stateBefore.state,
    stateAfter: stateAfter && !stateAfter.error ? stateAfter.state : null,
    stateFingerprintBefore: stateBefore.fingerprint,
    stateFingerprintAfter: stateAfter && !stateAfter.error ? stateAfter.fingerprint : null,
    windowSetFingerprintBefore: windowSetFingerprint,
    windowSetFingerprintAfter: windowSetFingerprint,
    windowSetUnchanged: true,
    ungespeichertVorher: dirtyBefore.dirty,
    ungespeichertNachher: dirtyAfter.dirty,
    dirtyStateUnchanged: dirtyAfter.dirty === dirtyBefore.dirty,
    physicalInputUsed: false,
    foregroundLeaseUsed: false,
    verified,
    clickBinding: { method: "qt-accessibility-press", rid: target.rid, aid: target.aid,
      receiptAcknowledged: actionReply.receiptAcknowledged, mutationAckMs: actionReply.mutationAckMs },
    nativeDurationMs: before.nativeDurationMs + dirtyBefore.durationMs! + (after?.nativeDurationMs ?? 0)
      + dirtyAfter.durationMs! + actionReply.durationMs,
  };
  return verified ? { ok: true, ...common }
    : { ok: false, kind: "postcondition-failed", error: "The acknowledged native receipt-manager action did not reach its exact catalogued state without dirty-state drift; do not replay.", ...common };
}
