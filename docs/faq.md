# FAQ

**Does Bogts hold money?**
No. Payments go straight to your own Bonum and QPay merchant accounts. Bogts
only talks to the providers and records what happened.

**Is it hosted somewhere I can sign up?**
No. You deploy your own copy to your own Cloudflare account. A hosted version
may come later.

**Can one deployment serve several companies?**
It isn't designed to. One deployment has one set of provider credentials (one
company's merchant accounts) and serves that company's projects. For another
company, deploy another copy.

**Do I need both Bonum and QPay?**
No. Leave a provider's secrets empty and it is switched off. Creating an
invoice for it then answers `provider_disabled`.

**Which one should I use?**
For card subscriptions and saved cards, Bonum. For a one-off QR payment, QPay
directly, or Bonum's hosted checkout if you want one page that also offers
cards, WeChat and SonoShop.

**Does it grant access to my product?**
No. Bogts reports facts: paid, renewed, failed, cancelled, expired. Your app
decides what they mean, for example "Pro until `period.end`".

**What if my webhook endpoint is down?**
Bogts retries for 3 days, and you can re-deliver any event from the dashboard.
After a longer outage, read `GET /v1/events?after=<last id>`. See
[webhooks.md](webhooks.md#reconciling-with-the-event-feed).

**A customer paid after the invoice expired. What happens?**
The money is honoured: the invoice becomes `paid` and you get `invoice.paid`,
even after `invoice.expired`. Decide in your app whether to fulfil or refund.

**Why doesn't Bogts poll QPay for the payment status?**
QPay asks integrators not to poll. Bogts asks QPay when the callback
arrives, when you cancel, while the payer has the hosted page open (at most
once every 10 seconds per invoice), and once when the invoice expires. It
never polls on a timer.

**Does it work on Cloudflare's free plan?**
Yes: one Worker, one D1 database and a cron trigger, with no Queues. For real
money, use Workers Paid. It gives more CPU per request and 30 days of D1
backups instead of 7.

**Where are card numbers stored?**
Nowhere. Bonum's page takes the card. Bogts stores only Bonum's card token,
encrypted with `ENCRYPTION_KEY`, and the masked number for display. Your
projects never see the token.

**I lost `ENCRYPTION_KEY`.**
Nothing encrypted with it can be read again: the saved card tokens (needed
for charges and reversals) and the projects' webhook signing secrets. Bonum
keeps renewing existing subscriptions, because it holds the mandate. Set a new
key, rotate each project's signing secret, and ask customers who need
saved-card charges to replace their card. Keep the key in a password manager.

**Is e-barimt supported?**
Not yet. The database has columns reserved for it, and it's planned after v1.

**Can I add another provider?**
The invoice flow has a provider adapter interface
(`apps/gateway/src/lib/server/services/invoice-adapter.ts`). Open an issue
first to discuss it.

**Why "Bogts"?**
A *bogts* («Богц») is the traditional Mongolian pouch for coins, flint and
small valuables, worn on the belt. It's where your payments go.
