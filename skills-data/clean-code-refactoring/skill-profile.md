# Skill Profile

## Scope

- skill: clean-code-refactoring
- purpose: preserve behavior while separating domain composition, schemas,
  wrapper glue and desktop side effects

## Stable Project Facts

- project_shape: one npm package with TypeScript orchestration and a
  PowerShell 5.1-compatible Windows UI worker
- main_languages: TypeScript, JavaScript tests, PowerShell, C# helper
- architecture_or_layering_rules:
  - MCP is a thin, PC-blind wrapper.
  - The loopback HTTP API owns configuration, resource references and domain
    composition.
  - The PowerShell worker owns only bounded desktop interactions.
  - All write operations require explicit preconditions and readback.

## Approved Defaults

- preferred_test_commands:
  - `npm run build:ts`
  - closest contract test under `test/`
- preferred_broader_checks:
  - `npm test`
  - `git diff --check`
- documentation_expectations:
  - document non-obvious safety invariants and public semantic operations
  - do not add comments for obvious control flow

## Area Notes

- `src/api-executor.ts`:
  - role: generic API orchestration and semantic compositions
  - keep_stable: validation, resource redaction, timeout and abort behavior
  - refactor_goals: keep domain handlers and resource bindings declarative;
    avoid moving UI side effects out of the worker
  - extra_test_expectations: API contract, operation catalog, domain contracts
- `src/api-main.ts`, `src/api-runtime.ts`:
  - role: minimaler Startvertrag getrennt von Serverlaufzeit und Shutdown
  - keep_stable: Hilfe und Argumentfehler laden keine Worker-/Servermodule;
    der Runtimepfad behaelt Config-Sanitizing, Logging und Abort-Fan-out
- `src/index.ts`, `src/mcp-tools.ts`, `src/mcp-tools-*.ts`:
  - role: minimal MCP startup plus grouped PC-blind registrations
  - keep_stable: one API call per ordinary tool and no local PC knowledge
  - refactor_goals: keep six cohesive registration groups below the guarded
    24-KiB module boundary while descriptions remain clear
- `src/mcp-schemas-*.ts`, `src/operation-schema-primitives.ts`,
  `src/operation-catalog.ts`:
  - role: fachlich gruppierte MCP-Schemas plus gemeinsame API-Projektion
  - keep_stable: jede Gruppe hat exakt dieselben Toolnamen und Schemas; alle
    Eingabeeigenschaften bleiben beschrieben und unter 24 KiB pro Modul
- `powershell/sse-worker.ps1`:
  - role: safety-critical UI side effects
  - keep_stable: ELSTER blocks, instance/case/hash/interference guards
  - refactor_goals: only cohesive helpers backed by focused contracts

## Known Drift Or Gotchas

- Generated `.tmp/` and `artifacts/` copies are not refactoring targets.
- Real SSE controls can share names; stable automation IDs and expected pages
  are required.
- UIA errors invalidate the worker process; never hide incomplete reads.
