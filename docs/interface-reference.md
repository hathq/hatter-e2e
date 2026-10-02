# hatter-e2e interface reference

Use the [usage guide](getting-started.md) for the first steps. This reference preserves the current interface details and operational limits. Run command examples from the repository root, after preparing the exact declared dependencies and registered configuration.

## Mandatory release acceptance

`release-requirements.json` records the semantic UI requirements, separately from
the combined use-case scenarios. Implemented requirements name executable assertions;
unmapped, failed and unexecuted assertions reject release eligibility. Missing
whole paths are explicit `implementationGap` entries: they remain `unimplemented`,
never vacuously successful, and block release even when all mapped actions pass.
`pnpm test:contract` checks the harness only and never authorizes a release.

The signed test packages acquire a fresh random entity/reference and English label
on each run. The open world scene must update without reload. CLI, HTTP, form
bindings, selected values, localized display fallback and restart are compared
exactly. A definition alone must not create facts or tasks.

Run `node bin/verify-release.mjs /absolute/generation /absolute/external-worker`.
Both developer setup commands run this gate before switching generations. Receipts
are stored under `.artifacts/releases` with the exact generation and manifest digest.
The receipt lists exclusions; it does not certify accounting rules or real model
inference, which are outside this Console/HAT integration scenario.

This independent repository verifies one released Hatter product from the same
HTTP and process boundaries used by an owner. It does not import Hatter or
Hatter Console source modules. Its browser dependency is the pinned Playwright release.

The authoritative coverage model is [`use-cases.json`](../use-cases.json). Its
coverage dimensions are combined into eight owner journeys and compiled
mechanically into [`scenario.json`](../scenario.json). Each journey correlates
multiple API, browser, authorization, persistence, and negative-path
observations. Playwright Test rejects any difference and turns every journey into
one named step, so reducing the case count cannot silently reduce coverage.

## Scenario

The runner creates an isolated `HATTER_HOME`, two HAT packages, and a temporary
local Catalog v2, generates a temporary Ed25519 catalog key, starts the released
Hatter Console, completes its internal launch handoff, and executes the ordered
operations declared in eight acceptance journeys. Every journey declares its
cross-boundary checks in the matrix and generated manual.
The main system observations are:

1. enter an isolated release through its internal browser connection while checking
   Host, Origin, CSRF, cookie, SSR, HTTP security and adopted definition provenance;
2. observe the built-in world, switch to a signed local Catalog, and correlate
   CAS, path redaction, signature rejection, candidates, and categories;
3. reject package drift, install two HATs, prove idempotency, and compare every
   manifest declaration with its user category and System structure projections;
4. atomically compose the HATs, validate proposal and binding digests, then use a
   real browser to follow the single primary Scene, Temporal Bar, contextual HAT detail,
   category, Work, and system UI;
5. remove and restore one role while correlating monotonic revisions,
   capabilities, an empty HAT Projection Journal, Now, and closed Digital Twin projections;
6. reject a phantom model route and inspect the exact privacy-preserving Codex
   token/cache/tool/compacting observation boundary without inventing cost;
7. execute a released HAT worker and correlate its output object, common event
   semantics, HAT Projection Journal API and UI, Service Mesh identity, and
   planned/actual Action Flow timing;
8. restart the release, reject the old process session, and deep-compare durable
   state after normalizing only the explicitly volatile clock.

The exact local directory is deliberately absent from the Web projection. The
temporary key, Catalog, state, and package copy are removed when the test ends.
The Playwright file contains two tests: one multi-observation harness contract
and one released-product journey with eight named steps. No test case exists for
only one assertion or one projection. Port `127.0.0.1:4213` must be unused because the released Console intentionally
has a fixed loopback origin.

## Run it

`reviewPoints` records improvement questions separately from pass/fail assertions.
The JSON reporter writes `.artifacts/acceptance-report.json`, including an
`acceptance-and-improvement-review` attachment. Only a fully passed journey is
eligible for UX review; failed and unexecuted journeys are never called successful.
This fixture tests financial reference transport, not Japanese accounting rules,
OS Passkey registration, real model inference, or HAT dependency-cycle resolution.

Point the scenario at an already staged and verified product launcher:

```bash
cd /path/to/hatter-e2e
pnpm exec playwright install chromium
HATTER_E2E_HATTER_BIN=/absolute/path/to/hatter \
HATTER_E2E_WORKER_BIN=/absolute/path/to/hat-accountant-worker \
pnpm test
```

The pinned Playwright release owns the Linux Chromium revision. The test does not
accept a browser path and never starts a Windows executable from WSL. Browser
contexts, temporary profiles, traces, console warnings, page errors, failed
requests, and HTTP 5xx observations are all managed through Playwright.

To exercise the exact released iHAT catalog and package instead of the generated
fixture, provide its built public directory. The runner copies only the signed
index, detached signature, and selected package into its temporary boundary; it
never modifies the release input.

`HATTER_E2E_REPOSITORY_IDS` may select exactly two comma-separated signed
entries; the defaults are `hat-accountant,hat-budget-planner`. Release mode pins
the official iHAT origin, signing-key ID, and public key rather than accepting
trust values from the input directory.

Print the same scenario as an operations checklist:

```bash
npm run scenario:compile
npm run manual
```

To inspect the same signed two-HAT state in the UI, start the isolated showcase.
It prints a one-use URL after installing and composing the fixtures. The temporary
state is removed when `Ctrl+C` stops it, so it never changes the owner's normal
Hatter state.

An occupied port, invalid launcher, failed session ceremony, wrong HTTP status,
unsafe source projection, verification drift, missing candidate, missing
installation, or restart-state loss fails the corresponding numbered step.
