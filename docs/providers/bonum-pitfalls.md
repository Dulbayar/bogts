# Bonum integration pitfalls

Places where a direct integration with Bonum's merchant API tends to go wrong,
and how Bogts handles each. The reference is Bonum's Postman collection
([bonum-api.md](bonum-api.md), from
https://documenter.getpostman.com/view/6164222/2sB2cYbzu8). How Bogts uses the
API as a whole is in [bonum.md](bonum.md).

## 1. Renewals keyed on `transactionId` are dropped

The docs describe `SUBSCRIPTION-PAYMENT.body.transactionId` as *"merchant's
transaction id **for the subscription**"*. That is the id sent to
`cards/tokenize/request`, and it stays the same on every renewal. Only
`invoiceId` changes from one charge to the next.

An integration that builds its dedup key from `transactionId` (or
`transactionId || invoiceId`) gives every renewal the same key as the first
`CARD-TOKEN` payment, so every monthly charge is rejected as a duplicate.
Bonum keeps taking the customer's money while the merchant stops crediting it,
and the customer loses access after the first period. Tests that send a
different `transactionId` for each renewal hide the bug.

**Bogts:** each `SUBSCRIPTION-PAYMENT` is keyed on its `invoiceId`, never on
`transactionId`. See also [the first charge's echo](#5-the-first-charge-may-be-echoed-back)
and [period dedupe](#6-one-credit-per-billing-period).

## 2. `UNSUBSCRIBED` must be handled

Once Bonum's retries run out (`retryCount` on the plan, 3 on the sample
plans), it sends `type: "UNSUBSCRIBED"` and ends the mandate. An integration
that ignores this type leaves the subscription stuck in a grace or past-due
state. If checkout refuses a customer who still has a subscription, that
customer can never pay again with a new card.

**Bogts:** `UNSUBSCRIBED` cancels the subscription with
`reason: "retries_exhausted"` and drops the card token, so the customer can
subscribe again. The hourly reconciliation also cancels a subscription that
Bonum reports as cancelled or unsubscribed, in case the webhook is lost.

## 3. Delete-subscription needs `planId` in its body

The docs send `{"planId": ...}` to both `DELETE /subscriptions/:id` and
`DELETE /subscriptions/:id/delete`. Sending no body is not what the API
documents.

Use `/delete` rather than the plain unsubscribe endpoint: plain unsubscribe
*"will execute the next billing cycle payment"*; `/delete` creates no further
payment.

**Bogts:** cancel calls `DELETE /subscriptions/:id/delete` with `planId`.

## 4. The checksum and number formatting

The docs compute `x-checksum-v2` over the body re-serialized with no
indentation. Checking it over the raw bytes is correct when Bonum sends the
body compact. The obvious fallback, `JSON.stringify(JSON.parse(raw))`, changes
numbers: `10000.00` becomes `10000`. Bonum's samples all use decimal amounts
(`amount: 10000.00`), so that fallback fails for every one of them.

**Bogts:** the checksum is checked before the body is parsed, over three
forms: the raw bytes; the body with whitespace outside strings removed,
**keeping number text exactly as sent**; and the re-serialized JSON. A bad
checksum gets `401`.

## 5. The first charge may be echoed back

A tokenization with `payNow: true` charges the first period and reports it in
the `CARD-TOKEN` webhook. It is not yet confirmed whether Bonum also sends a
`SUBSCRIPTION-PAYMENT` for that same charge. If it does, keying renewals on
`invoiceId` (pitfall 1) would credit the first charge twice.

**Bogts:** a successful `SUBSCRIPTION-PAYMENT` whose `completedAt` falls well
before the subscription's known `nextBillAt` is treated as the first charge
echoed back, and is not credited again.

## 6. One credit per billing period

A renewal can reach the merchant twice: through the `SUBSCRIPTION-PAYMENT`
webhook, and through a reconciliation that polls Get Subscriptions when the
webhook is late or lost. Without a shared key the same month is credited
twice.

**Bogts:** each renewal's ledger row records the scheduled billing date it
pays for, worked out from the charge's own time (`completedAt` or
`lastBilledAt`) and the subscription's first billing date. The ledger allows
one row per subscription and period: whichever arrives second adopts the
existing row instead of crediting. A second real charge in one period (a
different `invoiceId`) is still credited and flagged on the timeline. A failed
renewal for a period already paid is ignored.

## 7. `items[]` needs `remark`, and tokenization's needs `image`

The docs call `items` optional and do not mark its fields as required, but the
sandbox refuses Create Invoice with an item that has no `remark`, and Create
Card Token with an item that lacks `image` or `remark`. Empty strings are
accepted.

**Bogts:** every item carries `remark: ""`, and tokenization items also carry
`image: ""`.

## 8. Sandbox limits

- Card tokenization (subscriptions, card replacement) **cannot be completed in
  the sandbox** without a real card. The test card 4111 1111 1111 1111, expiry
  12/30, CVV 123 pays a hosted invoice, but not a tokenization.
- `transactionId` must be unique per invoice: reusing one answers `409`. Bogts
  sends its own invoice id, which is always new.
- Get Invoice Status is disabled on the sandbox, and there is no production
  status endpoint at all. Bogts marks an unpaid Bonum invoice expired locally,
  2 hours after `expiresAt`, and a late `PAYMENT` webhook still settles it.
- The shared test terminal has Bonum's own webhook URL registered, so its
  webhooks never reach you. Ask Bonum for your own sandbox terminal and
  register `${PUBLIC_ORIGIN}/hooks/bonum` on it.
- Sandbox plan ids differ from production ones. Run the sandbox as a separate
  deployment with its own plans (see
  [self-hosting](../self-hosting.md)).
- `PUT /subscriptions/:id/execute` triggers a subscription charge on demand,
  which exercises renewal, failure and `UNSUBSCRIBED` without waiting a month.
  It is test-only; Bogts never calls it in production.

## Also worth knowing

- **Access token:** `auth/create` is rate limited (*"Use previous token."*).
  Bogts caches the token in memory, then in D1 (encrypted), shares it across
  isolates, refreshes with `Authorization: Bearer <refreshToken>`, and calls
  `auth/create` only when there is no usable token.
- **0.01 MNT card check:** a card replacement with no `payment.amount` makes
  Bonum charge 0.01 MNT to check the card. Bogts does not count it as money.
- **Error text:** the docs advise against relying on the webhook `message` or
  on a purchase's `errorCode`. Bogts relies on neither and emits its own short
  machine codes.
