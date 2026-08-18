import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceTextFilesFromStaging } from "../dist/atomic-files.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-atomic-files-"));
try {
  const first = join(temporary, "first.txt");
  const second = join(temporary, "second.txt");
  writeFileSync(first, "alt-eins\n", "utf8");
  writeFileSync(second, "alt-zwei\n", "utf8");
  replaceTextFilesFromStaging([
    { path: first, content: "neu-eins\n" },
    { path: second, content: "neu-zwei\n" },
  ]);
  assert.equal(readFileSync(first, "utf8"), "neu-eins\n");
  assert.equal(readFileSync(second, "utf8"), "neu-zwei\n");
  assert.throws(
    () => replaceTextFilesFromStaging([
      { path: first, content: "doppelt-eins\n" },
      { path: first, content: "doppelt-zwei\n" },
    ]),
    /unterschiedliche Pfade/,
  );
  assert.equal(readFileSync(first, "utf8"), "neu-eins\n");

  const directoryTarget = join(temporary, "ist-ein-ordner");
  mkdirSync(directoryTarget);
  assert.throws(
    () => replaceTextFilesFromStaging([
      { path: first, content: "darf-vor-ordner-nicht-ankommen\n" },
      { path: directoryTarget, content: "kein-dateiziel\n" },
    ]),
    /keine regulaere Datei/,
  );
  assert.equal(readFileSync(first, "utf8"), "neu-eins\n", "Zieltyp muss vor dem ersten Ersetzen geprueft werden");

  const missingParent = join(temporary, "fehlt", "third.txt");
  assert.throws(
    () => replaceTextFilesFromStaging([
      { path: first, content: "darf-nicht-ankommen\n" },
      { path: missingParent, content: "nicht-schreibbar\n" },
    ]),
    /ENOENT/,
  );
  assert.equal(readFileSync(first, "utf8"), "neu-eins\n", "Stagingfehler darf kein frueheres Ziel ersetzen");
  assert.equal(
    readdirSync(temporary).filter((name) => name.includes(".sse-tmp-")).length,
    0,
    "Stagingreste muessen auch nach Fehlern entfernt werden",
  );
  process.stdout.write("Atomare Dateien: Vollstaging, Ersetzen und Fehlerbereinigung bestanden\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
