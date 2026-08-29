import { createHash } from "node:crypto";
import { resolve } from "node:path";

export interface ConfigurationFingerprintIdentity {
  profileId: string;
  caseDir?: string;
  documentsDir: string;
  workspaceDir: string;
  resultDir: string;
  backupsDir: string;
  sseExecutable?: string;
  operateExperimental?: boolean;
}

function optionalResolved(path: string | undefined): string | null {
  return path ? resolve(path) : null;
}

export function configurationFingerprint(config: ConfigurationFingerprintIdentity): string {
  const stable = {
    profileId: config.profileId,
    caseDir: optionalResolved(config.caseDir),
    documentsDir: resolve(config.documentsDir),
    workspaceDir: resolve(config.workspaceDir),
    resultDir: resolve(config.resultDir),
    backupsDir: resolve(config.backupsDir),
    sseExecutable: optionalResolved(config.sseExecutable),
    operateExperimental: config.operateExperimental === true,
  };
  return createHash("sha256").update(JSON.stringify(stable), "utf8").digest("hex");
}
