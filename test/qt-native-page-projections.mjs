import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { executeQtNativeRead } from "../dist/qt-native-executor.js";
import { executeQtNativeKnownPageState, executeQtNativePositions } from "../dist/qt-native-pages.js";
import { canonicalReceiptJson, receiptFingerprint } from "../dist/qt-native-receipts.js";
import { QtNativeTransportError } from "../dist/qt-native-client.js";
import { nativeWildcard } from "../dist/qt-native-find.js";
import { checkerResults, resultDetailsFromNodes, splitWindowScope } from "../dist/qt-native-projections.js";
import { loadProductProfile } from "../dist/product-profiles.js";

export async function pageProjectionOracle(cases, wildcards = [], receiptFingerprintValue = {}, helpers = []) {
  const temporary = mkdtempSync(join(tmpdir(), "sse-page-oracle-"));
  try {
    const input = join(temporary, "input.json"), output = join(temporary, "output.json");
    writeFileSync(input, JSON.stringify({ cases, wildcards, receiptFingerprintValue, helpers }));
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
  // One richer synthetic main window for the page, help, table and checker branches: navigation
  // tree, catalogue heading, toolbar, labelled fields, a table with a checkable cell, subpage
  // actions, help column with sections, the global checker and one foreign owned window.
  const pageNodes = [];
  const pageNode = (type, name, x, y, extra = {}) => {
    const i = pageNodes.length;
    const p = extra.p ?? -1;
    pageNodes.push({ i, p, d: p < 0 ? 0 : pageNodes[p].d + 1, type, name, aid: `window.RedThreadContent.Node${i}`,
      rid: `42.42.4.${i + 1}`, x, y, w: 80, h: 20, on: true, val: null, ro: null, checked: null, selected: null, scroll: null,
      ...extra, ...(extra.p === undefined ? {} : { p }) });
    return i;
  };
  const nav = pageNode("Tree", "Navigation", 0, 100, { w: 300, h: 700, aid: "window.Navigation" });
  pageNode("TreeItem", "Startseite", 10, 120, { p: nav, selected: false, aid: "window.Navigation.Item" });
  pageNode("TreeItem", "Betriebsausgaben", 10, 140, { p: nav, selected: true, aid: "window.Navigation.Item" });
  pageNode("TreeItem", "Fehlende Angabe !", 10, 160, { p: nav, selected: false, aid: "window.Navigation.Item" });
  pageNode("Button", "Speichern", 10, 10, { aid: "window.MainToolBar.tb_sichern" });
  pageNode("Button", "ELSTER versenden", 400, 30, { aid: "window.MainToolBar.tb_elster" });
  const pageHeader = pageNode("Group", "", 320, 20, { w: 800, aid: "window.ClientFrameSSE.ClientHeader" });
  pageNode("Text", "Betriebsausgaben Übersicht", 330, 24, { p: pageHeader, w: 300, aid: "window.ClientFrameSSE.ClientHeader.QLabel" });
  pageNode("Button", "Eingabehilfe", 1200, 100, { aid: "window.HelpColumn.Eingabehilfe" });
  pageNode("Text", "Kontoführungsgebühren", 320, 200, { w: 200 });
  pageNode("Edit", "", 600, 202, { val: "12,00", ro: false, aid: "window.RedThreadContent.Konto.Text" });
  pageNode("Text", "Umsatzsteuersatz", 320, 240, { w: 200 });
  pageNode("ComboBox", "", 600, 240, { val: "", ro: false, aid: "window.RedThreadContent.Ust.Combobox" });
  pageNode("Text", "Privatanteil", 320, 280, { w: 200 });
  pageNode("CheckBox", "", 600, 280, { checked: true, aid: "window.RedThreadContent.Privat.CheckBox" });
  pageNode("RadioButton", "Monatlich", 600, 320, { selected: true, aid: "window.RedThreadContent.Monatlich.Radio" });
  pageNode("Header", "Bezeichnung", 320, 400, { w: 200, aid: "window.RedThreadContent.Tabelle" });
  pageNode("Header", "Betrag", 700, 400, { w: 100, aid: "window.RedThreadContent.Tabelle" });
  pageNode("Header", "Betrag", 704, 400, { w: 100, aid: "window.RedThreadContent.Tabelle" });
  pageNode("Header", "Privat", 900, 400, { w: 60, aid: "window.RedThreadContent.Tabelle" });
  pageNode("DataItem", "Miete", 320, 430, { w: 200, aid: "window.RedThreadContent.Tabelle" });
  pageNode("DataItem", "500,00", 700, 430, { w: 100, aid: "window.RedThreadContent.Tabelle" });
  pageNode("DataItem", "", 900, 430, { w: 60, checked: true, aid: "window.RedThreadContent.Tabelle" });
  pageNode("DataItem", "", 320, 470, { w: 200, aid: "window.RedThreadContent.Tabelle" });
  pageNode("DataItem", "0,00", 700, 470, { w: 100, aid: "window.RedThreadContent.Tabelle" });
  pageNode("DataItem", "", 900, 470, { w: 60, checked: "unbestimmt", aid: "window.RedThreadContent.Tabelle" });
  pageNode("Hyperlink", "Erfassen", 1000, 200, { aid: "window.RedThreadContent.Erfassen.Link" });
  pageNode("Button", "Erfassen", 1000, 200, { aid: "window.RedThreadContent.Erfassen.Button" });
  pageNode("Button", "Weiter", 1100, 800, { aid: "window.RedThreadContent.Weiter" });
  pageNode("Text", "Hier tragen Sie die Gebühren ein.", 1210, 140, { w: 300, aid: "window.HelpColumn.Text" });
  pageNode("Hyperlink", "Mehr dazu", 1210, 160, { aid: "window.HelpColumn.Link" });
  pageNode("Text", "Mehr dazu", 1210, 160, { aid: "window.HelpColumn.Text" });
  pageNode("TreeItem", "Steuertipps", 1210, 300, { aid: "window.HelpColumn.Tips" });
  pageNode("TreeItem", "Tipp: Fahrtenbuch führen", 1210, 320, { aid: "window.HelpColumn.Tips" });
  pageNode("Text", "Mehr Details", 1210, 340, { aid: "window.HelpColumn.Text" });
  pageNode("Text", "Prüfer", 1210, 500, { aid: "window.HelpColumn.Text" });
  pageNode("TreeItem", "Angabe fehlt: Betrag", 1210, 520, { aid: "window.HelpColumn.PrueferItem" });
  const checker = pageNode("Tree", "", 320, 600, { w: 800, h: 250, aid: "window.PrueferWidgetSSE.SteuerPruefer" });
  pageNode("TreeItem", "2 Fragen oder Warnungen", 330, 610, { p: checker, aid: "window.PrueferWidgetSSE.SteuerPruefer" });
  pageNode("TreeItem", "Warnung A", 330, 630, { p: checker, aid: "window.PrueferWidgetSSE.SteuerPruefer" });
  pageNode("TreeItem", "Warnung A", 360, 650, { p: checker, h: 80, aid: "window.PrueferWidgetSSE.SteuerPruefer" });
  pageNode("TreeItem", "Warnung B", 330, 730, { p: checker, on: false, aid: "window.PrueferWidgetSSE.SteuerPruefer" });
  pageNode("TreeItem", "1 Tipps oder Zusatzinformationen", 330, 750, { p: checker, aid: "window.PrueferWidgetSSE.SteuerPruefer" });
  pageNode("TreeItem", "Tipp C", 330, 770, { p: checker, aid: "window.PrueferWidgetSSE.SteuerPruefer" });
  const foreign = pageNode("Window", "Werte-Info: Werte vergleichen - Was wäre wenn", 800, 300,
    { w: 400, h: 300, aid: "window.WerteInfo" });
  pageNode("DataItem", "999,99", 810, 320, { p: foreign, aid: "window.WerteInfo.obj_Wertetabelle" });
  // A pre-order subset stays a valid tree once indices, parents and depths are renumbered; a node whose parent
  // was cut becomes a root of its own.
  const reindex = nodes => {
    const position = new Map(nodes.map((node, index) => [node.i, index]));
    const renumbered = [];
    for (const [index, node] of nodes.entries()) {
      const p = position.get(node.p) ?? -1;
      renumbered.push({ ...node, i: index, p, d: p < 0 ? 0 : renumbered[p].d + 1 });
    }
    return renumbered;
  };
  const pageRect = { x: 0, y: 0, w: 1600, h: 900 };
  const pageStats = { ...stats, n: pageNodes.length };
  const checkerless = reindex(pageNodes.filter(node => node.p !== checker));
  // page and read_table: the worker only counts the process windows here, while the Qt path reads every owned
  // catalogued window through a tool snapshot the oracle cannot mirror. The counted windows are therefore ones
  // neither side reads: a system overlay and a second case window.
  const pageWindows = [
    { hwnd: 42, pid: 99, class: "Qt692QWindowIcon", title: "SteuerSparErklärung 2025", x: 0, y: 0, w: 1600, h: 900,
      minimized: false, hung: false },
    { hwnd: 86, pid: 99, class: "UAC_Overlay", title: "UAC", x: 0, y: 0, w: 40, h: 40, minimized: false, hung: false },
    { hwnd: 91, pid: 99, class: "Qt692QWindowIcon", title: "SteuerSparErklärung 2025 - zweiter Fall", x: 0, y: 0, w: 950, h: 600,
      minimized: false, hung: false },
  ];
  // ui_state: the worker sees the Werte-Info table inside its UIA walk of the main window; the Qt path reads the
  // same table through the tool snapshot. The descriptor kinds of the tips and BelegManager windows are fixture facts.
  const stateNodes = pageNodes.map(node => ({ ...node }));
  const stateWindow = stateNodes.length;
  const stateNode = (type, name, x, y, extra = {}) => {
    const i = stateNodes.length;
    const p = extra.p ?? -1;
    stateNodes.push({ i, p, d: p < 0 ? 0 : stateNodes[p].d + 1, type, name, aid: "window.WerteInfoFenster.obj_Wertetabelle",
      rid: `42.84.4.${i - stateWindow + 1}`, x, y, w: 100, h: 20, on: true, val: null, ro: null, checked: null, selected: null, scroll: null,
      ...extra, ...(extra.p === undefined ? {} : { p }) });
    return i;
  };
  const stateOwned = stateNode("Window", "Werte-Info: Werte vergleichen - Was wäre wenn", 800, 300, { w: 400, h: 300, aid: "window.WerteInfoFenster", rid: "42.84" });
  const stateTable = stateNode("Table", "", 810, 340, { p: stateOwned, w: 380, h: 200 });
  for (const [column, name] of ["Beobachteter Wert", "Aktuell", "Festgehaltener Vergleichswert", "Differenz"].entries()) {
    stateNode("Header", name, 810 + column * 90, 350, { p: stateTable });
  }
  for (const [rowIndex, cells] of [["Einkommensteuer", "1.000,00", "800,00", "200,00"], ["Soli & Kirche", "55,00", "44,00", "11,00"]].entries()) {
    for (const [column, text] of cells.entries()) stateNode("DataItem", text, 810 + column * 90, 380 + rowIndex * 30, { p: stateTable });
  }
  const toolNodes = reindex(stateNodes.filter(node => node.i >= stateTable));
  const stateWindows = [
    { hwnd: 42, pid: 99, class: "Qt692QWindowIcon", title: "SteuerSparErklärung 2025", x: 0, y: 0, w: 1600, h: 900,
      minimized: false, hung: false },
    { hwnd: 87, pid: 99, class: "Qt692QWindow", title: "BelegManager", x: 100, y: 100, w: 1200, h: 700, minimized: false, hung: false },
    { hwnd: 85, pid: 99, class: "Qt692QWindow", title: "Steuer-Spar-Tipps", x: 200, y: 200, w: 900, h: 700, minimized: false, hung: false },
    { hwnd: 84, pid: 99, class: "Qt692QWindow", title: "Werte-Info: Werte vergleichen - Was wäre wenn", x: 800, y: 300, w: 400, h: 300,
      minimized: false, hung: false },
    { hwnd: 86, pid: 99, class: "UAC_Overlay", title: "UAC", x: 0, y: 0, w: 40, h: 40, minimized: false, hung: false },
  ];
  cases.push(
    { operation: "ui_state", args: { hwnd: 42 }, nodes: stateNodes, rect: pageRect, stats: { ...pageStats, n: stateNodes.length },
      windows: stateWindows, kinds: { 87: "known-nonmodal", 85: "tips" },
      tool: { title: "Werte-Info: Werte vergleichen - Was wäre wenn", hwnd: 84, nodes: toolNodes, rect: { x: 800, y: 300, w: 400, h: 300 },
        stats: { ...pageStats, n: toolNodes.length } } },
    { operation: "page", args: {}, nodes: pageNodes, rect: pageRect, stats: pageStats, windows: pageWindows },
    { operation: "page", args: {}, nodes: pageNodes, rect: pageRect, stats: pageStats, windows: pageWindows.slice(0, 1) },
    { operation: "help", args: {}, nodes: pageNodes, rect: pageRect, stats: pageStats, windows: pageWindows.slice(0, 1) },
    { operation: "read_table", args: {}, nodes: pageNodes, rect: pageRect, stats: pageStats, windows: pageWindows },
    { operation: "read_table", args: {}, nodes: pageNodes, rect: pageRect, stats: { ...pageStats, truncated: true }, windows: pageWindows },
    { operation: "checker_results", args: {}, nodes: pageNodes, rect: pageRect, stats: pageStats, windows: pageWindows },
    { operation: "checker_results", args: {}, nodes: checkerless, rect: pageRect, stats: { ...pageStats, n: checkerless.length },
      windows: pageWindows },
  );
  // Pure helper oracles: the Werte-Info projection (fingerprint bytes included) and the checker grouping.
  const resultNodes = [];
  const resultNode = (type, name, x, y, extra = {}) => {
    const i = resultNodes.length;
    const p = extra.p ?? -1;
    resultNodes.push({ i, p, d: p < 0 ? 0 : resultNodes[p].d + 1, type, name, aid: "tool.WerteInfo.obj_Wertetabelle",
      rid: `42.84.4.${i + 1}`, x, y, w: 100, h: 20, on: true, val: null, ro: null, checked: null, selected: null, scroll: null,
      ...extra, ...(extra.p === undefined ? {} : { p }) });
    return i;
  };
  const resultTable = resultNode("Table", "", 10, 10, { w: 500, h: 300 });
  for (const [column, name] of ["Beobachteter Wert", "Aktuell", "Festgehaltener Vergleichswert", "Differenz"].entries()) {
    resultNode("Header", name, 10 + column * 120, 40, { p: resultTable });
  }
  const resultRows = [["Einkommensteuer", "1.234,56", "1.000,00", "234,56"], ["Solidaritätszuschlag", "12,30", "10,00", "5,00"],
    ["Kirchensteuer & Co", "abc", "10,00", "1,00"]];
  for (const [rowIndex, cells] of resultRows.entries()) {
    for (const [column, text] of cells.entries()) resultNode("DataItem", text, 10 + column * 120, 70 + rowIndex * 30, { p: resultTable });
  }
  resultNode("DataItem", "Zeile ohne Differenz", 10, 200, { p: resultTable });
  resultNode("DataItem", "1,00", 130, 200, { p: resultTable });
  resultNode("DataItem", "1,00", 250, 200, { p: resultTable });
  resultNode("DataItem", "virtualisiert", -1, -1, { p: resultTable, w: 0, h: 0 });
  const singleRowNodes = resultNodes.filter(node => node.i <= resultTable + 8);
  const helpers = [
    { helper: "resultDetails", nodes: resultNodes, stats: { ...stats, n: resultNodes.length } },
    { helper: "resultDetails", nodes: singleRowNodes, stats: { ...stats, n: singleRowNodes.length } },
    { helper: "resultDetails", nodes: resultNodes.filter(node => node.type !== "DataItem"), stats: { ...stats, n: 5 } },
    { helper: "resultDetails", nodes: pageNodes, stats: pageStats },
    { helper: "checkerResults", nodes: pageNodes, stats: pageStats },
    { helper: "checkerResults", nodes: pageNodes.filter(node => node.p !== checker), stats: pageStats },
    { helper: "windowScope", nodes: pageNodes, stats: pageStats },
  ];
  const patterns = ["*", "?", "a*", "*ä*", "[a-c]", "[-a]", "[a-]", "[]]", "[[]", "[!a]", "[^a]", "[z-a]",
    "[", "[]", "`", "a`", "`*", "a`?", "[a`-z]", "[a`]]", "*A`[B`]*", "*?*?*", "[A-Z]", "[ä-ü]"];
  const texts = ["", "a", "A", "b", "z", "!", "^", "-", "[", "]", "*", "a?", "a`", "Ä", "ä", "ö", "ü", "A[B]", "\n", "😀"];
  const wildcards = patterns.flatMap(pattern => texts.map(text => ({ pattern, text })));
  const receiptFingerprintValue = {
    title: "Müller & <Sohn>'s",
    date: "2026-09-11",
    documentNumber: "A&B",
    amount: "12,34",
    vatRate: "19",
    net: true,
    note: "Zeile\u2028zwei\u2029<&>'\u0085",
  };
  const oracle = await pageProjectionOracle(cases, wildcards, receiptFingerprintValue, helpers);
  for (const [index, test] of helpers.entries()) {
    const projected = test.helper === "resultDetails" ? resultDetailsFromNodes(test.nodes, test.stats)
      : test.helper === "checkerResults" ? checkerResults(test.nodes) : splitWindowScope(test.nodes);
    assert.deepEqual(projected, oracle.helpers[index], `${test.helper} #${index}`);
  }
  assert.equal(canonicalReceiptJson(receiptFingerprintValue), oracle.receiptFingerprintJson,
    "Qt/Node und Windows PowerShell 5.1 muessen dieselben kanonischen JSON-Bytes verwenden");
  assert.equal(receiptFingerprint(receiptFingerprintValue), oracle.receiptFingerprint,
    "Qt/Node und Worker muessen identische Belegfingerprints bilden");
  for (const [index, test] of wildcards.entries()) {
    let actual;
    try { actual = { match: nativeWildcard(test.pattern)(test.text) }; } catch { actual = { invalid: true }; }
    assert.deepEqual(actual, oracle.wildcards[index], JSON.stringify(test));
  }
  for (const [index, test] of cases.entries()) {
    const client = { binding: { hwnd: 42, pid: 99, creationTime: "1" }, request: async (operation, args) => {
      if (operation === "window_inventory") {
        return { durationMs: 1, result: { ok: true, windows: test.windows, visibleWindowCount: test.windows.length, productWindowCount: test.windows.length, untitledWindows: [] } };
      }
      assert.equal(operation, "accessibility_snapshot");
      assert.equal(args.withValues, test.operation === "find" ? false : undefined);
      assert.equal(args.withCellStates, test.operation === "read_table" ? true : undefined);
      const view = args.toolTitle === undefined ? { hwnd: 42, rect: test.rect, nodes: test.nodes, stats: test.stats } : test.tool;
      assert.equal(args.toolTitle, args.toolTitle === undefined ? undefined : test.tool.title);
      return { durationMs: 1, result: { ok: true, controllerBound: true, scope: "qt-accessibility-content", hwnd: view.hwnd,
        windowEnabled: true, modalBlocked: false, windowRect: view.rect, nodes: view.nodes, stats: view.stats,
        exactMatches: Object.fromEntries(Object.entries(args.equalitySelectors ?? {}).map(([key, value]) =>
          [key, view.nodes.filter(n => n[key].toLowerCase() === value.toLowerCase()).map(n => n.i)])) } };
    } };
    const result = await executeQtNativeRead(test.operation, test.args, { qtNativeClient: client }, 5000, undefined, loadProductProfile("2025"));
    const { backend, nativeDurationMs, ...projection } = result;
    assert.equal(backend, "qt"); assert(Number.isInteger(nativeDurationMs) && nativeDurationMs >= 1, test.operation);
    assert.deepEqual(projection, oracle.results[index], `${test.operation} ${JSON.stringify(test.args)}`);
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
  const processWindows = [
    { hwnd: 42, pid: 99, class: "Qt692QWindowIcon", title: "SteuerSparErklärung 2025", x: 0, y: 0, w: 1000, h: 600,
      minimized: false, hung: false },
    { hwnd: 84, pid: 99, class: "Qt692QWindowIcon", title: "BelegManager", x: 100, y: 100, w: 800, h: 500,
      minimized: false, hung: false },
  ];
  const receiptClient = { binding: { hwnd: 42, pid: 99 }, request: async (operation, args) => {
    assert.equal(operation, "accessibility_snapshot");
    const tool = args.toolTitle === "BelegManager";
    if (tool) {
      assert(args.aidSuffixes.includes(".tableWidget_mainTabel"));
      assert(args.aidSuffixes.includes(".label_infoText1"));
    } else {
      assert.deepEqual(args.aidSuffixes, [".MainToolBar.tb_sichern"]);
    }
    const selectedNodes = tool ? receiptNodes : mainNodes;
    return { durationMs: tool ? 5 : 2, result: { ok: true, controllerBound: true, scope: "qt-accessibility-content",
      hwnd: tool ? 84 : 42, windowRect: { x: 0, y: 0, w: 1000, h: 600 }, windowEnabled: true,
      modalBlocked: false, exactMatches: {}, nodes: selectedNodes,
      stats: { ...(tool ? receiptStats : stats), n: selectedNodes.length } } };
  } };
  const startNodes = [
    { ...receiptNodes[0] },
    { ...receiptNodes[1], i: 1, aid: "receipt.btn_neuenBelegAnlegen", name: "Neuen Beleg anlegen", rid: "42.84.4.50" },
    { ...receiptNodes[2], i: 2, aid: "receipt.btn_mehrereBelegeAnlegen", name: "Mehrere Belege anlegen", rid: "42.84.4.51" },
    { ...receiptNodes[3], i: 3, aid: "receipt.btn_alleBelegeAnzeigen", name: "Alle Belege anzeigen", rid: "42.84.4.52" },
  ];
  let actionState = "start";
  const actionClient = { binding: { hwnd: 42, pid: 99 },
    request: async (operation, args) => {
      if (operation === "window_inventory") {
        assert.deepEqual(args, {});
        return { durationMs: 1, result: { ok: true, windows: processWindows, visibleWindowCount: processWindows.length, productWindowCount: processWindows.length,
          untitledWindows: [] } };
      }
      assert.equal(operation, "accessibility_snapshot");
      const tool = args.toolTitle === "BelegManager";
      const selectedNodes = tool ? (actionState === "start" ? startNodes : receiptNodes) : mainNodes;
      return { durationMs: 2, result: { ok: true, controllerBound: true, scope: "qt-accessibility-content",
        hwnd: tool ? 84 : 42, windowRect: { x: 0, y: 0, w: 1000, h: 600 }, windowEnabled: true,
        modalBlocked: false, exactMatches: {}, nodes: selectedNodes,
        stats: { ...stats, n: selectedNodes.length } } };
    },
    requestAcknowledged: async (operation, args) => {
      assert.equal(operation, "accessibility_action");
      assert.equal(args.toolTitle, "BelegManager");
      assert.equal(args.aid, "receipt.btn_alleBelegeAnzeigen");
      assert.equal(args.expectedName, "Alle Belege anzeigen");
      actionState = "list";
      return { durationMs: 3, mutationAckMs: 1, receiptAcknowledged: true,
        result: { ok: true, mutationAttempted: true } };
    },
  };
  const action = await executeQtNativeRead("receipt_manager_action", { actionId: "showAllReceipts" },
    { qtNativeClient: actionClient }, 5000, undefined, loadProductProfile("2025"));
  assert.equal(action.ok, true, JSON.stringify(action));
  assert.equal(action.backend, "qt");
  assert.equal(action.stateBefore, "start");
  assert.equal(action.stateAfter, "list");
  assert.equal(action.physicalInputUsed, false);
  assert.equal(action.foregroundLeaseUsed, false);
  assert.equal(action.verified, true);
  assert.equal(action.windowSetUnchanged, true);
  assert.match(action.windowSetFingerprintBefore, /^[A-F0-9]{64}$/u);
  assert.equal(action.windowSetFingerprintAfter, action.windowSetFingerprintBefore);
  assert.equal(action.clickBinding.method, "qt-accessibility-press");
  let timeoutMutationDispatched = false;
  const timeoutActionClient = {
    binding: { hwnd: 42, pid: 99 },
    request: async (operation, args) => {
      if (operation === "window_inventory") {
        return { durationMs: 1, result: { ok: true, windows: processWindows, visibleWindowCount: processWindows.length, productWindowCount: processWindows.length,
          untitledWindows: [] } };
      }
      assert.equal(operation, "accessibility_snapshot");
      const tool = args.toolTitle === "BelegManager";
      if (tool && timeoutMutationDispatched) {
        throw new QtNativeTransportError("Synthetic postcondition timeout.", "native-timeout", true);
      }
      const selectedNodes = tool ? startNodes : mainNodes;
      return { durationMs: 2, result: { ok: true, controllerBound: true, scope: "qt-accessibility-content",
        hwnd: tool ? 84 : 42, windowRect: { x: 0, y: 0, w: 1000, h: 600 }, windowEnabled: true,
        modalBlocked: false, exactMatches: {}, nodes: selectedNodes,
        stats: { ...stats, n: selectedNodes.length } } };
    },
    requestAcknowledged: async () => {
      timeoutMutationDispatched = true;
      return { durationMs: 3, mutationAckMs: 1, receiptAcknowledged: true,
        result: { ok: true, mutationAttempted: true } };
    },
  };
  const timedOutAction = await executeQtNativeRead("receipt_manager_action", { actionId: "showAllReceipts" },
    { qtNativeClient: timeoutActionClient }, 5000, undefined, loadProductProfile("2025"));
  assert.equal(timedOutAction.ok, false, JSON.stringify(timedOutAction));
  assert.equal(timedOutAction.kind, "native-timeout");
  assert.equal(timedOutAction.outcomeUnknown, true);
  assert.equal(timedOutAction.mutationStarted, true);
  assert.equal(timedOutAction.cleanupRequired, true);
  assert.equal(timedOutAction.resultingState, "unknown");
  assert.equal(timedOutAction.verified, false);
  assert.match(timedOutAction.error, /Do not replay/u);
  assert.equal(timedOutAction.clickBinding.method, "qt-accessibility-press");
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
  const detailNodes = receiptNodes.map(node => ({ ...node }));
  const detailNode = (type, name, aid, extra = {}) => {
    const i = detailNodes.length;
    detailNodes.push({ i, p: 0, d: 1, type, name, aid, rid: `42.84.4.${i + 100}`,
      x: 100, y: 200 + i, w: 200, h: 20, on: true, val: null, ro: null,
      checked: null, selected: null, scroll: null, ...extra });
  };
  detailNode("Edit", "", "receipt.widget_detailPanel.lineEdit_detailsTitle", { val: "Synthetic receipt", ro: false });
  detailNode("Edit", "", "receipt.widget_detailPanel.dateEdit_datum.AAVDateLineEdit", { val: "01.02.2026", ro: false });
  detailNode("Edit", "", "receipt.widget_detailPanel.lineEdit_belegNummer", { val: "DOC-1", ro: false });
  detailNode("Edit", "", "receipt.widget_detailPanel.lineEdit_betrag", { val: "12,34", ro: false });
  detailNode("Edit", "", "receipt.widget_detailPanel.comboBox_umsatzsteuer.QLineEdit", { val: "19 %", ro: false });
  detailNode("CheckBox", "Netto", "receipt.widget_detailPanel.checkBox_netto", { checked: true });
  detailNode("Edit", "", "receipt.widget_detailPanel.textEdit_notiz", { val: "Synthetic note", ro: false });
  detailNode("Button", "Detailansicht  schließen", "receipt.widget_detailPanel.pushButton_detailsClose");
  let detailState = "list";
  const detailActions = [];
  const detailClient = { binding: { hwnd: 42, pid: 99 },
    request: async (operation, args) => {
      if (operation === "window_inventory") {
        assert.deepEqual(args, {});
        return { durationMs: 1, result: { ok: true, windows: processWindows, visibleWindowCount: processWindows.length, productWindowCount: processWindows.length,
          untitledWindows: [] } };
      }
      assert.equal(operation, "accessibility_snapshot");
      const tool = args.toolTitle === "BelegManager";
      if (tool && args.aidContains) assert.deepEqual(args.aidContains, [".widget_detailPanel."]);
      const selectedNodes = tool ? (detailState === "detail" ? detailNodes : receiptNodes) : mainNodes;
      return { durationMs: 2, result: { ok: true, controllerBound: true, scope: "qt-accessibility-content",
        hwnd: tool ? 84 : 42, windowRect: { x: 0, y: 0, w: 1000, h: 600 }, windowEnabled: true,
        modalBlocked: false, exactMatches: {}, nodes: selectedNodes,
        stats: { ...stats, n: selectedNodes.length } } };
    },
    requestAcknowledged: async (operation, args) => {
      assert.equal(operation, "accessibility_action");
      detailActions.push(args.action);
      if (args.action === "activate-table-cell") {
        assert.equal(args.rid, receipts.rows[0].rowRid);
        assert.equal(args.expectedName, "Synthetic receipt*");
        detailState = "detail";
      } else {
        assert.equal(args.action, "press");
        assert(args.aid.endsWith(".pushButton_detailsClose"));
        detailState = "list";
      }
      return { durationMs: 3, mutationAckMs: 1, receiptAcknowledged: true,
        result: { ok: true, mutationAttempted: true } };
    },
  };
  const detailRead = await executeQtNativeRead("receipt_manager_read", {
    rowRid: receipts.rows[0].rowRid,
    rowFingerprint: receipts.rows[0].rowFingerprint,
    expectedListFingerprint: receipts.listFingerprint,
  }, { qtNativeClient: detailClient }, 5000, undefined, loadProductProfile("2025"));
  assert.equal(detailRead.ok, true, JSON.stringify(detailRead));
  assert.equal(detailRead.backend, "qt");
  assert.equal(detailRead.valuesComplete, true);
  assert.deepEqual(detailRead.values, { title: "Synthetic receipt", date: "2026-02-01", documentNumber: "DOC-1",
    amount: "12,34", vatRate: "19", net: true, note: "Synthetic note" });
  assert.match(detailRead.detailFingerprint, /^[A-F0-9]{64}$/u);
  assert.equal(detailRead.semanticListUnchanged, true);
  assert.equal(detailRead.detailIdentityMatchesTarget, true);
  assert.equal(detailRead.physicalInputUsed, false);
  assert.equal(detailRead.foregroundLeaseUsed, false);
  assert.equal(detailRead.verified, true);
  assert.equal(detailRead.clickBinding.method, "qt-table-cell-activate");
  assert.equal(detailRead.closeBinding.method, "qt-accessibility-press");
  assert.deepEqual(detailActions, ["activate-table-cell", "press"]);
}
