# Using @hathq/hatter-e2e

Test a released Hatter generation through the same browser and process boundaries used by an owner.

## Before you start

Harness contract tests are not release acceptance. Failed, unmapped or unimplemented product paths block release eligibility.

## First steps

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test:contract
```

## How to assess the result

- Run mapped product requirements against the released launcher.
- Retain exact scenario results, cleanup evidence and exclusions.

A passing source-level check establishes only what that check observes. Keep missing configuration, unavailable services and unverified deployment paths visible.

## Continue reading

[Repository overview](../README.md)
