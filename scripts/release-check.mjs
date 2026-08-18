import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
if (!existsSync(npmCli)) throw new Error(`npm CLI fehlt: ${npmCli}`);

const steps = [
  ["Dependency-Audit", ["audit", "--omit=dev", "--audit-level=high"]],
  ["vollstaendige Offline-Suite", ["test"]],
  ["installiertes Produkt-Gate", ["run", "test:product"]],
  ["Portable-Paket", ["run", "package:portable"]],
  ["Portable-Readback", ["run", "verify:portable-release"]],
  ["npm-Packlisten", ["run", "pack"]],
  ["npm-Publish-Dry-run", ["run", "publish:dry-run"]],
  ["npm-Clean-install", ["run", "test:npm-clean-install"]],
];

for (const [label, args] of steps) {
  process.stdout.write(`\n=== Release-Gate: ${label} ===\n`);
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

process.stdout.write("\nAlle lokalen Release-Gates bestanden.\n");
