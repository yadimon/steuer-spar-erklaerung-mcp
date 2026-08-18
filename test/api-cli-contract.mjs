import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { readCliInputBounded } from "../dist/api-cli.js";
import { SSE_API_OPERATIONS } from "../dist/api-contract.js";
import { createSseApiServer } from "../dist/api-server.js";

const temporary = mkdtempSync(join(tmpdir(), "sse-api-cli-"));
const token = "api-cli-contract-token-with-at-least-24-characters";
const workspaceDir = join(temporary, "workspace");
const resultDir = join(workspaceDir, "results");
mkdirSync(resultDir, { recursive: true });

const config = {
  profileId: "2025",
  host: "127.0.0.1",
  port: 1,
  token,
  configPath: join(temporary, "config.json"),
  documentsDir: join(workspaceDir, "documents"),
  workspaceDir,
  resultDir,
  backupsDir: join(workspaceDir, "backups"),
};
let executeCalls = 0;
let executeDelayMs = 0;
let nextResult;
const server = createSseApiServer({
  config,
  execute: async (operation, args) => {
    executeCalls += 1;
    if (executeDelayMs > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, executeDelayMs));
      executeDelayMs = 0;
    }
    if (nextResult) {
      const result = nextResult;
      nextResult = undefined;
      return result;
    }
    return { ok: true, operation, args };
  },
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address === "object");
config.port = address.port;
writeFileSync(config.configPath, `${JSON.stringify({
  profileId: config.profileId,
  host: config.host,
  port: config.port,
  token: config.token,
  documentsDir: config.documentsDir,
  workspaceDir: config.workspaceDir,
  resultDir: config.resultDir,
  backupsDir: config.backupsDir,
}, null, 2)}\n`, "utf8");

const spawnCli = (input, ...args) => {
  const child = spawn(process.execPath, ["dist/api-cli.js", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SSE_API_TOKEN: "wrong-environment-token-with-at-least-24-characters",
      SSE_API_PORT: "9",
      SSE_API_URL: "http://127.0.0.1:9",
    },
    windowsHide: true,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  if (input !== undefined) child.stdin.end(input);
  return { child, readOutput: () => ({ stdout, stderr }) };
};
const runCliWithInput = async (input, ...args) => {
  const { child, readOutput } = spawnCli(input, ...args);
  const [code] = await once(child, "exit");
  const { stdout, stderr } = readOutput();
  return { code, stdout, stderr };
};
const runCli = (...args) => runCliWithInput(undefined, ...args);
const readJournal = (path) => readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
const hasJournalEntries = (path, count) => {
  try {
    return existsSync(path) && readJournal(path).length === count;
  } catch {
    return false;
  }
};
const waitFor = async (predicate, timeoutMs = 2_000) => {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error(`Bedingung nach ${timeoutMs} ms nicht erfuellt.`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
};

try {
  const helpStartedAt = performance.now();
  const help = await runCli("--help");
  const helpMs = performance.now() - helpStartedAt;
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /steuer-spar-erklaerung-call health/);
  assert(helpMs < 2_500, `API-CLI-Hilfe lud zu viel Laufzeitcode (${helpMs.toFixed(0)} ms).`);

  const health = await runCli("health", "--config", config.configPath);
  assert.equal(health.code, 0, health.stderr);
  assert.deepEqual(JSON.parse(health.stdout), { ok: true, operation: "health", args: {} });

  const journalPath = join(temporary, "health-journal.jsonl");
  const journaledHealth = await runCli("health", "--journal-file", journalPath, "--config", config.configPath);
  assert.equal(journaledHealth.code, 0, journaledHealth.stderr);
  const journal = readJournal(journalPath);
  assert.equal(journal.length, 2);
  assert.equal(journal[0].schemaVersion, 1);
  assert.equal(journal[0].status, "pending");
  assert.equal(journal[0].command, "health");
  assert.equal(journal[1].status, "complete");
  assert.equal(journal[1].exitCode, 0);
  assert.deepEqual(journal[1].result, JSON.parse(journaledHealth.stdout));

  const delayedJournalPath = join(temporary, "delayed-journal.jsonl");
  executeDelayMs = 750;
  const delayed = spawnCli(undefined, "health", "--journal-file", delayedJournalPath, "--config", config.configPath);
  await waitFor(() => hasJournalEntries(delayedJournalPath, 1));
  assert.equal(readJournal(delayedJournalPath)[0].status, "pending");
  assert.equal(delayed.child.exitCode, null, "CLI muss waehrend der Serveroperation noch laufen.");
  const [delayedCode] = await once(delayed.child, "exit");
  assert.equal(delayedCode, 0, delayed.readOutput().stderr);
  assert.deepEqual(readJournal(delayedJournalPath).map(({ status }) => status), ["pending", "complete"]);

  const failedJournalPath = join(temporary, "failed-journal.jsonl");
  nextResult = { ok: false, kind: "timeout", error: "synthetic timeout" };
  const failed = await runCli("health", "--journal-file", failedJournalPath, "--config", config.configPath);
  assert.equal(failed.code, 1, failed.stderr);
  assert.equal(readJournal(failedJournalPath)[1].exitCode, 1);
  assert.deepEqual(readJournal(failedJournalPath)[1].result, JSON.parse(failed.stdout));

  const existingJournalPath = join(temporary, "existing-journal.jsonl");
  writeFileSync(existingJournalPath, "keep\n", "utf8");
  const callsBeforeCollision = executeCalls;
  const collision = await runCli("health", "--journal-file", existingJournalPath, "--config", config.configPath);
  assert.equal(collision.code, 2);
  assert.match(collision.stderr, /Journaldatei existiert bereits/);
  assert.equal(readFileSync(existingJournalPath, "utf8"), "keep\n");
  assert.equal(executeCalls, callsBeforeCollision, "Bei einer vorhandenen Journaldatei darf kein API-Aufruf starten.");

  const argsPath = join(temporary, "find-args.json");
  const utf8Arguments = { name: "Prüfer\nÄnderung 25 €", type: "Button" };
  writeFileSync(argsPath, `${JSON.stringify(utf8Arguments)}\n`, "utf8");
  const find = await runCli("find", "--args-file", argsPath, "--timeout-ms", "1000", "--config", config.configPath);
  assert.equal(find.code, 0, find.stderr);
  assert.deepEqual(JSON.parse(find.stdout).args, utf8Arguments,
    "UTF-8-Argumentdateien müssen Nicht-ASCII und Zeilenumbrüche bytegetreu transportieren.");

  const findViaStdin = await runCliWithInput(
    JSON.stringify({ name: "Zurueck", type: "Button" }),
    "find", "--args-file", "-", "--timeout-ms", "1000", "--config", config.configPath,
  );
  assert.equal(findViaStdin.code, 0, findViaStdin.stderr);
  assert.deepEqual(JSON.parse(findViaStdin.stdout).args, { name: "Zurueck", type: "Button" });

  await assert.rejects(
    readCliInputBounded(Readable.from(["123", "45"]), 4),
    /groesser als 4 Bytes/,
  );
  const invalidStdin = await runCliWithInput("[]", "find", "--args-file", "-", "--config", config.configPath);
  assert.equal(invalidStdin.code, 2);
  assert.match(invalidStdin.stderr, /muss ein JSON-Objekt enthalten/);
  const invalidUtf8Stdin = await runCliWithInput(
    Buffer.from([0xc3]),
    "find", "--args-file", "-", "--config", config.configPath,
  );
  assert.equal(invalidUtf8Stdin.code, 2);
  assert.match(invalidUtf8Stdin.stderr, /kein gueltiges UTF-8/);

  const discovery = await runCli("discovery", "--config", config.configPath);
  assert.equal(discovery.code, 0, discovery.stderr);
  assert.equal(JSON.parse(discovery.stdout).operations.length, SSE_API_OPERATIONS.length);

  const described = await runCli("describe", "find", "--config", config.configPath);
  assert.equal(described.code, 0, described.stderr);
  assert.equal(JSON.parse(described.stdout).operation, "find");
  assert(JSON.parse(described.stdout).argumentSchema.properties.name);

  const unknownDescription = await runCli("describe", "nicht_freigegeben", "--config", config.configPath);
  assert.equal(unknownDescription.code, 1);
  assert.match(unknownDescription.stderr, /nicht Teil der freigegebenen SSE-API/);

  const errorJournalPath = join(temporary, "describe-error-journal.jsonl");
  const journaledUnknown = await runCli(
    "describe", "nicht_freigegeben", "--journal-file", errorJournalPath, "--config", config.configPath,
  );
  assert.equal(journaledUnknown.code, 1);
  const errorJournal = readJournal(errorJournalPath);
  assert.deepEqual(errorJournal.map(({ status }) => status), ["pending", "error"]);
  assert.equal(errorJournal[1].exitCode, 1);
  assert.match(errorJournal[1].error, /nicht Teil der freigegebenen SSE-API/);

  const openApi = await runCli("openapi", "--config", config.configPath);
  assert.equal(openApi.code, 0, openApi.stderr);
  assert.equal(JSON.parse(openApi.stdout).openapi, "3.1.0");

  const rejectedInline = await runCli("find", "--args-json", "{}", "--config", config.configPath);
  assert.equal(rejectedInline.code, 2);
  assert.match(rejectedInline.stderr, /Unbekannte Option '--args-json'/);
  assert(!rejectedInline.stderr.includes(token));
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(temporary, { recursive: true, force: true });
}

process.stdout.write("API-CLI: schnelle Hilfe, Config-Autoload, Datei/stdin, Discovery und Prozesslisten-Schutz bestanden\n");
