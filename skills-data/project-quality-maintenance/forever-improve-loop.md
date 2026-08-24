# Kontinuierliche Qualitätswartung

Last verified: 2026-08-25
Verification mode: full-cycle

## 1) Scope And Guardrails

- Mode: quality-only, no new end-user features.
- Scope: lokale Windows-API, PC-blinder MCP-Wrapper, PowerShell-Worker,
  Produktprofile, Tests und öffentliche Dokumentation.
- Allowed: Tests, Bugfixes, sichere Refactorings, Performance-, Typing-,
  Dokumentations- und Repository-Hygiene.
- Forbidden: ELSTER-/Versandfreigaben, spekulative Produktfeatures und echte
  Steuerdaten im Repository.
- Private VM-, Live- und lokale Testevidenz bleibt ausschließlich in
  gitignorierten Bereichen und wird hier nicht inventarisiert.

## 2) Workspace Fingerprint

- Repo shape: npm workspace monorepo with two published packages and shared
  root source.
- Workspace markers: `package.json`, `package-lock.json`, `tsconfig.json`.
- Package/runtime tools: Node.js 22, npm, TypeScript, Windows PowerShell 5.1.
- Main languages: TypeScript, JavaScript tests, PowerShell, C# helper.
- Workspace/package roots: repository root, `packages/api`, `packages/mcp`.
- Excluded generated/private roots: `.private`, `.tmp`, `artifacts`, `dist`,
  `node_modules`.

## 3) Baseline Snapshot (Run First)

- Date: 2026-08-25.
- Branch/commit after completed cycles: `main` / `3fae059`.
- `npm run test:fast`: pass, 81 fast API/MCP contracts before changes.
- `npm test`: pass before changes and after every committed runtime/test cycle;
  final plan has 120 planned steps.
- `npm run test:product`: pass against the installed supported 2025 product.
- `npm audit --omit=dev --audit-level=low`: 0 vulnerabilities.
- `npm audit --audit-level=low`: 0 vulnerabilities.
- `git diff --check`: pass for every committed cycle.

If the baseline is red, stop new improvements and repair the baseline first.

## 4) Smoke Verification Before Reuse

- Confirm root `package.json` still owns the test/build commands and npm
  workspaces still contain only `packages/api` and `packages/mcp`.
- Confirm ignored generated package copies are not treated as source workspaces.
- Run the global bootstrap helper with `-VerifyOnly`, but do not copy its
  machine-local findings into Git. Its current recursive detector does not
  honor this repository's ignore rules and therefore reports ignored package
  copies as false workspace drift.
- When that false positive occurs, verify this file manually against tracked
  manifests and regenerate only into a privacy-safe reviewed result.

## 5) Prioritized Backlog

| ID | Priority | Category | Area | Planned change | Validation | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Q-001 | P0 | API isolation | `src/api-server.ts` | Keep single-flight state per server instance | API regression plus `npm test` | done (`aa0be98`) |
| Q-002 | P1 | security docs | API/MCP docs | Keep tokenless loopback contract consistent | config/docs contract plus `npm test` | done (`a4e33ac`) |
| Q-003 | P1 | performance | desktop-marker tests | Batch parser parity without weakening Worker/API probes | focused tests plus `npm test` | done (`3fae059`) |
| Q-004 | P1 | healthcheck | project contract | Generate and run tracked `health-check.md` | documented health matrix | active |
| Q-005 | P2 | live evidence | private opt-in suite | Run only with disposable manufacturer cases and keep evidence ignored | `npm run test:live` | pending |

## 6) Quality Tooling And Cleanup

### Linters And Type Checks

- `npm run build:ts` uses strict TypeScript with unused-code checks.
- JavaScript and PowerShell syntax contracts run inside `npm test`.
- No separate ESLint or Prettier configuration is currently authoritative.

### Build Commands And Warnings

- `npm run build`, `npm run build:ts`, `npm run build:npm-packages`.
- Current verified builds emit no actionable compiler warnings.

### Static Analysis, Dead Code, Duplication

- `npm audit --audit-level=low`.
- Source-architecture, MCP-module-boundary, wrapper-boundary, privacy and
  result-contract tests are the repository's deterministic static gates.

### IDE Or MCP Assistance

- No IDE-quality MCP was available in this cycle; repository CLI contracts are
  authoritative.

## 7) Jobs, Tests, Docs, Logic Inventory

- CI: read-only Windows workflow plus separate manual npm trusted publishing.
- Test entrypoints: `npm run test:fast`, `npm test`, `npm run test:product`,
  opt-in `npm run test:live`.
- Docs to align: `README.md`, `SECURITY.md`, `docs/API-MCP-VERTRAG.md`,
  `docs/ARCHITEKTUR.md`, package READMEs and current release notes.
- Core hotspots: API server/client/executor, operation catalog/result schemas,
  MCP registration/response boundary, PowerShell worker and desktop ownership.

## 8) Verification Matrix

### Tier 0 (always)

- Closest contract test for the changed behavior.
- `npm run build:ts` for TypeScript changes.
- PowerShell syntax plus focused contract for PowerShell changes.
- `git diff --check`.

### Tier 1 (required)

- `npm test` for source, API, MCP, PowerShell, profile or test-plan changes.
- `npm run test:fast` is sufficient only for documentation-only changes when
  the central test plan itself is unchanged.

### Tier 2 (deep)

- `npm run test:product` when the supported SSE installation is present.
- `npm run test:live` only with disposable manufacturer cases and an unused
  desktop session.
- Package/registry gates only when package or release behavior changed.

## 9) Commit Policy

- Commit each completed improvement only after Tier 0 and Tier 1 pass.
- Use Conventional Commits and keep one cohesive improvement per commit.
- Never absorb unrelated or ignored private artifacts.

## 10) Docs, Comments, And Cleanup Rules

- Keep API as execution core and MCP as a thin PC-blind wrapper.
- Preserve hard ELSTER/send blocks, write preconditions and readback.
- Remove stale claims instead of layering contradictory explanations.
- Add comments only for non-obvious safety, ownership or ordering invariants.

## 11) Autonomous Loop Rules

- One backlog item per cycle.
- Stop immediately on failing Tier 0 or Tier 1.
- Re-run the full baseline after shared-runtime or cross-cutting changes.
- Record only durable, public-safe evidence; raw logs and local paths do not
  belong in this file.
