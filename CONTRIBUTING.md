# Contributing to Bogts

Thanks for helping. Bug reports, fixes, docs and provider knowledge (what
Bonum or QPay *actually* send) are all welcome. For anything larger than a
fix, open an issue first so we can agree on the shape before you build it.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Report
security problems privately, as described in [SECURITY.md](SECURITY.md), never
in a public issue.

## The repository

| Path | What it is |
|---|---|
| `apps/gateway` | The Worker: SvelteKit 2 + Svelte 5 on `@sveltejs/adapter-cloudflare`, Drizzle on D1, zod |
| `packages/client` | `@gege-mn/bogts`: the typed client and webhook verifier, with no runtime dependencies |
| `docs/` | Design, decisions, contracts, provider notes and the user docs |
| `scripts/` | Repository tooling |

Read [docs/contracts.md](docs/contracts.md) before changing code. It holds the
rules every module follows and the API shapes, which are binding.

## Set up

You need Node 24 or later and pnpm.

```sh
git clone https://github.com/gege-mn/bogts.git
cd bogts
pnpm install
cp apps/gateway/.dev.vars.example apps/gateway/.dev.vars
```

Fill in `apps/gateway/.dev.vars`. The minimum is:

```ini
ENCRYPTION_KEY=   # openssl rand -base64 32
ADMIN_PASSWORD=   # 12+ characters
PUBLIC_ORIGIN=http://localhost:5173
```

For QPay, the public sandbox merchant works:

```ini
QPAY_ENVIRONMENT=test
QPAY_CLIENT_ID=TEST_MERCHANT
QPAY_CLIENT_PASSWORD=123456
QPAY_INVOICE_CODE=TEST_INVOICE
```

For Bonum, use your own sandbox credentials with `BONUM_ENVIRONMENT=test`.
**Never commit `.dev.vars`**, and never paste real credentials into an issue,
a pull request, a test fixture or a log.

Create the local D1 database and start the dev server:

```sh
pnpm --filter @bogts/gateway db:migrate:local   # local D1 under apps/gateway/.wrangler
pnpm dev                                         # http://localhost:5173
```

`/health` should answer `{"status":"ok",…}`. Sign in at `/admin` with your
`ADMIN_PASSWORD`.

### Callbacks and the cron locally

- **Provider callbacks** can't reach `localhost`. To test them, run a tunnel
  (for example `cloudflared tunnel --url http://localhost:5173`) and set
  `PUBLIC_ORIGIN` to its `https://` address.
- **The cron** (webhook retries and the expiry sweep) doesn't run under
  `vite dev`. To run it, build and use wrangler:

  ```sh
  cd apps/gateway
  pnpm build
  pnpm wrangler dev --test-scheduled
  curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
  ```

## Checks and tests

```sh
pnpm check   # svelte-check for the gateway, tsc for the client
pnpm test    # vitest for the gateway and the client
```

CI runs both, builds the client and the gateway, and checks that the gateway
still deploys on its own (see below).

- Gateway tests run against **a real SQLite database built from the
  migrations** (better-sqlite3), never a mocked one, through the production
  `drizzle-orm/d1` driver over a small D1 fake, so results have D1's shapes.
  See `apps/gateway/src/lib/server/testdb.ts`, and the `db.batch` column-name
  rule in `docs/contracts.md` ("As built").
- Providers are faked with `vi.stubGlobal('fetch', …)`. Webhook fixtures are
  copied **exactly** from `docs/providers/*.md`, decimals included, because
  `10000.00` and `10000` sign differently.
- Put each test next to its module as `*.test.ts`.

## Changing the database

1. Edit `apps/gateway/src/lib/server/schema.ts`. The whole schema lives there.
2. Generate the migration: `pnpm --filter @bogts/gateway db:generate`.
3. Read the generated SQL in `apps/gateway/drizzle/` and commit it together
   with the schema change.

Migrations only move forward and must be safe on a live database: deploys
apply them before the new code goes live, so for a moment the old code runs
on the new schema.

## Dependencies and the standalone gateway

The Deploy to Cloudflare button copies **only `apps/gateway`** into a new
repository and installs it there. So `apps/gateway` must never import from
outside itself (tests excepted), and it has its own `pnpm-lock.yaml`.

After you change any dependency of the gateway, run:

```sh
pnpm install
pnpm lockfile:gateway   # rewrites apps/gateway/pnpm-lock.yaml from the root lockfile
```

and commit both lockfiles. CI fails if the gateway's lockfile is stale.

## Publishing the client

`packages/client` is published to npm as `@gege-mn/bogts`. To release it:

1. Bump `version` in `packages/client/package.json` and move the client's
   notes in `CHANGELOG.md` from *Unreleased* to the new version.
2. Publish from the package directory:

   ```sh
   cd packages/client
   pnpm publish --access public
   ```

   `prepublishOnly` builds and tests the package first. The tarball holds only
   `dist/`, `README.md`, `LICENSE` and `package.json`; check it with
   `pnpm pack --dry-run`.

## House rules

- **Money** is integer MNT. **Times** are epoch-ms in D1 and ISO-8601 strings
  in the API. **Ids** are ULIDs.
- Every provider payment goes through the `ledger` table, in the same
  `db.batch` as its state change and exactly one event.
- **Never log** credentials, tokens, card tokens or webhook bodies. Log event
  types and our own ids.
- Error messages must be safe to show to a user, and they never echo provider
  text.
- Code style: tabs, single quotes, TypeScript strict. `.editorconfig` has the
  rest.

## Commits and pull requests

- One logical change per commit. The subject is short, in the imperative or
  as `Area: what changed`, for example `QPay callback: re-check with
  payment/check` or `docs: webhook retry schedule`. Explain *why* in the body
  when it isn't obvious.
- Keep pull requests focused. Update the docs and `CHANGELOG.md` (under
  *Unreleased*) when behaviour changes.
- `pnpm check` and `pnpm test` must pass.

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE).
