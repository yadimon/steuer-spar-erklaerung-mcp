import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  ensureWorkspace,
  listWorkspaceFiles,
  MAX_LIST_HASH_BYTES,
  MAX_TEXT_FILE_BYTES,
  readWorkspaceText,
  resolveWorkspacePath,
  writeWorkspaceText,
} from "../dist/workspace.js";
import { createApiExecutor } from "../dist/api-executor.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-workspace-contract-"));
const root = join(temporary, "root");
const outside = join(temporary, "outside");
ensureWorkspace(root);
mkdirSync(outside);

try {
  for (const invalid of ["../escape.txt", "..\\escape.txt", "C:drive-relative.txt", "C:\\absolute.txt", "\\\\server\\share\\x", "nul\0x"]) {
    assert.throws(() => resolveWorkspacePath(root, invalid, true), /relativer Pfad|verlaesst/);
  }

  const link = join(root, "outside-link");
  symlinkSync(outside, link, "junction");
  assert.throws(() => resolveWorkspacePath(root, "outside-link/escape.txt", true), /ausserhalb/);
  assert.throws(() => resolveWorkspacePath(root, "outside-link/a/b/escape.txt", true), /ausserhalb/);
  assert.equal(existsSync(join(outside, "a")), false, "Junction darf ausserhalb keine Ordner anlegen");
  assert(!listWorkspaceFiles(root).some((entry) => entry.ref.includes("outside-link")),
    "Dateiliste darf Junctions weder verfolgen noch veroeffentlichen");

  const created = writeWorkspaceText(root, "inputs/value.txt", "eins\n");
  assert.equal(readWorkspaceText(root, "inputs/value.txt").text, "eins\n");
  assert.throws(() => writeWorkspaceText(root, "inputs/value.txt", "zwei\n"), /existiert bereits/);
  assert.equal(readWorkspaceText(root, "inputs/value.txt").info.sha256, created.sha256);
  const second = writeWorkspaceText(root, "inputs/value-v2.txt", "zwei\n");
  assert.notEqual(second.sha256, created.sha256);

  writeFileSync(join(root, "inputs", "invalid-utf8.txt"), Buffer.from([0xc3, 0x28]));
  assert.throws(
    () => readWorkspaceText(root, "inputs/invalid-utf8.txt"),
    /kein gueltiges UTF-8/,
    "Ungueltige Bytes duerfen nicht still durch Ersetzungszeichen veraendert werden",
  );
  const oversizedText = join(root, "inputs", "oversized.txt");
  writeFileSync(oversizedText, "x", "utf8");
  truncateSync(oversizedText, MAX_LIST_HASH_BYTES + 1);
  assert.throws(() => readWorkspaceText(root, "inputs/oversized.txt"), /groesser/);
  const oversizedListing = listWorkspaceFiles(root, "inputs", 500);
  const oversizedEntry = oversizedListing.find((entry) => entry.ref.endsWith("oversized.txt"));
  assert.equal(oversizedEntry?.sha256, null);
  assert.equal(oversizedEntry?.hashOmitted, true);

  writeFileSync(join(root, "a.txt"), "a");
  writeFileSync(join(root, "b.txt"), "b");
  const limited = listWorkspaceFiles(root, ".", 2);
  assert.equal(limited.length, 2);
  assert(limited.every((entry) => !isAbsolute(entry.ref) && typeof entry.sha256 === "string"));
  const withoutHashes = listWorkspaceFiles(root, ".", 2, false);
  assert(withoutHashes.every((entry) => entry.sha256 === null && entry.hashOmitted === true));
  assert.throws(() => listWorkspaceFiles(root, ".", 500, true, 1), /Ordnerlimit von 1/);
  assert.throws(() => listWorkspaceFiles(root, ".", 0), /Dateilimit.*zwischen 1 und 2000/);
  assert(readFileSync(join(root, "inputs", "value.txt"), "utf8").includes("eins"));
  const execute = createApiExecutor(
    {
      host: "127.0.0.1",
      port: 1,
      token: "workspace-test-token-with-24-characters",
      configPath: join(temporary, "config.json"),
      workspaceDir: root,
      resultDir: join(root, "results"),
    },
    async () => ({ ok: true }),
  );
  const invalidLimit = await execute("workspace_file_list", { limit: Number.POSITIVE_INFINITY }, 1_000);
  assert.equal(invalidLimit.ok, false);
  assert.match(invalidLimit.error, /ganze Zahl/);
  process.stdout.write("Workspace-Sandbox: Traversal, Junctions, Leselimits und exklusive Schreibziele bestanden\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
