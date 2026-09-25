## What and why

<!-- What does this change, and why? Link the issue: "Closes #123". -->

## How it was tested

<!-- Tests added or changed; sandbox runs (Bonum or QPay), if any. -->

## Checklist

- [ ] `pnpm check` and `pnpm test` pass
- [ ] Follows `docs/contracts.md` (money as integer MNT, the ledger for payments, no secrets in logs)
- [ ] Schema change: migration generated with `db:generate` and committed
- [ ] Gateway dependency change: `pnpm lockfile:gateway` run, both lockfiles committed
- [ ] Docs and `CHANGELOG.md` (Unreleased) updated if behaviour changed
- [ ] No credentials, tokens or real customer data anywhere in the diff
