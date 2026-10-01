<!-- Added by the Hatter downstream project, 2026. -->
<!-- Purpose: record verified progress without certifying unresolved profile/meaning contracts. -->
# View declarations acceptance — 0.10.0

Activated generation:
`e14279ffcbaab3531d8d348106500db150d986159d567ff6cb939b4afd3240b7`.

## Verified

- External Playwright: 8 combined product scenarios, 52 actions, 7 required
  requirements passed in 77.2 seconds; 3 separate harness tests also passed.
  No skipped/flaky cases or unexpected browser errors/warnings.
- New independent Identity/Place/Agent expectations reject the previous release:
  `reviewed example identity has no declared locale map`.
- Mutation tests reject a wrong existing base reference or translated label even
  if CLI/API/UI would agree with one another.
- Existing profile/save/restart scenario now selects Japanese, checks person
  classification names and World list/detail language, then selects French and
  checks English fallback without changing saved name, concept IDs or dictionary.
- Console: 275 unit tests, typecheck and production build passed.
- Hatter package: 8 library tests and 3 dictionary/surface integration tests passed.
  Semantic contract: 33 tests; modified package Clippy `-D warnings`: passed.
- Registry artifacts/checksummed Cargo.lock source audit passed, offline.
- Release build reused the previous optimization profile after stopping a build
  with mismatched optimization settings; final build took 4m22s for the affected
  product closure. No full-workspace build.
- Product approximately 48 MiB. Console output 7,187,727 bytes (previous
  7,185,496; +2,231 bytes), unchanged budgets; Cargo target approximately 3.8 GiB.
- User data and credentials were not reset. Test children were stopped.

## Not certified as complete

HAT-authored personal form adoption/editing, meaning-level equivalence and the
full accepted semantic definition set remain pending; representation bindings
must not be called semantic-equivalence proofs. Actual model inference and
domain accounting correctness remain outside this Console acceptance. Passkey
ceremonies belong to independent packages, not Hatter.

The field descriptor store is still closed. Converting view grouping into a
released data declaration is not the same as supporting arbitrary HAT forms.
The historical ownership-decision document is no longer shipped. Current executable requirements are maintained in this repository's [acceptance boundary](../README.md); this historical record does not close them.
