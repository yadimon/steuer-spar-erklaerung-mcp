/**
 * Opt-in Live-Nachweis fuer die Gewinn-Erfassung des Folgejahres.
 *
 * Der Test liest ausschliesslich eine bereits vom Aufrufer bereitgestellte
 * Wegwerfkopie. Er speichert nicht, ruft ELSTER nicht auf und beweist am Ende
 * Bytegleichheit. Das Produktprofil 2025 muss die Kopie als GewErfass2026 im
 * Startmodus einurvor oeffnen und die UStVA 2026 semantisch ausgeben.
 *
 * Voraussetzung:
 *   SSE_NEXT_YEAR_USTVA_FIXTURE=<GewErfass2026-Kopie im SSE_CASE_DIR>
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fixtureCaseRef } from "./fixture-case-ref.mjs";

const fixture = process.env.SSE_NEXT_YEAR_USTVA_FIXTURE;
assert(fixture, "SSE_NEXT_YEAR_USTVA_FIXTURE mit einer Wegwerfkopie ist Pflicht.");
const caseRef = fixtureCaseRef(fixture, { extension: ".GewErfass2026" });
const sha256 = () => createHash("sha256").update(readFileSync(fixture)).digest("hex").toUpperCase();
const originalHash = sha256();

const here = dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: "sse-live-ustva-next-year", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, "..", "dist", "index.js")],
  env: { ...process.env },
});
const fullText = (result) => result?.content?.filter((part) => part.type === "text")
  .map((part) => part.text).join("\n") ?? "";
const call = async (name, args = {}, timeout = 300_000) => {
  const result = await client.callTool(
    { name, arguments: args },
    undefined,
    { timeout, maxTotalTimeout: timeout },
  );
  assert.notEqual(result?.isError, true, `${name}: ${fullText(result)}`);
  return result.structuredContent ?? JSON.parse(fullText(result));
};

let instance = null;
try {
  await client.connect(transport);
  const product = await call("sse_product_info");
  assert.equal(product.profileId, "2025");
  assert.equal(product.taxYear, 2025);
  assert(product.supportedCaseYears?.einurvor?.includes(2026),
    "Produktprofil 2025 nennt GewErfass2026 nicht als freigegebenes Folgejahr.");

  const caseInfo = await call("sse_case_hash", { ref: caseRef });
  assert.equal(caseInfo.sha256, originalHash);
  assert.equal(String(caseInfo.header?.VJahr), "2026");
  assert.match(String(caseInfo.header?.FileType), /Gewinn-Erfassung|GewErfass/iu);

  const launched = await call("sse_launch", { caseRef, mode: "einurvor" });
  instance = { pid: launched.pid, hwnd: launched.instance?.hwnd };
  assert(Number.isInteger(instance.pid) && instance.pid > 0, "Start lieferte keine gebundene PID.");
  assert(Number.isInteger(instance.hwnd) && instance.hwnd > 0, "Start lieferte kein gebundenes Hauptfenster.");
  assert.equal(launched.case?.documentType, "GewErfass");
  assert.equal(launched.case?.taxYear, 2026);
  assert.equal(launched.case?.mode, "einurvor");
  const stateAfterLaunch = await call("sse_ui_state", { hwnd: instance.hwnd });

  const heading = "Umsatzsteuer-Voranmeldungen 2026";
  const navigation = await call("sse_goto", {
    name: heading,
    maxSteps: 200,
    useSearch: true,
    hwnd: instance.hwnd,
  });
  assert.equal(navigation.erreicht, true);
  assert.equal(navigation.ueberschrift, heading);
  const stateBeforeRead = await call("sse_ui_state", { hwnd: instance.hwnd });

  const overview = await call("sse_ustva_read", { hwnd: instance.hwnd });
  assert.equal(overview.pageKind, "overview");
  assert.equal(overview.taxYear, 2026);
  assert.equal(overview.page, heading);
  assert.equal(typeof overview.period, "object");
  assert.equal(typeof overview.amounts, "object");
  assert.equal(overview.transmission?.blockedByApi, true);
  assert.deepEqual(overview.effects, { savePerformed: false, submissionPerformed: false });

  const stateAfterRead = await call("sse_ui_state", { hwnd: instance.hwnd });
  assert.equal(
    stateAfterRead.ungespeichert,
    stateBeforeRead.ungespeichert,
    "ustva_read hat den Aenderungszustand gegenueber der bereits geoeffneten UStVA-Seite verschlechtert.",
  );
  await call("sse_close", {
    pid: instance.pid,
    hwnd: instance.hwnd,
    force: true,
    discardChanges: true,
  }, 120_000);
  instance = null;
  assert.equal(sha256(), originalHash, "Read-only UStVA-Nachweis hat die Wegwerfkopie veraendert.");

  process.stdout.write(JSON.stringify({
    ok: true,
    profileId: product.profileId,
    productTaxYear: product.taxYear,
    caseYear: 2026,
    startMode: "einurvor",
    pageKind: overview.pageKind,
    navigationMarkedDirty: stateAfterLaunch.ungespeichert === false && stateBeforeRead.ungespeichert === true,
    readDirtyStateUnchanged: stateAfterRead.ungespeichert === stateBeforeRead.ungespeichert,
    unchanged: true,
    submissionBlocked: overview.transmission?.blockedByApi === true,
  }) + "\n");
} finally {
  try {
    if (instance?.pid) {
      await call("sse_close", {
        pid: instance.pid,
        ...(instance.hwnd ? { hwnd: instance.hwnd } : {}),
        force: true,
        discardChanges: true,
      }, 120_000).catch(() => undefined);
    }
  } finally {
    await client.close().catch(() => undefined);
    assert.equal(sha256(), originalHash, "Cleanup hat die Wegwerfkopie veraendert.");
  }
}
