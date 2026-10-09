import { setTimeout as delay } from "node:timers/promises";
import type { WorkerResult } from "./api-contract.js";
import { SSE_API_GOTO_SCHEMA } from "./operation-schema-goto.js";
import { resolvePageObjectDefinition, type ProductProfile } from "./product-profiles.js";
import { QtNativeAcknowledgmentError, QtNativeTransportError, type QtNativeClient } from "./qt-native-client.js";
import { containerDescendants, findContainerNode, readProcessWindowInventory, transmissionName } from "./qt-native-projections.js";
import { readQtNativeSnapshot, type QtSnapshotNode } from "./qt-native-snapshot.js";
import { gotoLanding, gotoRoute, gotoTargetState, pagingOrder, selectSearchHit, visibleNavigationItem,
  type GotoPage, type GotoSnapshot } from "./qt-native-goto-projection.js";

class GotoError extends Error {
  constructor(message: string, readonly kind = "navigation-blocked", readonly unknown = false) { super(message); }
}

/** One bound Qt navigation transaction, including the existing bounded form/history path. */
export async function executeQtNativeGoto(
  client: QtNativeClient, input: Readonly<Record<string, unknown>>, timeoutMs: number,
  signal?: AbortSignal, profile?: ProductProfile,
): Promise<WorkerResult> {
  const parsed = SSE_API_GOTO_SCHEMA.safeParse(input);
  if (!parsed.success || !profile) return { ok: false, backend: "qt", kind: "bad-args", error: parsed.success ? "goto requires a product profile." : parsed.error.message };
  const args = parsed.data;
  let page: GotoPage | undefined;
  if (args.pageId) {
    const resolved = resolvePageObjectDefinition(profile.pageObjectsCatalog, args.pageId);
    if (resolved.status !== "found") return { ok: false, backend: "qt", kind: resolved.status, error: "The target page object is not uniquely defined." };
    page = resolved.page as GotoPage;
  }
  const target = page ? String(page.headingNumberedLabel || page.headingPrefix || page.heading || "") : args.ziel ?? "";
  if (!target) return { ok: false, backend: "qt", kind: "bad-args", error: "The target heading is empty." };
  if (transmissionName(target)) return { ok: false, backend: "qt", kind: "blocked", error: "Transmission navigation is not an allowed native goto target." };
  const activeProfile = profile, started = performance.now(), path: string[] = [], visited: string[] = [];
  let mutationStarted = false, nativeDurationMs = 0, steps = 0, lastHeading: string | null = null, phase = "precondition";
  const budget = () => {
    const remaining = Math.floor(timeoutMs - (performance.now() - started));
    if (remaining < 1) throw new QtNativeTransportError("Native goto deadline expired.", "native-timeout", mutationStarted);
    return remaining;
  };
  const wait = async (deadline: number) => {
    await delay(Math.max(1, Math.min(25, deadline - performance.now(), budget())), undefined, { signal });
  };
  const read = async (): Promise<GotoSnapshot> => {
    const snapshot = await readQtNativeSnapshot(client, { hwnd: args.hwnd, maxNodes: 5000 }, budget(), signal);
    nativeDurationMs += snapshot.nativeDurationMs;
    if (snapshot.stats.truncated || snapshot.stats.depthLimited || snapshot.stats.err || snapshot.stats.cyc || snapshot.stats.valErr)
      throw new GotoError("The navigation tree is incomplete or contains read errors.", "native-incomplete");
    if (!snapshot.windowEnabled || snapshot.modalBlocked) {
      const inventory = await readProcessWindowInventory(client, budget(), signal); nativeDurationMs += inventory.durationMs;
      const warnings = inventory.windows.filter(window => window.pid === client.binding.pid && window.title.startsWith("Die Prüfung hat ergeben"));
      throw new GotoError(warnings.length ? "A validation warning blocks navigation; read and answer its fingerprint before continuing."
        : "The exact navigation window is disabled or obstructed.", warnings.length ? "warning-dialog" : "window-obstructed");
    }
    lastHeading = gotoTargetState(snapshot, activeProfile, target, page).heading;
    return snapshot;
  };
  const stateOf = (snapshot: GotoSnapshot) => gotoTargetState(snapshot, activeProfile, target, page);
  const complete = (snapshot: GotoSnapshot, direction?: string): WorkerResult => ({
    ok: true, backend: "qt", erreicht: true, pageId: args.pageId ?? null, ueberschrift: stateOf(snapshot).heading,
    schritte: steps, weg: steps === 0 ? ["schon dort"] : path, ...(direction ? { richtung: direction } : {}),
    fokusfrei: true, physicalInputUsed: false, nativeDurationMs,
  });
  const dispatch = async (snapshot: GotoSnapshot, node: QtSnapshotNode, action: string, extra: Record<string, unknown> = {}) => {
    if (!node.on || node.w <= 0 || node.h <= 0 || transmissionName(node.name))
      throw new GotoError("The exact navigation control is inactive, invisible or blocked.", "stale");
    let reply: Awaited<ReturnType<QtNativeClient["requestAcknowledged"]>>;
    try {
      reply = await client.requestAcknowledged("accessibility_action", { expectedRootHwnd: snapshot.hwnd,
        rid: node.rid, aid: node.aid, expectedName: node.name, action, ...extra }, budget(), signal);
    } catch (error) {
      if (error instanceof QtNativeAcknowledgmentError && error.mutationResult.mutationAttempted === true
        || error instanceof QtNativeTransportError && error.outcomeUnknown) mutationStarted = true;
      throw error;
    }
    nativeDurationMs += reply.durationMs;
    mutationStarted ||= reply.result.mutationAttempted === true;
    if (reply.result.ok !== true) throw new GotoError(String(reply.result.error ?? "The exact navigation action failed."),
      String(reply.result.code ?? "native-action"), reply.result.outcomeUnknown === true || reply.result.mutationAttempted === true);
  };
  const button = (snapshot: GotoSnapshot, name: string) => {
    const matches = snapshot.nodes.filter(node => node.type === "Button" && node.name === name && node.on && node.w > 0 && node.h > 0);
    if (matches.length > 1) throw new GotoError(`Navigation button '${name}' is ambiguous.`, "ambiguous");
    return matches[0] ?? null;
  };
  const pollPage = async (previous: string | null, waitMs: number, stopOnOther = true) => {
    const deadline = performance.now() + Math.min(waitMs, budget());
    let snapshot: GotoSnapshot;
    do {
      snapshot = await read();
      const state = stateOf(snapshot);
      if (state.ready || stopOnOther && state.heading && state.heading !== previous && !state.headingMatches) return snapshot;
      if (performance.now() >= deadline) break;
      await wait(deadline);
    } while (performance.now() < deadline);
    if (stateOf(snapshot!).headingMatches) throw new GotoError("The target heading is visible, but its exact fields, tables or sums are incomplete; no further navigation dispatched.");
    return snapshot!;
  };
  const closeSearch = async (snapshot: GotoSnapshot): Promise<GotoSnapshot> => {
    const close = button(snapshot, "Suche schließen");
    if (close) {
      await dispatch(snapshot, close, "press");
      const deadline = performance.now() + Math.min(1800, budget());
      do {
        snapshot = await read();
        if (!button(snapshot, "Suche schließen")) return snapshot;
        if (performance.now() >= deadline) break;
        await wait(deadline);
      } while (performance.now() < deadline);
      throw new GotoError("The owned search view did not close; no form-path navigation dispatched.");
    }
    return snapshot;
  };
  try {
    let snapshot = await read();
    if (stateOf(snapshot).ready) return complete(snapshot);
    if (stateOf(snapshot).headingMatches) {
      snapshot = await pollPage(lastHeading, 1800, false);
      if (stateOf(snapshot).ready) return complete(snapshot);
    }
    if (button(snapshot, "Suche schließen")) throw new GotoError("A search view is already open; close it before starting a new native goto.", "precondition-failed");
    let start = lastHeading;
    path.push(start ?? "");
    if (args.viaSuche !== false) {
      const navName = page ? String(page.navigationTreeItemName || target) : target;
      const item = visibleNavigationItem(snapshot.nodes, navName);
      if (item && !transmissionName(item.name)) {
        phase = "navigation-tree";
        await dispatch(snapshot, item, "activate-navigation-item"); steps++;
        snapshot = await pollPage(start, 4000);
        path.push(`Navigationsbaum '${item.name}' -> '${lastHeading ?? ""}'`);
        if (stateOf(snapshot).ready) return complete(snapshot, "Navigationsbaum");
        if (!lastHeading || lastHeading === start) throw new GotoError("The exact navigation-tree activation produced no verified page change; no second navigation dispatched.");
        start = lastHeading;
      }
      const suffix = (activeProfile.pageObjectsCatalog.windows.main as Record<string, unknown>).searchContainerAutomationIdSuffix;
      if (typeof suffix !== "string" || !suffix) throw new GotoError("The profile has no search container binding.", "invalid-catalog");
      const searchNodes = containerDescendants(snapshot.nodes, suffix, "Edit");
      const fields = searchNodes.filter(node => node.on && node.w > 0 && node.h > 0 && node.ro === false && node.val !== null);
      if (fields.length > 1) throw new GotoError("The exact catalogue search field is ambiguous.", "ambiguous");
      if (fields.length === 1) {
        phase = "search-edit";
        const field = fields[0]!;
        await dispatch(snapshot, field, "replace-edit-text", { expectedValue: field.val, value: target });
        snapshot = await read();
        const entered = snapshot.nodes.filter(node => node.rid === field.rid && node.aid === field.aid && node.val === target && node.on && node.ro === false);
        if (entered.length !== 1) throw new GotoError("The bound search field did not report the exact target text.", "stale");
        const searchButtons = containerDescendants(snapshot.nodes, suffix, "Button").filter(node => !node.name && node.on
          && node.w > 0 && node.h > 0 && node.x > entered[0]!.x && Math.abs(node.y - entered[0]!.y) <= 12);
        if (searchButtons.length !== 1) throw new GotoError("The exact search button is not uniquely bound.", "ambiguous");
        await dispatch(snapshot, searchButtons[0]!, "press");
        phase = "search-results";
        const deadline = performance.now() + Math.min(10_000, budget());
        do {
          snapshot = await read();
          if (findContainerNode(snapshot.nodes, "DialogSearchResultsTableView", "Table")) break;
          if (performance.now() >= deadline) throw new GotoError("The search result table did not become ready.");
          await wait(deadline);
        } while (performance.now() < deadline);
        if (!findContainerNode(snapshot.nodes, "DialogSearchResultsTableView", "Table"))
          throw new GotoError("The search result table did not become ready.");
        const hit = selectSearchHit(snapshot.nodes, target, page);
        path.push(`Suche nach '${target}'`);
        if (hit) {
          phase = "search-hit";
          await dispatch(snapshot, hit, "activate-table-cell"); steps++;
          snapshot = await pollPage(start, 1500);
          path.push(`Qt-Suchtreffer '${hit.name}' -> '${lastHeading ?? ""}'`);
        }
        phase = "search-close";
        snapshot = await closeSearch(snapshot);
        phase = "search-close-readback";
        snapshot = await pollPage(start, 1800);
        if (stateOf(snapshot).ready) return complete(snapshot, "Suche");
        // An acknowledged activation with no page proof may still be pending.
        // It is never followed by another navigation strategy or a replay.
        if (hit && (!lastHeading || lastHeading === start))
          throw new GotoError("The acknowledged search hit produced no verified page change; no form-path action dispatched.");
        if (lastHeading) start = lastHeading;
      }
    }
    const order = pagingOrder(activeProfile.taxYear), route = gotoRoute(order, start ?? "", target, args.direction, args.maxSteps);
    let position = route.startIndex, stagnant = 0, consumed = 0;
    const transitions = new Set<string>(); visited.push(start ?? "");
    while (consumed < route.budget) {
      phase = "paging";
      snapshot = await read();
      if (stateOf(snapshot).ready) return complete(snapshot, route.direction);
      if (stateOf(snapshot).headingMatches) {
        snapshot = await pollPage(lastHeading, 1800, false);
        if (stateOf(snapshot).ready) return complete(snapshot, route.direction);
      }
      const previous: string | null = lastHeading;
      const next = button(snapshot, route.direction);
      if (!next) {
        const opposite = button(snapshot, route.direction === "Weiter" ? "Zurück" : "Weiter");
        if (!opposite) throw new GotoError(`Page '${previous ?? ""}' has neither 'Weiter' nor 'Zurück'; no form path continues.`, "dead-end");
        break;
      }
      consumed++; steps++;
      await dispatch(snapshot, next, "press");
      const deadline = performance.now() + Math.min(900, budget());
      do {
        snapshot = await read();
        if (stateOf(snapshot).ready || previous && lastHeading && lastHeading !== previous) break;
        if (performance.now() >= deadline) break;
        await wait(deadline);
      } while (performance.now() < deadline);
      path.push(`${route.direction} -> ${lastHeading ?? ""}`);
      if (stateOf(snapshot).ready) return complete(snapshot, route.direction);
      if (stateOf(snapshot).headingMatches) {
        snapshot = await pollPage(previous, 1800, false);
        if (stateOf(snapshot).ready) return complete(snapshot, route.direction);
      }
      if (lastHeading === previous) {
        const inventory = await readProcessWindowInventory(client, budget(), signal); nativeDurationMs += inventory.durationMs;
        if (inventory.windows.some(window => window.pid === client.binding.pid && window.title.startsWith("Die Prüfung hat ergeben")))
          throw new GotoError("A validation warning blocks navigation; no repeated paging action dispatched.", "warning-dialog");
        if (++stagnant >= 5) throw new GotoError("Five bounded paging attempts produced no page change.", "no-progress");
      } else {
        const transition = `${previous ?? ""}\u001f${lastHeading ?? ""}`;
        if (transitions.has(transition)) throw new GotoError("The directed navigation transition repeated; the form path is cycling.", "no-progress");
        transitions.add(transition);
        const landing = gotoLanding(route, order, position, lastHeading ?? "");
        if (landing.verdict !== "continue") throw new GotoError(landing.verdict === "deviation"
          ? "Back history deviated from the checked form path; no further paging action dispatched."
          : "The form path overshot the target; no further paging action dispatched.", "not-found");
        position = landing.position; stagnant = 0;
      }
      visited.push(lastHeading ?? "");
    }
    phase = "late-readback";
    snapshot = await pollPage(null, 1200);
    if (stateOf(snapshot).ready) return complete(snapshot, "spaete Gegenprobe");
    throw new GotoError(`Page '${target}' was not reached within the bounded route. Visited: ${[...new Set(visited)].join(" | ")}.`, "not-found");
  } catch (error) {
    const unknown = error instanceof GotoError ? error.unknown || mutationStarted : error instanceof QtNativeTransportError ? error.outcomeUnknown || mutationStarted
      : error instanceof QtNativeAcknowledgmentError && error.mutationResult.mutationAttempted === true || mutationStarted;
    return { ok: false, backend: "qt", kind: error instanceof GotoError ? error.kind : error instanceof QtNativeTransportError ? error.kind : "native-contract",
      error: error instanceof Error ? error.message : "Invalid native navigation response.", outcomeUnknown: unknown,
      mutationAttempted: mutationStarted, pageId: args.pageId ?? null, ueberschrift: lastHeading, weg: path, schritte: steps,
      physicalInputUsed: false, nativeDurationMs, phase };
  }
}
