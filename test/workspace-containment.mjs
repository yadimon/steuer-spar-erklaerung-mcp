import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  ensureWorkspace,
  listWorkspaceFiles,
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

  const created = writeWorkspaceText(root, "inputs/value.txt", "eins\n");
  assert.equal(readWorkspaceText(root, "inputs/value.txt").text, "eins\n");
  assert.throws(() => writeWorkspaceText(root, "inputs/value.txt", "zwei\n"), /expectedSha256/);
  assert.throws(
    () => writeWorkspaceText(root, "inputs/value.txt", "zwei\n", "0".repeat(64)),
    /stimmt nicht/,
  );
  assert.throws(
    () => writeWorkspaceText(root, "inputs/missing.txt", "x", created.sha256),
    /existiert nicht/,
  );
  const replaced = writeWorkspaceText(root, "inputs/value.txt", "zwei\n", created.sha256);
  assert.notEqual(replaced.sha256, created.sha256);

  writeFileSync(join(root, "a.txt"), "a");
  writeFileSync(join(root, "b.txt"), "b");
  const limited = listWorkspaceFiles(root, ".", 2);
  assert.equal(limited.length, 2);
  assert(limited.every((entry) => !isAbsolute(entry.ref) && typeof entry.sha256 === "string"));
  const withoutHashes = listWorkspaceFiles(root, ".", 2, false);
  assert(withoutHashes.every((entry) => entry.sha256 === null && entry.hashOmitted === true));
  assert(!readFileSync(join(root, "inputs", "value.txt"), "utf8").includes("eins"));
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
  process.stdout.write("Workspace-Sandbox: Traversal, Junctions und SHA256-Schreibvertrag bestanden\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
