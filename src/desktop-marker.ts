import { join } from "node:path";
import { readFileBounded } from "./bounded-files.js";

export const MAX_DESKTOP_MARKER_BYTES = 4 * 1024;
export function desktopMarkerPath(env: { TEMP?: string; TMP?: string } = process.env): string {
  return join(env.TEMP ?? env.TMP ?? ".", "sse-mcp-desktop.txt");
}

export const DESKTOP_MARKER_PATH = desktopMarkerPath();

const VALID_DESKTOP_NAME = /^[A-Za-z0-9_-]{1,64}$/;
export const CENTER_TEST_OPERATIONS = Object.freeze(["center_cases", "center_refresh"] as const);
const CENTER_TEST_OPERATION_SET = new Set<string>(CENTER_TEST_OPERATIONS);

export type DesktopMarkerOwner = "sse" | "center-test";

export interface DesktopMarker {
  schemaVersion: 0 | 1;
  owner: DesktopMarkerOwner;
  name: string;
  pid: number | null;
}

export class DesktopMarkerError extends Error {
  constructor(
    message: string,
    readonly kind: "desktop-marker-invalid" | "desktop-marker-owner",
  ) {
    super(message);
    this.name = "DesktopMarkerError";
  }
}

function invalidMarker(): never {
  throw new DesktopMarkerError(
    "Desktop-Marker ist ungueltig; sichtbarer Desktop wird nicht ersatzweise verwendet.",
    "desktop-marker-invalid",
  );
}

function hasExactProperties(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && expected.slice().sort().every((name, index) => name === actual[index]);
}

function validName(value: unknown): value is string {
  return typeof value === "string" && VALID_DESKTOP_NAME.test(value);
}

function validPid(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 0xffff_ffff;
}

/** Parses both the old SSE-only marker and the owned, versioned contract. */
export function parseDesktopMarker(text: string): DesktopMarker {
  const raw = text.trim();
  if (!raw) return invalidMarker();
  if (!raw.startsWith("{")) {
    if (!validName(raw)) return invalidMarker();
    return { schemaVersion: 0, owner: "sse", name: raw, pid: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return invalidMarker();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return invalidMarker();
  const marker = parsed as Record<string, unknown>;

  if (hasExactProperties(marker, ["name", "pid"])) {
    if (!validName(marker.name) || !validPid(marker.pid)) return invalidMarker();
    return { schemaVersion: 0, owner: "sse", name: marker.name, pid: marker.pid };
  }

  if (!hasExactProperties(marker, ["name", "owner", "pid", "schemaVersion"]) || marker.schemaVersion !== 1) {
    return invalidMarker();
  }
  if ((marker.owner !== "sse" && marker.owner !== "center-test") ||
      !validName(marker.name) || !validPid(marker.pid)) {
    return invalidMarker();
  }
  return {
    schemaVersion: 1,
    owner: marker.owner,
    name: marker.name,
    pid: marker.pid,
  };
}

/**
 * Only ENOENT means "visible desktop". Every existing but unreadable marker
 * is a safety boundary and therefore fails closed.
 */
export function resolveDesktopMarkerForOperation(
  markerPath: string,
  operation: string,
  allowCenterTest: boolean,
): DesktopMarker | null {
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true })
      .decode(readFileBounded(markerPath, MAX_DESKTOP_MARKER_BYTES));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof DesktopMarkerError) throw error;
    return invalidMarker();
  }

  const marker = parseDesktopMarker(raw);
  if (marker.owner === "sse" && CENTER_TEST_OPERATION_SET.has(operation)) {
    throw new DesktopMarkerError(
      "SSE-Desktop-Marker besitzt keinen Steuertipps-Center; Center-Operation wurde nicht dorthin geroutet.",
      "desktop-marker-owner",
    );
  }
  if (marker.owner === "center-test" && (!allowCenterTest || !CENTER_TEST_OPERATION_SET.has(operation))) {
    throw new DesktopMarkerError(
      "Desktop-Marker gehoert dem isolierten Center-Test; Operation wurde nicht dorthin geroutet.",
      "desktop-marker-owner",
    );
  }
  return marker;
}
