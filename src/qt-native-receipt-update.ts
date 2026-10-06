import { setTimeout as delay } from "node:timers/promises";
import type { WorkerResult } from "./api-contract.js";
import type { ProductProfile } from "./product-profiles.js";
import { SSE_MCP_RECEIPT_SCHEMAS } from "./mcp-schemas-receipts.js";
import { QtNativeAcknowledgmentError, QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import type { QtSnapshotNode } from "./qt-native-snapshot.js";
import {
  detailBindingFingerprint, detailIdentityMatches, exactDetailClose, fail, receiptDetailSnapshot,
  receiptDirtyState, receiptEditableValues, receiptList, receiptPolicySchema, receiptState,
  receiptWindowSet, sameSemanticRow, type ReceiptListProjection, type ReceiptRow,
} from "./qt-native-receipts.js";

type Field = "title" | "date" | "documentNumber" | "amount" | "vatRate" | "net" | "note";
const fields: readonly Field[] = ["title", "date", "documentNumber", "amount", "net", "vatRate", "note"];
type Values = Record<string, unknown>;
type Detail = Awaited<ReturnType<typeof receiptDetailSnapshot>>;
type Policy = ReturnType<typeof receiptPolicySchema.parse>;
type Edit = { field: Field; before: unknown; requested: unknown; verified: boolean };

class ReceiptUpdateError extends Error {
  constructor(message: string, readonly kind = "postcondition-failed", readonly outcomeUnknown = false) { super(message); }
}

function amountCents(value: unknown): bigint | null {
  let text = String(value);
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/u.test(text)) text = text.replaceAll(".", "");
  const match = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/u.exec(text);
  if (!match) return null;
  const magnitude = BigInt(match[2]!) * 100n + BigInt((match[3] ?? "").padEnd(2, "0") || "0");
  return match[1] ? -magnitude : magnitude;
}

function equalValue(field: Field, actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (field === "amount") {
    const left = amountCents(actual), right = amountCents(expected);
    return left !== null && right !== null && left === right;
  }
  return actual === expected;
}

function rawValue(field: Field, value: unknown): string {
  if (field === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value))) return String(value);
    const [year, month, day] = String(value).split("-");
    return `${day}.${month}.${year}`;
  }
  if (field === "amount") {
    if (value === "") return "";
    const cents = amountCents(value);
    if (cents === null) throw new ReceiptUpdateError("Receipt amount is not an exact decimal.", "bad-args");
    const magnitude = cents < 0n ? -cents : cents;
    return `${cents < 0n ? "-" : ""}${magnitude / 100n},${String(magnitude % 100n).padStart(2, "0")}`;
  }
  return String(value);
}

function validDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year!, month! - 1, day!);
  return year! > 0 && date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function fieldNode(detail: Detail, policy: Policy, field: Field): QtSnapshotNode {
  const definition = policy.controls.editableFields[field];
  const matches = detail.nodes.filter(node => node.aid.endsWith(definition.automationIdSuffix)
    && node.type === definition.controlType && node.w > 0 && node.h > 0 && node.on
    && (field === "net" ? typeof node.checked === "boolean" : node.ro === false && node.val !== null));
  if (matches.length !== 1) throw new ReceiptUpdateError(`The exact writable receipt field '${field}' is not unique.`, "stale");
  return matches[0]!;
}

function rawReceiptValues(detail: Detail, policy: Policy, selectedFields: readonly Field[]): Values {
  return Object.fromEntries(selectedFields.map(field => {
    const definition = policy.controls.editableFields[field];
    const node = detail.nodes.find(node => node.aid.endsWith(definition.automationIdSuffix)
      && node.type === definition.controlType && node.w > 0 && node.h > 0 && node.on)!;
    return [field, field === "net" ? node.checked : node.val ?? node.name];
  }));
}

function reboundRow(list: ReceiptListProjection, values: Values, policy: Policy) {
  const title = String(values.title), documentNumber = String(values.documentNumber);
  const titleRows = list.rows.filter(row => row.primaryText === title
    || (row.draft && row.primaryText === title + policy.list.draftMarker));
  const documentRows = list.rows.filter(row => row.documentNumber === documentNumber);
  const exact = titleRows.filter(row => row.documentNumber === documentNumber);
  const documentNumberCellIndices = [...new Set(list.rows.flatMap(row => row.cells.flatMap((cell, index) =>
    documentNumber && cell.name === documentNumber ? [index] : [])))].sort((left, right) => left - right);
  // The worker has the same explicit projection rule: some supported grids omit
  // document numbers entirely. Detail readback must prove the number first.
  const titleOnly = exact.length === 0 && titleRows.length === 1 && documentNumberCellIndices.length === 0;
  return { row: exact.length === 1 ? exact[0]! : titleOnly ? titleRows[0]! : null,
    targetIdentityMatchCount: exact.length, titleIdentityMatchCount: titleRows.length,
    documentNumberIdentityMatchCount: documentRows.length, documentNumberCellIndices,
    identityProjectionComplete: exact.length === 1 || titleOnly };
}

function otherRowsEqual(before: ReceiptListProjection, targetBefore: ReceiptRow,
  after: ReceiptListProjection, targetAfter: ReceiptRow): boolean {
  const remaining = after.rows.filter(row => row !== targetAfter);
  for (const row of before.rows.filter(candidate => candidate !== targetBefore)) {
    const index = remaining.findIndex(candidate => sameSemanticRow(row, candidate));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}

/** Exact, acknowledged Qt edits followed by independent detail and complete list proofs. */
export async function executeQtNativeReceiptManagerUpdate(
  client: QtNativeClient, input: Readonly<Record<string, unknown>>, timeoutMs: number,
  signal?: AbortSignal, profile?: ProductProfile,
): Promise<WorkerResult> {
  const parsed = SSE_MCP_RECEIPT_SCHEMAS.sse_receipt_manager_update.safeParse(input);
  if (!parsed.success) return fail("bad-args", parsed.error.message);
  const args = parsed.data;
  if (args.values.date && !validDate(args.values.date)) return fail("bad-args", "Receipt date is not a valid calendar date.");
  if (args.values.amount && Number(args.values.amount.replace(",", ".")) > 999999999)
    return fail("bad-args", "Receipt amount exceeds the supported maximum.");
  const parsedPolicy = receiptPolicySchema.safeParse(profile?.pageObjectsCatalog.windows.receiptManager);
  if (!parsedPolicy.success) return fail("invalid-catalog", "The active profile has no complete receipt-manager edit policy.");
  const policy = parsedPolicy.data, waitMs = args.waitMs ?? 3500;
  const requestedFields = fields.filter(field => args.values[field] !== undefined);
  const requestedValues = Object.fromEntries(requestedFields.map(field => [field,
    field === "net" ? args.values[field] : field === "vatRate" ? `${args.values[field]} %` : rawValue(field, args.values[field])]));
  const started = performance.now();
  let mutationStarted = false, persistentMutationStarted = false, nativeDurationMs = 0;
  let detailCloseStarted = false;
  let managerHwnd: number | null = null;
  let lastActionBinding: Record<string, unknown> | null = null;
  let selectionBinding: Record<string, unknown> = { method: "already-open-detail" };
  let closeBinding: Record<string, unknown> | null = null;
  let valuesBefore: Values | null = null, valuesAfter: Values | null = null;
  let rawBefore: Values | null = null, rawAfter: Values | null = null;
  const edits: Edit[] = [];
  const budget = () => {
    const left = Math.floor(timeoutMs - (performance.now() - started));
    if (left < 1) throw new QtNativeTransportError("Receipt update deadline expired.", "native-timeout", mutationStarted);
    return left;
  };
  const detailRead = async () => {
    const detail = await receiptDetailSnapshot(client, policy, budget(), signal);
    nativeDurationMs += detail.nativeDurationMs;
    if (managerHwnd !== null && detail.hwnd !== managerHwnd)
      throw new ReceiptUpdateError("The bound receipt manager window changed; no further action dispatched.", "stale-window", true);
    managerHwnd = detail.hwnd;
    if (!detail.windowEnabled || detail.modalBlocked || detail.stats.truncated)
      throw new ReceiptUpdateError("Receipt detail is obstructed or incomplete.", "window-obstructed");
    return detail;
  };
  const action = async (node: QtSnapshotNode, kind: string, extra: Record<string, unknown> = {}) => {
    const persistent = ["replace-edit-text", "select-combo-value", "toggle-check-box"].includes(kind);
    lastActionBinding = { method: `qt-${kind}`, rid: node.rid, aid: node.aid, name: node.name };
    let reply: Awaited<ReturnType<QtNativeClient["requestAcknowledged"]>>;
    try {
      reply = await client.requestAcknowledged("accessibility_action", {
        toolTitle: policy.title, expectedRootHwnd: managerHwnd,
        rid: node.rid, aid: node.aid, expectedName: node.name, action: kind, ...extra,
      }, budget(), signal);
    } catch (error) {
      if (error instanceof QtNativeAcknowledgmentError && error.mutationResult.mutationAttempted === true
        || error instanceof QtNativeTransportError && error.outcomeUnknown) {
        mutationStarted = true;
        persistentMutationStarted ||= persistent;
      }
      throw error;
    }
    mutationStarted ||= reply.result.mutationAttempted === true;
    persistentMutationStarted ||= persistent && reply.result.mutationAttempted === true;
    nativeDurationMs += reply.durationMs;
    lastActionBinding = { ...lastActionBinding, receiptAcknowledged: reply.receiptAcknowledged, mutationAckMs: reply.mutationAckMs };
    if (reply.result.ok !== true) throw new ReceiptUpdateError(
      String(reply.result.error ?? "The exact Qt action was rejected."), String(reply.result.code ?? "native-action"),
      reply.result.outcomeUnknown === true || reply.result.mutationAttempted === true);
    return lastActionBinding;
  };
  const editField = async (detail: Detail, field: Field, requested: unknown) => {
    const node = fieldNode(detail, policy, field);
    return action(node, field === "net" ? "toggle-check-box" : field === "vatRate" ? "select-combo-value" : "replace-edit-text",
      field === "net" ? { expectedChecked: node.checked, checked: requested }
        : { expectedValue: node.val, value: rawValue(field, requested) });
  };
  const readValues = (detail: Detail) => {
    const result = receiptEditableValues(detail.nodes, policy);
    if (!result.complete || !result.values) throw new ReceiptUpdateError("All receipt detail fields must remain readable.", "stale");
    return result.values;
  };
  const waitDetail = async (predicate: (detail: Detail) => boolean) => {
    const deadline = Math.min(started + timeoutMs, performance.now() + waitMs);
    let detail = await detailRead();
    while (!predicate(detail) && performance.now() < deadline) {
      await delay(Math.min(25, Math.max(1, deadline - performance.now())), undefined, { signal });
      detail = await detailRead();
    }
    return detail;
  };
  const closeDetail = async (detail: Detail) => {
    const close = exactDetailClose(detail.nodes, policy);
    if (close.length !== 1) throw new ReceiptUpdateError("The exact receipt detail close action is not unique.", "stale");
    closeBinding = await action(close[0]!, "press");
    detailCloseStarted = true;
    const deadline = Math.min(started + timeoutMs, performance.now() + waitMs);
    let restored: Detail;
    do {
      restored = await detailRead();
      if (exactDetailClose(restored.nodes, policy).length === 0) return restored;
      await delay(Math.min(25, Math.max(1, deadline - performance.now())), undefined, { signal });
    } while (performance.now() < deadline);
    throw new ReceiptUpdateError("Receipt detail did not close within its bound.");
  };

  const before = await detailRead();
  const state = receiptState(before.nodes, before.hwnd, policy);
  if (state.error) return state.error;
  if (state.state !== "list") return fail("precondition-failed", "Receipt update requires the receipt list state.");
  const listBefore = receiptList(before.nodes, policy);
  if ("error" in listBefore) return listBefore.error;
  if (!listBefore.rowsComplete) return fail("native-incomplete", "Receipt update requires the complete counted receipt list.");
  if (listBefore.listFingerprint !== args.expectedListFingerprint.toUpperCase()) return fail("stale", "Receipt list fingerprint changed; no action dispatched.");
  const rows = listBefore.rows.filter(row => row.rowRid === args.rowRid && row.rowFingerprint === args.rowFingerprint.toUpperCase());
  if (rows.length !== 1) return fail("stale", "The exact bound receipt row changed; no action dispatched.");
  const rowBefore = rows[0]!;
  const dirtyBefore = await receiptDirtyState(client, args.hwnd, policy.title, budget(), signal);
  if (dirtyBefore.error) return dirtyBefore.error;
  nativeDurationMs += dirtyBefore.durationMs!;
  const windowsBefore = await receiptWindowSet(client, budget(), signal);
  if (windowsBefore.error) return windowsBefore.error;
  nativeDurationMs += windowsBefore.durationMs!;
  const common = () => ({ backend: "qt", pid: client.binding.pid, hwnd: before.hwnd,
    mainHwnd: client.binding.hwnd, managerHwnd: before.hwnd, rowBefore, valuesBefore: rawBefore, valuesAfter: rawAfter,
    requestedValues, changedFields: edits.filter(edit => edit.verified).map(edit => edit.field),
    listFingerprintBefore: listBefore.listFingerprint, detailFingerprintBefore: args.expectedDetailFingerprint.toUpperCase(),
    ungespeichertVorher: dirtyBefore.dirty, mutationStarted, persistentMutationStarted,
    physicalInputUsed: false, foregroundLeaseUsed: false, selectionBinding, closeBinding, lastActionBinding, nativeDurationMs });

  try {
    let detail = before;
    if (!detailIdentityMatches(receiptEditableValues(detail.nodes, policy).values, rowBefore, policy)) {
      const target = detail.nodes.filter(node => node.rid === rowBefore.rowRid && node.type === "DataItem"
        && node.aid.endsWith(policy.list.tableAutomationIdSuffix) && node.name === rowBefore.primaryText);
      if (target.length !== 1) return fail("stale", "The exact receipt cell is not visible and unique; no action dispatched.");
      selectionBinding = await action(target[0]!, "activate-table-cell");
      detail = await waitDetail(candidate => detailIdentityMatches(receiptEditableValues(candidate.nodes, policy).values, rowBefore, policy)
        && exactDetailClose(candidate.nodes, policy).length === 1);
    }
    valuesBefore = readValues(detail);
    rawBefore = rawReceiptValues(detail, policy, requestedFields);
    if (!detailIdentityMatches(valuesBefore, rowBefore, policy)) throw new ReceiptUpdateError("Receipt detail belongs to another row.", "stale");
    if (detailBindingFingerprint(valuesBefore) !== args.expectedDetailFingerprint.toUpperCase()) {
      const restored = await closeDetail(detail);
      const list = receiptList(restored.nodes, policy);
      const unchanged = !("error" in list) && list.rowsComplete && list.listFingerprint === listBefore.listFingerprint;
      return { ok: false, kind: "stale", error: "Receipt detail fingerprint changed; no receipt fields were edited.",
        ...common(), detailClosed: true, cleanupRequired: !unchanged, verified: false };
    }
    let working = { ...valuesBefore };
    for (const field of requestedFields) {
      const requested = args.values[field];
      detail = await detailRead();
      const liveValues = readValues(detail);
      if (!fields.every(name => equalValue(name, liveValues[name], working[name])))
        throw new ReceiptUpdateError("Receipt values changed outside this transaction; no further edit dispatched.", "stale", true);
      if (equalValue(field, liveValues[field], requested)) continue;
      const edit: Edit = { field, before: liveValues[field], requested, verified: false };
      edits.push(edit);
      await editField(detail, field, requested);
      detail = await waitDetail(candidate => equalValue(field, receiptEditableValues(candidate.nodes, policy).values?.[field], requested));
      const updated = readValues(detail);
      if (!equalValue(field, updated[field], requested)) throw new ReceiptUpdateError(`Receipt field '${field}' did not commit the requested value.`);
      if (!fields.filter(name => name !== field).every(name => equalValue(name, updated[name], working[name])))
        throw new ReceiptUpdateError(`Other receipt fields changed during '${field}'; no further edit dispatched.`, "stale", true);
      edit.verified = true;
      working = updated;
    }
    detail = await detailRead();
    valuesAfter = readValues(detail);
    rawAfter = rawReceiptValues(detail, policy, requestedFields);
    const requestedMatch = fields.every(field => equalValue(field, valuesAfter![field], args.values[field] ?? valuesBefore![field]));
    if (!requestedMatch) throw new ReceiptUpdateError("Final receipt detail readback differs from the requested transaction.", "postcondition-failed", true);
    let restored = await closeDetail(detail);
    let listAfter = receiptList(restored.nodes, policy);
    const deadline = Math.min(started + timeoutMs, performance.now() + waitMs);
    while (("error" in listAfter || !listAfter.rowsComplete || !reboundRow(listAfter, valuesAfter, policy).identityProjectionComplete)
      && performance.now() < deadline) {
      await delay(Math.min(25, Math.max(1, deadline - performance.now())), undefined, { signal });
      restored = await detailRead();
      listAfter = receiptList(restored.nodes, policy);
    }
    if ("error" in listAfter) throw new ReceiptUpdateError(String(listAfter.error.error ?? "Final receipt list is unreadable."));
    const identity = reboundRow(listAfter, valuesAfter, policy);
    const dirtyAfter = await receiptDirtyState(client, args.hwnd, policy.title, budget(), signal);
    if (dirtyAfter.error) throw new ReceiptUpdateError(String(dirtyAfter.error.error));
    nativeDurationMs += dirtyAfter.durationMs!;
    const windowsAfter = await receiptWindowSet(client, budget(), signal);
    if (windowsAfter.error) throw new ReceiptUpdateError(String(windowsAfter.error.error));
    nativeDurationMs += windowsAfter.durationMs!;
    const countUnchanged = listAfter.rowsComplete && listAfter.count === listBefore.count;
    const otherRowsUnchanged = Boolean(identity.row && otherRowsEqual(listBefore, rowBefore, listAfter, identity.row));
    const windowSetUnchanged = windowsBefore.fingerprint === windowsAfter.fingerprint;
    const dirtyStateUnchanged = dirtyBefore.dirty === dirtyAfter.dirty;
    const detailClosed = exactDetailClose(restored.nodes, policy).length === 0;
    const verified = countUnchanged && otherRowsUnchanged && windowSetUnchanged && dirtyStateUnchanged && detailClosed && identity.identityProjectionComplete;
    const { row: rowAfter, ...identityProof } = identity;
    const result = { ...common(), rowAfter, ...identityProof,
      valuesComplete: true, draftBefore: rowBefore.draft, draftAfter: identity.row?.draft ?? null,
      listFingerprintAfter: listAfter.listFingerprint, detailFingerprintAfter: detailBindingFingerprint(valuesAfter),
      detailClosed, countUnchanged, otherRowsUnchanged, windowSetUnchanged,
      windowSetFingerprintBefore: windowsBefore.fingerprint, windowSetFingerprintAfter: windowsAfter.fingerprint,
      ungespeichertNachher: dirtyAfter.dirty, dirtyStateUnchanged, rollback: { attempted: false, ok: true, complete: null, fields: [] },
      cleanupRequired: !verified, verified };
    if (verified) return { ok: true, ...result };
    const offeneBedingungen = [!countUnchanged && "count-drift", !otherRowsUnchanged && "other-row-drift",
      !windowSetUnchanged && "window-set-drift", !dirtyStateUnchanged && "dirty-state-drift",
      !detailClosed && "detail-not-closed", !identity.identityProjectionComplete && "target-identity-ambiguous"].filter(Boolean);
    return { ok: false, kind: "postcondition-failed", error: "Receipt update postconditions were not fully proven; do not replay.", offeneBedingungen, ...result };
  } catch (error) {
    const uncertain = detailCloseStarted || signal?.aborted === true || error instanceof QtNativeTransportError
      || error instanceof ReceiptUpdateError && error.outcomeUnknown;
    const rollback: { attempted: boolean; complete: boolean | null; fields: Record<string, unknown>[] } = { attempted: false, complete: null, fields: [] };
    // Never replay an unacknowledged write or overwrite an unexpected value.
    // A rejected, acknowledged edit can restore only fields still equal to our
    // requested value, through a fresh exact target and independent readback.
    if (!uncertain && valuesBefore && edits.length) {
      rollback.attempted = true;
      rollback.complete = true;
      try {
        for (const edit of [...edits].reverse()) {
          let detail = await detailRead();
          const live = readValues(detail)[edit.field];
          if (equalValue(edit.field, live, edit.before)) { rollback.fields.push({ field: edit.field, verified: true, action: "unchanged" }); continue; }
          if (!equalValue(edit.field, live, edit.requested)) {
            rollback.complete = false;
            rollback.fields.push({ field: edit.field, verified: false, action: "unexpected-value-preserved" }); continue;
          }
          await editField(detail, edit.field, edit.before);
          detail = await waitDetail(candidate => equalValue(edit.field, receiptEditableValues(candidate.nodes, policy).values?.[edit.field], edit.before));
          const verified = equalValue(edit.field, readValues(detail)[edit.field], edit.before);
          rollback.complete &&= verified;
          rollback.fields.push({ field: edit.field, verified, action: "restored" });
        }
        const detail = await detailRead();
        valuesAfter = readValues(detail);
        rawAfter = rawReceiptValues(detail, policy, requestedFields);
        rollback.complete &&= fields.every(field => equalValue(field, valuesAfter![field], valuesBefore![field]));
      } catch { rollback.complete = false; }
    }
    let cleanupVerified = false;
    if (rollback.complete && valuesBefore) {
      try {
        const restored = await closeDetail(await detailRead());
        const list = receiptList(restored.nodes, policy);
        const dirty = await receiptDirtyState(client, args.hwnd, policy.title, budget(), signal);
        const windows = await receiptWindowSet(client, budget(), signal);
        if (!dirty.error) nativeDurationMs += dirty.durationMs!;
        if (!windows.error) nativeDurationMs += windows.durationMs!;
        cleanupVerified = !("error" in list) && list.rowsComplete && list.count === listBefore.count
          && list.rows.filter(row => sameSemanticRow(row, rowBefore)).length === 1
          && listBefore.rows.every(row => list.rows.filter(candidate => sameSemanticRow(row, candidate)).length === 1)
          && !dirty.error && dirty.dirty === dirtyBefore.dirty && !windows.error && windows.fingerprint === windowsBefore.fingerprint;
      } catch { cleanupVerified = false; }
    }
    return { ok: false, ...common(), kind: error instanceof QtNativeTransportError || error instanceof ReceiptUpdateError ? error.kind : "native-contract",
      error: `${error instanceof Error ? error.message : String(error)} Do not replay.`,
      outcomeUnknown: uncertain && mutationStarted, resultingState: cleanupVerified ? "restored" : mutationStarted ? "unknown" : "unchanged",
      rollback: { ...rollback, ok: rollback.complete === true },
      detailClosed: cleanupVerified, cleanupRequired: mutationStarted && !cleanupVerified, verified: false };
  }
}
