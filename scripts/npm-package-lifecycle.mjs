import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const mode = process.argv[2];
if (!new Set(["pack", "publish:dry-run"]).has(mode)) {
  throw new Error("Erwartet wird pack oder publish:dry-run.");
}

const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
if (!existsSync(npmCli)) throw new Error(`npm CLI fehlt: ${npmCli}`);

function run(args) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["run", "build:npm-packages"]);
for (const workspace of [
  "@yadimon/steuer-spar-erklaerung-mcp",
  "@yadimon/steuer-spar-erklaerung-api",
]) {
  run(["run", mode, "--workspace", workspace]);
}
