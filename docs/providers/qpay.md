# QPay v2 (merchant API)

What Bogts relies on, and how each point was confirmed. "Sandbox" means
`https://merchant-sandbox.qpay.mn`, probed on 2026-09-25 with qpay-js 1.0.0 and curl.

## Hosts and credentials
| | Host |
|---|---|
| Production | `https://merchant.qpay.mn` |
| Sandbox | `https://merchant-sandbox.qpay.mn` |

`QPAY_ENVIRONMENT=test` selects the sandbox. qpay-js appends `/v2/...` itself,
so the config holds the bare host (a trailing `/v2` is trimmed).

**The public test merchant works.** `TEST_MERCHANT` / `123456` with invoice code
`TEST_INVOICE` minted a token, created invoices, answered `payment/check` and
cancelled them (confirmed). For a local sandbox run:
`QPAY_ENVIRONMENT=test`, `QPAY_CLIENT_ID=TEST_MERCHANT`,
`QPAY_CLIENT_PASSWORD=123456`, `QPAY_INVOICE_CODE=TEST_INVOICE`.

The sandbox is flaky: one `POST /v2/invoice` answered an nginx HTML 404, and the
same request succeeded moments later. A create failure becomes a `failed`
invoice with `provider_error`; the project simply creates another.

## Endpoints qpay-js 1.0.0 calls
| Operation | qpay-js | HTTP |
|---|---|---|
| Mint token | `getToken()` | `POST /v2/auth/token`, `Authorization: Basic base64(client_id:password)`, no body |
| Refresh | `refreshToken()` | `POST /v2/auth/refresh`, `Authorization: Bearer <refresh_token>` |
| Create invoice | `createSimpleInvoice()` | `POST /v2/invoice` |
| Check payment | `checkPayment()` | `POST /v2/payment/check` |
| Cancel invoice | `cancelInvoice(id)` | `DELETE /v2/invoice/{id}` |

qpay-js converts camelCase to snake_case on the way out and back on the way in
(`qPay_shortUrl` ↔ `qPayShortUrl`, `not-before-policy` ↔ `notBeforePolicy`).
Errors are `QPayError(statusCode, code, message, rawBody)`, where `code` is QPay's
`error` field or the HTTP status text. Its message and `rawBody` carry the raw
body, so Bogts never logs or stores them (`providers/qpay/client.ts` turns every
error into `QpayCallError(status, code, operation)`).

## Tokens
The sandbox token response (confirmed):
```json
{ "token_type": "bearer", "access_token": "…", "refresh_token": "…",
  "expires_in": 1790433197, "refresh_expires_in": 1790433197,
  "scope": "get_token", "not-before-policy": "0", "session_state": "sandbox" }
```
`expires_in` and `refresh_expires_in` are **absolute epoch seconds**, about 24 h
ahead, and qpay-js reads them that way. Bogts caches the pair in memory, then in
D1 `provider_token` (key `qpay:<sha256(base url | client id)>`, both tokens
encrypted), then refreshes, then mints. It injects the token into each
`QPayClient` via the runtime-visible `storeToken` (TS-private). **Re-read qpay-js
before bumping it.** On a 401 the token is dropped and the call retried once.

## Creating an invoice
Bogts sends:
```json
{ "invoice_code": "<QPAY_INVOICE_CODE>", "sender_invoice_no": "<our invoice ULID>",
  "invoice_receiver_code": "terminal", "invoice_description": "<≤255 chars>",
  "amount": 49900, "callback_url": "<PUBLIC_ORIGIN>/hooks/qpay/<our invoice ULID>" }
```
The sandbox answer (confirmed) is `{ invoice_id (UUID), qr_text (≈240 chars),
qr_image (base64 PNG, ≈10.5 KB), qPay_shortUrl, urls[23] }`, where each `urls[]`
entry is `{ name, description, logo (https), link }` (a bank app deeplink with
`qPay_QRcode=<qr_text>`). Bogts stores `qr_text`, `qr_image` (dropped above 48 KiB
or when it is not base64) and `urls` as `deeplinks`. It drops `javascript:`/`data:`
links and non-https logos. `qPay_shortUrl` is not kept: the hosted page is
`/pay/<id>`.

A simple invoice carries no expiry at QPay. Our own `expiresAt` plus the sweep
decide, and a payment after expiry is honoured.

## payment/check
Request: `{ "object_type": "INVOICE", "object_id": "<QPay invoice_id>", "offset": { "page_number": 1, "page_limit": 100 } }`.

For an unpaid invoice, and for an unknown invoice id, the sandbox answers
`{ "count": 0, "rows": [] }` with no `paid_amount` (confirmed). Paid rows
(documented by qpay-js types, not seen live: nobody can pay the sandbox merchant
without a bank app) look like
`{ payment_id, payment_status, payment_amount: "49900.00", trx_fee, payment_currency, payment_wallet, payment_type, card_transactions[], p2p_transactions[] }`.

**Bogts counts an invoice as paid only when there is a row with
`payment_status === "PAID"` whose amount (via `toMnt`) equals the invoice
amount.** The first such row's `payment_id` becomes the ledger `provider_ref`.
PAID money of any other amount is not settled; it is recorded as
`qpay.payment.amount_mismatch` activity. Other statuses (`NEW`, `FAILED`,
`REFUNDED`) are never settled.

Two more findings are recorded (once each), never settled:
- **More than one PAID row** (the payer paid the same QR twice): the invoice is
  settled once, with one `invoice.paid`; the other payments are listed in
  `qpay.extra_payment` activity with their ids and amounts, and the dashboard's
  Overview asks you to refund them.
- **The settled payment is no longer PAID** (`REFUNDED`, or gone):
  `qpay.payment_refunded`. The invoice stays `paid`; Bogts does not unsettle.

## Cancel
`DELETE /v2/invoice/{id}` answers 200 `{}`. A second cancel answers 400
`INVOICE_ALREADY_CANCELED` (confirmed), which Bogts treats as done; it treats
a 404 the same way. Cancelling is best effort: a QR can stay payable in a bank
app, and `settleInvoice` still honours money that arrives.

Before cancelling, `POST /v1/invoices/:id/cancel` asks `payment/check`. A paid
invoice is settled and the cancel answers 409. If the check fails, nothing is
cancelled (502), so a payment with an unknown state is never retired.

## Callback
QPay calls the invoice's `callback_url` server-to-server once payment clears.
**Not confirmed live** (it needs a real payment). Other integrations report a GET,
sometimes with `?qpay_payment_id=…` appended, and some see POSTs. QPay's own docs
advise relying on the callback rather than cron polling.

Bogts treats the callback purely as a hint:
- `GET` and `POST /hooks/qpay/<invoiceId>` are both accepted. The body, the
  query (a forged `?qpay_payment_id=` included) and the headers are never read;
  the handler only gets the invoice id from the path. Tests forge all three.
- Unknown or malformed id, or a non-QPay invoice: 404.
- Already paid: 200 `SUCCESS`. At most once per 10 minutes per invoice (and not
  right after the callback that settled it), it re-checks, because a callback
  for a paid invoice usually means a second payment on the same QR; that
  finds `qpay.extra_payment` or `qpay.payment_refunded`.
- Otherwise it re-checks with `payment/check`, at most 20 times per invoice per
  10 minutes (after that, 503 so QPay retries later):
  - verified payment: `settleInvoice`, 200 `SUCCESS`
  - no matching payment: 200 `SUCCESS` plus `qpay.callback.unverified` activity (a spoof)
  - QPay or D1 failure: 503 with `Retry-After: 60`, so QPay retries
- A payment after expiry or cancel is settled (`invoice.paid` follows
  `invoice.expired`).

## Expiry sweep and the late check
Every 10 minutes, each pending invoice past `expiresAt` is claimed (by setting
`swept_at` conditionally) and checked **once** with `payment/check`. Paid:
settled. Otherwise, or on a QPay error (`sweep.check_failed`): expired.

QPay keeps accepting payment on an old QR, and its callback can be lost. So an
invoice that ended `expired` gets **one** late check about 24 hours after
`expiresAt` (claimed through `late_checked_at`, at most 100 per run, only for
invoices that expired in the last 7 days). Paid: settled, and `invoice.paid`
follows `invoice.expired`. A QPay error uses the check up too.

That is two scheduled calls per invoice, ever, so QPay's no-polling rule
holds.

## Open questions
- The callback's exact method and query parameters, and whether QPay retries a
  non-2xx and how often. Confirm on the first production payment and record
  it here.
- Whether `invoice_description` has a hard limit below 255.
- `enable_expiry` on the full invoice request, which could make QPay itself
  stop accepting payment after `expiresAt`. It is undocumented, so unused.
