import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export interface AtomicTextWrite {
  path: string;
  content: string;
  mode?: number;
}

/**
 * Schreibt zuerst alle Inhalte in exklusive Nachbardateien. Dadurch bleibt bei
 * Platz-/Encoding-/Pfadfehlern jede Zieldatei unveraendert. Erst wenn das
 * komplette Staging erfolgreich war, ersetzen atomare Same-Volume-Renames die
 * Ziele einzeln. Mehrere Dateien koennen betriebssystemseitig nicht als eine
 * Transaktion umbenannt werden; jede einzelne Datei bleibt aber immer ganz.
 */
export function replaceTextFilesFromStaging(files: readonly AtomicTextWrite[]): void {
  const identities = files.map((file) => {
    const absolute = resolve(file.path);
    return process.platform === "win32" ? absolute.toLocaleLowerCase("de-DE") : absolute;
  });
  if (new Set(identities).size !== identities.length) {
    throw new Error("Atomare Schreibziele muessen unterschiedliche Pfade verwenden.");
  }
  for (const file of files) {
    if (existsSync(file.path) && !lstatSync(file.path).isFile()) {
      throw new Error(`Atomisches Schreibziel ist keine regulaere Datei: ${file.path}`);
    }
  }
  const staged = files.map((file) => ({
    ...file,
    temporary: join(dirname(file.path), `.${basename(file.path)}.sse-tmp-${process.pid}-${randomUUID()}`),
  }));
  try {
    for (const file of staged) {
      writeFileSync(file.temporary, file.content, {
        encoding: "utf8",
        flag: "wx",
        ...(file.mode === undefined ? {} : { mode: file.mode }),
      });
    }
    for (const file of staged) renameSync(file.temporary, file.path);
  } finally {
    for (const file of staged) {
      if (existsSync(file.temporary)) unlinkSync(file.temporary);
    }
  }
}
