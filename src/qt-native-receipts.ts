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

function receiptList(nodes: QtSnapshotNode[], policy: z.infer<typeof receiptPolicySchema>) {
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
  if (list.error) return list.error;
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
