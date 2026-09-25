# Bogts: dashboard UX brief

Status: **brief for v1, not yet built.** Scope comes from `docs/design.md` and
`docs/contracts.md`. This file says what to build and how it should look and
behave. It holds no code except the design tokens.

Feel: calm, dense, quiet. Aim for Stripe's list and detail pages and Linear's
restraint. Mostly greys with one accent colour. Colour is saved for status
and for things that need attention. Every number is exact, every id can be
copied, and every destructive action asks for confirmation.

---

## 1. Principles

1. **Facts first.** The dashboard shows what happened (paid, failed, sent,
   retried) with exact times and ids. It never shows entitlement, because the
   projects own that.
2. **Attention, not decoration.** Only failing deliveries, past-due
   subscriptions, plan mismatches and missing configuration get colour on the
   Overview.
3. **One scope control.** A project switcher (default "All projects") filters
   every list and metric. The scope lives in the URL (`?project=<id>`), so
   links can be shared.
4. **Secrets are never shown twice.** An API key or signing secret appears
   once, when it is created or rotated. After that the page shows only its
   prefix and last 4 characters.
5. **i18n-ready.** Every visible string is a key in `messages/en.ts`. Keep the
   layout loose enough for Mongolian, which runs about 30% longer than
   English. Avoid fixed-width buttons.

---

## 2. Information architecture

All routes sit under `/admin`. The dashboard uses English path names only.

```
/admin/login                     Password login (hidden when Cloudflare Access is configured)
/admin                           Overview
/admin/payments                  Invoices list (QPay direct + Bonum hosted)
/admin/payments/[id]             Invoice detail
/admin/subscriptions             Subscriptions list
/admin/subscriptions/[id]        Subscription detail
/admin/charges                   Saved-card charges list
/admin/charges/[id]              Charge detail
/admin/events                    Events list (our emitted events)
/admin/events/[id]               Event detail: payload + delivery attempts
/admin/projects                  Projects list
/admin/projects/new              Create project
/admin/projects/[id]             Project: General · API key · Webhook · Plans (tabs via ?tab=)
/admin/usage                     Usage meter (per project, per month)
/admin/settings                  Health: providers, environment, secrets, auth, cron
```

Public pages that the gateway itself renders sit outside `/admin`:

```
/pay/[invoiceId]                 QPay QR checkout (only for invoices created with provider=qpay and no project UI)
/return/[invoiceId]              "Payment complete, returning…" bounce page
```

### Navigation

**Sidebar** (240px, fixed, on desktop):

```
[logo] Company       ← Settings → Branding (logo + name), else the Bogts pouch; hostname under it
[ All projects        ⌄ ]    ← project switcher (menu + type-to-filter)

Overview                     g o
Payments                     g p
Subscriptions                g s
Charges                      g c
Events            [3]        g e   ← count badge = deliveries currently failing/retrying
────────
Projects                     g j
Usage                        g u
Settings          [!]        g ,   ← dot when any provider/secret problem exists
────────
(footer) Sandbox · Bonum, QPay   or   Production
         Sign out
```

- Active item: `--bg-subtle` fill, `--fg` text, 2px accent bar on the left.
  Inactive items use `--fg-muted`.
- The count badge on Events is neutral when it is 0 (hidden), and danger when
  it is 1 or more.
- **Top bar** (48px, over the content only): breadcrumb on the left
  (`Payments / 01J8…Q3ZK`), and the global search box (`/`) on the right.
- **Global search** takes one input. It matches an exact id (ids are bare
  ULIDs), a `reference` or a `customerRef`. An exact
  id jumps straight to its detail page. Anything else opens a results page
  with a group for each resource type.

---

## 3. App shell and shared components

Build these first. Every page is made from them.

| Component | Purpose / spec |
|---|---|
| `EnvBanner` | See §11. Sits above everything and is sticky. |
| `PageHeader` | Title (`--text-xl`, weight 600), an optional subtitle in muted text, and up to 2 buttons on the right (primary + secondary), with any further actions in a `⋯` overflow menu. |
| `StatusBadge` | See §4. Pill, 20px high, 12px text, an icon glyph and a label. It never relies on colour alone. |
| `Money` | Renders an integer MNT amount (§5). Right-aligned in tables, `tabular-nums`. |
| `Time` | Renders `<time datetime=ISO>` with relative or absolute text (§5). A tooltip shows the full UB time and UTC. |
| `IdChip` | Monospace, truncated in the middle (`01J8…Q3ZK`), with a copy button that appears on hover or focus. Clicking the text links to the detail page. |
| `CopyButton` | 16px icon button. After a click it swaps to a check mark for 1.5s and announces "Copied" through an `aria-live="polite"` region. |
| `KeyValueList` | Detail sidebars: a muted label above the value, 12px gap. Missing values render `—` in muted text. |
| `DataTable` | See §6. Sticky header, rows 40px tall (36px in compact mode), whole row clickable (it is an `<a>` in the first cell, and the row uses a `:has()` hover), cursor pagination. |
| `FilterBar` | Chips: `+ Status`, `+ Provider`, `+ Date`, `+ Project` (only when the scope is All projects). Active chips show their value and an ✕. Filters live in URL params. |
| `Tabs` | Underline tabs. They are for sub-views of a detail page, such as the project tabs. Status filters above a list are **segmented count tiles** (Stripe-style: `All 128 · Paid 97 · Pending 4 · Expired 21 · Failed 6`). |
| `Timeline` | A vertical list: a 12px icon dot, the title, a muted secondary line, and the time on the right. A 1px line connects the dots. Items that come from a provider and items we emitted have different icons (§7.3). |
| `JsonViewer` | A `<pre>` in monospace 12px with light syntax colours, a Copy button and a "Wrap lines" toggle. It collapses to 20 lines behind a "Show all" fade. |
| `Modal` | Centred, 480px wide (full-width sheet under 480px), with a focus trap. Esc closes it unless an action is running. |
| `ConfirmDialog` | A destructive variant of Modal with typed confirmation (§9.2). |
| `Toast` | Bottom-right (bottom-centre on mobile), 4s, at most 3 stacked. Used for success and background errors. |
| `EmptyState` | A 32px outlined icon, a one-line title, a one-line hint, and an optional button. Inside a card with a dashed border. |
| `Skeleton` | Grey bars with a 1.2s shimmer. Turned off under `prefers-reduced-motion`. |
| `Callout` | An inline notice (info, warning or danger) with an icon, text and an optional link. Used for plan mismatches, missing webhook URLs and similar. |

**Content width:** list pages use `max-width: 1280px`. Detail pages use a
two-column grid: main content `minmax(0, 1fr)` and a side column of 320px.
Settings and forms use 720px.

---

## 4. Status vocabulary

Each status is a **tone** (the colour), a **glyph** (the icon) and a
**label** (i18n key). Carbon's rule applies: always show at least the label
and the glyph together with the colour.

| Tone | Glyph | Token pair | Meaning |
|---|---|---|---|
| `success` | ✓ check | `--success-bg` / `--success-fg` | Final, good |
| `pending` | ◷ clock | `--neutral-bg` / `--neutral-fg` | Waiting on the customer or the provider |
| `info` | ↻ arrows | `--info-bg` / `--info-fg` | In progress on our side (retrying, queued) |
| `warning` | ! triangle | `--warning-bg` / `--warning-fg` | Needs a look, still recoverable |
| `danger` | ✕ cross | `--danger-bg` / `--danger-fg` | Failed, final |
| `muted` | ⊘ slash | `--neutral-bg` / `--fg-subtle` | Final, not good or bad (expired, cancelled) |

### Status map for each resource

| Resource | Status (DB value) | Label (en) | Tone |
|---|---|---|---|
| Invoice | `pending` | Pending | pending |
| | `paid` | Paid | success |
| | `expired` | Expired | muted |
| | `failed` | Failed | danger |
| Subscription | `pending` | Awaiting card | pending |
| | `active` | Active | success |
| | `past_due` (after `payment_failed`) | Payment failed | warning |
| | `cancelled` | Cancelled | muted |
| | (cancel reason `unsubscribed`) | Cancelled · by bank | muted, reason shown as secondary text |
| Charge | `pending` / queued (`TOKEN-PAYMENT` awaited) | Processing | info |
| | `succeeded` | Succeeded | success |
| | `failed` | Failed | danger |
| | `reversed` | Reversed | muted, and the amount is struck through in tables |
| Delivery | `pending` (first attempt not yet made) | Queued | pending |
| | `succeeded` (2xx) | Delivered | success |
| | `retrying` (non-2xx, next attempt scheduled) | Retrying · n/… | warning |
| | `failed` (gave up after 3 days) | Failed | danger |
| Event (rolls up its delivery) | same as its latest delivery | | |
| Plan validation | `verified` | Verified | success |
| | `mismatch` (amount or interval differs from Bonum) | Mismatch | danger |
| | `unchecked` | Not checked | pending |
| | `error` (Bonum lookup failed) | Check failed | warning |
| Provider | all secrets present | Configured | success |
| | some present | Incomplete | warning |
| | none present | Off | muted |
| Environment | `sandbox` | Sandbox | warning (amber) |
| | `production` | Production | neutral (it is the calm default) |

**Provider badge** (not a status): a small neutral square tag with the
provider mark as text, `QPay` or `Bonum`, plus the method when it is known
(`Bonum · Card`, `Bonum · QPay`, `Bonum · WeChat`). Never use the providers'
brand colours. Keep them neutral so they don't compete with status.

**Event type** (not a status): monospace text such as `invoice.paid`, coloured
by the part after the dot. `paid/succeeded/renewed/active` → success-fg,
`failed/payment_failed` → danger-fg, everything else → fg-muted.

---

## 5. Formatting

### Money

- Amounts are **integer MNT** everywhere (see contracts). Show **no decimals**.
- Format: `₮12,500`, with the ₮ sign before the number and no space, and
  comma thousands separators.
  `new Intl.NumberFormat('en-US', { style: 'currency', currency: 'MNT', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 })`
  produces `₮1,234,500` (checked on Node 24). Put the formatter in
  `lib/format.ts`. A later Mongolian UI can switch to `12,500₮` in that one
  place.
- The known **0.01 card-verification charge** is the only fractional amount.
  Render it as `₮0.01` with a muted "verification" tag, and never round it to
  `₮0`.
- Tables: right-aligned, `font-variant-numeric: tabular-nums`, weight 500. A
  reversed charge shows its amount struck through in `--fg-muted`.
- KPI cards: compact form `₮12.4M` / `₮850K`, with the exact value in `title`
  and in the tooltip. Never compact a number in a table or on a detail page.
- In timeline copy, negative movements such as a reversal are written
  `−₮12,500` with the true minus sign U+2212.
- Never convert to other currencies. Everything is MNT, so the currency code
  column is dropped. Show `MNT` once, next to the amount in a detail header:
  `₮49,000 MNT`.

### Dates and times

- The data is epoch-ms UTC. The display time zone is **`Asia/Ulaanbaatar`
  (UTC+8, no DST)**, hard-coded for v1. An optional `DISPLAY_TZ` variable can
  come later.
- **Tables:** relative when under 24 hours old (`just now`, `3 min ago`,
  `5 h ago`), otherwise `25 Sep, 14:05`. Add the year when it isn't the
  current year: `25 Sep 2025, 14:05`. Use a 24-hour clock.
- **Detail pages and the timeline:** absolute with seconds,
  `25 Sep 2026, 14:05:32`. The relative time goes on the secondary line.
- **Tooltip on every `Time`:** `25 Sep 2026, 14:05:32 UB · 06:05:32 UTC`.
- **Future times** (next bill, next retry, expiry): `in 3 h` / `on 25 Oct`,
  plus a countdown in the tooltip.
- Use `Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ulaanbaatar', … })` and
  `Intl.RelativeTimeFormat('en', { numeric: 'auto' })`. `mn` works in both for
  later (`3 минутын өмнө`).
- Relative labels refresh every 60s through a single shared ticker, not one
  timer per cell.
- Date-range filter presets: Today, 7 days, 30 days, 90 days, Custom. Day
  boundaries follow UB time.

### Ids, masks, references

- Ids are monospace and truncated in the middle (keep the prefix and the last
  4 characters). The full id is in the tooltip and copied by the copy button.
- Card mask: `•••• 4242` plus the bank name when it is known (`Khan Bank`) and
  the expiry `09/28`. Never show more digits than the provider gave.
- `reference` and `customerRef` are shown verbatim, truncated with an ellipsis
  at 32 characters, and copyable.

---

## 6. Table column specifications

These rules apply to every list:

- Default sort is newest first. Only the columns listed below as sortable can
  be sorted.
- Pagination is cursor based, 50 rows per page, with `← Newer` / `Older →`
  and a line such as "Showing 50 of 1,284". Show a count only if it is cheap
  to get (D1 `COUNT` with the same filter). Otherwise show "50+".
- Clicking a row opens its detail page. Cmd/Ctrl-click opens a new tab (the
  row uses a real `<a>`).
- A `⋯` column holds row actions (copy id, and the resource's own actions).
- Hide the **Project** column when the scope is a single project.

### Payments (invoices): `/admin/payments`

Count tiles above the table: All · Paid · Pending · Expired · Failed.

| # | Column | Content | Width | Align | Sort | Mobile |
|---|---|---|---|---|---|---|
| 1 | Amount | `Money` | 120 | right | ✓ | line 1, left, bold |
| 2 | Status | `StatusBadge` | 110 | left | | line 1, right |
| 3 | Provider | provider tag (`QPay`, `Bonum · Card`) | 120 | left | | hidden |
| 4 | Reference | project `reference` (mono, truncated) | flex | left | | line 2 |
| 5 | Description | muted, truncated | flex | left | | hidden |
| 6 | Project | project name | 140 | left | | hidden |
| 7 | Created | `Time` | 130 | right | ✓ | line 3, muted |
| 8 | Paid / Expires | paid time, or "expires in 12 min" when pending | 130 | right | | hidden |
| 9 | ⋯ | Copy id · Copy reference · Open event log | 40 | | | hidden |

Filters: Status, Provider (QPay / Bonum), Date, Project, Amount (min–max).

### Subscriptions: `/admin/subscriptions`

Count tiles: All · Active · Payment failed · Awaiting card · Cancelled.

| # | Column | Content | Width | Align | Sort | Mobile |
|---|---|---|---|---|---|---|
| 1 | Customer | `customerRef` (mono), with the email under it in muted text when present | flex | left | | line 1 |
| 2 | Status | badge | 130 | left | | line 1, right |
| 3 | Plan | plan key + `₮49,000 / month` muted | 180 | left | | line 2 |
| 4 | Card | `•••• 4242` | 100 | left | | hidden |
| 5 | Next bill | future `Time`, or `—` when cancelled | 130 | right | ✓ | line 3 |
| 6 | Project | name | 140 | left | | hidden |
| 7 | Started | `Time` | 130 | right | ✓ | hidden |
| 8 | ⋯ | Copy id · Cancel… | 40 | | | hidden |

Filters: Status, Plan, Project, Next bill (range).

### Charges: `/admin/charges`

Count tiles: All · Succeeded · Processing · Failed · Reversed.

| # | Column | Content | Width | Align | Sort | Mobile |
|---|---|---|---|---|---|---|
| 1 | Amount | `Money` (struck through when reversed) | 120 | right | ✓ | line 1 |
| 2 | Status | badge | 120 | left | | line 1, right |
| 3 | Reference | mono | flex | left | | line 2 |
| 4 | Card | `•••• 4242` | 100 | left | | hidden |
| 5 | Subscription | `IdChip` link, or `—` for a bare card | 150 | left | | hidden |
| 6 | Project | name | 140 | left | | hidden |
| 7 | Created | `Time` | 130 | right | ✓ | line 3 |
| 8 | ⋯ | Copy id · Reverse… (only when succeeded) | 40 | | | hidden |

### Events: `/admin/events`

Count tiles: All · Delivered · Retrying · Failed.

| # | Column | Content | Width | Align | Sort | Mobile |
|---|---|---|---|---|---|---|
| 1 | Type | event type (mono, tinted) | 220 | left | | line 1 |
| 2 | Delivery | badge + `3 attempts` muted | 150 | left | | line 1, right |
| 3 | Subject | `IdChip` of the invoice/subscription/charge | 170 | left | | line 2 |
| 4 | Amount | `Money` or `—` | 110 | right | | hidden |
| 5 | Last response | `200` / `500` / `timeout` in mono, tinted by class | 110 | left | | hidden |
| 6 | Next retry | future `Time` or `—` | 120 | right | | hidden |
| 7 | Project | name | 140 | left | | hidden |
| 8 | Created | `Time` | 130 | right | ✓ | line 3 |
| 9 | ⋯ | Copy id · Re-deliver | 40 | | | hidden |

Filters: Delivery status, Type (multi-select, grouped by prefix), Project,
Date. **Bulk action:** checkbox column, shown only when the Retrying or Failed
tile is selected → `Re-deliver selected (n)`.

### Projects: `/admin/projects`

| Column | Content |
|---|---|
| Name | name + slug muted |
| API key | `bgk_…a1B2` mono + "last used 3 min ago" (only if tracked cheaply; otherwise omit) |
| Webhook | host of the URL (`nomad.example`), or a warning "Not set" |
| Delivery health (7d) | `99.2%` delivered, tinted: ≥ 99 success, ≥ 95 warning, below that danger |
| Plans | count + a danger dot if any plan is in mismatch |
| Created | `Time` |

### Usage: `/admin/usage`

A month picker (`‹ September 2026 ›`) above the table. It has one row per
project and a total row at the bottom (sticky, bold).

| Column | Content |
|---|---|
| Project | name |
| Payments | count of ledger rows for the month (tabular) |
| Volume | `Money` |
| Invoices / Subscriptions renewals / Charges | counts split by kind |
| Events sent | count |
| vs last month | `+12%` / `−4%` in muted text. It is not tinted, because more volume isn't "good" to the gateway |

---

## 7. Pages

### 7.1 Login: `/admin/login`

- A centred card 360px wide on a `--bg-subtle` page. It holds the instance
  hostname as the title, one **Password** field (with a show/hide eye), and a
  full-width **Sign in** button.
- Errors appear inline under the field: "Wrong password." After the rate
  limit: "Too many attempts. Try again in 5 min." (show the real wait time).
- If Cloudflare Access is configured, the route redirects to `/admin`, because
  Access handles auth.
- If neither method is configured, the Worker serves a 503. Its page shows a
  plain "Not configured" screen: "Set `ADMIN_PASSWORD` or Cloudflare Access to
  open the dashboard", with a link to the README. It never shows a form.
- The EnvBanner shows here too, so nobody signs in to sandbox by mistake.
- Session: 12h. When it expires, a toast says "Signed out: session expired"
  and the page returns to login with `?next=` kept.

### 7.2 Overview: `/admin`

Layout, top to bottom:

1. **PageHeader:** "Overview". On the right: a period segmented control
   (`7d · 30d · 90d`, default 30d). The scope comes from the project switcher.
2. **Needs attention.** A card list shown **only when something needs
   attention**. Otherwise one quiet line: "✓ Nothing needs attention". Each
   row has a tone icon, a sentence, a count and a link:
   - "**4** webhook deliveries are failing for **Nomad Coffee**" → `/admin/events?status=retrying,failed&project=…`
   - "**2** subscriptions have a failed payment" → subscriptions filtered
   - "**1** plan doesn't match Bonum (`pro_monthly`)" → project Plans tab
   - "**QPay** is not configured" (warning; only when a project has used it or has a plan for it)
   - "**Sandbox**: Bonum is using sandbox credentials" (only in the mixed case; see §11)
   Rows are ordered danger → warning.
3. **KPI row.** 4 equal cards (on mobile: a 2×2 grid, and 1 column under
   360px):
   - **Volume**: `₮12.4M` (paid invoices + succeeded charges + renewals −
     reversals), a delta vs the previous period in muted text, and a sparkline.
   - **Payments**: count of successful payments.
   - **Success rate**: `paid / (paid + failed + expired)` for finished
     invoices and charges, as `92.4%`. The tooltip explains the formula and
     that pending is excluded.
   - **Active subscriptions**: count, with "+3 / −1 this period" in muted text.

   Each card: label 12px muted, value `--text-2xl` tabular, footer 12px. No
   icons.
4. **Volume chart.** One card, full width. Daily bars for the period, days in
   UB time, in a single accent colour. The tooltip shows date, volume and
   count. Hand-drawn SVG, no chart library. Fixed height 180px.
5. **Two columns** (stacked on mobile):
   - **Recent activity** (left, 2/3): the last 10 events across the scope in a
     compact timeline, each with type, subject, amount, time and delivery
     badge. Link: "View all events →".
   - **Delivery health** (right, 1/3): one row per project with the 7-day
     delivered % and a small bar, the last failure time, and its webhook host.

Empty (a fresh deploy with no projects): replace everything below the header
with a **Setup checklist** card:
① Providers configured (from Settings)
② Create a project
③ Set webhook URL
④ Add a plan (if subscriptions are used)
⑤ Make a test payment in sandbox.
Each item is a ✓ or ○ with a link. This follows the Clerk and fal
empty-dashboard patterns.

### 7.3 Payment (invoice) detail: `/admin/payments/[id]`

**Header block** (full width):

```
PAYMENT · QPay                                   [Copy id] [⋯]
₮49,000 MNT   [✓ Paid]
Nomad Coffee · ref sub-renew-8841 · "Pro plan, October"
```

- The eyebrow line has the resource type and provider tag.
- Amount at `--text-2xl` weight 600, then the badge.
- A muted line: project · reference · description.
- The `⋯` menu holds Copy id, Copy reference, Open raw JSON, and "Check with
  provider" (QPay only: runs the payment-check API, **if** the server exposes
  it; otherwise leave it out).

**Main column:**

1. **Timeline** card. It merges three sources, newest first by default, with
   an "Oldest first" toggle:
   - **Gateway** (glyph ● accent): created, sent to the provider, swept at
     expiry ("Expiry sweep: QPay says unpaid → expired").
   - **Provider** (glyph ⇣ neutral, secondary text "from QPay" or "from
     Bonum"): callback received, checksum verified, payment ref
     `QP-88123…`, method.
   - **Emitted events** (glyph ⇡ in the event type's tone): `invoice.paid` →
     the event id with its delivery badge inline ("Delivered · 200 · 1 attempt").
     Clicking it goes to the event detail.

   Each item shows the title, a secondary line, and the absolute time on the
   right with the relative time under it.
   *Data note:* provider items come from `ledger` rows and invoice state
   changes. The contracts forbid storing full provider bodies, so the timeline
   shows **only summaries** (type, provider ref, method, our ids). It has no
   payload viewer for provider callbacks. If failed callbacks (rows that never
   reach the ledger) must appear, the schema needs a small `activity` table
   (`subject_id, source, kind, summary, at`). Flag this to the builder.
2. **Events** card: a small table of the events emitted for this invoice
   (type, delivery badge, attempts, created). Each row links to the event.

**Side column** (`KeyValueList` cards):

- **Details:** Invoice id (IdChip), Provider invoice id (IdChip), Status,
  Created, Paid at / Expires at, Swept at (if any), Return URL (truncated
  link).
- **Customer:** customerRef or `—`. The gateway knows no names.
- **Payment method** (once paid): method (`QPay · Khan Bank app`, `Card •••• 4242`).
- **Project:** name → link, and the webhook host.

A pending QPay invoice gets an extra **QR preview** card (the QR image at
160px plus "Open checkout page ↗" when `/pay/[id]` exists). This helps support
staff reproduce what the customer sees.

### 7.4 Subscription detail: `/admin/subscriptions/[id]`

**Header:**

```
SUBSCRIPTION · Bonum
cust_8841 (ops@acme.mn)   [✓ Active]
pro_monthly · ₮49,000 / month · Nomad Coffee         [Cancel subscription…]
```

The Cancel button uses the secondary style with danger text. The danger fill
is kept for the confirmation dialog. The button is hidden once the
subscription is cancelled.

**Main column:**

1. **Summary strip** (3 inline stats): Next bill (`25 Oct 2026`, with "in 30
   days" muted), Last payment (`₮49,000 · 25 Sep`), Started (`25 Jun 2026`).
   For `past_due`, a warning Callout replaces the strip's first stat: "Last
   renewal failed on 25 Sep. Bonum will retry; the project was sent
   `subscription.payment_failed`."
2. **Payments** table: each renewal or first charge, with amount, status,
   period (`25 Sep – 25 Oct`), Bonum invoice id and time. Newest first.
3. **Timeline:** the same three-source timeline as §7.3 (activated, renewed,
   payment_failed, card_changed, cancelled/UNSUBSCRIBED with a reason).

**Side column:**

- **Card on file:** `•••• 4242`, bank, expiry `09/28`. A warning tag shows
  when the card expires before the next bill.
- **Card history:** a compact list, newest first: `•••• 4242 · since 12 Aug`,
  `•••• 1881 · 25 Jun – 12 Aug (replaced)`. It comes from
  `subscription.card_changed` events and card rows.
- **Details:** Subscription id, Bonum subscription id, Plan (links to the
  project's Plans tab), Project, customerRef, email.

### 7.5 Charge detail: `/admin/charges/[id]`

The header is like a payment's: `CHARGE · Bonum saved card`, the amount, a
badge, and **[Reverse charge…]** (only when `succeeded`).

- Main column: a timeline (requested → queued (`TOKEN-PAYMENT` awaited) →
  succeeded/failed → reversed), then an Events card.
- Side column: Details (Charge id, Bonum transaction id, reference, created,
  settled), Card (`•••• 4242`, a link to its subscription if it has one),
  Project.
- A reversed charge shows a muted Callout at the top: "Reversed on 26 Sep,
  14:02. −₮49,000 returned to the card."

### 7.6 Events list and detail

The list is specified in §6. The **event detail** at `/admin/events/[id]` is a
split layout modelled on Resend's webhook page and Hashnode's webhook history:

```
invoice.paid                                         [Re-deliver]
01J8…Q3ZK · Nomad Coffee · subject 01J8…A1B2 · 25 Sep 2026, 14:05:32
┌ Deliveries (left, 320px) ─────┐ ┌ Selected attempt (right) ────────────────┐
│ ● #3  200  1.2s   14:35:02    │ │ Attempt #3 · [✓ Delivered] · 200 OK      │
│ ● #2  500  0.8s   14:10:01    │ │ URL  https://nomad.example/hooks/bogts    │
│ ● #1  timeout 10s 14:05:33    │ │ Duration 1.2s · Next retry —             │
└───────────────────────────────┘ │ Request headers (Bogts-Signature …)     │
                                  │ Request body     [JsonViewer]            │
                                  │ Response body    [first 2 KB, JsonViewer]│
                                  └──────────────────────────────────────────┘
```

- **Payload** (our event JSON) is always shown. It is ours to show, and it
  holds no secrets.
- The signature header is shown with the `v1=` value truncated in the middle
  and a Copy button, so project developers can debug verification.
- Store response bodies capped at 2 KB and show them as text. Say "(truncated)"
  when they were cut.
- Error class under the status: `timeout`, `connection refused`, `DNS`,
  `TLS`, `HTTP 4xx`, `HTTP 5xx`. That tells the operator what to fix.
- Retry schedule line: "Retrying with backoff for up to 3 days. Next attempt
  in 14 min (#4)." After it gives up: "Gave up after 3 days (18 attempts)."
- Mobile: the deliveries list sits on top and the selected attempt below it.
  Tapping an attempt scrolls to its panel.

### 7.7 Projects

**List** (§6), with **[+ New project]** in the header.

**Create** (`/admin/projects/new`): a single-column form 560px wide:
- Name (required).
- Webhook URL (optional now, but a warning follows until it is set). It must
  be `https://`; `http://localhost…` is allowed only in sandbox.

Submitting opens the **reveal-once modal** (§9.1) showing **both** the API key
and the signing secret. Closing it lands on the project page.

**Project page** (`/admin/projects/[id]`): the header shows the name, and the
tabs are **General · API key · Webhook · Plans**.

- **General:** name (inline edit), id (IdChip), created, and a small
  "Integration" card with copyable values: base URL
  `<PUBLIC_ORIGIN>/v1` and a 3-line `curl` example using
  `$BOGTS_API_KEY`, never the real key. The danger zone at the bottom has
  "Delete project" (typed confirmation). Deletion is disabled with an
  explanation while the project has active subscriptions.
- **API key:** one row showing `bgk_••••••••a1B2`, created, and "last used" if
  it is tracked. The **Rotate key…** button opens a confirm dialog (typed
  project name). The current key keeps working for 24 h after the rotation;
  the dialog says so. If an older key is still inside its 24 h, the dialog
  says that one (by prefix) stops working at once. While the old key works,
  the tab shows "Previous key: valid until …". After rotating, the reveal-once
  modal appears.
- **Webhook:**
  - URL field with Save. A **Send test event** button (optional, cheap)
    posts a signed `ping` and shows the result inline (status, time,
    response).
  - Signing secret: `bgwh_••••••••Zx9Q` with **Rotate secret…** (same
    pattern as the API key).
  - Recent deliveries: the last 10 delivery rows for this project, plus the
    7-day health figure.
- **Plans:** a table with Key (mono), Provider, Bonum plan id, Amount,
  Interval, Validation badge, and a `⋯` menu (Edit, Re-check, Delete).
  - **[+ Add plan]** opens a side sheet (Vercel-style drawer, 480px wide) with
    key, provider, Bonum plan id, amount (₮ prefix inside the field, integer
    only, thousands separators added as you type) and interval
    (month/year).
  - Saving runs validation against Bonum. The sheet shows a spinner that says
    "Checking with Bonum…", then either "✓ Matches Bonum plan 166
    (₮49,000 / month)" or a danger Callout with a diff table:
    `Amount  ours ₮49,000 · Bonum ₮45,000`. The plan is saved with the
    `mismatch` status, and new checkouts for it are blocked. Say so in the
    Callout.
  - Environment note above the table: "Plans are checked against **Bonum
    sandbox**", matching the current environment. Plans are per-environment
    (decision #12).

### 7.8 Usage: `/admin/usage`

Specified in §6: a month picker, the table and a total row. Under it, one
line in muted text: "Counts come from the ledger. Each provider payment
counts once." No charts in v1.

### 7.9 Settings / health: `/admin/settings`

Read-only, except the theme toggle. Sections are cards 720px wide:

1. **Providers.** One row per provider (Bonum, QPay): the name, a status badge
   (Configured / Incomplete / Off), an environment badge (Sandbox /
   Production), and a disclosure listing its **secret names** with ✓/✕, never
   their values: `BONUM_APP_SECRET ✓`, `BONUM_TERMINAL_ID ✓`,
   `BONUM_CHECKSUM_KEY ✕`. An Incomplete provider gets a Callout: "Bonum is
   switched off until all 4 secrets are set. Add them with `wrangler secret
   put` or in the Cloudflare dashboard, then redeploy."
2. **Callback URLs to register.** Copyable rows:
   `https://<host>/hooks/bonum` with the hint "Paste into Bonum merchant portal
   → Webhook". The QPay callback is per invoice and needs no setup, so say
   that instead.
3. **Security:** auth mode (`Cloudflare Access` or `Admin password`), with
   ✓/✕ rows for `ENCRYPTION_KEY` (valid length) and `ADMIN_PASSWORD`.
4. **Background jobs:** the last cron run (`2 min ago`, relative with a UB
   tooltip), deliveries due now, and the last expiry sweep. When the last cron
   run is more than 5 min old, show a warning ("Cron hasn't run for 12 min;
   check the Worker's triggers"). This needs a heartbeat row, which is cheap:
   one D1 upsert per cron run.
5. **About:** version (git sha), a link to the docs, the licence.
6. **Appearance:** theme System / Light / Dark (saved in `localStorage`).

---

## 8. Empty, loading and error states

| Where | Empty | Loading | Error |
|---|---|---|---|
| Any list, no data ever | `EmptyState`: icon, "No payments yet", "Payments appear here when a project creates an invoice.", link "API docs ↗" | 8 skeleton rows at real row height; the header stays real | Inline Callout (danger) in place of the table: "Couldn't load payments. [Retry]", with the request id in muted text |
| Any list, filters give 0 | "No payments match these filters." + [Clear filters] | | |
| Events list, all delivered | Retrying/Failed tile: "✓ No failing deliveries" | | |
| Overview, fresh install | Setup checklist (§7.2) | KPI values as skeleton bars; the chart as a flat grey block | Each card fails on its own with "—" and a retry icon. One slow query never blanks the page |
| Detail page, bad id | Full-page "Not found": "No payment with id `01J8…`. It may belong to another deployment." [Back to payments] | Skeleton header + 2 cards | |
| Project without webhook URL | Warning Callout on the project page and in Needs attention: "Events are being stored but not sent: no webhook URL." | | |
| Plans tab, none | "No plans. Add one to sell subscriptions." [+ Add plan] | | |

Rules:
- Load data in SvelteKit `load` on the server, so there are no spinners on
  first paint. Skeletons appear only for navigation that takes longer than
  300ms (use `navigating`).
- Mutations: the button shows an inline spinner and the label changes
  (`Re-delivering…`). The rest of the page stays interactive. On success,
  show a toast and refresh the affected data (`invalidate`). On failure,
  show a toast with the API error `message`, which is always safe to show
  (contracts).
- The re-deliver buttons in a delivery panel use optimistic UI: a new attempt
  row appears as "Queued" straight away.

---

## 9. Key interactions

### 9.1 Reveal-once secret modal

This follows the pattern shared by Vercel, ElevenLabs, StackAI, Gamma and
Buffer:

```
┌───────────────────────────────────────────────┐
│ Save these secrets now                     ✕  │
│ ⚠ You won't be able to see them again. If you │
│   lose them, rotate to get new ones.          │
│                                               │
│ API key                                       │
│ [bgk_7Hq…full value…………………………] [Copy]        │
│ Webhook signing secret                        │
│ [bgwh_…full value…………………………] [Copy]        │
│                                               │
│ Set on the project as BOGTS_API_KEY and       │
│ BOGTS_WEBHOOK_SECRET.           [Copy as .env]│
│                                               │
│ ☐ I've saved these somewhere safe             │
│                       [Done] (disabled until ☑)│
└───────────────────────────────────────────────┘
```

- The values are shown in full, in monospace, in a read-only input that
  selects everything when focused.
- **Copy as .env** copies both lines.
- Esc, the ✕ and clicking the backdrop are **disabled** until the checkbox is
  ticked. Only one exit exists.
- The server returns the plaintext only in the response to the
  create/rotate action. It is never in page data that could be reloaded.
  Reloading the page shows the masked value.
- For a rotation, the modal shows only the rotated secret.

### 9.2 Typed confirmation for destructive actions

Use this for **Cancel subscription**, **Reverse charge**, **Rotate API key**,
**Rotate signing secret** and **Delete project**. It follows the Cloudflare
Workers, Clerk and Resend delete dialogs.

```
Cancel subscription                                   ✕
This stops future renewals for cust_8841 on Bonum. The
customer keeps nothing extra: the project decides access.
Nomad Coffee will receive subscription.cancelled.

Type  cust_8841  [copy] to confirm
[                                   ]
                          [Keep subscription] [Cancel subscription]
```

- **What to type:** the subscription's `customerRef` for a cancel, the
  **amount without the sign** (`49000`) for a reversal, the project name for
  a rotate or delete. Paste is allowed. The target value has a copy button
  (Cloudflare pattern). The real friction is reading the consequences.
- The danger button stays disabled until the text matches exactly (trimmed).
  The cancel button is labelled with the safe outcome ("Keep subscription"),
  never a bare "Cancel", which would be ambiguous here.
- The body text always says: what happens at the provider, which event the
  project will receive, and whether it can be undone. Reversals: "Refunds
  ₮49,000 to •••• 4242. Can't be undone. Nomad Coffee will receive
  `charge.reversed`."
- A provider error keeps the dialog open with an inline danger Callout, so
  the operator can retry or back out.

### 9.3 Re-deliver

- This is a button on the event detail header, a row action in the Events
  list, and a bulk action for selected rows.
- No confirmation, because re-delivery is safe: projects dedupe by
  `event.id`. The button's tooltip says so ("Projects process each event.id
  once").
- It creates a new attempt now (in `waitUntil`), outside the backoff
  schedule, and appends it to the attempt list. After a success, the backoff
  sequence for that delivery stops.
- The bulk version shows progress in a toast ("Re-delivering 12 events…
  9 delivered, 3 failed") and doesn't block the UI.

### 9.4 Copy

- Every id, reference, URL, secret and JSON block can be copied. The icon
  sits at the right edge and appears on row hover or focus on desktop. It is
  always visible on touch.
- Copy uses the whole value, never the truncated display.

### 9.5 Project switcher

- The trigger in the sidebar opens a popover with a filter input, "All
  projects" first, then the projects A–Z. Each shows a small health dot
  (danger if deliveries are failing).
- Changing it keeps the current page and swaps the `?project=` param. On a
  detail page of another project, it jumps to that list.

---

## 10. Responsive behaviour (down to 360px)

| Breakpoint | Layout |
|---|---|
| ≥ 1200 | Sidebar 240px + content. The detail side column is 320px. |
| 960–1199 | The sidebar collapses to 56px icons with tooltips (toggle with `[`). The detail side column stays. |
| 640–959 | The sidebar becomes a drawer (hamburger in the top bar). The detail page stacks, with the side column's cards **above** the timeline (details matter more on small screens). Tables drop the columns marked "hidden" in §6. |
| < 640 | **Tables become stacked rows** (the Stripe mobile pattern): each row is a 3-line block, laid out as in the Mobile column of §6. The whole block is the link. Count tiles become a horizontally scrollable segmented row. FilterBar collapses to one "Filters (2)" button that opens a bottom sheet. KPI cards go 2×2. Modals become full-width bottom sheets. Page padding is 16px. |
| 360 | The minimum supported width. Nothing scrolls sideways except JsonViewer (it scrolls inside its own box) and the count-tile row. Buttons in headers become one primary + `⋯`. |

- Touch targets are at least 40px (44px on public pages).
- Tables use real `<table>` elements on desktop. Under 640px, render a `<ul>`
  of links instead. Two markups are clearer than CSS-only reflow for screen
  readers.
- Right-aligned money stays right-aligned in the stacked layout too (line 1:
  amount left and bold, badge right).

---

## 11. Sandbox / environment banner

- Each provider has its own environment (`BONUM_ENVIRONMENT`,
  `QPAY_ENVIRONMENT`). Work out a single **deployment mode**:
  - all enabled providers are `production` → **Production**, with no banner;
  - all are `sandbox` → **Sandbox**, with a banner;
  - mixed → **Mixed**, with a banner that names each provider.
- **Banner:** a full-width strip 32px high, `--sandbox-bg` (amber) with
  `--sandbox-fg` text, centred, not dismissible, sticky at the top above the
  sidebar and content. Examples:
  - "**Sandbox**: Bonum and QPay are using test credentials. No real money moves."
  - "**Mixed**: Bonum sandbox · QPay production. QPay payments are real."
- Also:
  - a 2px amber inset border around the whole viewport in sandbox, so it is
    still visible when the banner has scrolled away on mobile;
  - the tab title is prefixed `[Sandbox]`;
  - the favicon gets an amber dot;
  - each list row whose provider is in sandbox (only in the mixed case) gets a
    tiny `TEST` tag after the provider tag, as Hashnode does.
- Production has no banner. The sidebar footer says `Production` in muted
  text. Calm is the default. Stripe's "Test mode" toggle doesn't apply: the
  environment is fixed per deploy, so it is a read-only fact, not a switch.

---

## 12. Keyboard shortcuts (cheap ones only)

| Keys | Action |
|---|---|
| `/` | Focus global search |
| `g` then `o p s c e j u ,` | Go to Overview / Payments / Subscriptions / Charges / Events / Projects / Usage / Settings |
| `j` / `k` | Move the row focus down/up in a list |
| `Enter` | Open the focused row |
| `c` | Copy the id of the focused row, or of the current detail page |
| `[` | Toggle the collapsed sidebar |
| `?` | Shortcut help modal |
| `Esc` | Close the modal or sheet, or clear the search |

- Shortcuts don't fire while focus is in an input.
- Show the hint in tooltips (`Payments  G P`), as Linear does.
- There are no shortcuts for destructive actions.

---

## 13. Accessibility

- Aim for WCAG 2.2 AA. Every text/background token pair below meets 4.5:1
  (checked at design time, and to be re-checked in the build with an axe run
  in CI).
- Status is never conveyed by colour alone. Each status has a glyph and a
  text label (Carbon status-indicator guidance, Primer SC 1.4.1).
- `StatusBadge` is plain text (no `role="img"`), and its glyph is
  `aria-hidden`.
- Tables have a `<caption>` (visually hidden) such as "Payments, newest
  first, filtered by status Paid", and `aria-sort` on sortable headers.
- Focus: 2px `--focus-ring` outline with a 2px offset on every interactive
  element. Never remove the outline without replacing it.
- Modals: `role="dialog"`, `aria-modal`, labelled by the title. Focus goes to
  the first field, or to the safe button in a ConfirmDialog. Focus returns to
  the trigger on close.
- Toasts and "Copied" go through a single `aria-live="polite"` region.
  Errors use `role="alert"`.
- `Time` elements have `datetime`, and the tooltip text is also the `title`
  / `aria-label` so screen readers get the absolute time.
- Money is read correctly: `₮12,500` is read as "12,500 tugrik" through
  `aria-label` on the `Money` component, because the ₮ sign isn't voiced
  reliably.
- Respect `prefers-reduced-motion` (no shimmer, no toast slide) and
  `prefers-color-scheme`.
- The public pages set `lang` (`en` now, `mn` later) and have a 44px minimum
  tap size.

---

## 14. Public pages

These are minimal, have no admin chrome, work without JavaScript where
possible, and load in under 50 KB (plus the self-hosted fonts). The header
carries the payee's brand: the project's display name and logo, else the
company's (Settings → Branding), else the project name. They speak Mongolian
by default, plus English, French, Russian, Simplified Chinese and Spanish
(see §15a).

### 14.1 QPay checkout: `/pay/[invoiceId]`

This page is for projects that want a hosted QR page instead of rendering
`qr` themselves.

```
        Nomad Coffee
        ₮49,000
        Pro plan, October

     ┌───────────────┐
     │   [QR 240px]  │     ← white tile, even in dark mode
     └───────────────┘
   Scan with any bank app

   ── or open your bank app ──
   [Khan] [Golomt] [TDB] [State] [Xac] …   ← deeplink grid, 4 per row, 56px tiles with the bank name
                                            (shown first on mobile, where scanning your own screen is impossible)

   ◷ Waiting for payment…   expires in 14:32
   [I've paid: check now]

   Secured by Bogts · Invoice …Q3ZK
```

- On mobile (under 640px) **the deeplink grid comes first** and the QR sits
  behind a disclosure: "Show QR to scan from another phone".
- The page polls `GET` status every 3s for up to the expiry, backing off
  after 2 min. On `paid`, it swaps to the success state (§14.2) and redirects
  to `returnUrl`.
- **Expired:** "This payment link has expired. Go back to Nomad Coffee to start
  again." with a [Back] button if `returnUrl` is set.
- The "check now" button runs the QPay payment-check. Rate-limit it to once
  every 5s and give feedback ("Not received yet").
- Sandbox: the same amber strip at the top: "Test payment: no real money".

### 14.2 Return page: `/return/[invoiceId]`

Based on the Stripe-hosted return used by Bonsai and Midday.

- **Paid:** a check icon, "Payment complete", `₮49,000 to Nomad Coffee`, then
  "Returning you to Nomad Coffee…" with a spinner. It auto-redirects after 2s. A
  manual link "Return now" is always visible, because the auto-redirect is
  not guaranteed (no-JS fallback: `<meta http-equiv="refresh" content="2;url=…">`).
- **Still processing** (the Bonum callback hasn't arrived yet): "Confirming
  your payment…". Poll for up to 30s, then show "This is taking longer than
  usual. You can safely return; Nomad Coffee will be notified when it completes."
  with a [Return to Nomad Coffee] link.
- **Failed / cancelled:** "Payment didn't go through", a one-line reason if
  it is safe to show, and [Return to Nomad Coffee].
- Only redirect to the invoice's stored `returnUrl`. Never take the target
  from a query param (open-redirect guard).

---

## 15. i18n

- All strings live in `lib/i18n/en.ts` as flat keys: `payments.title`,
  `status.invoice.paid`, `confirm.cancelSubscription.body`. A later `mn.ts`
  mirrors it.
- Use ICU-style placeholders (`{amount}`, `{project}`). Never build sentences
  by joining strings. Use `Intl.PluralRules` for counts
  ("1 attempt" / "3 attempts").
- Status DB values never appear in the UI. Always map them through
  `status.<resource>.<value>`.
- Event types (`invoice.paid`) and ids stay untranslated: they are API
  identifiers.
- Leave 30% slack in buttons, badges and tiles. Badges have `white-space:
  nowrap` and a minimum width, not a fixed one.
- Geologica and Piazzolla (self-hosted, §16a) cover Cyrillic (and Mongolian Cyrillic `Ө ө Ү ү`)
  on every platform.

---

## 15a. Public page languages (as built)

The dashboard is English only. `/pay`, `/return` and the public error pages
pick a language in this order: `?lang=` (the picker; remembered in the
`bogts_lang` cookie), that cookie, Cloudflare's `cf.country === 'MN'` (most
Mongolian phones are set to English), `Accept-Language`, then Mongolian.
Strings live in `src/lib/i18n/public/<lang>.ts`; `mn.ts` defines the key set
and the others are typed against it. Mongolian copy avoids case endings on
the brand name (`{name}`), so sentences read correctly for any name.

## 16a. Identity and branding (as built, supersedes parts of §16)

- **Type:** Geologica for the interface, Piazzolla for money and titles
  (the "coin face"). Both are OFL, self-hosted in `static/fonts` (no
  third-party requests, CSP unchanged) and split by unicode-range.
- **Accent:** Settings → Branding sets one colour. `lib/brand.ts` derives
  light and dark variants and checks them for AA (fill 3:1 against the card,
  label and link text 4.5:1), rendered as `--brand-*-l/-d` on `:root` and
  mapped in `app.css`. Without one, Bogts' own оюу turquoise `#0e7c7b`.
  Use `--accent` for fills and `--accent-text` for text.
- **Mark:** the Bogts coin pouch (`components/brand/BogtsMark.svelte`), shown
  whenever no company logo is set. Brass (`--brass`) is reserved for the
  coin: the mark and the paid moment.
- **Logos:** PNG, SVG or WebP, at most 256 KB, stored in D1 (`brand_logo`,
  content-addressed) and served from `/brand/logo/<sha256>` with a year-long
  immutable cache. SVG is sanitised on upload and served sandboxed.
- **Ornament:** a key-fret (хээ) edge on the public pages and the login card.
  One motif, used only there.
- **Bank logos:** the public pay page shows QPay's own bank logos; `img-src`
  allows exactly `https://qpay.mn` and `https://s3.qpay.mn`, and a logo that
  fails to load falls back to the bank's initial.

## 16. Design tokens

A system font stack means no network fetch, it is fast inside the Worker, and
it covers Cyrillic. The theme follows `prefers-color-scheme`, and
`data-theme` overrides it.

```css
:root {
  /* ── Type ─────────────────────────────────────────── */
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
               "Helvetica Neue", Arial, "Noto Sans", sans-serif,
               "Apple Color Emoji", "Segoe UI Emoji";
  --font-mono: ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono",
               Menlo, Consolas, "Liberation Mono", monospace;

  --text-xs:   12px;  --lh-xs:  16px;   /* badges, table meta, labels   */
  --text-sm:   13px;  --lh-sm:  20px;   /* table cells, sidebar          */
  --text-md:   14px;  --lh-md:  22px;   /* body, inputs, buttons         */
  --text-lg:   16px;  --lh-lg:  24px;   /* card titles                   */
  --text-xl:   20px;  --lh-xl:  28px;   /* page titles                   */
  --text-2xl:  28px;  --lh-2xl: 36px;   /* detail amount, KPI value      */
  --weight-regular: 400;
  --weight-medium:  500;
  --weight-semibold: 600;
  --tracking-tight: -0.01em;            /* for 20px and up only          */

  /* ── Spacing (4px base) ───────────────────────────── */
  --space-0: 0;     --space-1: 4px;   --space-2: 8px;   --space-3: 12px;
  --space-4: 16px;  --space-5: 20px;  --space-6: 24px;  --space-8: 32px;
  --space-10: 40px; --space-12: 48px; --space-16: 64px;

  /* ── Radii ────────────────────────────────────────── */
  --radius-sm: 4px;    /* badges, tags, chips  */
  --radius-md: 6px;    /* inputs, buttons      */
  --radius-lg: 8px;    /* cards, table wrapper */
  --radius-xl: 12px;   /* modals, sheets       */
  --radius-full: 999px;

  /* ── Sizes ────────────────────────────────────────── */
  --sidebar-w: 240px;  --sidebar-w-collapsed: 56px;
  --topbar-h: 48px;    --banner-h: 32px;
  --row-h: 40px;       --row-h-compact: 36px;
  --control-h: 32px;   --control-h-lg: 40px;
  --detail-aside-w: 320px;

  /* ── Motion ───────────────────────────────────────── */
  --ease: cubic-bezier(0.2, 0, 0, 1);
  --dur-fast: 120ms;  --dur-base: 180ms;

  /* ── Colour: light ────────────────────────────────── */
  --bg:          #ffffff;
  --bg-subtle:   #f7f7f8;   /* page behind cards, sidebar, hover */
  --bg-muted:    #efeff1;   /* selected row, pressed             */
  --bg-inset:    #f3f3f5;   /* code / JSON blocks                */
  --border:      #e4e4e7;
  --border-strong: #d4d4d8;
  --fg:          #18181b;   /* 17.4:1 on --bg */
  --fg-muted:    #52525b;   /*  7.7:1 */
  --fg-subtle:   #71717a;   /*  4.8:1, the minimum for text */
  --fg-on-accent: #ffffff;

  --accent:        #3451d1;  /* links, primary button, chart bars */
  --accent-hover:  #2a43b3;
  --accent-subtle: #eef1fc;
  --focus-ring:    #3451d1;

  --success-fg: #1a7f37;  --success-bg: #e8f5ec;  --success-border: #b7e0c3;
  --warning-fg: #9a5b00;  --warning-bg: #fdf3e1;  --warning-border: #f1d49b;
  --danger-fg:  #c4251c;  --danger-bg:  #fdecea;  --danger-border:  #f5c0bb;
  --info-fg:    #1f5fbf;  --info-bg:    #e9f1fd;  --info-border:    #bcd3f5;
  --neutral-fg: #3f3f46;  --neutral-bg: #f1f1f3;  --neutral-border: #dcdce0;

  --danger-solid: #d1242f;  --danger-solid-hover: #b31d27;  /* destructive button fill */

  --sandbox-bg: #f5a524;  --sandbox-fg: #2b1a00;  /* banner strip, 9.6:1 */

  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 12px rgb(0 0 0 / 0.08), 0 1px 3px rgb(0 0 0 / 0.06);
  --shadow-lg: 0 16px 40px rgb(0 0 0 / 0.16);
  --overlay:   rgb(9 9 11 / 0.45);

  color-scheme: light;
}

/* ── Colour: dark ───────────────────────────────────── */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* same block as [data-theme="dark"] */ }
}
:root[data-theme="dark"] {
  --bg:          #0f0f11;
  --bg-subtle:   #151518;
  --bg-muted:    #1f1f23;
  --bg-inset:    #18181b;
  --border:      #27272a;
  --border-strong: #3a3a40;
  --fg:          #ededef;   /* 16.1:1 on --bg */
  --fg-muted:    #a1a1aa;   /*  7.9:1 */
  --fg-subtle:   #8b8b94;   /*  5.6:1 */
  --fg-on-accent: #ffffff;

  --accent:        #6b86ff;
  --accent-hover:  #8599ff;
  --accent-subtle: #1b2140;
  --focus-ring:    #8599ff;

  --success-fg: #4ac26b;  --success-bg: #0f2a18;  --success-border: #1d4d2c;
  --warning-fg: #e3a53a;  --warning-bg: #2b1f08;  --warning-border: #57400f;
  --danger-fg:  #ff7b72;  --danger-bg:  #2d1214;  --danger-border:  #5c2226;
  --info-fg:    #6cb0ff;  --info-bg:    #0f2036;  --info-border:    #1f3f66;
  --neutral-fg: #c4c4cc;  --neutral-bg: #1f1f23;  --neutral-border: #34343a;

  --danger-solid: #da3633;  --danger-solid-hover: #e5534b;

  --sandbox-bg: #d98e04;  --sandbox-fg: #1a1000;

  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.4);
  --shadow-md: 0 4px 12px rgb(0 0 0 / 0.5);
  --shadow-lg: 0 16px 40px rgb(0 0 0 / 0.6);
  --overlay:   rgb(0 0 0 / 0.6);

  color-scheme: dark;
}
```

Implementation note: copy the dark block into the `prefers-color-scheme`
media query. CSS can't share it, so generate both from one source object in
`tokens.ts`, or accept the duplication. Set `body { background: var(--bg);
color: var(--fg); font: var(--text-md)/var(--lh-md) var(--font-sans); }`.

**Component defaults, derived from the tokens:**

- **Buttons:** 32px high, `--radius-md`, `--text-md` weight 500, 12px
  horizontal padding.
  - Primary: accent background with `--fg-on-accent` text.
  - Secondary: `--bg` background, `--border-strong` border, `--fg` text.
  - Danger: `--danger-solid` background.
  - Ghost: transparent, with `--bg-muted` on hover.
- **Inputs:** 32px high (40px on public pages and login), with the
  `--border-strong` border.
- **Cards:** `--bg` background, `--border` 1px, `--radius-lg`, no shadow (flat
  and calm). The page background is `--bg-subtle`, so cards separate from it.
- **Tables:** headers in sentence case (not uppercase), `--text-xs` weight
  500, `--fg-muted`. Cells use `--text-sm`, and a 1px
  `--border` separates rows. Hovered rows get `--bg-subtle`.
- **Badges:** 20px high, 6px horizontal padding, `--radius-sm`, tone bg + fg
  + border, glyph 12px.

---

## 17. Build order (suggested)

1. Tokens, the shell (sidebar, top bar, EnvBanner) and login.
2. Formatters (`Money`, `Time`, `IdChip`), `StatusBadge` and `DataTable`.
3. Projects: create, the reveal-once modal, the webhook tab, and plans with
   validation. Projects come first because nothing else has data without them.
4. Events list and detail with re-deliver. This is the operator's most-used
   screen during integration.
5. Payments, subscriptions and charges lists and details, with the typed
   confirmations.
6. Overview, Usage and Settings/health.
7. The public `/pay` and `/return` pages.

---

## Sources

Mobbin (web unless noted):
- Stripe transactions list with count tiles, filter chips and status badges: [1](https://mobbin.com/screens/80054ec0-bb9d-4438-9a66-4f7bcd8f103f), [filter menu](https://mobbin.com/screens/78430f40-1d9b-45de-8c03-d25b8e33d728), [edit columns](https://mobbin.com/screens/d1ccc54c-679b-406f-893a-8c18cb5690f3)
- Stripe payment detail (timeline + details sidebar): [link](https://mobbin.com/screens/ebf7e9fe-326a-4459-ae16-f94aea16f56b); invoice logs section: [link](https://mobbin.com/screens/62d47133-041b-4d12-95fe-be71c1f2e530)
- Stripe subscriptions list: [link](https://mobbin.com/screens/bc21762d-28b7-487c-b34e-7973e5e7e4b9); Developers overview (API requests, recent errors, event destinations empty state): [link](https://mobbin.com/screens/a5d970b4-6274-47f5-b89e-99bcb7cd7c5d); sandbox banner: [link](https://mobbin.com/screens/925177de-949b-48e6-97a6-c0cef39a0959)
- Stripe Dashboard iOS stacked payment rows: [link](https://mobbin.com/screens/d8b72d98-48cd-4829-ad08-309ae833dfe4) (ios)
- Whop payment detail (breakdown + activity): [link](https://mobbin.com/screens/5694166b-f5c5-4837-9a34-26786ef1d75a); Shopify bill timeline: [link](https://mobbin.com/screens/512520ce-bc7e-4819-9cc4-16049b6e6572); Airwallex payment activity: [link](https://mobbin.com/screens/602332a6-4464-4252-a809-35e8a1a41c9e)
- Resend webhook page (events list + selected attempt with status, attempts, response body, payload, Replay): [link](https://mobbin.com/screens/e5079320-66e3-4ae3-86e3-336a72fd9a6c); Hashnode webhook history (TEST tag, Resend): [link](https://mobbin.com/screens/168e320b-3c66-467c-a88f-16ce90cb6959); Customer.io failed deliveries with bulk retry: [link](https://mobbin.com/screens/c2bc5440-c6ca-4dd4-bfd2-ec70a26039c5)
- Reveal-once key modals: [Vercel](https://mobbin.com/screens/77dfa251-28b5-4be4-ab60-ba6b428b3471), [ElevenLabs](https://mobbin.com/screens/f636cd71-171c-4266-9dd8-ff6412264b84), [StackAI](https://mobbin.com/screens/bc82da8c-c197-446e-921f-caa350184238), [Gamma](https://mobbin.com/screens/3762fc5a-915b-4783-a48b-01f01c95c49a), [Buffer](https://mobbin.com/screens/7172c3c9-fe83-4c9b-a4fb-1c70d386e866), [WRITER](https://mobbin.com/screens/a6e00feb-6a83-45cb-b57b-43ca3ef31b0a)
- Typed confirmation dialogs: [Cloudflare](https://mobbin.com/screens/aa928ac1-4a1d-4b8c-9ccb-be35211cdca8), [Clerk](https://mobbin.com/screens/71516c8f-ca28-4b68-bca8-01b6ea6e46ec), [Resend](https://mobbin.com/screens/778f011b-60b4-4584-b317-1e2353024e0c), [Relevance AI](https://mobbin.com/screens/552cef13-e0e1-41d4-8715-9b5b7d65cb43)
- Subscription management (card on file, next charge, cancel): [Claude](https://mobbin.com/screens/40cea7ff-83cc-4a74-9232-cc8390595269), [Disney+](https://mobbin.com/screens/d268a44c-58d9-452d-b981-9462150db689), [Codecademy](https://mobbin.com/screens/4bf40f5b-7b07-46ad-bb67-00e4c51c9eff)
- Lemon Squeezy orders (chart + metric tiles + table): [link](https://mobbin.com/screens/2c7f7cb8-f8eb-4361-99d8-1a60514eb90f), row actions: [link](https://mobbin.com/screens/ab99de4c-0f29-4df7-928e-e2cf91209850)
- Linear dense list + sidebar: [link](https://mobbin.com/screens/d1d26f7d-e1e5-490f-ab4f-c96dd12854c1)
- Vercel env-var side sheet (masked values, sensitive toggle): [link](https://mobbin.com/screens/5bd3c92b-c89f-4445-8541-b29b3b578074)
- Empty states: [Clerk API keys](https://mobbin.com/screens/428c1eea-e837-4daa-8d03-5619ecb18ac7), [Clerk table empty](https://mobbin.com/screens/67f22bc2-a48f-43b2-b519-d736eb096475), [fal getting-started dashboard](https://mobbin.com/screens/3786699a-7b92-4f81-9545-737fd5edfcff), [PandaDoc dev center](https://mobbin.com/screens/79d68519-f53a-4cee-af87-32c39727a0dd)
- QR checkout: [Wise PayNow](https://mobbin.com/screens/bb04c94e-091d-494b-a05d-5c2232c25446), [Coinbase PayNow steps](https://mobbin.com/screens/1fbb30ad-9102-4ebd-b324-405ac5d409e8)
- Return / redirect page: [Bonsai via Stripe](https://mobbin.com/screens/f59fbf14-5190-4c9b-a380-6c960a72487b), [Midday via Stripe](https://mobbin.com/screens/f7ae5acf-2435-421e-afae-493c290aea07)

Web:
- Stripe docs: webhooks, delivery attempts, 3-day retry with backoff: <https://docs.stripe.com/webhooks>
- Svix: retry schedule, manual and bulk replay, per-attempt inspection: <https://www.svix.com/resources/webhook-best-practices/retries/>, <https://www.svix.com/resources/faq/what-happens-when-a-webhook-fails/>
- Hookdeck, Stripe webhook features: <https://hookdeck.com/webhooks/platforms/guide-to-stripe-webhooks-features-and-best-practices>
- Carbon status-indicator pattern (at least 3 of 4 indicators, not colour alone): <https://carbondesignsystem.com/patterns/status-indicator-pattern/>
- Primer colour considerations (WCAG SC 1.4.1): <https://primer.style/accessibility/design-guidance/color-considerations/>
- Tugrik sign U+20AE, placed before the amount: <https://en.wikipedia.org/wiki/Mongolian_t%C3%B6gr%C3%B6g>
- `Intl.NumberFormat` / `DateTimeFormat` / `RelativeTimeFormat` output for `en`/`mn` and `Asia/Ulaanbaatar`, checked locally on Node 24.
