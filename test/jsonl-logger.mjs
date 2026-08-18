import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRotatingJsonlLogger } from "../dist/jsonl-logger.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-jsonl-logger-"));
try {
  const diagnostics = [];
  const logPath = join(temporary, "logs", "api.jsonl");
  const logger = createRotatingJsonlLogger({
    logPath,
    maxBytes: 512,
    maxLineBytes: 192,
    now: () => new Date("2026-08-04T03:00:00.000Z"),
    writeDiagnostic: (line) => diagnostics.push(line),
  });

  logger.log({ event: "ready" });
  logger.log({ event: "cyclic", payload: 1n });
  logger.log({ event: "oversized", payload: "x".repeat(1_000) });
  for (let index = 0; index < 20; index += 1) {
    logger.log({ event: "bounded", index, payload: "y".repeat(40) });
  }

  assert.equal(logger.isFileLoggingAvailable(), true);
  assert(statSync(logPath).size <= 512, "Aktuelle Logdatei muss begrenzt bleiben");
  assert(statSync(`${logPath}.1`).size <= 512, "Rotierte Logdatei muss begrenzt bleiben");
  const allOutput = diagnostics.join("");
  assert.match(allOutput, /"event":"ready"/);
  assert.match(allOutput, /"event":"log-serialization-failed"/);
  assert.match(allOutput, /"event":"log-record-too-large"/);

  const blockedPath = join(temporary, "blocked", "api.jsonl");
  mkdirSync(blockedPath, { recursive: true });
  const blockedDiagnostics = [];
  const blocked = createRotatingJsonlLogger({
    logPath: blockedPath,
    maxBytes: 512,
    writeDiagnostic: (line) => blockedDiagnostics.push(line),
  });
  blocked.log({ event: "api-remains-available" });
  blocked.log({ event: "second-record" });
  assert.equal(blocked.isFileLoggingAvailable(), false);
  assert.equal(blockedDiagnostics.filter((line) => line.includes("file-log-disabled")).length, 1);
  assert.match(blockedDiagnostics.join(""), /api-remains-available/);
  assert.doesNotThrow(() => readFileSync(logPath, "utf8"));

  const inheritedPath = join(temporary, "inherited", "api.jsonl");
  mkdirSync(join(temporary, "inherited"), { recursive: true });
  writeFileSync(inheritedPath, "x", "utf8");
  truncateSync(inheritedPath, 2_048);
  writeFileSync(`${inheritedPath}.1`, "y", "utf8");
  truncateSync(`${inheritedPath}.1`, 2_048);
  const inheritedDiagnostics = [];
  const inherited = createRotatingJsonlLogger({
    logPath: inheritedPath,
    maxBytes: 512,
    maxLineBytes: 192,
    writeDiagnostic: (line) => inheritedDiagnostics.push(line),
  });
  inherited.log({ event: "fresh-after-oversized" });
  assert(statSync(inheritedPath).size <= 512);
  assert.equal(inheritedDiagnostics.some((line) => line.includes("file-log-reset")), true);

  const throwingDiagnostic = createRotatingJsonlLogger({
    logPath: join(temporary, "throwing", "api.jsonl"),
    maxBytes: 512,
    writeDiagnostic: () => { throw new Error("synthetischer Diagnosefehler"); },
  });
  assert.doesNotThrow(() => throwingDiagnostic.log({ event: "api-muss-weiterlaufen" }));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write("JSONL-Logger: Rotation, Grenzen, Serialisierungs- und Datei-Fallback bestanden\n");
