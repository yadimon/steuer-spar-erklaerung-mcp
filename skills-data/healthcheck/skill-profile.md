# Skill Profile

## Scope

- skill: healthcheck
- purpose: evidence-based health verdict for the local SSE API/MCP workspace

## Stable Project Facts

- target_file: `health-check.md`
- project_shape: npm workspace with shared root source and separate API/MCP
  publication packages
- primary_apps_or_services: loopback API, PC-blind stdio MCP wrapper,
  PowerShell 5.1 Worker, supported SSE-2025 desktop application

## Approved Defaults

- preferred_check_commands:
  - `npm run test:privacy`
  - `npm run build:ts`
  - `npm run test:fast`
  - `npm test`
  - `npm run test:product`
  - `npm run test:npm-clean-install`
  - `npm audit --audit-level=low`
- preferred_manual_check_areas:
  - disposable-case live suite and cleanup
  - final Git privacy/scope review
  - exact registry/release assets only when publishing is in scope
- accepted_non_blocking_warnings:
  - optional archive fixture unavailable outside its private test environment
  - 2024 profile and unverified VaSt paths remain explicit product limits

## Key Files

- `health-check.md`
- `package.json`
- `test/suite-plan.mjs`
- `docs/VERIFIKATION.md`
- `SECURITY.md`

## Key Commands

- `npm run test:fast`
- `npm test`
- `npm run test:product`
- `npm run test:live`

## Known Drift Or Gotchas

- Run large suites serially.
- Never count a missing live fixture as successful live evidence.
- Keep VM/live logs, paths, screenshots and reports in ignored private areas.
- The global maintenance bootstrap does not honor ignored generated package
  copies; that tooling limitation is not a healthcheck workspace invariant.

## Last Confirmed State

- verified_at: 2026-08-25
- verdict: `HEALTHY`
- notes: all required repository, build, offline, package, installed-product and
  live checks passed; live coverage reached 86/93 catalog operations across 452
  calls with no error-only operation; no release action was in scope
