import { accessSync, constants, statSync } from "node:fs";
import {
  configurationFingerprint,
  type ConfigurationFingerprintIdentity,
} from "./configuration-fingerprint.js";
export { configurationFingerprint } from "./configuration-fingerprint.js";

function directoryReady(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false;
    accessSync(path, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function readWorkspaceStatus(config: ConfigurationFingerprintIdentity) {
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
