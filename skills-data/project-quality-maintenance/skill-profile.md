# Skill Profile

## Scope

- skill: project-quality-maintenance
- purpose: safe, no-submission maintenance of the local SSE API/MCP package

## Stable Repo Facts

- repo_type: npm workspace with two published packages and shared root source
- workspace_shape: root build/test package plus `packages/api` and
  `packages/mcp`; ignored generated copies are never source workspaces
- major_components: TypeScript API/MCP, PowerShell 5.1 worker, C# helper DLL,
  German public skills and contract/integration tests

## Maintenance Defaults

- preferred_baseline_commands:
  - `npm run test:fast`
  - `npm test`
  - `npm run test:product` when the supported product is installed
- preferred_quality_gates:
  - `npm run build:ts`
  - impacted `node test/<contract>.mjs`
  - `npm test`
  - `git diff --check`
  - `npm audit --audit-level=low`
- known_hotspots:
  - `src/api-executor.ts`
  - `src/api-server.ts`
  - `src/mcp-tools-*.ts`
  - `src/operation-catalog.ts`
  - `powershell/sse-worker.ps1`
  - `test/run-suite.mjs`
  - `test/desktop-marker-contract.mjs`
- do_not_touch_areas:
  - ELSTER/send hard blocks except to strengthen them
  - real tax cases or generated evidence outside disposable copies

## Constraints

- no_feature_work: yes
- commit_only_when_tier0_tier1_green: yes
- keep_mcp_pc_blind: yes
- keep_api_as_execution_core: yes

## Known Drift Or Gotchas

- `.tmp/` and `artifacts/` contain generated package copies and must not be
  detected as workspaces or edited as source.
- The archive integration test intentionally skips without its private fixture.
- PowerShell changes must remain Windows PowerShell 5.1 compatible.
- External reviews are advisory evidence; local tests and the actual diff stay
  authoritative.
- The global maintenance bootstrap scans ignored generated package copies; its
  workspace findings must be filtered against tracked npm manifests before
  they are written to Git.

## Last Confirmed State

- verified_at: 2026-08-25
- notes: 120-step offline suite, installed-product gate and clean package
  install pass; dependency audits report zero known vulnerabilities.
