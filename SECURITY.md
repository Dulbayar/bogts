# Security policy

Bogts handles payment credentials and card tokens, so we take reports
seriously and answer them quickly.

## Reporting a vulnerability

**Please don't open a public issue, discussion or pull request for a
security problem.**

Report it privately through GitHub:
[**Security → Report a vulnerability**](https://github.com/gege-mn/bogts/security/advisories/new)
on this repository. This opens a private GitHub Security Advisory that only the
maintainers can see. If you can't use GitHub, email hello@gege.mn with
"Bogts security" in the subject.

Please include:

- what an attacker can do, and under which configuration;
- the steps to reproduce it, or a proof of concept;
- the affected version or commit.

We'll acknowledge your report within 3 working days, keep you updated, and
credit you in the advisory unless you prefer not to be named. Please give us a
reasonable time to release a fix before you disclose anything publicly.

## Never post credentials

Never include real secrets in a report, an issue, a pull request, a log or a
screenshot. That covers Bonum or QPay credentials, `ENCRYPTION_KEY`,
`ADMIN_PASSWORD`, project API keys (`bgk_…`), webhook signing secrets
(`bgwh_…`), card tokens, and Access tokens. Use placeholders, or the public
QPay sandbox merchant.

If you posted a secret by accident, **rotate it at once** (in the provider's
portal, or with `wrangler secret put` for Worker secrets) and then tell us, so
we can remove the post. Deleting it doesn't un-leak it.

## Scope

In scope: this repository (`apps/gateway`, `packages/client`), and the way the
default configuration and the docs set up a deployment.

Out of scope: vulnerabilities in Cloudflare, Bonum or QPay themselves (report
those to them), and deployments that ignore the documented setup, such as
`/admin` exposed with a weak password.

## Supported versions

Bogts is pre-1.0. Security fixes go into the latest release only, so keep
your deployment up to date (see
[docs/self-hosting.md](docs/self-hosting.md#upgrading-and-migrations)).
