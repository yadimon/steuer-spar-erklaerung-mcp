import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, relative } from "node:path";

const roots = ["scripts", "test"];

function collectModules(directory) {
  const modules = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) modules.push(...collectModules(path));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) modules.push(path);
  }
  return modules;
}

function checkSyntax(path) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--check", path], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 16_384) stderr += chunk.slice(0, 16_384 - stderr.length);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && !signal) resolve();
      else reject(new Error(`${relative(process.cwd(), path)}: Exit ${code ?? "-"}, Signal ${signal ?? "-"}\n${stderr}`));
    });
  });
}

const modules = roots.flatMap(collectModules).sort();
// Skripte, die nur mit einer Fixture laufen und deshalb in keinem normalen
// Lauf ausgefuehrt werden. Genau sie verrotten unbemerkt, also wird hier
// wenigstens ihre Syntax verbindlich mitgeprueft.
//
// table-add/-update/-delete-transaction.mjs und click-dirty-readback.mjs
// standen frueher hier. Sie sind entfernt, weil sie nicht bloss ruhten,
// sondern nachweislich nicht mehr lauffaehig waren: Sie uebergaben
// 'file:<absoluter Pfad>' an sse_launch, was das strikte Schema seit der
// Pfadredaktion abweist, und erwarteten feste Betraege aus einer privaten
// Arbeitskopie. Ihre Gebiete deckt test/table-lifecycle-transaction.mjs
// beziehungsweise test/hidden-desktop-lifecycle.mjs vollstaendig ab.
const requiredDormantEntries = [
  "multi-instance-binding.mjs",
  "search-set-transaction.mjs",
  "table-lifecycle-transaction.mjs",
  "toggle-transaction.mjs",
  "visible-input-guard.mjs",
].map((name) => join("test", name));
for (const path of requiredDormantEntries) {
  assert(modules.includes(path), `Fixturegebundener Regressionseinstieg fehlt im Syntaxvertrag: ${path}`);
}

// Kein Testmodul darf PowerShell 7 hart aufrufen. Das Produkt
// laeuft auf der Windows PowerShell 5.1 aus dem Systemordner und verspricht
// ausdruecklich, ohne globale PowerShell-7-Installation auszukommen; ein
// solcher Aufruf im Testweg macht das Release-Gate auf einer frisch
// aufgesetzten Windows-Maschine unlauffaehig, waehrend es auf jedem
// Entwicklungsrechner gruen bleibt. Wer eine PowerShell braucht, nimmt
// resolveWindowsPowerShell() aus dist/windows-runtime.js.
//
// native-build-cache.mjs ist die eine begruendete Ausnahme: Es prueft, dass
// PowerShell Core die Produkt-DLL gerade NICHT bauen darf, und ueberspringt
// sich selbst, wenn Core fehlt.
//
// Der verbotene Name steht zusammengesetzt da, damit dieser Vertrag nicht
// ueber sein eigenes Zitat stolpert. Gesucht wird nur die ausfuehrbare Datei:
// derselbe Name als blosser Prozessname, etwa in einer Beobachtungsliste, ist
// erlaubt und kommt vor.
const verbotenerAufruf = "pw" + "sh";
const pwshAusnahmen = new Set([join("test", "native-build-cache.mjs")]);
for (const path of modules) {
  if (pwshAusnahmen.has(path)) continue;
  const quelltext = readFileSync(path, "utf8");
  assert(
    !new RegExp(`${verbotenerAufruf}\\.exe`, "u").test(quelltext),
    `${path} ruft ${verbotenerAufruf} hart auf. Das Gate muss ohne ` +
      "PowerShell 7 laufen; " +
      "nutze resolveWindowsPowerShell() aus dist/windows-runtime.js.",
  );
}

let nextIndex = 0;
const concurrency = Math.min(8, availableParallelism(), modules.length);
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (nextIndex < modules.length) {
    const path = modules[nextIndex++];
    await checkSyntax(path);
  }
}));

process.stdout.write(`JavaScript-Syntax: ${modules.length} Module inklusive Fixture-Regressionen geprueft\n`);
