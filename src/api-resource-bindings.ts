import type { SseApiOperation } from "./api-contract.js";
import type { ResourceArea } from "./resources.js";

export type ResourceBinding = {
  alias: string;
  workerField: string;
  allowedAreas: readonly ResourceArea[];
};

/**
 * Deklarative Abbildung oeffentlicher Ressourcenreferenzen auf die absoluten
 * Worker-Pfade. Jede Zeile ist zugleich der Redaktionsvertrag der Antwort.
 */
export const API_RESOURCE_BINDINGS: Readonly<Partial<Record<SseApiOperation, readonly ResourceBinding[]>>> = Object.freeze({
  case_hash: [{ alias: "ref", workerField: "path", allowedAreas: ["cases"] }],
  case_create: [{ alias: "targetRef", workerField: "targetPath", allowedAreas: ["cases"] }],
  center_refresh: [{ alias: "expectedDirectoryRef", workerField: "expectedDirectory", allowedAreas: ["cases"] }],
  launch: [{ alias: "caseRef", workerField: "file", allowedAreas: ["cases"] }],
  desktop_start: [{ alias: "caseRef", workerField: "file", allowedAreas: ["cases"] }],
  collect: [{ alias: "resultRef", workerField: "path", allowedAreas: ["results"] }],
  export_csv: [{ alias: "resultRef", workerField: "dir", allowedAreas: ["results"] }],
  verify: [{ alias: "sourceRef", workerField: "from", allowedAreas: ["results", "workspace"] }],
  screenshot: [{ alias: "resultRef", workerField: "path", allowedAreas: ["results"] }],
  save: [{ alias: "caseRef", workerField: "expectedPath", allowedAreas: ["cases"] }],
  dialog_answer: [{ alias: "expectedCaseRef", workerField: "expectedCasePath", allowedAreas: ["cases"] }],
  file_dialog_select: [{
    alias: "resourceRef",
    workerField: "expectedPath",
    allowedAreas: ["cases", "documents", "workspace", "results", "backups"],
  }],
  receipt_manager_import: [{
    alias: "resourceRef",
    workerField: "expectedPath",
    allowedAreas: ["documents"],
  }],
  vast_apply: [{ alias: "expectedCaseRef", workerField: "expectedCasePath", allowedAreas: ["cases"] }],
  tracked_set_value: [{ alias: "expectedCaseRef", workerField: "expectedCasePath", allowedAreas: ["cases"] }],
  combo_select: [{ alias: "expectedCaseRef", workerField: "expectedCasePath", allowedAreas: ["cases"] }],
  toggle: [{ alias: "expectedCaseRef", workerField: "expectedCasePath", allowedAreas: ["cases"] }],
  save_as: [
    { alias: "sourceRef", workerField: "expectedSourcePath", allowedAreas: ["cases"] },
    { alias: "targetRef", workerField: "targetPath", allowedAreas: ["cases"] },
  ],
  make_working_copy: [
    { alias: "sourceRef", workerField: "source", allowedAreas: ["cases"] },
    // Backups sind hashgepruefte Arbeitskopien mit eigenem Ablagezweck.
    { alias: "targetRef", workerField: "target", allowedAreas: ["cases", "backups"] },
  ],
  backup_cases: [{ alias: "destinationRef", workerField: "dest", allowedAreas: ["backups"] }],
  archive_cases: [{ alias: "destinationRef", workerField: "dest", allowedAreas: ["backups"] }],
} satisfies Partial<Record<SseApiOperation, readonly ResourceBinding[]>>);
