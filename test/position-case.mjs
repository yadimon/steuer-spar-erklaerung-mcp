/**
 * Stellt eine Wegwerfkopie einmalig auf die profilierte Formularseite.
 *
 * Warum das noetig ist: Der offizielle Musterfall oeffnet auf einer
 * Uebersichtsseite ohne 'Weiter'. Gemessen wurde, dass dort weder Invoke auf
 * 'Jetzt beginnen' noch der lineare Blaetterweg weiterfuehrt - nur ein echter
 * Mausklick in den Navigationsbaum, und der ist auf dem privaten Desktop
 * technisch ausgeschlossen. Jeder versteckte Test war damit auf der
 * Startseite gefangen.
 *
 * Deshalb einmal sichtbar: Zweig anklicken, zur profilierten Seite blaettern,
 * hashgebunden speichern. Die Anwendung merkt sich die Seite in der Datei -
 * danach oeffnen alle weiteren Laeufe direkt dort, auch versteckt.
 *
 * Aufruf: SSE_POSITION_FIXTURE=<Kopie im Fallbereich der Test-API>
 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureCaseRef } from "./fixture-case-ref.mjs";
import { gotoPageFocusless } from "./focusless-navigation.mjs";
import { profiledTablePage } from "./profiled-table-page.mjs";

/** Zweig, unter dem die profilierten Betriebsausgabenseiten liegen. */
const BRANCH = "Einnahmen/Ausgaben";

const fixture = process.env.SSE_POSITION_FIXTURE;
assert(fixture, "SSE_POSITION_FIXTURE mit einer Wegwerfkopie ist Pflicht.");
const caseRef = fixtureCaseRef(fixture);
const { heading } = profiledTablePage();
const sha256 = () => createHash("sha256").update(readFileSync(fixture)).digest("hex").toUpperCase();

const here = dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: "sse-position-case", version: "1.0.0" });
const fullText = (r) => r?.content?.filter((p) => p.type === "text").map((p) => p.text).join("\n") ?? "";
const call = async (name, args, timeout = 300_000) => {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout, maxTotalTimeout: timeout });
  assert.notEqual(result?.isError, true, `${name}: ${fullText(result)}`);
  return JSON.parse(fullText(result));
};

let started = null;
try {
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [join(here, "..", "dist", "index.js")], env: { ...process.env },
  }));
  const launch = await call("sse_launch", { caseRef, mode: "einur" });
  started = { pid: launch.pid, hwnd: launch.instance?.hwnd };
  const hwnd = started.hwnd;
  assert(Number.isInteger(hwnd) && hwnd > 0, `Start lieferte kein Hauptfenster: ${JSON.stringify(launch)}`);

  const found = await call("sse_find", { name: BRANCH, type: "TreeItem", hwnd });
  const hits = found.anzahl ?? found.count;
  assert.equal(hits, 1, `Navigationszweig '${BRANCH}' ist nicht eindeutig (${hits} Treffer).`);
  const branch = await call("sse_click_point", { name: BRANCH, type: "TreeItem", waitMs: 4000, hwnd });
  assert.equal(branch.seiteGewechselt, true, `Zweigklick wechselte die Seite nicht: ${JSON.stringify(branch)}`);

  const reached = await gotoPageFocusless(client, heading, { hwnd });
  assert.equal(reached.ueberschrift, heading, `Positionierung landete falsch: ${JSON.stringify(reached)}`);

  const hashBefore = sha256();
  const saved = await call("sse_save", { caseRef, expectedHashBefore: hashBefore, hwnd });
  assert.equal(saved.verified, true, `Positionierung wurde nicht bestaetigt gespeichert: ${JSON.stringify(saved)}`);
  assert.notEqual(sha256(), hashBefore, "Speichern hat die Datei nicht veraendert.");
  assert.equal(saved.transmitted, false,
    `Die positionierte Kopie gilt als uebermittelt: ${JSON.stringify(saved.transmitted)}`);

  process.stdout.write(`OK: Wegwerfkopie steht auf '${heading}' und ist gespeichert.\n`);
} finally {
  try {
    for (const instance of started ? [started] : []) {
      await call("sse_close", { ...instance, force: true, discardChanges: true }, 120_000);
    }
  } finally {
    await client.close();
  }
}
