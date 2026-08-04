# Skill Profile

## Scope

- skill: project-quality-maintenance
- purpose: safe, no-submission maintenance of the local SSE API/MCP package

## Stable Repo Facts

- repo_type: single npm package, not a monorepo
- workspace_shape: source package plus ignored portable/release copies
- major_components: TypeScript API/MCP, PowerShell 5.1 worker, C# helper DLL,
  German public skills and contract/integration tests

## Maintenance Defaults

- preferred_baseline_commands:
  - `npm test`
- preferred_quality_gates:
  - `npm run build:ts`
  - impacted `node test/<contract>.mjs`
  - `npm test`
  - `git diff --check`
- known_hotspots:
  - `src/api-executor.ts`
  - `src/mcp-tools-*.ts`
  - `src/operation-catalog.ts`
  - `powershell/sse-worker.ps1`
  - `test/run-suite.mjs`
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
- Claude review is a user-requested commit gate and currently requires login.

## Last Confirmed State

- verified_at: 2026-08-04 02:44 Europe/Berlin
- notes: `npm test` passed in 33,700 ms with 86 API/MCP operations; focused
  no-overwrite, backup and synthetic archive/rollback gates passed afterward.
