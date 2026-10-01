# Semantic UI acceptance — 2026-09-05

## Result

Scope correction and subsequent verification:
[View declarations acceptance](view-declarations-acceptance-2026-09-05.md).
The result below describes the earlier generation; it does not establish complete
HAT person-form adoption or semantic equivalence. The latest acceptance-report.json
belongs to the subsequent generation, not the historical run below.

The tested and activated 0.10.0 generation is
`60b3d25a33fe31e015ee67f100a7c0efc9816432e6e77f417e6323bce250527a`.
External Playwright: **8 combined scenarios / 52 executable actions**, all passed
in 65.8 seconds. Six mandatory semantic UI requirements passed, with no skipped
or flaky tests and no unexpected browser console warnings/errors.

The harness has two additional verification tests; these are not counted as
product scenarios. Current detailed evidence is in
the locally generated `.artifacts/acceptance-report.json` (excluded from Git), with an
artifact-specific receipt under `.artifacts/releases/`.

## Why the previous green result was insufficient

The old checks accepted a fixed nine-axis profile list and a fixed six-area world
list. They did not require an adopted language API, runtime dictionary membership,
newly introduced types, or a completed profile-input/locale/restart journey.
Some source-text tests enforced that old layout instead of its intended behavior.
Passing those tests did not establish that dynamic projection was complete.

Tests were extended before completing implementation. The old release failed on
the missing `/api/semantic/views` endpoint. Further real-input testing exposed
an action-flow 503 after selecting French: missing display translations returned
keys, which setup validation correctly rejected. This was fixed through English
display fallback without changing the asserted French preference.

## Required evidence

| Requirement | Executed assertions |
| --- | --- |
| Language provenance | Released sem-lang basis IDs/digest, explicit Hatter base references, CLI/Web equality, visible system provenance |
| Profile projection | Exact declared menus, form IDs/order, field paths, schema and meaning references; no invented facts/tasks |
| Dynamic world | Fresh random signed entity IDs/labels and surface-only declarations; open-browser invalidation without reload; exact detail/back navigation |
| Localization | Declared labels, French selection, English fallback, unchanged stored values and semantic IDs |
| CLI/Web parity | Dictionary, forms, interface contract and persisted profile values agree across independent process and HTTP access |
| Persistence | HAT additions, composition, real worker output references and profile values survive process restart; dictionary remains unchanged by fact writes |

The existing scenario also verifies signature tampering rejection, revision/CAS
conflicts, composition removal/restoration, placement boundaries, competing worker
rejection, a real external accountant worker, exact output digest/subject references,
projection-event ingestion and completed history.

The GitHub package's surface-only pattern is additionally covered by the focused
Hatter package test. It must remain discoverable without inventing a new entity type.

## Other checks

- Console unit tests: 274 passed.
- Console typecheck, production build and resource budgets: passed.
- Hatter focused profile/dictionary/surface tests: 6 passed.
- Hatter semantic contract tests: 33 passed.
- sem-lang exported-language test: 1 passed.
- Modified Hatter package Clippy with warnings denied: passed.
- Offline registry/checksummed-lock source audit: passed.
- Product generation: approximately 48 MiB; Console output: 7,185,496 bytes.

## Regression prevention and limits

`release-requirements.json` maps requirements to actual executed actions.
Missing mappings, missing execution, failures and skipped tests reject the gate.
Both development setup commands run `bin/verify-release.mjs` before activation.
Negative harness tests remove each requirement's execution evidence and verify
that a superficially green result is not eligible. Test discovery includes newly
added test files instead of pinning one filename.

This is Console/HAT integration acceptance, not a proof of every possible product
behavior. Japanese accounting correctness, OS Passkey ceremonies, and real model
inference are outside this scenario and are explicitly excluded in the receipt.
New requirements still need review and explicit assertions; a green test count
alone must not be presented as completion.

No user data was initialized or migrated. Five intermediate generations created
solely for this investigation were deleted; they can be reproduced by rebuilding.
The prior active generation and Cargo caches were preserved.
