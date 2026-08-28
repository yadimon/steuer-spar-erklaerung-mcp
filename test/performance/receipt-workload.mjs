import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseApiOperationArgs } from "../../dist/operation-catalog.js";
import { createStatefulSseWorker, seedSyntheticCases } from "../mock/stateful-sse-worker.mjs";
import { summarizeDurations } from "./performance-statistics.mjs";

export const RECEIPT_WORKLOAD_SCHEMA_VERSION = 2;
export const RECEIPT_WORKLOAD_GENERATOR_VERSION = "receipt-workload-v2";
export const RECEIPT_WORKLOAD_POPULATIONS = Object.freeze([50, 250, 1_000]);
export const RECEIPT_WORKLOAD_BATCH_SIZE = 20;

const here = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = resolve(here, "..", "..");
const HASH_PATTERN = /^[A-F0-9]{64}$/u;
const VALID_UPSERT_SCENARIOS = new Set([
  "new-import",
  "existing-update",
  "existing-noop",
  "existing-skip",
  "missing-metadata",
  "duplicate-content",
]);
const SCENARIOS = Object.freeze([
  ["new-import", 36],
  ["existing-update", 18],
  ["existing-noop", 10],
  ["existing-skip", 8],
  ["already-linked-noop", 6],
  ["missing-metadata", 6],
  ["duplicate-content", 4],
  ["unsupported-foreign-currency", 6],
  ["invalid-input", 2],
  ["ambiguous-identity", 2],
  ["stale-source-hash", 2],
]);
const DOCUMENT_SIZES = Object.freeze([
  [8 * 1_024, 10],
  [64 * 1_024, 40],
  [512 * 1_024, 30],
  [2 * 1_024 * 1_024, 16],
  [8 * 1_024 * 1_024, 4],
]);
const FILENAME_SHAPES = Object.freeze(["ascii", "german", "spaces", "non-bmp", "long"]);

function rounded(value) {
  return Math.round(value * 1_000) / 1_000;
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function deterministicNumber(seed, label, index) {
  const digest = createHash("sha256").update(`${seed}\0${label}\0${index}`).digest();
  return digest.readUInt32BE(0);
}

function exactAssignments(count, definitions, seed, label) {
  const values = [];
  for (const [value, percent] of definitions) {
    const quota = count * percent / 100;
    if (!Number.isInteger(quota)) throw new Error(`${label} quota is not integral for count ${count}.`);
    values.push(...Array.from({ length: quota }, () => value));
  }
  if (values.length !== count) throw new Error(`${label} quotas do not sum to ${count}.`);
  return values
    .map((value, index) => ({ value, rank: sha256(`${seed}\0${label}\0${index}\0${value}`) }))
    .sort((left, right) => left.rank.localeCompare(right.rank))
    .map(({ value }) => value);
}

function pairDuplicateSizes(scenarios, sizes) {
  const duplicateIndexes = scenarios
    .map((scenario, index) => scenario === "duplicate-content" ? index : -1)
    .filter((index) => index >= 0);
  for (let pair = 0; pair < duplicateIndexes.length; pair += 2) {
    const first = duplicateIndexes[pair];
    const second = duplicateIndexes[pair + 1];
    if (second === undefined || sizes[first] === sizes[second]) continue;
    const donor = sizes.findIndex((size, index) => (
      size === sizes[first] && !duplicateIndexes.includes(index) && sizes[index] !== sizes[second]
    ));
    if (donor < 0) throw new Error("Could not preserve document-size quotas for duplicate content.");
    [sizes[second], sizes[donor]] = [sizes[donor], sizes[second]];
  }
}

function filenameFor(shape, index) {
  const serial = String(index + 1).padStart(4, "0");
  if (shape === "german") return `Beleg-fuer-Uebung-${serial}-äöüß.pdf`;
  if (shape === "spaces") return `Rechnung (synthetische Reise) ${serial}.pdf`;
  if (shape === "non-bmp") return `Beleg-🧾-${serial}.pdf`;
  if (shape === "long") return `Beleg-${"lang-".repeat(24)}${serial}.pdf`;
  return `receipt-${serial}.pdf`;
}

function amountFor(seed, index) {
  const cents = 100 + deterministicNumber(seed, "amount", index) % 9_999_900;
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function dateFor(seed, index) {
  const month = 1 + deterministicNumber(seed, "month", index) % 12;
  const day = 1 + deterministicNumber(seed, "day", index) % 28;
  return `2025-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function classificationFor(index) {
  if (index % 4 === 0) return { categories: ["Bürobedarf"] };
  if (index % 4 === 1) return { persons: ["Synthetische Person"] };
  if (index % 4 === 2) return { categories: ["Reisekosten", "Bewirtung"], persons: [] };
  return undefined;
}

function decrementAmount(value) {
  const [euros, cents] = value.split(".");
  const total = Number(euros) * 100 + Number(cents);
  const before = Math.max(0, total - 1);
  return `${Math.floor(before / 100)}.${String(before % 100).padStart(2, "0")}`;
}

function initialRow(item, suffix, { updateBefore = false } = {}) {
  const values = item.values;
  const classification = item.classification ?? {};
  const amountIsIdentity = Object.hasOwn(item.identity, "amount");
  return {
    rowRid: `42.5252.4.${suffix}`,
    title: values.title,
    draft: false,
    date: values.date,
    documentNumber: values.documentNumber,
    amount: updateBefore && !amountIsIdentity ? decrementAmount(values.amount) : values.amount.replace(".", ","),
    vatRate: values.vatRate,
    net: values.net,
    note: updateBefore ? "Vorheriger synthetischer Wert" : (values.note ?? ""),
    categories: updateBefore ? ["Vorher"] : [...(classification.categories ?? [])],
    persons: updateBefore ? [] : [...(classification.persons ?? [])],
  };
}

function countBy(values, key) {
  const counts = new Map();
  for (const value of values) {
    const name = String(value[key]);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

function equalJson(left, right) {
  return stableJson(left) === stableJson(right);
}

function isContainedPath(root, candidate) {
  const fromRoot = relative(root, candidate);
  return fromRoot !== "" && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}

function sortedStrings(values) {
  return [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

export function validateReceiptWorkloadPlan(plan, { allowTestDocumentSizes = false } = {}) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new Error("Receipt workload plan must be an object.");
  if (plan.schemaVersion !== RECEIPT_WORKLOAD_SCHEMA_VERSION ||
      plan.generatorVersion !== RECEIPT_WORKLOAD_GENERATOR_VERSION) {
    throw new Error("Unsupported receipt workload plan version.");
  }
  if (!RECEIPT_WORKLOAD_POPULATIONS.includes(plan.count) || plan.batchSize !== RECEIPT_WORKLOAD_BATCH_SIZE) {
    throw new Error("Receipt workload plan has an invalid population or batch size.");
  }
  if (typeof plan.seed !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/u.test(plan.seed)) {
    throw new Error("Receipt workload plan has an unsafe seed.");
  }
  if (!Array.isArray(plan.items) || plan.items.length !== plan.count) {
    throw new Error("Receipt workload item count does not match the population.");
  }
  const scenarioCounts = countBy(plan.items, "scenario");
  const expectedScenarios = Object.fromEntries(SCENARIOS.map(([scenario, percent]) => [scenario, plan.count * percent / 100]));
  if (!equalJson(scenarioCounts, expectedScenarios) || !equalJson(plan.scenarioCounts, scenarioCounts)) {
    throw new Error("Receipt workload scenario quotas are invalid.");
  }
  const sizeCounts = countBy(plan.items, "bytes");
  const expectedSizes = Object.fromEntries(DOCUMENT_SIZES.map(([bytes, percent]) => [String(bytes), plan.count * percent / 100]));
  if ((!allowTestDocumentSizes && !equalJson(sizeCounts, expectedSizes)) || !equalJson(plan.documentSizeCounts, sizeCounts)) {
    throw new Error("Receipt workload document-size quotas are invalid.");
  }
  if (allowTestDocumentSizes && plan.testOnlyCompact !== true) {
    throw new Error("Noncanonical document sizes require an explicit test-only compact plan.");
  }
  const logicalIds = new Set();
  const relativePaths = new Set();
  let totalBytes = 0;
  for (let index = 0; index < plan.items.length; index += 1) {
    const item = plan.items[index];
    if (item.index !== index || item.logicalId !== `receipt-${String(index + 1).padStart(6, "0")}`) {
      throw new Error("Receipt workload item order or logical ID is invalid.");
    }
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > 8 * 1_024 * 1_024) {
      throw new Error("Receipt workload item bytes are invalid.");
    }
    if (typeof item.relativePath !== "string" || !/^documents\/[^/\\:]{1,220}$/u.test(item.relativePath) ||
        item.relativePath.includes("..")) {
      throw new Error("Receipt workload contains an unsafe relative path.");
    }
    const foldedPath = item.relativePath.toLocaleLowerCase("en-US");
    if (logicalIds.has(item.logicalId) || relativePaths.has(foldedPath)) {
      throw new Error("Receipt workload contains duplicate IDs or case-insensitive paths.");
    }
    logicalIds.add(item.logicalId);
    relativePaths.add(foldedPath);
    totalBytes += item.bytes;
  }
  if (plan.totalDocumentBytes !== totalBytes || !equalJson(plan.filenameShapeCounts, countBy(plan.items, "filenameShape"))) {
    throw new Error("Receipt workload aggregate counts are invalid.");
  }
  const { planFingerprint, ...withoutFingerprint } = plan;
  if (!HASH_PATTERN.test(planFingerprint) || sha256(stableJson(withoutFingerprint)) !== planFingerprint) {
    throw new Error("Receipt workload plan fingerprint is invalid.");
  }
  return plan;
}

export function createReceiptWorkloadPlan({ count, seed }) {
  if (!RECEIPT_WORKLOAD_POPULATIONS.includes(count)) {
    throw new Error(`count must be one of ${RECEIPT_WORKLOAD_POPULATIONS.join(", ")}.`);
  }
  if (typeof seed !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/u.test(seed)) {
    throw new Error("seed must be a lowercase path-free token with 3-64 characters.");
  }
  const scenarios = exactAssignments(count, SCENARIOS, seed, "scenario");
  const sizes = exactAssignments(count, DOCUMENT_SIZES, seed, "document-size");
  pairDuplicateSizes(scenarios, sizes);
  let duplicateOrdinal = 0;
  const items = scenarios.map((scenario, index) => {
    const logicalId = `receipt-${String(index + 1).padStart(6, "0")}`;
    const shape = FILENAME_SHAPES[deterministicNumber(seed, "filename-shape", index) % FILENAME_SHAPES.length];
    const date = dateFor(seed, index);
    const amount = amountFor(seed, index);
    const title = scenario === "ambiguous-identity"
      ? `Mehrdeutiger synthetischer Beleg ${String(index + 1).padStart(4, "0")}`
      : `Synthetischer Beleg ${String(index + 1).padStart(4, "0")}`;
    const documentNumber = `SYN-${String(index + 1).padStart(6, "0")}`;
    const classification = classificationFor(index);
    const values = {
      title,
      date,
      documentNumber,
      amount,
      vatRate: ["0", "7", "19"][deterministicNumber(seed, "vat", index) % 3],
      net: deterministicNumber(seed, "net", index) % 2 === 0,
      ...(scenario === "missing-metadata" ? {} : { note: `Nur synthetische Testdaten ${index + 1}` }),
    };
    const identity = index % 2 === 0
      ? { exactTitle: title, documentNumber }
      : { exactTitle: title, date, amount };
    const contentKey = scenario === "duplicate-content"
      ? `duplicate-${Math.floor(duplicateOrdinal++ / 2)}`
      : logicalId;
    return {
      index,
      logicalId,
      scenario,
      relativePath: `documents/${filenameFor(shape, index)}`,
      filenameShape: shape,
      bytes: sizes[index],
      contentKey,
      currency: scenario === "unsupported-foreign-currency" ? "USD" : "EUR",
      identity,
      onExisting: scenario === "existing-skip" ? "skip" : "update",
      values: scenario === "invalid-input" ? { ...values, amount: "12.345" } : values,
      ...(classification ? { classification } : {}),
      expectedDisposition: VALID_UPSERT_SCENARIOS.has(scenario)
        ? scenario === "existing-skip" ? "skipped" : scenario.startsWith("existing-") ? "updated" : "imported"
        : scenario === "already-linked-noop" ? "link-noop"
          : scenario === "unsupported-foreign-currency" ? "unsupported-currency-schema-rejected"
            : scenario === "invalid-input" ? "bad-args"
              : scenario === "ambiguous-identity" ? "ambiguous"
                : "stale",
    };
  });
  const initialRows = [];
  const initialReceiptLinks = [];
  for (const item of items) {
    const suffix = 100_000 + item.index * 3;
    if (["existing-update", "existing-noop", "existing-skip", "already-linked-noop"].includes(item.scenario)) {
      initialRows.push(initialRow(item, suffix, {
        updateBefore: item.scenario === "existing-update" || item.scenario === "existing-skip",
      }));
    }
    if (item.scenario === "already-linked-noop") {
      initialReceiptLinks.push({ rowRid: `42.5252.4.${suffix}`, linked: true });
    }
    if (item.scenario === "ambiguous-identity") {
      initialRows.push(initialRow(item, suffix));
      initialRows.push(initialRow(item, suffix + 1));
    }
  }
  const planWithoutFingerprint = {
    schemaVersion: RECEIPT_WORKLOAD_SCHEMA_VERSION,
    generatorVersion: RECEIPT_WORKLOAD_GENERATOR_VERSION,
    seed,
    count,
    batchSize: RECEIPT_WORKLOAD_BATCH_SIZE,
    totalDocumentBytes: items.reduce((total, item) => total + item.bytes, 0),
    scenarioCounts: countBy(items, "scenario"),
    documentSizeCounts: countBy(items, "bytes"),
    filenameShapeCounts: countBy(items, "filenameShape"),
    items,
    initialRows,
    initialReceiptLinks,
  };
  return { ...planWithoutFingerprint, planFingerprint: sha256(stableJson(planWithoutFingerprint)) };
}

function claimExternalNewDirectory(path, label) {
  const absolute = resolve(path);
  const parent = dirname(absolute);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    throw new Error(`${label} parent must already exist.`);
  }
  const realRepository = realpathSync(REPOSITORY_ROOT);
  const realParent = realpathSync(parent);
  const projected = resolve(realParent, basename(absolute));
  if (projected.toLocaleLowerCase("en-US") === realRepository.toLocaleLowerCase("en-US") ||
      isContainedPath(realRepository, projected)) {
    throw new Error(`${label} must stay outside the repository.`);
  }
  try {
    mkdirSync(absolute);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`${label} already exists.`, { cause: error });
    throw error;
  }
  const realRoot = realpathSync(absolute);
  if (realRoot.toLocaleLowerCase("en-US") !== projected.toLocaleLowerCase("en-US") ||
      realRoot.toLocaleLowerCase("en-US") === realRepository.toLocaleLowerCase("en-US") ||
      isContainedPath(realRepository, realRoot)) {
    throw new Error(`${label} resolved to an unsafe location after creation.`);
  }
  return realRoot;
}

function pdfSections(streamLength, seed, contentKey) {
  const header = Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "binary");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${streamLength} >>\nstream\n`,
  ].map((value) => Buffer.from(value, "ascii"));
  const offsets = [];
  let cursor = header.length;
  for (const object of objects) {
    offsets.push(cursor);
    cursor += object.length;
  }
  const streamComment = Buffer.from(`% deterministic synthetic receipt ${sha256(`${seed}\0${contentKey}`)}\n`, "ascii");
  if (streamComment.length > streamLength) throw new Error("document stream is too small for its identity comment.");
  cursor += streamLength;
  const afterStream = Buffer.from("\nendstream\nendobj\n", "ascii");
  cursor += afterStream.length;
  const xrefOffset = cursor;
  const xref = Buffer.from([
    "xref",
    "0 5",
    "0000000000 65535 f ",
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    "<< /Size 5 /Root 1 0 R >>",
    "startxref",
    String(xrefOffset),
    "%%EOF",
    "",
  ].join("\n"), "ascii");
  return { prefix: Buffer.concat([header, ...objects]), streamComment, afterStream, xref };
}

function exactPdfLayout(bytes, seed, contentKey) {
  let streamLength = bytes - 512;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const sections = pdfSections(streamLength, seed, contentKey);
    const fixedBytes = sections.prefix.length + sections.afterStream.length + sections.xref.length;
    const nextStreamLength = bytes - fixedBytes;
    if (nextStreamLength === streamLength) return { ...sections, streamLength };
    streamLength = nextStreamLength;
  }
  throw new Error(`Could not construct an exact ${bytes}-byte PDF.`);
}

export function writeDeterministicDocument(path, { bytes, seed, contentKey }) {
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error("document bytes must be positive.");
  const layout = exactPdfLayout(bytes, seed, contentKey);
  const filler = Buffer.alloc(64 * 1_024, 0x20);
  const hash = createHash("sha256");
  const handle = openSync(path, "wx");
  try {
    writeSync(handle, layout.prefix);
    hash.update(layout.prefix);
    writeSync(handle, layout.streamComment);
    hash.update(layout.streamComment);
    let remaining = layout.streamLength - layout.streamComment.length;
    while (remaining > 0) {
      const length = Math.min(remaining, filler.length);
      const chunk = length === filler.length ? filler : filler.subarray(0, length);
      writeSync(handle, chunk);
      hash.update(chunk);
      remaining -= length;
    }
    writeSync(handle, layout.afterStream);
    hash.update(layout.afterStream);
    writeSync(handle, layout.xref);
    hash.update(layout.xref);
  } finally {
    closeSync(handle);
  }
  return hash.digest("hex").toUpperCase();
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

export function materializeReceiptWorkload(plan, fixtureRoot, { allowTestDocumentSizes = false } = {}) {
  validateReceiptWorkloadPlan(plan, { allowTestDocumentSizes });
  const root = claimExternalNewDirectory(fixtureRoot, "fixture root");
  mkdirSync(join(root, "documents"));
  const items = plan.items.map((item) => {
    const path = join(root, ...item.relativePath.split("/"));
    const actualSha256 = writeDeterministicDocument(path, {
      bytes: item.bytes,
      seed: plan.seed,
      contentKey: item.contentKey,
    });
    const expectedHash = item.scenario === "stale-source-hash"
      ? `${actualSha256[0] === "A" ? "B" : "A"}${actualSha256.slice(1)}`
      : actualSha256;
    return { ...item, actualSha256, expectedHash };
  });
  const expectedStateDigest = sha256(stableJson(expectedReceiptSnapshot(plan)));
  const manifestWithoutFingerprint = {
    ...plan,
    items,
    fixtureRootPolicy: "external-relative-paths-only",
    expectedStateDigest,
  };
  const manifest = {
    ...manifestWithoutFingerprint,
    manifestFingerprint: sha256(stableJson(manifestWithoutFingerprint)),
  };
  writeJson(join(root, "fixture-manifest.json"), manifest);
  return { root, manifest };
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function publicBulkItem(item) {
  return {
    resourceRef: `documents:${item.relativePath.slice("documents/".length)}`,
    expectedHash: item.expectedHash,
    identity: item.identity,
    onExisting: item.onExisting,
    values: item.values,
    ...(item.classification ? { classification: item.classification } : {}),
  };
}

function internalBulkArgs(publicArgs, logicalItems, documentPaths) {
  return {
    ...publicArgs,
    items: publicArgs.items.map((item, index) => ({
      ...item,
      expectedPath: documentPaths.get(logicalItems[index].logicalId),
    })),
  };
}

function canonicalReceiptSnapshot(snapshot) {
  return {
    open: snapshot.open,
    state: snapshot.state,
    nextReceiptId: snapshot.nextReceiptId,
    rows: snapshot.rows.map((row) => ({
      rowRid: row.rowRid,
      title: row.title,
      draft: row.draft,
      date: row.date,
      documentNumber: row.documentNumber,
      amount: row.amount,
      vatRate: row.vatRate,
      net: row.net,
      note: row.note,
      categories: sortedStrings(row.categories ?? []),
      persons: sortedStrings(row.persons ?? []),
      linked: row.linked === true,
    })),
  };
}

function expectedReceiptSnapshot(manifest) {
  const rows = structuredClone(manifest.initialRows);
  const links = new Map(manifest.initialReceiptLinks.map((entry) => [entry.rowRid, entry.linked === true]));
  let nextReceiptId = rows.reduce((maximum, row) => {
    const suffix = /(?:^|\.)(\d+)$/u.exec(String(row.rowRid))?.[1];
    return suffix === undefined ? maximum : Math.max(maximum, Number(suffix) + 1);
  }, 1);
  const normalizeAmount = (value) => String(value ?? "").replace(",", ".");
  const matchesIdentity = (row, identity) => row.title === identity.exactTitle && (
    identity.documentNumber !== undefined
      ? row.documentNumber === identity.documentNumber
      : row.date === identity.date && normalizeAmount(row.amount) === normalizeAmount(identity.amount)
  );
  for (const item of manifest.items.filter((entry) => VALID_UPSERT_SCENARIOS.has(entry.scenario))) {
    const matches = rows.filter((row) => matchesIdentity(row, item.identity));
    if (matches.length > 1) throw new Error(`Expected-state oracle found ambiguous valid item ${item.logicalId}.`);
    if (matches.length === 1 && item.onExisting === "skip") continue;
    const row = matches[0] ?? {
      rowRid: `42.5252.4.${nextReceiptId++}`,
      title: "Neuer Beleg*",
      draft: true,
      date: "",
      documentNumber: "",
      amount: "0,00",
      vatRate: "19",
      net: false,
      note: "",
      categories: [],
      persons: [],
    };
    if (matches.length === 0) rows.push(row);
    for (const [name, raw] of Object.entries(item.values)) {
      row[name] = name === "amount" ? String(raw).replace(".", ",") : raw;
    }
    for (const name of ["categories", "persons"]) {
      if (item.classification?.[name] !== undefined) row[name] = structuredClone(item.classification[name]);
    }
    if (Object.hasOwn(item.values, "title")) row.draft = false;
  }
  return canonicalReceiptSnapshot({
    open: true,
    state: "list",
    nextReceiptId,
    rows: rows.map((row) => ({ ...row, linked: links.get(row.rowRid) === true })),
  });
}

function resolveContainedReceiptPath(realFixtureRoot, item) {
  const lexicalPath = resolve(realFixtureRoot, ...item.relativePath.split("/"));
  if (!isContainedPath(realFixtureRoot, lexicalPath)) {
    throw new Error(`Receipt workload source escapes the fixture root: ${item.logicalId}.`);
  }
  const realPath = realpathSync(lexicalPath);
  if (!isContainedPath(realFixtureRoot, realPath) || !statSync(realPath).isFile()) {
    throw new Error(`Receipt workload source is not a contained regular file: ${item.logicalId}.`);
  }
  return realPath;
}

export function validateMaterializedReceiptWorkloadManifest(manifest, fixtureRoot) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Receipt workload manifest must be an object.");
  }
  const planView = {
    ...manifest,
    items: Array.isArray(manifest.items)
      ? manifest.items.map(({ actualSha256, expectedHash, ...item }) => item)
      : manifest.items,
  };
  delete planView.fixtureRootPolicy;
  delete planView.expectedStateDigest;
  delete planView.manifestFingerprint;
  validateReceiptWorkloadPlan(planView, { allowTestDocumentSizes: planView.testOnlyCompact === true });
  if (manifest.fixtureRootPolicy !== "external-relative-paths-only") {
    throw new Error("Receipt workload fixture-root policy is invalid.");
  }
  if (!Array.isArray(manifest.items) || !manifest.items.every((item) => (
    HASH_PATTERN.test(item.actualSha256) && HASH_PATTERN.test(item.expectedHash)
  ))) {
    throw new Error("Receipt workload must be materialized before equivalence execution.");
  }
  for (const item of manifest.items) {
    const expectedStale = item.scenario === "stale-source-hash";
    if ((item.expectedHash !== item.actualSha256) !== expectedStale) {
      throw new Error(`Receipt workload source binding is inconsistent: ${item.logicalId}.`);
    }
  }
  const expectedStateDigest = sha256(stableJson(expectedReceiptSnapshot(manifest)));
  if (!HASH_PATTERN.test(manifest.expectedStateDigest) || manifest.expectedStateDigest !== expectedStateDigest) {
    throw new Error("Receipt workload expected-state digest is invalid.");
  }
  const { manifestFingerprint, ...withoutManifestFingerprint } = manifest;
  if (!HASH_PATTERN.test(manifestFingerprint) || sha256(stableJson(withoutManifestFingerprint)) !== manifestFingerprint) {
    throw new Error("Receipt workload manifest fingerprint is invalid.");
  }
  const realFixtureRoot = realpathSync(resolve(fixtureRoot));
  const documentPaths = new Map();
  for (const item of manifest.items) {
    const path = resolveContainedReceiptPath(realFixtureRoot, item);
    if (statSync(path).size !== item.bytes || sha256(readFileSync(path)) !== item.actualSha256) {
      throw new Error(`Receipt workload source does not match its manifest: ${item.logicalId}.`);
    }
    documentPaths.set(item.logicalId, path);
  }
  return { documentPaths, expectedStateDigest, sourceHashCheckCount: manifest.items.length };
}

export function cleanupMaterializedReceiptWorkload(materialized) {
  if (!materialized || typeof materialized !== "object") {
    throw new Error("Materialized receipt workload ownership proof is missing.");
  }
  const validation = validateMaterializedReceiptWorkloadManifest(materialized.manifest, materialized.root);
  const manifestPath = join(realpathSync(materialized.root), "fixture-manifest.json");
  if (!statSync(manifestPath).isFile() ||
      stableJson(JSON.parse(readFileSync(manifestPath, "utf8"))) !== stableJson(materialized.manifest)) {
    throw new Error("Materialized receipt workload manifest changed before cleanup.");
  }
  for (const item of materialized.manifest.items) unlinkSync(validation.documentPaths.get(item.logicalId));
  unlinkSync(manifestPath);
  rmdirSync(join(materialized.root, "documents"));
  rmdirSync(materialized.root);
  return { removed: true, sourceHashCheckCount: validation.sourceHashCheckCount };
}

async function runVariant({ manifest, documentPaths, scratchRoot, mode }) {
  const chunkSize = mode === "individual" ? 1 : RECEIPT_WORKLOAD_BATCH_SIZE;
  const caseDir = join(scratchRoot, mode, "cases");
  mkdirSync(caseDir, { recursive: true });
  const seeded = seedSyntheticCases(caseDir);
  const { worker, model } = createStatefulSseWorker({
    caseDir,
    initialReceiptManagerState: "list",
    initialReceiptRows: manifest.initialRows,
    initialReceiptLinks: manifest.initialReceiptLinks,
  });
  const launch = await worker("launch", { file: seeded.freelancerPath, mode: "einur" });
  if (launch.ok !== true) throw new Error(`${mode} synthetic launch failed.`);

  const callRecords = [];
  const dispositions = new Map();
  const runStartedAt = performance.now();
  const call = async (operation, args, logicalItems, expected) => {
    const startedAt = performance.now();
    const result = await worker(operation, args);
    const elapsedMs = rounded(performance.now() - startedAt);
    callRecords.push({
      schemaVersion: RECEIPT_WORKLOAD_SCHEMA_VERSION,
      type: "direct-worker-call",
      benchmark: "synthetic-receipt-equivalence",
      phase: "measurement",
      population: manifest.count,
      seedFingerprint: sha256(manifest.seed),
      mode,
      sequence: callRecords.length + 1,
      operation,
      logicalItemCount: logicalItems.length,
      batchSize: logicalItems.length,
      ok: result.ok === true,
      outcome: result.ok === true ? "ok" : result.kind ?? "unknown",
      ...(result.kind ? { kind: result.kind } : {}),
      ...(typeof result.verified === "boolean" ? { verified: result.verified } : {}),
      ...(typeof result.resultingState === "string" ? { resultingState: result.resultingState } : {}),
      elapsedMs,
    });
    if (expected === "ok" && result.ok !== true) {
      throw new Error(`${mode} ${operation} failed: ${result.kind ?? "unknown"}.`);
    }
    return result;
  };

  const validUpserts = manifest.items.filter((item) => VALID_UPSERT_SCENARIOS.has(item.scenario));
  for (const group of chunks(validUpserts, chunkSize)) {
    const publicArgs = parseApiOperationArgs("receipt_manager_bulk_upsert", {
      items: group.map(publicBulkItem),
      acknowledgeBulkUpsert: true,
      stopOnError: true,
    });
    const result = await call(
      "receipt_manager_bulk_upsert",
      internalBulkArgs(publicArgs, group, documentPaths),
      group,
      "ok",
    );
    for (const completed of result.completed) {
      const item = group[completed.index];
      if (completed.sourceHashStable !== true || completed.verified !== true) {
        throw new Error(`${mode} did not verify source and readback for ${item.logicalId}.`);
      }
      dispositions.set(item.logicalId, completed.action);
    }
  }

  const linkItems = manifest.items.filter((item) => item.scenario === "already-linked-noop");
  for (const group of chunks(linkItems, chunkSize)) {
    const args = parseApiOperationArgs("receipt_manager_link", {
      items: group.map((item) => ({
        expectedReceiptTitle: item.values.title,
        expectedDocumentNumber: item.values.documentNumber,
        linked: true,
      })),
      expectedTargetPage: "Einnahmen/Ausgaben",
      expectedLinkTarget: "Synthetisches Ziel",
      acknowledgeLinkChange: true,
    });
    const result = await call("receipt_manager_link", args, group, "ok");
    for (let index = 0; index < group.length; index += 1) {
      if (result.items[index].changed !== false || result.items[index].linkedAfter !== true) {
        throw new Error(`${mode} linked no-op changed state for ${group[index].logicalId}.`);
      }
      dispositions.set(group[index].logicalId, "link-noop");
    }
  }

  const snapshotDigest = () => sha256(stableJson(canonicalReceiptSnapshot(model.receiptSnapshot())));
  const assertSchemaRejectedWithoutMutation = (item, rawItem, disposition) => {
    const before = snapshotDigest();
    let rejected = false;
    try {
      parseApiOperationArgs("receipt_manager_bulk_upsert", {
        items: [rawItem], acknowledgeBulkUpsert: true, stopOnError: true,
      });
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`${mode} ${item.scenario} passed the production schema.`);
    if (snapshotDigest() !== before) throw new Error(`${mode} schema rejection mutated synthetic state.`);
    dispositions.set(item.logicalId, disposition);
  };
  const invalidItems = manifest.items.filter((entry) => entry.scenario === "invalid-input");
  for (const item of invalidItems) {
    assertSchemaRejectedWithoutMutation(item, publicBulkItem(item), "bad-args");
  }
  const foreignCurrencyItems = manifest.items.filter((entry) => entry.scenario === "unsupported-foreign-currency");
  for (const item of foreignCurrencyItems) {
    if (item.currency === "EUR") throw new Error(`${mode} foreign-currency control is not foreign.`);
    parseApiOperationArgs("receipt_manager_bulk_upsert", {
      items: [publicBulkItem(item)], acknowledgeBulkUpsert: true, stopOnError: true,
    });
    assertSchemaRejectedWithoutMutation(
      item,
      { ...publicBulkItem(item), currency: item.currency },
      "unsupported-currency-schema-rejected",
    );
  }
  const workerFailureItems = manifest.items.filter((entry) => (
    entry.scenario === "stale-source-hash" || entry.scenario === "ambiguous-identity"
  ));
  for (const scenario of ["stale-source-hash", "ambiguous-identity"]) {
    for (const item of manifest.items.filter((entry) => entry.scenario === scenario)) {
      const before = snapshotDigest();
      const publicArgs = parseApiOperationArgs("receipt_manager_bulk_upsert", {
        items: [publicBulkItem(item)], acknowledgeBulkUpsert: true, stopOnError: true,
      });
      const result = await call(
        "receipt_manager_bulk_upsert",
        internalBulkArgs(publicArgs, [item], documentPaths),
        [item],
        "failure",
      );
      const expectedKind = scenario === "stale-source-hash" ? "stale" : "ambiguous";
      if (result.ok !== false || result.kind !== expectedKind || result.cleanupRequired !== false) {
        throw new Error(`${mode} ${scenario} did not fail closed as ${expectedKind}.`);
      }
      if (snapshotDigest() !== before) throw new Error(`${mode} ${scenario} mutated synthetic state.`);
      dispositions.set(item.logicalId, expectedKind);
    }
  }

  const list = await call("receipt_manager_list", {}, [], "ok");
  const staleRead = await call("receipt_manager_read", {
    rowRid: list.rows[0].rowRid,
    rowFingerprint: "F".repeat(64),
    expectedListFingerprint: list.listFingerprint,
  }, [], "failure");
  if (staleRead.ok !== false || staleRead.kind !== "stale") {
    throw new Error(`${mode} stale-fingerprint read did not fail closed.`);
  }

  const dispositionVector = manifest.items.map((item) => {
    const disposition = dispositions.get(item.logicalId);
    if (disposition !== item.expectedDisposition) {
      throw new Error(`${mode} disposition mismatch for ${item.logicalId}: ${disposition ?? "missing"}.`);
    }
    return { logicalId: item.logicalId, scenario: item.scenario, disposition };
  });
  const snapshot = canonicalReceiptSnapshot(model.receiptSnapshot());
  const elapsedMs = rounded(performance.now() - runStartedAt);
  const durations = callRecords.map((record) => record.elapsedMs);
  const operationCounts = Object.fromEntries([...new Set(callRecords.map((record) => record.operation))]
    .sort()
    .map((operation) => [operation, callRecords.filter((record) => record.operation === operation).length]));
  const dispositionCounts = countBy(dispositionVector, "disposition");
  const kindCounts = Object.fromEntries([...new Set(callRecords.filter((record) => record.kind).map((record) => record.kind))]
    .sort()
    .map((kind) => [kind, callRecords.filter((record) => record.kind === kind).length]));
  const workerExecutedLogicalItemCount = validUpserts.length + linkItems.length + workerFailureItems.length;
  const schemaRejectedLogicalItemCount = invalidItems.length + foreignCurrencyItems.length;
  if (workerExecutedLogicalItemCount + schemaRejectedLogicalItemCount !== manifest.count) {
    throw new Error(`${mode} workload accounting does not cover every logical item.`);
  }
  return {
    mode,
    workloadLogicalItemCount: manifest.count,
    workerExecutedLogicalItemCount,
    schemaRejectedLogicalItemCount,
    directWorkerCallCount: callRecords.length,
    operationCounts,
    dispositionCounts,
    callOutcomes: {
      ok: callRecords.filter((record) => record.ok).length,
      nonOk: callRecords.filter((record) => !record.ok).length,
      kinds: kindCounts,
    },
    elapsedMs,
    workloadLogicalItemsPerSecond: rounded(manifest.count / (elapsedMs / 1_000)),
    workerExecutedItemsPerSecond: rounded(workerExecutedLogicalItemCount / (elapsedMs / 1_000)),
    millisecondsPerWorkloadLogicalItem: rounded(elapsedMs / manifest.count),
    millisecondsPerWorkerExecutedItem: rounded(elapsedMs / workerExecutedLogicalItemCount),
    callDurationMs: summarizeDurations(durations),
    stateDigest: sha256(stableJson(snapshot)),
    dispositionDigest: sha256(stableJson(dispositionVector)),
    snapshot,
    dispositionVector,
    callRecords,
  };
}

export async function runReceiptWorkloadEquivalence({ manifest, fixtureRoot, scratchRoot }) {
  const validation = validateMaterializedReceiptWorkloadManifest(manifest, fixtureRoot);
  const individual = await runVariant({
    manifest,
    documentPaths: validation.documentPaths,
    scratchRoot,
    mode: "individual",
  });
  const batch = await runVariant({
    manifest,
    documentPaths: validation.documentPaths,
    scratchRoot,
    mode: "batch-20",
  });
  const expectedStateDigest = validation.expectedStateDigest;
  if (individual.stateDigest !== expectedStateDigest || batch.stateDigest !== expectedStateDigest) {
    throw new Error("Individual or batch state differs from the independent expected-state oracle.");
  }
  if (individual.stateDigest !== batch.stateDigest) throw new Error("Individual and batch final-state digests differ.");
  if (individual.dispositionDigest !== batch.dispositionDigest) {
    throw new Error("Individual and batch disposition vectors differ.");
  }
  let postflightSourceHashCheckCount = 0;
  for (const item of manifest.items) {
    const path = validation.documentPaths.get(item.logicalId);
    if (sha256(readFileSync(path)) !== item.actualSha256) {
      throw new Error(`Synthetic source changed during workload: ${item.logicalId}.`);
    }
    postflightSourceHashCheckCount += 1;
  }
  return {
    schemaVersion: RECEIPT_WORKLOAD_SCHEMA_VERSION,
    benchmark: "synthetic-receipt-equivalence",
    generatorVersion: manifest.generatorVersion,
    manifestFingerprint: manifest.manifestFingerprint,
    count: manifest.count,
    batchSize: RECEIPT_WORKLOAD_BATCH_SIZE,
    semanticClaim: "product-free-direct-stateful-test-worker-model-values-classifications-links-and-source-bindings",
    installedProductMutationClaim: false,
    timingClaim: "descriptive-single-order-mock-timing-not-causal-installed-product-speed-evidence",
    equivalent: true,
    expectedStateDigest,
    stateDigest: individual.stateDigest,
    dispositionDigest: individual.dispositionDigest,
    sourceHashChecks: {
      preflight: validation.sourceHashCheckCount,
      postflight: postflightSourceHashCheckCount,
      total: validation.sourceHashCheckCount + postflightSourceHashCheckCount,
    },
    individual,
    batch,
    amortization: {
      directWorkerCallReduction: individual.directWorkerCallCount - batch.directWorkerCallCount,
      directWorkerCallRatio: rounded(batch.directWorkerCallCount / individual.directWorkerCallCount),
      descriptiveMillisecondsPerWorkloadItemRatio: rounded(
        batch.millisecondsPerWorkloadLogicalItem / individual.millisecondsPerWorkloadLogicalItem,
      ),
    },
  };
}

export function readReceiptWorkloadManifest(fixtureRoot) {
  const path = join(resolve(fixtureRoot), "fixture-manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  validateMaterializedReceiptWorkloadManifest(manifest, fixtureRoot);
  return manifest;
}
