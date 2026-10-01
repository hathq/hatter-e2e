<!-- Added by the Hatter downstream project, 2026. -->
<!-- Purpose: preserve an external-only, executable acceptance boundary. -->

# Hatter E2E rules

- Treat `use-cases.json` as the coverage source and `scenario.json` as its exact
  compiled acceptance record. Every operational change must update the matrix;
  the compiler, executable test, recorded scenario, and manual must remain equal.
- Exercise only a released Hatter launcher through its process and loopback
  HTTP interfaces. Never import Hatter or Hatter Console source modules.
- Use an isolated temporary `HATTER_HOME`, a temporary signing key, and a local
  signed catalog. Tests must not require public-network access or persistent
  credentials.
- Stop a scenario at its first failed step. Do not perform later mutations
  after an earlier observation or authorization failure.
- Remove all temporary state and stop the child Console even when a step fails.
- Product mocks may be used only to test this runner itself, never as product
  acceptance evidence.
- Before implementing a UI contract change, add its observable requirements to
  `release-requirements.json` and link them to executable assertions in the use-case
  matrix. Missing or unexecuted requirements are release failures, not exclusions.
- Dynamic UI tests must introduce previously unknown signed declarations, compare
  exact IDs/references/labels with CLI and HTTP, and observe the already-open browser.
  A fixed category count or source-text match is not functional acceptance.
- Exercise input, persisted values, locale changes and restart, not just initial
  rendering. Browser console warnings and errors fail product acceptance.
- Run `bin/verify-release.mjs` against the exact staged generation before activation.
  Harness-only success, skipped scenarios and stale reports must never authorize it.
