import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { executeQtNativeRead } from "../dist/qt-native-executor.js";
import { executeQtNativeKnownPageState, executeQtNativePositions } from "../dist/qt-native-pages.js";
import { nativeWildcard } from "../dist/qt-native-find.js";
import { loadProductProfile } from "../dist/product-profiles.js";

export async function pageProjectionOracle(cases, wildcards = []) {
  const temporary = mkdtempSync(join(tmpdir(), "sse-page-oracle-"));
  try {
    const input = join(temporary, "input.json"), output = join(temporary, "output.json");
    writeFileSync(input, JSON.stringify({ cases, wildcards }));
    const run = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      fileURLToPath(new URL("./qt-native-page-oracle.ps1", import.meta.url)), "-InputPath", input, "-OutputPath", output],
    { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let diagnostic = ""; run.stderr.on("data", chunk => { diagnostic += chunk; });
    const oracleTimeoutMs = Number(process.env.SSE_PAGE_ORACLE_TIMEOUT_MS ?? 90_000);
    assert(Number.isSafeInteger(oracleTimeoutMs) && oracleTimeoutMs >= 30_000 && oracleTimeoutMs <= 180_000,
      "SSE_PAGE_ORACLE_TIMEOUT_MS must be an integer from 30000 through 180000");
    const timer = setTimeout(() => run.kill(), oracleTimeoutMs);
    let code;
    try { [code] = await once(run, "exit"); } finally { clearTimeout(timer); }
    assert.equal(code, 0, diagnostic);
    return JSON.parse(readFileSync(output, "utf8"));
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

export async function testNativePageProjections() {
  const nodes = [];
  const node = (type, name, x, y, extra = {}) => {
    const i = nodes.length;
    nodes.push({ i, p: -1, d: 0, type, name, aid: "fixture.RedThreadContent.", rid: `42.42.4.${i + 1}`,
      x, y, w: 80, h: 20, on: true, val: null, ro: null, checked: null, selected: null, scroll: null, ...extra });
    return i;
  };
  node("Tree", "Navigation", 0, 0, { w: 200 });
  node("Button", "Eingabehilfe", 800, 0);
  const header = node("Group", "", 220, 0, { aid: "fixture.ClientFrameSSE.ClientHeader" });
  node("Text", "Synthetic heading", 220, 20, { p: header, d: 1 });
  node("Text", "Anchor", 220, 100);
  node("Edit", "", 320, 111, { val: "11", ro: false });
  node("Text", "New line", 420, 122, { h: 2 });
  node("Text", "Overlapping", 220, 150, { h: 60 });
  node("Text", "Same row", 320, 175, { h: 20 });
  const group = node("Group", "", 220, 240);
  node("Text", "Sibling caption", 220, 240, { p: group, d: 1 });
  node("Edit", "", 420, 240, { p: group, d: 1, val: "42,00", ro: true });
  node("Button", "", 620, 240, { p: group, d: 1, aid: "fixture.RedThreadContent.Row.Button" });
  const linkGroup = node("Group", "", 220, 270);
  node("Text", "Link caption", 220, 270, { p: linkGroup, d: 1 });
  node("Hyperlink", "Erfassen", 620, 270, { p: linkGroup, d: 1 });
  node("Button", "Erfassen", 620, 270, { p: linkGroup, d: 1 });
  node("Button", "Weiter", 620, 300);
  node("Button", "Übermitteln…", 620, 330);
  node("Button", "Jahreserklärungen abschließen", 620, 360);
  node("Text", "A[B] Äpfel", 240, 390);
  const rect = { x: 0, y: 0, w: 1000, h: 500 };
  const stats = { n: nodes.length, err: 0, cyc: 0, cycleRid: "", cycleName: "", truncated: false, depthLimited: false,
    valErr: 0, scrollErr: 0, source: "qt", fallbackReason: "", snapshotMs: 1 };
  const cases = [
    { operation: "read_page", args: {} }, { operation: "read_page", args: { minX: 300, maxX: 700 } },
    { operation: "subpages", args: {} }, { operation: "find", args: { name: "A`[B`]", contains: true } },
    { operation: "find", args: { aid: "Row.Butt?n", type: "bUtToN" } },
  ].map(test => ({ ...test, nodes: test.operation === "find"
    ? nodes.map(n => ({ ...n, val: null, ro: null, checked: null, selected: null })) : nodes, rect, stats }));
  // Odd/negative midpoint rounding, missing/ambiguous headings and a collapsed navigation tree.
  cases.push({ operation: "read_page", args: {}, nodes: nodes.map(n => n.type === "Tree" ? { ...n, w: 0 } : n),
    rect: { x: -40, y: 0, w: 50, h: 500 }, stats });
  cases.push({ operation: "read_page", args: {}, nodes: nodes.map(n => n.i === 4 ? { ...n, aid: nodes[header].aid } : n), rect, stats });
  const patterns = ["*", "?", "a*", "*ä*", "[a-c]", "[-a]", "[a-]", "[]]", "[[]", "[!a]", "[^a]", "[z-a]",
    "[", "[]", "`", "a`", "`*", "a`?", "[a`-z]", "[a`]]", "*A`[B`]*", "*?*?*", "[A-Z]", "[ä-ü]"];
  const texts = ["", "a", "A", "b", "z", "!", "^", "-", "[", "]", "*", "a?", "a`", "Ä", "ä", "ö", "ü", "A[B]", "\n", "😀"];
  const wildcards = patterns.flatMap(pattern => texts.map(text => ({ pattern, text })));
  const oracle = await pageProjectionOracle(cases, wildcards);
  for (const [index, test] of wildcards.entries()) {
    let actual;
    try { actual = { match: nativeWildcard(test.pattern)(test.text) }; } catch { actual = { invalid: true }; }
    assert.deepEqual(actual, oracle.wildcards[index], JSON.stringify(test));
  }
  for (const [index, test] of cases.entries()) {
    const client = { binding: { hwnd: 42 }, request: async (operation, args) => {
      assert.equal(operation, "accessibility_snapshot");
      assert.equal(args.withValues, test.operation === "find" ? false : undefined);
      return { durationMs: 1, result: { ok: true, controllerBound: true, scope: "qt-accessibility-content", hwnd: 42,
        windowEnabled: true, modalBlocked: false, windowRect: test.rect, nodes: test.nodes, stats: test.stats,
        exactMatches: Object.fromEntries(Object.entries(args.equalitySelectors ?? {}).map(([key, value]) =>
          [key, test.nodes.filter(n => n[key].toLowerCase() === value.toLowerCase()).map(n => n.i)])) } };
    } };
    const result = await executeQtNativeRead(test.operation, test.args, { qtNativeClient: client }, 5000, undefined, loadProductProfile("2025"));
    const { backend, nativeDurationMs, ...projection } = result;
    assert.equal(backend, "qt"); assert.equal(nativeDurationMs, 1);
    assert.deepEqual(projection, oracle.results[index], JSON.stringify(test.args));
  }
  const knownProfile = {
    pageObjectsCatalog: {
      windows: { main: { headingContainerAutomationIdSuffix: ".ClientFrameSSE.ClientHeader" } },
      pages: { "synthetic.page": {
        heading: "Synthetic heading", headingPrefix: "Synthetic heading",
        fields: { amount: {
          label: "Amount", controlType: "Edit", valueKind: "currency",
          automationIdRelative: "window.RedThreadContent.Amount.Text", automationIdSuffix: ".Amount.Text",
        } },
      } },
    },
  };
  const knownNodes = [
    { i: 0, p: -1, d: 0, type: "Group", name: "", aid: "window", rid: "42.42", x: 0, y: 0, w: 1000, h: 500, on: true, val: null, ro: null, checked: null, selected: null, scroll: null },
    { i: 1, p: 0, d: 1, type: "Group", name: "", aid: "window.ClientFrameSSE.ClientHeader", rid: "42.42.4.1", x: 200, y: 0, w: 700, h: 40, on: true, val: null, ro: null, checked: null, selected: null, scroll: null },
    { i: 2, p: 1, d: 2, type: "Text", name: "Synthetic heading", aid: "window.ClientFrameSSE.ClientHeader.QLabel", rid: "42.42.4.2", x: 220, y: 10, w: 300, h: 20, on: true, val: null, ro: null, checked: null, selected: null, scroll: null },
    { i: 3, p: 0, d: 1, type: "Edit", name: "", aid: "window.RedThreadContent.Amount.Text", rid: "42.42.4.3", x: 300, y: 100, w: 120, h: 25, on: true, val: "Before", ro: false, checked: null, selected: null, scroll: null },
    { i: 4, p: 0, d: 1, type: "Button", name: "Speichern", aid: "window.MainToolBar.tb_sichern", rid: "42.42.4.4", x: 10, y: 10, w: 40, h: 20, on: true, val: null, ro: null, checked: null, selected: null, scroll: null },
  ];
  const knownClient = { binding: { hwnd: 42, pid: 99 }, request: async operation => {
    assert.equal(operation, "accessibility_snapshot");
    return { durationMs: 2, result: { ok: true, controllerBound: true, scope: "qt-accessibility-content", hwnd: 42,
      windowRect: { x: 0, y: 0, w: 1000, h: 500 }, windowEnabled: true, modalBlocked: false, foreground: true,
      exactMatches: {}, nodes: knownNodes, stats: { ...stats, n: knownNodes.length } } };
  } };
  const known = await executeQtNativeKnownPageState(knownClient, { pageId: "synthetic.page", hwnd: 42 }, 5000, undefined, knownProfile);
  assert.equal(known.ok, true, JSON.stringify(known));
  assert.equal(known.backend, "qt"); assert.equal(known.onExpectedPage, true); assert.equal(known.foreground, true);
  assert.equal(known.dirty, true); assert.equal(known.fields.length, 1);
  assert.deepEqual(known.fields[0], {
    fieldId: "amount", label: "Amount", controlType: "Edit", valueKind: "currency", writeTool: null,
    automationIdSuffix: ".Amount.Text", present: true, value: "Before", enabled: true, readOnly: false,
    x: 300, y: 100, w: 120, h: 25,
  });
  assert.match(known.epoch, /^[A-F0-9]{64}$/u);
  const missing = await executeQtNativeKnownPageState(knownClient, { pageId: "missing" }, 5000, undefined, knownProfile);
  assert.equal(missing.kind, "not-found");

  const exhausted = nativeWildcard("?".repeat(1000));
  assert.throws(() => exhausted("x".repeat(20_000)), error => error.kind === "native-selector-limit");

  const positionsClient = { binding: { hwnd: 42 }, request: async operation => {
    assert.equal(operation, "accessibility_snapshot");
    return { durationMs: 3, result: { ok: true, controllerBound: true, scope: "qt-accessibility-content", hwnd: 42,
      windowRect: rect, windowEnabled: true, modalBlocked: false, exactMatches: {},
      nodes: [{ ...knownNodes[0], name: "»Fahrzeugkosten« bearbeiten" }, { ...knownNodes[1], name: "»Fahrzeugkosten« bearbeiten" },
        { ...knownNodes[2], name: "»Arbeitszimmer« bearbeiten" }], stats: { ...stats, n: 3 } } };
  } };
  const positions = await executeQtNativePositions(positionsClient, { hwnd: 42, aktion: "list" }, 5000);
  assert.deepEqual(positions, { ok: true, backend: "qt", positionen: ["Fahrzeugkosten", "Arbeitszimmer"], anzahl: 2,
    hinweis: null, nativeDurationMs: 3 });
  assert.equal((await executeQtNativePositions(positionsClient, { aktion: "add" }, 5000)).kind, "blocked");

  const ustvaNodes = [];
  const ustvaNode = (type, name, x, y, extra = {}) => {
    const i = ustvaNodes.length;
    const p = extra.p ?? 0;
    ustvaNodes.push({ i, p: i === 0 ? -1 : p, d: i === 0 ? 0 : p === 0 ? 1 : 2, type, name,
      aid: `window.RedThreadContent.Node${i}`, rid: i === 0 ? "42.42" : `42.42.4.${i}`,
      x, y, w: 180, h: 20, on: true, val: null, ro: null, checked: null, selected: null, scroll: null, ...extra });
    return i;
  };
  ustvaNode("Group", "", 0, 0, { w: 1000, h: 600 });
  ustvaNode("Tree", "Navigation", 0, 0, { w: 200 });
  const ustvaHeader = ustvaNode("Group", "", 220, 0, { aid: "window.ClientFrameSSE.ClientHeader" });
  ustvaNode("Text", "Umsatzsteuer-Voranmeldungen 2025", 220, 20, { p: ustvaHeader });
  ustvaNode("Text", "Voranmeldezeitraum", 220, 100);
  ustvaNode("ComboBox", "", 500, 100, { val: "monatlich", ro: false,
    aid: "window.AuswahlAnmeldezeitraum.Zeitraum.Combobox" });
  ustvaNode("Text", "Auswahl Monat", 220, 130);
  ustvaNode("ComboBox", "", 500, 130, { val: "Juni", ro: false,
    aid: "window.AuswahlAnmeldezeitraum.AuswahlMonat.Combobox" });
  ustvaNode("Text", "Beträge für die Umsatzsteuer-Voranmeldung manuell erfassen", 220, 160);
  ustvaNode("CheckBox", "", 700, 160, { checked: true, ro: false,
    aid: "window.RahmenWerteUebersicht.ManuelleEingabe" });
  ustvaNode("Button", "ELSTER versenden", 600, 300);
  const ustvaStats = { ...stats, n: ustvaNodes.length };
  const ustvaClient = { binding: { hwnd: 42, pid: 99 }, request: async operation => {
    assert.equal(operation, "accessibility_snapshot");
    return { durationMs: 4, result: { ok: true, controllerBound: true, scope: "qt-accessibility-content", hwnd: 42,
      windowRect: { x: 0, y: 0, w: 1000, h: 600 }, windowEnabled: true, modalBlocked: false,
      exactMatches: {}, nodes: ustvaNodes, stats: ustvaStats } };
  } };
  const ustva = await executeQtNativeRead("ustva_read", { hwnd: 42 }, { qtNativeClient: ustvaClient },
    5000, undefined, loadProductProfile("2025"));
  assert.equal(ustva.ok, true, JSON.stringify(ustva));
  assert.equal(ustva.backend, "qt");
  assert.equal(ustva.nativeDurationMs, 4);
  assert.equal(ustva.pageKind, "overview");
  assert.equal(ustva.taxYear, 2025);
  assert.deepEqual(ustva.period, { frequency: "monthly", frequencyDisplay: "monatlich", selector: "month", key: "june", display: "Juni" });
  assert.equal(ustva.flags.manual_input, true);
  assert.equal(ustva.transmission.blockedByApi, true);
  assert.equal(ustva.transmission.uiGuardObserved, true);

  const receiptNodes = [];
  const receiptNode = (type, name, aid, x, y, extra = {}) => {
    const i = receiptNodes.length;
    receiptNodes.push({ i, p: i === 0 ? -1 : 0, d: i === 0 ? 0 : 1,
      type, name, aid, rid: i === 0 ? "42.84" : `42.84.4.${i + 1}`,
      x, y, w: 80, h: 20, on: true, val: null, ro: null, checked: null, selected: null, scroll: null, ...extra });
  };
  receiptNode("Group", "", "receipt", 0, 0, { w: 1000, h: 600 });
  receiptNode("Button", "Neuer Beleg", "receipt.btn_new", 0, 0);
  receiptNode("Button", "Mehrere Belege", "receipt.btn_newPopup", 90, 0);
  receiptNode("Button", "Home", "receipt.pushButton_home", 180, 0);
  receiptNode("Table", "", "receipt.tableWidget_mainTabel", 0, 100, { w: 900, h: 300 });
  receiptNode("Text", "MEINE BELEGE (1)", "receipt.label_infoText1", 0, 70);
  receiptNode("Edit", "", "receipt.widget_mainWindowInfoBar.frame_container.lineEdit_suche", 500, 70, { val: "" });
  receiptNode("Header", "Titel", "receipt.tableWidget_mainTabel", 160, 100);
  for (let column = 0; column < 9; column += 1) {
    receiptNode("DataItem", column === 2 ? "Synthetic receipt*" : column === 8 ? "DOC-1" : "",
      "receipt.tableWidget_mainTabel", column * 80, 140, { selected: column === 2 });
  }
  const mainNodes = [{ ...knownNodes[0] }, { ...knownNodes[4], i: 1, on: false }];
  const receiptStats = { ...stats, n: receiptNodes.length };
  const receiptClient = { binding: { hwnd: 42, pid: 99 }, request: async (operation, args) => {
    assert.equal(operation, "accessibility_snapshot");
    const tool = args.toolTitle === "BelegManager";
    const selectedNodes = tool ? receiptNodes : mainNodes;
    return { durationMs: tool ? 5 : 2, result: { ok: true, controllerBound: true, scope: "qt-accessibility-content",
      hwnd: tool ? 84 : 42, windowRect: { x: 0, y: 0, w: 1000, h: 600 }, windowEnabled: true,
      modalBlocked: false, exactMatches: {}, nodes: selectedNodes,
      stats: { ...(tool ? receiptStats : stats), n: selectedNodes.length } } };
  } };
  const receipts = await executeQtNativeRead("receipt_manager_list", { filter: { draft: true }, limit: 1 },
    { qtNativeClient: receiptClient }, 5000, undefined, loadProductProfile("2025"));
  assert.equal(receipts.ok, true, JSON.stringify(receipts));
  assert.equal(receipts.backend, "qt");
  assert.equal(receipts.pid, 99);
  assert.equal(receipts.mainHwnd, 42);
  assert.equal(receipts.managerHwnd, 84);
  assert.equal(receipts.state, "list");
  assert.equal(receipts.count, 1);
  assert.equal(receipts.rowsComplete, true);
  assert.equal(receipts.draftCount, 1);
  assert.equal(receipts.matchedCount, 1);
  assert.equal(receipts.matchesComplete, true);
  assert.equal(receipts.matches[0].title, "Synthetic receipt*");
  assert.equal(receipts.matches[0].documentNumber, "DOC-1");
  assert.equal(receipts.rows[0].selected, true);
  assert.equal(receipts.ungespeichert, false);
  assert.equal(receipts.physicalInputUsed, false);
  assert.equal(receipts.nativeDurationMs, 7);
  assert.match(receipts.stateFingerprint, /^[A-F0-9]{64}$/u);
  assert.match(receipts.listFingerprint, /^[A-F0-9]{64}$/u);
  assert.match(receipts.rows[0].rowFingerprint, /^[A-F0-9]{64}$/u);
  assert.match(receipts.rows[0].contentFingerprint, /^[A-F0-9]{64}$/u);
}
