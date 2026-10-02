# @hathq/hatter-e2e

Test a released Hatter generation through the same browser and process boundaries used by an owner.

## What you can do

- Run mapped product requirements against the released launcher.
- Retain exact scenario results, cleanup evidence and exclusions.

## Current scope

Harness contract tests are not release acceptance. Failed, unmapped or unimplemented product paths block release eligibility.

## Getting started

The commands below check the harness. Product acceptance requires the exact released generation and external worker selected by the operator; see `release-requirements.json` and `use-cases.json`.

```sh
pnpm install --frozen-lockfile
pnpm test:contract
```

## Documentation and source

[Interface reference](docs/interface-reference.md)

[Usage guide](docs/getting-started.md)

[Detailed documentation](docs) · [Implementation and public interfaces](src) · [Verification cases](test) · [Contributing](CONTRIBUTING.md) · [Security reporting](SECURITY.md) · [License](LICENSE) · [Attribution notices](NOTICE)
