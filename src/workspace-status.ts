import { createHash } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { resolve } from "node:path";
import type { SseApiServerConfig } from "./api-config.js";

export type WorkspaceStatusIdentity = Pick<
  SseApiServerConfig,
  "profileId" | "caseDir" | "documentsDir" | "workspaceDir" | "resultDir" | "backupsDir" | "sseExecutable"
>;

function optionalResolved(path: string | undefined): string | null {
  return path ? resolve(path) : null;
}

export function configurationFingerprint(config: WorkspaceStatusIdentity): string {
  const stable = {
    profileId: config.profileId,
    caseDir: optionalResolved(config.caseDir),
    documentsDir: resolve(config.documentsDir),
    workspaceDir: resolve(config.workspaceDir),
    resultDir: resolve(config.resultDir),
    backupsDir: resolve(config.backupsDir),
    sseExecutable: optionalResolved(config.sseExecutable),
  };
  return createHash("sha256").update(JSON.stringify(stable), "utf8").digest("hex");
}

function directoryReady(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false;
    accessSync(path, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function readWorkspaceStatus(config: SseApiServerConfig) {
  return {
    ok: true,
    profileId: config.profileId,
    configurationFingerprint: configurationFingerprint(config),
    workspaceReady: directoryReady(config.workspaceDir),
    resultAreaReady: directoryReady(config.resultDir),
    caseDirectoryConfigured: Boolean(config.caseDir),
    caseDirectoryReady: config.caseDir ? directoryReady(config.caseDir) : false,
    documentAreaReady: directoryReady(config.documentsDir),
    backupAreaReady: directoryReady(config.backupsDir),
    sseExecutableConfigured: Boolean(config.sseExecutable),
  };
}
