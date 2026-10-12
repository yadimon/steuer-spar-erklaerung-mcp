import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bindTableWorkerArguments, createTableWorkerCapability, tableWorkerEnvironment } from "../dist/worker-table-capability.js";

const a = createTableWorkerCapability(), b = createTableWorkerCapability();
assert.match(a, /^[a-f0-9]{64}$/u);
assert.match(b, /^[a-f0-9]{64}$/u);
assert.notEqual(a, b, "Distinct single-job workers need distinct capabilities.");
const base = { SSE_INTERNAL_TABLE_CAPABILITY: "caller-controlled", SSE_PROFILE_ID: "2025" };
const environment = tableWorkerEnvironment(a, base);
assert.equal(environment.SSE_INTERNAL_TABLE_CAPABILITY, a);
assert.equal(environment.SSE_PROFILE_ID, "2025");
assert.equal(base.SSE_INTERNAL_TABLE_CAPABILITY, "caller-controlled", "Do not mutate the API environment.");
const publicArgs = { hwnd: 42 };
assert.equal(bindTableWorkerArguments(publicArgs, a), publicArgs);
const cursor = { hwnd: 42, __tableCursorPlan: { phase: "prepare" } };
const bound = bindTableWorkerArguments(cursor, a);
assert.equal(bound.__tableTransportCapability, environment.SSE_INTERNAL_TABLE_CAPABILITY);
assert.equal(Object.hasOwn(cursor, "__tableTransportCapability"), false);
const mutation = { hwnd: 42, __tableMutationBinding: { row: 1 } };
assert.equal(bindTableWorkerArguments(mutation, b).__tableTransportCapability, b);
assert.throws(() => bindTableWorkerArguments({ __tableTransportCapability: a }, a), /Caller-supplied/u);
assert.throws(() => bindTableWorkerArguments(cursor, "caller-controlled"), /Invalid internal/u);
assert.throws(() => tableWorkerEnvironment("caller-controlled"), /Invalid internal/u);

const worker = readFileSync("src/worker.ts", "utf8"), warm = readFileSync("src/worker-prewarm.ts", "utf8");
assert(worker.indexOf("takeWarmSpare()") < worker.indexOf("createWorkerArgumentsFile(bindTableWorkerArguments"),
  "Bind the payload to the selected child, not an unrelated cold capability.");
assert.match(worker, /env: tableWorkerEnvironment\(transportCapability\)/u);
assert.match(warm, /env: tableWorkerEnvironment\(transportCapability\)/u);
assert.doesNotMatch(worker + warm, /process\.env\.SSE_INTERNAL_TABLE_CAPABILITY\s*=/u);
process.stdout.write("worker-table-capability: child authority, private payload, caller rejection, environment isolation passed\n");
