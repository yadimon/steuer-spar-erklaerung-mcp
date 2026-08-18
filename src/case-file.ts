import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { abortable, abortError } from "./abortable.js";
import { DEFAULT_OPERATION_TIMEOUT_MS, type WorkerResult } from "./api-contract.js";
import { sameFileState } from "./file-identity.js";
import type { ProductProfile } from "./product-profiles.js";

export const AKAD_MAX_HEADER_BYTES = 512 * 1024;
const HEADER_KEYS = [
  "FileType",
  "VJahr",
  "Steuernummer",
  "FileSavedBy",
  "ElsterTransferTime",
  "MitElsterVersendetText",
] as const;
const AKAD_TYPE_NAMES: Readonly<Record<number, string>> = {
  4: "text",
  5: "datum",
  6: "zahl",
  12: "blob",
};

type HeaderKey = (typeof HEADER_KEYS)[number];
type CaseHeader = Record<HeaderKey, string | number | null>;
type TransmissionState = boolean | "unknown";

export interface AkadCaseSummary {
  header: CaseHeader;
  transmitted: TransmissionState;
  transmittedReason: string;
}

export interface CaseFileInfo extends WorkerResult, AkadCaseSummary {
  ok: true;
  path: string;
  exists: true;
  size: number;
  mtimeUtc: string;
  sha256: string;
}

export interface ListedCaseFile {
  name: string;
  path: string;
  kb: number;
  modified: string;
  module: string;
  fileType: string | number;
  year: string | number;
  steuernummer: string | number;
  savedBy: string | number;
  elsterTransferTime: string;
  transmitted: TransmissionState;
  transmittedReason: string;
  encryptedBytes: number;
  meta: null;
}

export interface ListedCaseFiles extends WorkerResult {
  ok: true;
  dir: string;
  count: number;
  cases: ListedCaseFile[];
  parserError?: null;
}

class CaseFileError extends Error {
  override readonly name = "CaseFileError";

  constructor(message: string, readonly kind: string) {
    super(message);
  }
}

export class CaseFileParserFallbackError extends Error {
  override readonly name = "CaseFileParserFallbackError";
}

function emptyHeader(): CaseHeader {
  return Object.fromEntries(HEADER_KEYS.map((key) => [key, null])) as CaseHeader;
}

function unknownSummary(reason = "Uebermittlungsstatus nicht sicher lesbar"): AkadCaseSummary {
  return { header: emptyHeader(), transmitted: "unknown", transmittedReason: reason };
}

function trimmed(data: Buffer): Buffer {
  let end = data.length;
  while (end > 0 && data[end - 1] === 0) end -= 1;
  return data.subarray(0, end);
}

function plausibleRecord(data: Buffer, offset: number): boolean {
  if (offset < 0 || offset + 9 > data.length) return false;
  const nameLength = data.readUInt32LE(offset);
  if (nameLength < 2 || nameLength > 200 || offset + 4 + nameLength + 5 > data.length) return false;
  const nameStart = offset + 4;
  if (data[nameStart + nameLength - 1] !== 0) return false;
  for (let index = nameStart; index < nameStart + nameLength - 1; index += 1) {
    const value = data[index];
    if (value === undefined || value < 33 || value >= 127) return false;
  }
  return true;
}

function decodeText(data: Buffer): string {
  const value = trimmed(data);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    return value.toString("latin1");
  }
}

interface RecordVariant {
  raw: Buffer;
  next: number;
}

interface AkadMetaEntry {
  type: number;
  value: string | number;
}

interface ParsedAkadMeta {
  meta: Map<string, AkadMetaEntry>;
  encryptedBytes: number;
}

function variant(data: Buffer, offset: number, length: number): RecordVariant | undefined {
  if (length < 0 || offset < 0 || offset + length > data.length) return undefined;
  return { raw: data.subarray(offset, offset + length), next: offset + length };
}

function parseAkadMeta(data: Buffer): ParsedAkadMeta | undefined {
  if (data.length < 64 || data.toString("ascii", 0, 4) !== "AKAD") return undefined;
  const uuidLength = data.readUInt32LE(12);
  if (uuidLength < 8 || uuidLength > 256 || 16 + uuidLength + 8 > data.length) return undefined;
  let offset = 16 + uuidLength;
  if (data.toString("ascii", offset, offset + 4) !== "FIIF") return undefined;

  let start = -1;
  for (let candidate = offset + 4; candidate < Math.min(offset + 24, data.length); candidate += 1) {
    if (plausibleRecord(data, candidate)) {
      start = candidate;
      break;
    }
  }
  if (start < 0) return undefined;

  const meta = new Map<string, AkadMetaEntry>();
  let encryptedBytes = 0;
  offset = start;
  for (let recordIndex = 0; recordIndex < 400; recordIndex += 1) {
    if (offset + 4 > data.length) break;
    const nameLength = data.readUInt32LE(offset);
    if (nameLength < 1 || nameLength > 500 || offset + 4 + nameLength > data.length) break;
    const name = trimmed(data.subarray(offset + 4, offset + 4 + nameLength)).toString("latin1");
    const valueHeaderOffset = offset + 4 + nameLength;
    if (valueHeaderOffset + 5 > data.length) break;
    const type = data[valueHeaderOffset];
    if (type === undefined) break;

    const variants: RecordVariant[] = [];
    const addVariant = (candidate: RecordVariant | undefined): void => {
      if (candidate) variants.push(candidate);
    };
    if (type === 6) addVariant(variant(data, valueHeaderOffset + 1, 1));
    if (type === 5) addVariant(variant(data, valueHeaderOffset + 1, 4));
    const prefixedLength = data.readUInt32LE(valueHeaderOffset + 1);
    addVariant(variant(data, valueHeaderOffset + 5, prefixedLength));
    if (type !== 6) addVariant(variant(data, valueHeaderOffset + 1, 1));
    if (type !== 5) addVariant(variant(data, valueHeaderOffset + 1, 4));
    if (!variants.length) break;

    const chosen = variants.find((candidate) =>
      candidate.next === data.length || plausibleRecord(data, candidate.next)) ?? variants[0];
    if (!chosen) break;
    offset = chosen.next;

    if (name.toLowerCase() === "svcrypted") {
      encryptedBytes = data.length - (valueHeaderOffset + 5);
      break;
    }
    let value: string | number;
    if (type === 5 && chosen.raw.length === 4) {
      const day = chosen.raw[0] ?? 0;
      const month = chosen.raw[1] ?? 0;
      const year = chosen.raw.readUInt16LE(2);
      value = month >= 1 && month <= 12 && year > 1900 && year < 2200
        ? `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`
        : [...chosen.raw].map((entry) => entry.toString(16).padStart(2, "0")).join(" ");
    } else if (chosen.raw.length === 1 && type !== 4 && type !== 12) {
      value = chosen.raw[0] ?? 0;
    } else {
      value = decodeText(chosen.raw);
    }
    meta.set(name.toLowerCase(), { type, value });
  }
  return { meta, encryptedBytes };
}

function caseSummaryFromMeta(meta: Map<string, AkadMetaEntry>): AkadCaseSummary {
  const header = Object.fromEntries(HEADER_KEYS.map((key) => [key, meta.get(key.toLowerCase())?.value ?? null])) as CaseHeader;
  if (!meta.has("elstertransfertime")) {
    return {
      header,
      transmitted: "unknown",
      transmittedReason:
        "Feld ElsterTransferTime nicht im Kopf gefunden - der Kopf wurde womöglich unvollständig gelesen. Keine Aussage möglich.",
    };
  }
  const transferRecord = meta.get("elstertransfertime");
  if (!transferRecord || transferRecord.type !== 4) {
    const typeName = transferRecord ? (AKAD_TYPE_NAMES[transferRecord.type] ?? String(transferRecord.type)) : "undefined";
    return {
      header,
      transmitted: "unknown",
      transmittedReason: `ElsterTransferTime hat unerwarteten Typ '${typeName}' - keine Aussage möglich.`,
    };
  }
  const transferTime = String(transferRecord.value).trim();
  if (["", "0", "-"].includes(transferTime)) {
    return {
      header,
      transmitted: false,
      transmittedReason: transferTime
        ? `ElsterTransferTime ist der Platzhalter '${transferTime}' - kein Versand`
        : "ElsterTransferTime ist leer",
    };
  }
  if (/\d/u.test(transferTime)) {
    return { header, transmitted: true, transmittedReason: `übermittelt am ${transferTime}` };
  }
  return {
    header,
    transmitted: "unknown",
    transmittedReason:
      `ElsterTransferTime '${transferTime}' ist weder Platzhalter noch Zeitstempel - keine Aussage möglich.`,
  };
}

/**
 * Liest nur den unverschluesselten, auf 512 KiB begrenzten AKAD-Kopf. Ein
 * unbekanntes Format bleibt bewusst dreistufig statt "nicht uebermittelt" zu
 * behaupten; eine versehentliche zweite ELSTER-Abgabe waere teurer.
 */
export function parseAkadCaseSummary(input: Uint8Array): AkadCaseSummary {
  try {
    const data = Buffer.from(input).subarray(0, AKAD_MAX_HEADER_BYTES);
    const parsed = parseAkadMeta(data);
    return parsed ? caseSummaryFromMeta(parsed.meta) : unknownSummary();
  } catch {
    return unknownSummary("Datei nicht lesbar - keine Aussage moeglich");
  }
}

function parseAkadCaseListSummary(input: Uint8Array): (AkadCaseSummary & { encryptedBytes: number }) | undefined {
  try {
    const parsed = parseAkadMeta(Buffer.from(input).subarray(0, AKAD_MAX_HEADER_BYTES));
    return parsed ? { ...caseSummaryFromMeta(parsed.meta), encryptedBytes: parsed.encryptedBytes } : undefined;
  } catch {
    return undefined;
  }
}

export function isProfileCaseFileName(path: string, profile: ProductProfile, includeBackups = true): boolean {
  const name = basename(path);
  const types = [...new Set(Object.values(profile.startModes))];
  const escapedTypes = types.map((type) => type.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  const match = new RegExp(`\\.(?<type>${escapedTypes.join("|")})(?<year>\\d{4})(?<backup>_Backup)?$`, "iu").exec(name);
  const type = match?.groups?.type;
  const year = Number(match?.groups?.year);
  if (!type || !Number.isInteger(year) || (!includeBackups && Boolean(match?.groups?.backup))) return false;
  return Object.entries(profile.startModes).some(([mode, modeType]) =>
    modeType.toUpperCase() === type.toUpperCase() &&
    [profile.taxYear, ...(profile.additionalCaseYears[mode] ?? [])].includes(year));
}

function preciseIsoTime(milliseconds: bigint, nanoseconds: bigint): string {
  const whole = new Date(Number(milliseconds)).toISOString().slice(0, 19);
  const fraction = String((nanoseconds % 1_000_000_000n) / 100n).padStart(7, "0");
  return `${whole}.${fraction}Z`;
}

async function openCaseFile(path: string, signal?: AbortSignal): Promise<Awaited<ReturnType<typeof open>>> {
  if (signal?.aborted) throw abortError();
  const openOperation = open(path, "r");
  return signal
    ? await abortable(openOperation, signal, (lateHandle) => lateHandle.close().catch(() => undefined))
    : await openOperation;
}

async function readStableCaseHeader(path: string, signal?: AbortSignal): Promise<{ data: Buffer; stats: BigIntStats }> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (signal?.aborted) throw new CaseFileError("API-Client hat die Fallliste abgebrochen.", "aborted");
    handle = await openCaseFile(path, signal);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new CaseFileError(`Falldatei fehlt: ${path}`, "not-found");
    const length = Number(before.size < BigInt(AKAD_MAX_HEADER_BYTES) ? before.size : BigInt(AKAD_MAX_HEADER_BYTES));
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    if (length > 0) {
      const stream = handle.createReadStream({ autoClose: false, end: length - 1, ...(signal ? { signal } : {}) });
      stream.on("error", () => undefined);
      for await (const entry of stream) {
        const chunk = Buffer.isBuffer(entry) ? entry : Buffer.from(entry);
        chunks.push(chunk);
        bytesRead += chunk.length;
      }
    }
    const afterHandle = await handle.stat({ bigint: true });
    const afterPath = await stat(path, { bigint: true });
    if (!sameFileState(before, afterHandle) || !sameFileState(before, afterPath)) {
      throw new CaseFileError(
        "Falldatei wurde waehrend des Kopflesens veraendert oder ersetzt; Fallliste wird verworfen.",
        "resource-changed",
      );
    }
    return { data: Buffer.concat(chunks, bytesRead), stats: before };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function roundedKilobytes(bytes: bigint): number {
  const numerator = bytes * 10n;
  let tenths = numerator / 1024n;
  const remainder = numerator % 1024n;
  if (remainder > 512n || (remainder === 512n && tenths % 2n !== 0n)) tenths += 1n;
  return Number(tenths) / 10;
}

function localTimestamp(milliseconds: bigint): string {
  const value = new Date(Number(milliseconds));
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-") + " " + [
    String(value.getHours()).padStart(2, "0"),
    String(value.getMinutes()).padStart(2, "0"),
    String(value.getSeconds()).padStart(2, "0"),
  ].join(":");
}

export async function listCaseFiles(
  directoryInput: string,
  profile: ProductProfile,
  options: { includeBackups?: boolean; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ListedCaseFiles> {
  const dir = resolve(directoryInput);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS);
  const abort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    const entries = await abortable(readdir(dir, { withFileTypes: true }), controller.signal);
    const names = entries
      .filter((entry) => entry.isFile() && isProfileCaseFileName(entry.name, profile, options.includeBackups === true))
      .map((entry) => entry.name);
    if (!names.length) return { ok: true, dir: directoryInput, count: 0, cases: [] };

    const cases: ListedCaseFile[] = [];
    for (const name of names) {
      if (controller.signal.aborted) throw abortError();
      const path = resolve(dir, name);
      const { data, stats } = await readStableCaseHeader(path, controller.signal);
      const parsed = parseAkadCaseListSummary(data);
      if (!parsed) throw new CaseFileParserFallbackError(`AKAD-Kopf von '${name}' braucht den Worker-Parser.`);
      const header = parsed.header;
      cases.push({
        name,
        path,
        kb: roundedKilobytes(stats.size),
        modified: localTimestamp(stats.mtimeMs),
        module: name.slice(name.lastIndexOf(".") + 1).replace(/_Backup$/iu, ""),
        fileType: header.FileType ?? "",
        year: header.VJahr ?? "",
        steuernummer: header.Steuernummer ?? "",
        savedBy: header.FileSavedBy ?? "",
        elsterTransferTime: String(header.ElsterTransferTime ?? "").trim(),
        transmitted: parsed.transmitted,
        transmittedReason: parsed.transmittedReason,
        encryptedBytes: parsed.encryptedBytes,
        meta: null,
      });
    }
    if (controller.signal.aborted) throw abortError();
    return { ok: true, dir: directoryInput, count: cases.length, cases, parserError: null };
  } catch (error) {
    if (error instanceof CaseFileParserFallbackError) throw error;
    if (error instanceof CaseFileError && error.kind !== "aborted") throw error;
    throw normalizeListError(error, dir, timedOut, options.signal?.aborted === true);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

function normalizeListError(error: unknown, dir: string, timedOut: boolean, aborted: boolean): CaseFileError {
  if (timedOut) return new CaseFileError(`Zeitueberschreitung beim Lesen des Fallordners: ${dir}`, "timeout");
  if (aborted) return new CaseFileError("API-Client hat die Fallliste abgebrochen.", "aborted");
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "ENOENT" || code === "ENOTDIR") return new CaseFileError(`Fallordner fehlt: ${dir}`, "not-found");
  return new CaseFileError(error instanceof Error ? error.message : String(error), "worker");
}

function normalizeFileError(error: unknown, path: string, timedOut: boolean, aborted: boolean): CaseFileError {
  if (timedOut) return new CaseFileError(`Zeitueberschreitung beim Hashen der Falldatei: ${path}`, "timeout");
  if (aborted) return new CaseFileError("API-Client hat den Fallhash abgebrochen.", "aborted");
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "ENOENT" || code === "ENOTDIR") return new CaseFileError(`Falldatei fehlt: ${path}`, "not-found");
  if (error instanceof CaseFileError) return error;
  return new CaseFileError(error instanceof Error ? error.message : String(error), "worker");
}

export async function readCaseFileInfo(
  pathInput: string,
  profile: ProductProfile,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<CaseFileInfo> {
  const path = resolve(pathInput);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS);
  const abort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
    handle = await openCaseFile(path, controller.signal);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new CaseFileError(`Falldatei fehlt: ${path}`, "not-found");
    if (!isProfileCaseFileName(path, profile)) {
      throw new CaseFileError(
        `Falldatei gehoert nicht zum freigegebenen Profil '${profile.id}'.`,
        "unsupported-case",
      );
    }
    if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new CaseFileError("Falldatei ist fuer eine sichere JSON-Groessenangabe zu gross.", "worker");
    }

    const hash = createHash("sha256");
    const headerChunks: Buffer[] = [];
    let headerBytes = 0;
    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
    const stream = handle.createReadStream({ autoClose: false, signal: controller.signal });
    // Ein bereits beim Erzeugen ablaufendes Signal emittiert neben der
    // Async-Iterator-Ablehnung ein Error-Event. Der Listener verhindert nur
    // einen unhandled process error; die Schleife wirft denselben Fehler und
    // wird unten weiterhin als timeout/aborted klassifiziert.
    stream.on("error", () => undefined);
    for await (const entry of stream) {
      const chunk = Buffer.isBuffer(entry) ? entry : Buffer.from(entry);
      hash.update(chunk);
      if (headerBytes < AKAD_MAX_HEADER_BYTES) {
        const slice = chunk.subarray(0, AKAD_MAX_HEADER_BYTES - headerBytes);
        headerChunks.push(slice);
        headerBytes += slice.length;
      }
    }
    const afterHandle = await handle.stat({ bigint: true });
    const afterPath = await stat(path, { bigint: true });
    if (!sameFileState(before, afterHandle) || !sameFileState(before, afterPath)) {
      throw new CaseFileError(
        "Falldatei wurde waehrend des Hashens veraendert oder ersetzt; Ergebnis wird verworfen.",
        "resource-changed",
      );
    }

    return {
      ok: true,
      path,
      exists: true,
      size: Number(before.size),
      mtimeUtc: preciseIsoTime(before.mtimeMs, before.mtimeNs),
      sha256: hash.digest("hex").toUpperCase(),
      ...parseAkadCaseSummary(Buffer.concat(headerChunks, headerBytes)),
    };
  } catch (error) {
    throw normalizeFileError(error, path, timedOut, options.signal?.aborted === true);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
    await handle?.close().catch(() => undefined);
  }
}
