import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiExecutor } from "../dist/api-executor.js";
import { createSseApiServer } from "../dist/api-server.js";
import { callWorker } from "../dist/worker.js";

const [, , command, ...args] = process.argv;
if (!command) {
  process.stderr.write("Aufruf: node test/with-api.mjs <befehl> [argumente...]\n");
  process.exit(2);
}

const temporary = mkdtempSync(join(tmpdir(), "sse-api-test-"));
const workspaceDir = join(temporary, "workspace");
const resultDir = join(temporary, "results");
mkdirSync(workspaceDir, { recursive: true });
mkdirSync(resultDir, { recursive: true });
const token = randomBytes(32).toString("base64url");
const config = {
  host: "127.0.0.1",
  port: 1,
  token,
  configPath: join(temporary, "config.json"),
  workspaceDir,
  resultDir,
  caseDir: process.env.SSE_CASE_DIR,
  sseExecutable: process.env.SSE_EXECUTABLE,
};
const execute = createApiExecutor(config, callWorker);
const server = createSseApiServer({ config, execute });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address !== "object") throw new Error("Test-API hat keinen TCP-Port erhalten.");

try {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SSE_API_URL: `http://127.0.0.1:${address.port}`,
      SSE_API_TOKEN: token,
      SSE_TEST_WORKSPACE_DIR: workspaceDir,
      SSE_TEST_RESULT_DIR: resultDir,
    },
    stdio: "inherit",
    windowsHide: true,
  });
  const [code, signal] = await once(child, "exit");
  if (signal) throw new Error(`Testprozess wurde durch Signal ${signal} beendet.`);
  process.exitCode = typeof code === "number" ? code : 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(temporary, { recursive: true, force: true });
}
