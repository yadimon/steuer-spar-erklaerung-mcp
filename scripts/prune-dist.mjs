import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pruneStaleDistArtifacts } from "./dist-artifacts.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const removed = pruneStaleDistArtifacts(repoRoot);
process.stdout.write(removed.length
  ? `Veraltete dist-Artefakte entfernt: ${removed.join(", ")}\n`
  : "dist-Artefakte stimmen mit den TypeScript-Quellen ueberein.\n");
