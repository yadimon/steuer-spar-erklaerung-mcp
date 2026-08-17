import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const worker = join(root, "powershell", "sse-worker.ps1");
const powershell = join(
  process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);

const uint32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};
const record = (name, type, value) => {
  const nameBytes = Buffer.from(`${name}\0`, "ascii");
  return Buffer.concat([uint32(nameBytes.length), nameBytes, Buffer.from([type]), uint32(value.length), value]);
};
const textRecord = (name, value) => record(name, 4, Buffer.from(`${value}\0`, "utf8"));
const akadCase = () => {
  const uuid = Buffer.from("12345678-1234-1234-1234-123456789abc\0", "ascii");
  return Buffer.concat([
    Buffer.from("AKAD", "ascii"),
    Buffer.alloc(8),
    uint32(uuid.length),
    uuid,
    Buffer.from("FIIF", "ascii"),
    Buffer.from([0xaa, 0xbb, 0xcc]),
    textRecord("FileType", "Gew"),
    textRecord("VJahr", "2025"),
    textRecord("Steuernummer", "synthetisch"),
    textRecord("ElsterTransferTime", ""),
    record("svCrypted", 12, Buffer.from([1, 2, 3, 4])),
  ]);
};
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
const callWorker = (args, env = {}) => {
  const b64 = Buffer.from(JSON.stringify(args), "utf8").toString("base64");
  const output = execFileSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", worker, "-Op", "archive_cases", "-B64", b64],
    { cwd: root, encoding: "utf8", windowsHide: true, env: { ...process.env, ...env } },
  );
  return JSON.parse(output.trim());
};
const createInventory = (directory, hideCurrent = false) => {
  mkdirSync(directory);
  const old = join(directory, "alt.Gew2025");
  const current = join(directory, "aktuell.Gew2025");
  writeFileSync(old, akadCase());
  writeFileSync(current, akadCase());
  if (hideCurrent) {
    const attrib = join(process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows", "System32", "attrib.exe");
    execFileSync(attrib, ["+H", current], { windowsHide: true });
  }
  return {
    old,
    current,
    args: {
      dir: directory,
      cases: [{ name: "alt.Gew2025", expectedSha256: sha256(old) }],
      expectedRemaining: [{ name: "aktuell.Gew2025", expectedSha256: sha256(current) }],
    },
  };
};

const temporary = mkdtempSync(join(tmpdir(), "sse-archive-synthetic-"));
try {
  const cases = createInventory(join(temporary, "cases"), true);
  const archive = join(temporary, "archive");
  const success = callWorker({ ...cases.args, dest: archive });
  assert.equal(success.ok, true, JSON.stringify(success));
  assert.equal(success.archived, 1);
  assert.equal(success.recoverable, true);
  assert.equal(existsSync(cases.old), false);
  assert.equal(sha256(join(archive, "alt.Gew2025")), cases.args.cases[0].expectedSha256);
  assert.equal(sha256(cases.current), cases.args.expectedRemaining[0].expectedSha256);
  assert.match(readFileSync(join(archive, "pruefsummen.csv"), "utf8"), /alt\.Gew2025/);

  const rollbackCases = createInventory(join(temporary, "rollback-cases"));
  const rollbackArchive = join(temporary, "rollback-archive");
  const rolledBack = callWorker(
    { ...rollbackCases.args, dest: rollbackArchive },
    { SSE_MCP_TEST_FAULT: "archive-after-first-move" },
  );
  assert.equal(rolledBack.ok, false, JSON.stringify(rolledBack));
  assert.equal(rolledBack.kind, "postcondition-failed");
  assert.equal(rolledBack.rolledBack, true);
  assert.equal(sha256(rollbackCases.old), rollbackCases.args.cases[0].expectedSha256);
  assert.equal(sha256(rollbackCases.current), rollbackCases.args.expectedRemaining[0].expectedSha256);
  assert.equal(existsSync(rollbackArchive), false, "Leeres, eigenes Rollback-Ziel muss entfernt werden.");

  process.stdout.write("Fallarchiv: synthetischer AKAD-Erfolg, Hashbestand und erzwungener Rollback bestanden\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
