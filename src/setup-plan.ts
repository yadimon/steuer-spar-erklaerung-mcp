import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { readJsonFileStrict } from "./json-files.js";

const MAX_SETUP_PLAN_BYTES = 64 * 1024;
const PLAN_FIELDS = new Set(["schemaVersion", "profileId", "caseDir", "sourceFolders", "sseExecutable"]);

export interface ConfirmedSetupPlan {
  schemaVersion: 1;
  profileId: string;
  caseDir: string;
  sourceFolders: readonly string[];
  sseExecutable?: string;
}

function absolutePath(value: unknown, name: string): string {
  if (typeof value !== "string" || !isAbsolute(value) || /[\u0000-\u001f]/u.test(value)) {
    throw new Error(`${name} muss ein absoluter Pfad ohne Steuerzeichen sein.`);
  }
  return resolve(value);
}

function existingDirectory(value: unknown, name: string): string {
  const path = absolutePath(value, name);
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${name} fehlt oder ist kein Ordner: ${path}`);
  }
  return path;
}

/**
 * Liest nur die vier bereits vom Nutzer bestaetigten First-run-Angaben.
 * Token, Schreibmodus und andere Autoritaet sind absichtlich nicht planbar.
 */
export function loadConfirmedSetupPlan(path: string): ConfirmedSetupPlan {
  if (!isAbsolute(path) || /[\u0000-\u001f]/u.test(path)) {
    throw new Error("--plan-file muss ein absoluter Pfad ohne Steuerzeichen sein.");
  }
  const parsed = readJsonFileStrict(path, "Bestaetigter Setup-Plan", MAX_SETUP_PLAN_BYTES);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Bestaetigter Setup-Plan muss ein JSON-Objekt sein.");
  }
  const value = parsed as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (!PLAN_FIELDS.has(key)) throw new Error(`Unbekanntes Feld '${key}' im bestaetigten Setup-Plan.`);
  }
  if (value.schemaVersion !== 1) throw new Error("Bestaetigter Setup-Plan benoetigt schemaVersion 1.");
  if (typeof value.profileId !== "string" || !value.profileId.trim() || /[\u0000-\u001f]/u.test(value.profileId)) {
    throw new Error("profileId im bestaetigten Setup-Plan ist ungueltig.");
  }
  if (!Array.isArray(value.sourceFolders) || value.sourceFolders.length > 32) {
    throw new Error("sourceFolders muss eine Liste mit hoechstens 32 Ordnern sein.");
  }
  const sourceFolders = [...new Set(value.sourceFolders.map((entry, index) =>
    existingDirectory(entry, `Quellordner sourceFolders[${index}]`)))];
  const sseExecutable = value.sseExecutable === undefined
    ? undefined
    : absolutePath(value.sseExecutable, "sseExecutable");
  return {
    schemaVersion: 1,
    profileId: value.profileId,
    caseDir: existingDirectory(value.caseDir, "Fallordner caseDir"),
    sourceFolders,
    ...(sseExecutable ? { sseExecutable } : {}),
  };
}
