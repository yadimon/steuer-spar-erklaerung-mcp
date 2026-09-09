import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { executeQtNativeRead } from "../dist/qt-native-executor.js";
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
    const timer = setTimeout(() => run.kill(), 30_000);
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
  const exhausted = nativeWildcard("?".repeat(1000));
  assert.throws(() => exhausted("x".repeat(20_000)), error => error.kind === "native-selector-limit");
}
