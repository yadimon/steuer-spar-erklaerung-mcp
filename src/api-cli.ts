#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ApiClientOptions } from "./api-client.js";
import { ApiClientError } from "./api-client-error.js";
import { MAX_API_BODY_BYTES } from "./api-contract.js";
import { parseJsonBytesStrict, readJsonFileStrict } from "./json-files.js";

interface CliArguments {
  command: string;
  targetOperation?: string;
  argsFile?: string;
  configPath?: string;
  timeoutMs: number;
}

const usage = [
  "Aufruf:",
  "  steuer-spar-erklaerung-call health [--config <config.json>]",
  "  steuer-spar-erklaerung-call <operation> --args-file <args.json|-> [--timeout-ms <ms>] [--config <config.json>]",
  "  steuer-spar-erklaerung-call discovery [--config <config.json>]",
  "  steuer-spar-erklaerung-call describe <operation> [--config <config.json>]",
  "  steuer-spar-erklaerung-call openapi [--config <config.json>]",
  "",
  "Mit --args-file - kommt ein begrenztes JSON-Objekt ueber stdin.",
  "Argumentwerte werden absichtlich nicht direkt in der Kommandozeile akzeptiert.",
].join("\n");

function parseCliArguments(argv: readonly string[]): CliArguments {
  const command = argv[0];
  if (!command) {
    throw new ApiClientError(usage, "usage");
  }
  let argsFile: string | undefined;
  let configPath: string | undefined;
  let timeoutMs = 90_000;
  let targetOperation: string | undefined;
  let optionStart = 1;
  if (command === "describe") {
    targetOperation = argv[1];
    if (!targetOperation || targetOperation.startsWith("--")) {
      throw new ApiClientError(`describe braucht einen Operationsnamen.\n${usage}`, "usage");
    }
    optionStart = 2;
  }
  for (let index = optionStart; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!["--args-file", "--config", "--timeout-ms"].includes(option ?? "")) {
      throw new ApiClientError(`Unbekannte Option '${option}'.\n${usage}`, "usage");
    }
    if (!value || value.startsWith("--")) {
      throw new ApiClientError(`Option '${option}' braucht einen Wert.\n${usage}`, "usage");
    }
    if (option === "--args-file") argsFile = value === "-" ? "-" : resolve(value);
    if (option === "--config") configPath = resolve(value);
    if (option === "--timeout-ms") {
      timeoutMs = Number(value);
      if (!Number.isInteger(timeoutMs)) {
        throw new ApiClientError("--timeout-ms muss eine ganze Zahl sein.", "usage");
      }
    }
    index += 1;
  }
  if (["discovery", "describe", "openapi"].includes(command) && argsFile) {
    throw new ApiClientError(`${command} akzeptiert keine Argumentdatei.`, "usage");
  }
  return {
    command,
    timeoutMs,
    ...(targetOperation ? { targetOperation } : {}),
    ...(argsFile ? { argsFile } : {}),
    ...(configPath ? { configPath } : {}),
  };
}

async function loadClientOptions(configPath?: string): Promise<ApiClientOptions> {
  if (!configPath && process.env.SSE_API_TOKEN) return {};
  const { environmentForExplicitApiConfig, loadApiServerConfig } = await import("./api-config.js");
  const env = configPath ? environmentForExplicitApiConfig(configPath) : { ...process.env };
  const config = loadApiServerConfig(env);
  const host = config.host === "::1" ? "[::1]" : config.host;
  return { baseUrl: `http://${host}:${config.port}`, token: config.token };
}

export async function readCliInputBounded(
  stream: AsyncIterable<unknown>,
  maxBytes = MAX_API_BODY_BYTES,
): Promise<Buffer> {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new ApiClientError("CLI-Eingabelimit muss eine positive ganze Zahl sein.", "bad-args");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
      throw new ApiClientError("CLI-stdin lieferte einen ungueltigen Datentyp.", "bad-args");
    }
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) {
      throw new ApiClientError(`CLI-stdin ist groesser als ${maxBytes} Bytes.`, "bad-args");
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

async function readOperationArgs(argsFile?: string): Promise<Record<string, unknown>> {
  if (!argsFile) return {};
  let parsed: unknown;
  try {
    parsed = argsFile === "-"
      ? parseJsonBytesStrict(await readCliInputBounded(process.stdin), "API-CLI-stdin")
      : readJsonFileStrict(argsFile, "API-CLI-Argumentdatei", MAX_API_BODY_BYTES);
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiClientError(message, "bad-args");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiClientError("API-CLI-Eingabe muss ein JSON-Objekt enthalten.", "bad-args");
  }
  return parsed as Record<string, unknown>;
}

export async function runApiCli(argv: readonly string[]): Promise<number> {
  if (argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(`${usage}\n`);
    return 0;
  }
  const cli = parseCliArguments(argv);
  const [options, client] = await Promise.all([
    loadClientOptions(cli.configPath),
    import("./api-client.js"),
  ]);
  let output: unknown;
  if (cli.command === "discovery") output = await client.readApiDiscovery(options);
  else if (cli.command === "describe") output = await client.readApiOperationDiscovery(cli.targetOperation!, options);
  else if (cli.command === "openapi") output = await client.readOpenApiDocument(options);
  else output = await client.callApiOperation(cli.command, await readOperationArgs(cli.argsFile), cli.timeoutMs, options);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return output && typeof output === "object" && "ok" in output && output.ok === false ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runApiCli(process.argv.slice(2)).then(
    (exitCode) => { process.exitCode = exitCode; },
    (error) => {
      const kind = error instanceof ApiClientError ? error.kind : "unexpected";
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`SSE-API-CLI (${kind}): ${message}\n`);
      process.exitCode = kind === "usage" || kind === "bad-args" ? 2 : 1;
    },
  );
}
