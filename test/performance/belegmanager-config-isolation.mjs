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
  const sectionPattern = new RegExp(`^[ \\t]*\\[${sectionName}\\][ \\t]*$`, "imu");
  const start = text.search(sectionPattern);
  if (start < 0) return null;
  const nextSectionOffset = text.slice(start).slice(1).search(/^[ \t]*\[[^\]]+\][ \t]*$/mu);
  return { start, end: nextSectionOffset < 0 ? text.length : start + 1 + nextSectionOffset };
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
  if (!body.every((line) => line.trim() === "")) return withoutKey;
  return withoutKey.slice(0, remaining.start) + withoutKey.slice(remaining.end);
}

function assertOnlyKnownRuntimeDrift(current, swapped) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const currentText = decoder.decode(current);
  const swappedText = decoder.decode(swapped);
  assert.deepEqual(Buffer.from(currentText, "utf8"), current);
  assert.deepEqual(Buffer.from(swappedText, "utf8"), swapped);
  // SSE darf diese Laufzeitwerte waehrend eines Laufs anlegen ODER aendern.
  // Fehlte der Eintrag in der Vergleichskonfiguration (frische Installation
  // schreibt [Files] erst beim ersten Fallkontakt), wird der neue Eintrag
  // entfernt statt ersetzt. Jede andere Abweichung bleibt fail-closed.
  const allowedRuntimeFields = [
    ["Files", "LastWorkDir"],
    ["License", "LastCheck"],
    ["WerteInfoPos", "Size3"],
    ["WerteInfoPos", "Size4"],
  ];
  const normalized = allowedRuntimeFields.reduce((text, [sectionName, keyName]) => {
    const swappedLine = optionalSectionKeyLine(swappedText, sectionName, keyName);
    if (swappedLine === null) return dropSectionKeyLine(text, sectionName, keyName);
    return replaceSectionKeyLine(text, sectionName, keyName, swappedLine);
  }, currentText);
  assert.deepEqual(Buffer.from(normalized, "utf8"), swapped,
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
  const text = new TextDecoder("utf-8", { fatal: true }).decode(original);
  assert.deepEqual(Buffer.from(text, "utf8"), original,
    "SSE-Benutzerkonfiguration ist nicht round-trip-faehiges UTF-8.");
  const sectionStart = text.search(/^[ \t]*\[BelegManager\][ \t]*$/imu);
  assert(sectionStart >= 0, "SSE-Benutzerkonfiguration enthaelt keinen [BelegManager]-Abschnitt.");
  const afterSection = text.slice(sectionStart);
  const nextSectionOffset = afterSection.slice(1).search(/^[ \t]*\[[^\]]+\][ \t]*$/mu);
  const sectionEnd = nextSectionOffset < 0 ? text.length : sectionStart + 1 + nextSectionOffset;
  const sectionText = text.slice(sectionStart, sectionEnd);
  const matches = [...sectionText.matchAll(/^([ \t]*DataDir[ \t]*=[ \t]*)([^\r\n]*)$/gimu)];
  assert.equal(matches.length, 1, "[BelegManager] braucht genau einen DataDir-Eintrag.");
  const match = matches[0];
  const absoluteMatchStart = sectionStart + match.index;
  const replacement = `${match[1]}${isolatedDataDir}`;
  return Buffer.from(
    text.slice(0, absoluteMatchStart) + replacement + text.slice(absoluteMatchStart + match[0].length),
    "utf8",
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
