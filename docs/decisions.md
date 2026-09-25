# Decisions

The product decisions behind Bogts, and why.

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Hosted multi-tenant or self-hosted? | **Open source, single-tenant, self-hosted**, with a Deploy to Cloudflare button | Bonum's All-in-one checkout already consolidates payment methods, and QPay SDKs already exist. The missing piece is a correct, finished setup. Holding other companies' credentials adds trust and compliance weight for revenue nobody has proven. Hosting it for others can come later, as Hyperswitch does. |
| 2 | Tenancy inside one deployment | One company, **many projects** | A company usually runs several apps against the same merchant accounts; one deployment serves them all. |
| 3 | How projects call it | HTTPS API with a per-project Bearer key | Works across Cloudflare accounts and for backends that aren't Workers. |
| 4 | How projects learn about payments | Signed webhooks with retries (outbox + cron), an event feed, and a 10-minute expiry sweep that checks each invoice once | A project is always told how every invoice ended, even without a provider callback. |
| 5 | Entitlement | Projects own it; the gateway reports facts | Keeps the gateway low-level and general. |
| 6 | Repo shape | Worker + typed client package | Projects get types and a webhook signature check for free. |
| 7 | Dashboard | Full dashboard, SvelteKit, in the same Worker | One deploy. |
| 8 | Dashboard auth | Cloudflare Access if configured, otherwise an admin password; it refuses to run with neither | Self-hosters may not have Access. A deploy must never run open. |
| 9 | Plans | Defined in the gateway per project, mapped to Bonum plan ids and checked against them | Bonum plans are made in its portal; the gateway checks amount and type before checkout. |
| 10 | e-barimt | Later; columns reserved | |
| 11 | v1 flows | Bonum subscriptions, QPay direct invoices, Bonum hosted invoice, charging a saved card | |
| 12 | Testing | The sandbox is a separate deployment on the Bonum and QPay sandboxes, with its own plans | Exercises renew, fail and unsubscribe via the sandbox `execute` endpoint. |
| 13 | License | Apache-2.0 | An explicit patent grant from every contributor, and a patent-retaliation clause. |
