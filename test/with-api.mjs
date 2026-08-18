import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiExecutor } from "../dist/api-executor.js";
import { createSseApiServer } from "../dist/api-server.js";
import { callWorker } from "../dist/worker.js";
import { traceOperations } from "./operation-trace.mjs";

const [, , command, ...args] = process.argv;
if (!command) {
  process.stderr.write("Aufruf: node test/with-api.mjs <befehl> [argumente...]\n");
  process.exit(2);
}

const temporary = mkdtempSync(join(tmpdir(), "sse-api-test-"));
const preserveTemporaryOnFailure = process.env.SSE_PRESERVE_TEST_SANDBOX_ON_FAILURE === "1";
const caseDir = process.env.SSE_CASE_DIR ?? join(temporary, "cases");
const workspaceDir = join(temporary, "workspace");
const resultDir = join(temporary, "results");
mkdirSync(caseDir, { recursive: true });
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
  caseDir,
  sseExecutable: process.env.SSE_EXECUTABLE,
  profileId: process.env.SSE_PROFILE_ID,
  // Ein noch unverifiziertes Jahr laesst sich sonst nie verifizieren: seine
  // Betriebsoperationen sind fail-closed. Nur ein ausdruecklich gesetztes
  // SSE_OPERATE_EXPERIMENTAL oeffnet den Weg fuer genau solche Laeufe.
  operateExperimental: process.env.SSE_OPERATE_EXPERIMENTAL === "1",
};
const execute = traceOperations("worker", createApiExecutor(config, callWorker));
const server = createSseApiServer({ config, execute });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address !== "object") throw new Error("Test-API hat keinen TCP-Port erhalten.");

let childFailed = false;
try {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SSE_API_URL: `http://127.0.0.1:${address.port}`,
      SSE_API_TOKEN: token,
      SSE_TEST_CASE_DIR: caseDir,
      SSE_TEST_WORKSPACE_DIR: workspaceDir,
      SSE_TEST_RESULT_DIR: resultDir,
    },
    stdio: "inherit",
    windowsHide: true,
  });
  const [code, signal] = await once(child, "exit");
  if (signal) {
    childFailed = true;
    throw new Error(`Testprozess wurde durch Signal ${signal} beendet.`);
  }
  childFailed = code !== 0;
  process.exitCode = typeof code === "number" ? code : 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
  if (childFailed && preserveTemporaryOnFailure) {
    process.stderr.write(`Test-Sandbox zur Diagnose erhalten: ${temporary}\n`);
  } else {
    for (let attempt = 0; attempt < 20 && existsSync(temporary); attempt++) {
      try {
        rmSync(temporary, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      } catch (error) {
        if (!error || !["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code) || attempt === 19) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }
}
