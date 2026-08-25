# Health Check

## 1. Scope

- repository: SteuerSparErklärung API/MCP workspace
- generated-at: 2026-08-25
- baseline branch: `main`
- objective: determine whether the tracked API, PC-blind MCP wrapper, Windows
  worker, package artifacts and supported SSE-2025 integration are healthy

The health check never sends through ELSTER and never uses real tax data.
Environment-dependent UI checks use only configured disposable manufacturer
cases. Raw reports, local paths, screenshots and VM evidence stay gitignored.

## 2. Prerequisites

- Windows x64 with the Node.js version from `.node-version` and npm.
- Windows PowerShell 5.1 for the product worker boundary.
- Dependencies installed from the tracked lockfile.
- For `LIVE-001`: supported SteuerSparErklärung 2025, configured manufacturer
  sample cases, an unlocked otherwise unused desktop session and no open case
  that must be preserved.
- No API, MCP or SSE process from another test may own the configured fixtures.

## 3. Repository Invariants

| id | check | required | severity | how to run | pass condition |
| --- | --- | --- | --- | --- | --- |
| STRUCT-001 | tracked files contain no private paths, secrets or forbidden artifacts | yes | critical | `npm run test:privacy` | exit code 0 |
| STRUCT-002 | tracked Markdown links and anchors resolve | yes | major | `npm run test:links` | exit code 0 |
| STRUCT-003 | pending diff has no whitespace errors | yes | major | `git diff --check` | exit code 0 |

## 4. Automated Checks

| id | command | required | severity | expected |
| --- | --- | --- | --- | --- |
| AUTO-001 | `npm run build:ts` | yes | critical | strict TypeScript build exits 0 without compiler errors |
| AUTO-002 | `npm run test:fast` | yes | major | fast API/MCP contract plan exits 0 |
| AUTO-003 | `npm test` | yes | critical | all planned offline API/MCP, Worker, privacy and package contracts exit 0 |
| AUTO-004 | `npm run test:product` | yes | major | installed supported SSE-2025 identity, mode, process and catalog gates exit 0 |
| AUTO-005 | `npm run test:npm-clean-install` | yes | major | freshly packed API and MCP packages install and all public entries start successfully |
| AUTO-006 | `npm audit --omit=dev --audit-level=low` | yes | major | exit code 0 and zero production vulnerabilities |
| AUTO-007 | `npm audit --audit-level=low` | yes | major | exit code 0 and zero full-tree vulnerabilities |

### 4.1 Notes

- Run `AUTO-002` and `AUTO-003` serially; overlapping large suites create
  misleading timing/port failures.
- `AUTO-003` may report an archive integration fixture as unavailable only
  where the test explicitly treats that private fixture as optional. It must
  not hide any required contract failure.
- Dependency audit needs registry access. A registry outage is `blocked`, not
  a pass.

## 5. Environment-Dependent And Manual Checks

| id | procedure | required | severity | pass condition |
| --- | --- | --- | --- | --- |
| LIVE-001 | Run `npm run test:live` on configured disposable manufacturer cases in the unused desktop session | yes | major | exit code 0; both supported live journeys finish; no ELSTER/send; cleanup reports no owned SSE process left |
| MAN-001 | Inspect the final Git status and staged diff before any push or publication | yes | major | only intentional tracked files; no `.private`, `.tmp`, `artifacts`, local configs, screenshots or reports |
| MAN-002 | Verify published registry packages and GitHub release assets | no | major | only when a release is in scope; exact versions and package boundaries match |

If `LIVE-001` lacks its documented prerequisites, mark it `blocked` and use an
`AT_RISK` verdict. A mock, schema test or offline product identity gate is not
a replacement for live UI evidence.

## 6. Confirmed Result

- verified-at: 2026-08-25
- verdict: `HEALTHY`
- release scope: none; no publish, push or ELSTER/send action was performed

| check | result |
| --- | --- |
| `npm run build:ts` | pass |
| `npm run test:fast` | pass, 81 planned contracts |
| `npm test` | pass, 120 planned contracts |
| `npm run test:product` | pass against the installed supported 2025 product |
| `npm run test:npm-clean-install` | pass for both packed packages and all public entrypoints |
| production and full dependency audits | pass, zero reported vulnerabilities |
| live UI evidence | same-day broad live gate remains green; the current receipt, dialog, instances and MCP delta passed in a disposable VM and cleanup left no owned SSE process |
| privacy, links and pending-diff checks | pass |

The current aggregate ledger has 87 of 93 catalog operations functional. The
six VaSt operations reached only their real fail-closed error paths because the
required certificate PIN was not provided; no operation remains completely
untested. The same-day broad live baseline still covers the unchanged strict
2025, verification-only 2024 and Center journeys. Current changed UI paths were
repeated separately in the disposable VM. Temporary evidence and
machine-specific details stayed outside Git.

## 7. Known Weak Points

- Profile 2025 / Engine 31 is supported. Profile 2024 / Engine 30 remains
  experimental and verification-only; this health check does not promote it.
- ELSTER submission, transmission and send operations remain hard-blocked and
  are never exercised by this playbook.
- Six VaSt operations still lack successful live evidence. Their real
  `not-found` paths prove safe refusal, not a successful VaSt workflow.
- UI automation depends on an unlocked, unused Windows desktop and configured
  disposable fixtures. Missing prerequisites must be reported, not skipped as
  green.
- Ignored generated package copies are not workspace roots and must never be
  included in tracked maintenance or health evidence.

## 8. Decision Policy

- `HEALTHY`: every required repository and automated check passes, `LIVE-001`
  passes, and `MAN-001` finds no privacy or scope issue.
- `AT_RISK`: no required check fails, but `LIVE-001`, dependency audit or
  another required environment-dependent check is blocked.
- `UNHEALTHY`: any required critical check fails, any required major contract
  fails, or multiple required checks cannot be executed for reasons controlled
  by the repository.

Optional release verification never lowers an otherwise valid verdict when no
release is in scope.

## 9. Failure Response Protocol

1. Stop further refactoring, release or publication work.
2. Capture only the minimal non-private failure evidence.
3. Classify code regression, stale test/playbook, missing environment or
   external outage.
4. Add or tighten the closest regression test before changing shared runtime
   code where feasible.
5. Re-run the failed check, then `npm test` after shared API/MCP/Worker changes.
6. Re-run all required checks before issuing a new verdict.

## 10. Optional Automation Hooks

No additional healthcheck script is created. The commands above are the
authoritative project entrypoints.
