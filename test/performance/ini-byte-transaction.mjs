import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWindowsPowerShell } from "../../dist/windows-runtime.js";

const hash = bytes => createHash("sha256").update(bytes).digest("hex").toUpperCase();
const helper = fileURLToPath(new URL("./ini-byte-transaction.ps1", import.meta.url));
const failureKinds = new Set(["locked-or-unavailable", "cas-mismatch", "write-failed", "invalid-or-unavailable"]);

/** Compare, preserve a private preimage, write and read back under one exclusive handle. */
function transact({ path, expectedHash, bytes, recoveryPath, mode }) {
  assert.equal(process.platform, "win32", "INI transactions require Windows.");
  assert(isAbsolute(path) && isAbsolute(recoveryPath), "INI transaction paths must be absolute.");
  assert(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 1024 * 1024,
    "INI transaction exceeds its byte bound.");
  assert.equal(typeof expectedHash === "string" && /^[A-F0-9]{64}$/u.test(expectedHash), true,
    "INI transaction needs an exact expected hash.");
  const newHash = hash(bytes);
  const child = spawnSync(resolveWindowsPowerShell(), [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helper,
  ], {
    input: JSON.stringify({ path, recoveryPath, mode, expectedHash, newHash, bytesBase64: bytes.toString("base64") }),
    encoding: "utf8", windowsHide: true, timeout: 15_000, maxBuffer: 65_536,
  });
  let result;
  try { result = JSON.parse(child.stdout ?? ""); }
  catch { throw Object.assign(new Error("INI transaction process failed; target state unknown; recovery artifacts retained."),
    { rollbackVerified: false, outcomeUnknown: true }); }
  if (child.error || child.signal || child.status !== 0 || result?.ok !== true) {
    const kind = failureKinds.has(result?.kind) ? result.kind : "protocol-error";
    const rollbackVerified = result?.rollbackVerified === true;
    const outcomeUnknown = Boolean(child.error || child.signal ||
      (kind === "write-failed" && !rollbackVerified) || kind === "protocol-error");
    throw Object.assign(new Error(`INI transaction refused (${kind}); rollbackVerified=${rollbackVerified}; ` +
      `outcomeUnknown=${outcomeUnknown}; recovery artifacts retained.`), { rollbackVerified, outcomeUnknown });
  }
  assert.equal(result.beforeHash === (mode === "private-copy" ? null : expectedHash), true,
    "INI transaction preimage attestation differs.");
  assert.equal(result.afterHash === newHash, true, "INI transaction readback attestation differs.");
  assert.equal(typeof result.writePerformed, "boolean", "INI transaction lacks a write outcome.");
  return { writePerformed: result.writePerformed, beforeHash: result.beforeHash, afterHash: result.afterHash };
}

export function commitIniBytes(options) {
  return transact({ ...options, mode: "compare-and-write" });
}

export function createPrivateIniCopy(path, bytes) {
  return transact({ path, bytes, expectedHash: hash(bytes), recoveryPath: path, mode: "private-copy" });
}
