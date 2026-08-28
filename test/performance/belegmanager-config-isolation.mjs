import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const ORIGINAL_NAME = ".api-mega-belegmanager-config-original.bin";
const MARKER_NAME = ".api-mega-belegmanager-config-recovery.json";
const sha256 = (value) => createHash("sha256").update(value).digest("hex").toUpperCase();

function paths({ evidenceRoot, localAppData, engineMajor }) {
  assert(isAbsolute(evidenceRoot) && isAbsolute(localAppData));
  assert(Number.isInteger(engineMajor) && engineMajor > 0);
  return {
    iniPath: join(localAppData, "Steuertipps", "SSE", String(engineMajor), "SSEKonf.user.ini"),
    originalPath: join(evidenceRoot, ORIGINAL_NAME),
    markerPath: join(evidenceRoot, MARKER_NAME),
  };
}

function restoreExistingIsolation(options) {
  const { iniPath, originalPath, markerPath } = paths(options);
  const hasOriginal = existsSync(originalPath);
  const hasMarker = existsSync(markerPath);
  if (!hasOriginal && !hasMarker) return { recovered: false };
  assert.equal(hasOriginal, true, "BelegManager-Recovery-Marker existiert ohne Originalkonfiguration.");
  assert.equal(hasMarker, true, "BelegManager-Originalkonfiguration existiert ohne Recovery-Marker.");
  const marker = JSON.parse(readFileSync(markerPath, "utf8"));
  const original = readFileSync(originalPath);
  assert.equal(sha256(original), marker.originalHash, "Private Recovery-Kopie hat einen unerwarteten Hash.");
  const currentHash = sha256(readFileSync(iniPath));
  assert([marker.originalHash, marker.swappedHash].includes(currentHash),
    "SSEKonf.user.ini driftete ausserhalb der isolierten Mega-Transaktion; nichts ueberschrieben.");
  if (currentHash === marker.swappedHash) writeFileSync(iniPath, original);
  assert.equal(sha256(readFileSync(iniPath)), marker.originalHash,
    "SSEKonf.user.ini wurde nicht byteidentisch restauriert.");
  unlinkSync(markerPath);
  unlinkSync(originalPath);
  return { recovered: true, originalHash: marker.originalHash };
}

function replaceDataDir(original, isolatedDataDir) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(original);
  assert.deepEqual(Buffer.from(text, "utf8"), original,
    "SSEKonf.user.ini ist nicht round-trip-faehiges UTF-8.");
  const sectionStart = text.search(/^[ \t]*\[BelegManager\][ \t]*$/imu);
  assert(sectionStart >= 0, "SSEKonf.user.ini enthaelt keinen [BelegManager]-Abschnitt.");
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
  const { iniPath, originalPath, markerPath } = paths(options);
  const original = readFileSync(iniPath);
  const swapped = replaceDataDir(original, resolve(isolatedDataDir));
  const marker = {
    schemaVersion: 1,
    originalHash: sha256(original),
    swappedHash: sha256(swapped),
  };
  writeFileSync(originalPath, original, { flag: "wx" });
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
