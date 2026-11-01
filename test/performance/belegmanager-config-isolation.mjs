import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const ORIGINAL_NAME = ".api-mega-belegmanager-config-original.bin";
const SWAPPED_NAME = ".api-mega-belegmanager-config-swapped.bin";
const MARKER_NAME = ".api-mega-belegmanager-config-recovery.json";
const USER_CONFIG_NAME = ["SSEKonf", "user.ini"].join(".");
const sha256 = (value) => createHash("sha256").update(value).digest("hex").toUpperCase();

function paths({ evidenceRoot, localAppData, engineMajor }) {
  assert(isAbsolute(evidenceRoot) && isAbsolute(localAppData));
  assert(Number.isInteger(engineMajor) && engineMajor > 0);
  return {
    iniPath: join(localAppData, "Steuertipps", "SSE", String(engineMajor), USER_CONFIG_NAME),
    originalPath: join(evidenceRoot, ORIGINAL_NAME),
    swappedPath: join(evidenceRoot, SWAPPED_NAME),
    markerPath: join(evidenceRoot, MARKER_NAME),
  };
}

function sectionRange(text, sectionName) {
  const sectionPattern = new RegExp(`^[ \\t]*\\[${sectionName}\\][ \\t]*$`, "gimu");
  const headers = [...text.matchAll(sectionPattern)];
  assert(headers.length <= 1, `Abschnitt [${sectionName}] ist mehrfach vorhanden; keine eindeutige Konfiguration.`);
  if (!headers.length) return null;
  const header = headers[0];
  const afterHeader = header.index + header[0].length;
  const nextSectionOffset = text.slice(afterHeader).search(/^[ \t]*\[[^\]\r\n]+\][ \t]*$/mu);
  return { start: header.index, end: nextSectionOffset < 0 ? text.length : afterHeader + nextSectionOffset };
}

function replaceSectionKeyLine(text, sectionName, keyName, replacementLine) {
  const range = sectionRange(text, sectionName);
  assert(range, `SSE-Benutzerkonfiguration enthaelt keinen [${sectionName}]-Abschnitt.`);
  const keyPattern = new RegExp(`^([ \\t]*${keyName}[ \\t]*=[ \\t]*)([^\\r\\n]*)$`, "gimu");
  const matches = [...text.slice(range.start, range.end).matchAll(keyPattern)];
  assert.equal(matches.length, 1, `[${sectionName}] braucht genau einen ${keyName}-Eintrag.`);
  const match = matches[0];
  const absoluteMatchStart = range.start + match.index;
  return text.slice(0, absoluteMatchStart) + replacementLine +
    text.slice(absoluteMatchStart + match[0].length);
}

function sectionKeyLine(text, sectionName, keyName) {
  const line = optionalSectionKeyLine(text, sectionName, keyName);
  assert(line !== null, `SSE-Benutzerkonfiguration enthaelt keinen [${sectionName}]-Abschnitt.`);
  return line;
}

/** Wie sectionKeyLine, aber fehlender Abschnitt/Eintrag ist kein Fehler. */
function optionalSectionKeyLine(text, sectionName, keyName) {
  const range = sectionRange(text, sectionName);
  if (!range) return null;
  const keyPattern = new RegExp(`^[ \\t]*${keyName}[ \\t]*=[ \\t]*[^\\r\\n]*$`, "gimu");
  const matches = [...text.slice(range.start, range.end).matchAll(keyPattern)];
  if (matches.length === 0) return null;
  assert.equal(matches.length, 1, `[${sectionName}] braucht hoechstens einen ${keyName}-Eintrag.`);
  return matches[0][0];
}

/**
 * Einen erlaubten Laufzeiteintrag entfernen, den die Vergleichskonfiguration
 * noch gar nicht kannte. Bleibt sein Abschnitt dadurch leer, faellt auch die
 * Ueberschrift weg - sonst verglichen wir eine leere Ueberschrift gegen ihr
 * vollstaendiges Fehlen. Alles andere bleibt byteweise bestehen und faellt
 * weiterhin fail-closed auf.
 */
function dropSectionKeyLine(text, sectionName, keyName) {
  const range = sectionRange(text, sectionName);
  if (!range) return text;
  const keyPattern = new RegExp(`^[ \\t]*${keyName}[ \\t]*=[ \\t]*[^\\r\\n]*(\\r?\\n)?`, "gimu");
  const matches = [...text.slice(range.start, range.end).matchAll(keyPattern)];
  if (matches.length === 0) return text;
  assert.equal(matches.length, 1, `[${sectionName}] braucht hoechstens einen ${keyName}-Eintrag.`);
  const match = matches[0];
  const absoluteMatchStart = range.start + match.index;
  const withoutKey = text.slice(0, absoluteMatchStart) +
    text.slice(absoluteMatchStart + match[0].length);
  const remaining = sectionRange(withoutKey, sectionName);
  if (!remaining) return withoutKey;
  const body = withoutKey.slice(remaining.start, remaining.end).split(/\r?\n/).slice(1);
  if (!body.every((line) => /^[ \t]*$/u.test(line))) return withoutKey;
  return withoutKey.slice(0, remaining.start) + withoutKey.slice(remaining.end);
}

function assertOnlyKnownRuntimeDrift(current, swapped) {
  // latin1 is a reversible byte view, not a guess at the INI's text encoding.
  // Section names and permitted runtime keys are ASCII; every other byte stays opaque.
  const currentText = current.toString("latin1");
  const swappedText = swapped.toString("latin1");
  // SSE darf diese Laufzeitwerte waehrend eines Laufs anlegen ODER aendern.
  // Fehlte der Eintrag in der Vergleichskonfiguration (frische Installation
  // schreibt [Files] erst beim ersten Fallkontakt), wird der neue Eintrag
  // entfernt statt ersetzt. Jede andere Abweichung bleibt fail-closed.
  const allowedRuntimeFields = [
    // BelegManager schreibt waehrend eines Laufs einen Layoutwert. Er ist in
    // einer frischen Vergleichskonfiguration nicht vorhanden und wird dann
    // beim Normalisieren entfernt; jede andere Drift bleibt fail-closed.
    ["BelegManager", "ColumnNameWidth"],
    ["Files", "LastWorkDir"],
    ["License", "LastCheck"],
    // Reading the short help can persist its size when the own product exits.
    ["ShortHelpWindow", "H"],
    ["ShortHelpWindow", "W"],
    // Qt persistiert die normale Hauptfenster-Geometrie beim Schliessen. Ein
    // Wechsel von Aufloesung/DPI darf die private DataDir-Restauration nicht
    // blockieren; Darstellungsoptionen und andere Schluessel bleiben gesperrt.
    ["MainWindowPos", "H"],
    ["MainWindowPos", "MinMax"],
    ["MainWindowPos", "W"],
    ["MainWindowPos", "X"],
    ["MainWindowPos", "Y"],
    ["WerteInfoPos", "Count"],
    ["WerteInfoPos", "H"],
    ["WerteInfoPos", "MinMax"],
    ["WerteInfoPos", "Size1"],
    ["WerteInfoPos", "Size2"],
    ["WerteInfoPos", "Size3"],
    ["WerteInfoPos", "Size4"],
    ["WerteInfoPos", "W"],
    ["WerteInfoPos", "X"],
    ["WerteInfoPos", "Y"],
  ];
  const normalized = allowedRuntimeFields.reduce((text, [sectionName, keyName]) => {
    const swappedLine = optionalSectionKeyLine(swappedText, sectionName, keyName);
    if (swappedLine === null) return dropSectionKeyLine(text, sectionName, keyName);
    return replaceSectionKeyLine(text, sectionName, keyName, swappedLine);
  }, currentText);
  assert.equal(Buffer.from(normalized, "latin1").equals(swapped), true,
    "SSE-Benutzerkonfiguration driftete ausserhalb der bekannten Laufzeitwerte; nichts ueberschrieben.");
}

function restoreExistingIsolation(options) {
  const { iniPath, originalPath, swappedPath, markerPath } = paths(options);
  const hasOriginal = existsSync(originalPath);
  const hasSwapped = existsSync(swappedPath);
  const hasMarker = existsSync(markerPath);
  if (!hasOriginal && !hasSwapped && !hasMarker) return { recovered: false };
  assert.equal(hasOriginal, true, "BelegManager-Recovery-Marker existiert ohne Originalkonfiguration.");
  assert.equal(hasSwapped, true, "BelegManager-Recovery-Marker existiert ohne isolierte Vergleichskonfiguration.");
  assert.equal(hasMarker, true, "BelegManager-Originalkonfiguration existiert ohne Recovery-Marker.");
  const marker = JSON.parse(readFileSync(markerPath, "utf8"));
  const original = readFileSync(originalPath);
  const swapped = readFileSync(swappedPath);
  assert.equal(sha256(original), marker.originalHash, "Private Recovery-Kopie hat einen unerwarteten Hash.");
  assert.equal(sha256(swapped), marker.swappedHash, "Private Vergleichskopie hat einen unerwarteten Hash.");
  const current = readFileSync(iniPath);
  const currentHash = sha256(current);
  if (![marker.originalHash, marker.swappedHash].includes(currentHash)) {
    assertOnlyKnownRuntimeDrift(current, swapped);
  }
  if (currentHash !== marker.originalHash) writeFileSync(iniPath, original);
  assert.equal(sha256(readFileSync(iniPath)), marker.originalHash,
    "SSE-Benutzerkonfiguration wurde nicht byteidentisch restauriert.");
  unlinkSync(markerPath);
  unlinkSync(swappedPath);
  unlinkSync(originalPath);
  return { recovered: true, originalHash: marker.originalHash };
}

function replaceDataDir(original, isolatedDataDir) {
  const text = original.toString("latin1");
  const range = sectionRange(text, "BelegManager");
  assert(range, "SSE-Benutzerkonfiguration enthaelt keinen [BelegManager]-Abschnitt.");
  const sectionText = text.slice(range.start, range.end);
  const matches = [...sectionText.matchAll(/^([ \t]*DataDir[ \t]*=[ \t]*)([^\r\n]*)$/gimu)];
  assert.equal(matches.length, 1, "[BelegManager] braucht genau einen DataDir-Eintrag.");
  const match = matches[0];
  const absoluteMatchStart = range.start + match.index;
  // Keep the existing UTF-8 directory-value contract without decoding unrelated values.
  const replacement = `${match[1]}${Buffer.from(isolatedDataDir, "utf8").toString("latin1")}`;
  return Buffer.from(
    text.slice(0, absoluteMatchStart) + replacement + text.slice(absoluteMatchStart + match[0].length),
    "latin1",
  );
}

export function beginBelegManagerConfigIsolation(options) {
  const { evidenceRoot, isolatedDataDir } = options;
  assert(isAbsolute(isolatedDataDir));
  mkdirSync(evidenceRoot, { recursive: true });
  const recovered = restoreExistingIsolation(options);
  mkdirSync(isolatedDataDir, { recursive: true });
  assert.deepEqual(readdirSync(isolatedDataDir), [], "Der isolierte BelegManager-DataDir ist nicht leer.");
  const { iniPath, originalPath, swappedPath, markerPath } = paths(options);
  const original = readFileSync(iniPath);
  // Reject ambiguous known runtime sections before changing the real DataDir.
  assertOnlyKnownRuntimeDrift(original, original);
  const swapped = replaceDataDir(original, resolve(isolatedDataDir));
  const marker = {
    schemaVersion: 1,
    originalHash: sha256(original),
    swappedHash: sha256(swapped),
  };
  writeFileSync(originalPath, original, { flag: "wx" });
  writeFileSync(swappedPath, swapped, { flag: "wx" });
  writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, { flag: "wx" });
  writeFileSync(iniPath, swapped);
  assert.equal(sha256(readFileSync(iniPath)), marker.swappedHash,
    "Isolierter BelegManager-DataDir wurde nicht exakt in die Benutzerkonfiguration geschrieben.");
  let restored = false;
  return {
    recoveredStaleIsolation: recovered.recovered,
    originalHash: marker.originalHash,
    swappedHash: marker.swappedHash,
    restore() {
      assert.equal(restored, false, "BelegManager-Konfiguration darf nur einmal restauriert werden.");
      const result = restoreExistingIsolation(options);
      assert.equal(result.recovered, true);
      restored = true;
      return { restored: true, originalHash: result.originalHash };
    },
  };
}
