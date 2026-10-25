# 01 — Gift Aid capture

The Dartington Recreation Association (charity **1168817**) wants to claim Gift Aid on
donations, mainly for the pool appeal. Two ways in, one record:

1. a Gift Aid step on the public **`/donate`** form, and
2. a committee-only **`/admin/gift-aid`** page for declarations and gifts made away from
   the website: on a tablet, on paper, verbally, by cheque or bank transfer, and bucket
   collections.

Both write to **Firestore first** (the record of truth), then append to the bookkeeper's
Google Sheet, which is where claims are made from.

Written in the style of `spec/booking/`. Read `spec/booking/04` (Square) and
`spec/booking/12` (privacy) alongside it.

> Not tax or legal advice. This follows HMRC's published guidance on declarations and the
> model wording, but the treasurer should check the wording and process before the first
> claim.

---

## What the codebase already had, and how it changed the plan

Read before building, 25 Oct 2026. Each of these changed something.

| Found | Consequence |
|---|---|
| **`/donate` already exists** (`src/pages/donate.astro`, `src/pages/api/donate.ts`), live, on the production Square credentials (`SQUARE_ACCESS_TOKEN`, `PUBLIC_SQUARE_*`). It charges synchronously and **records nothing**: no Firestore, no webhook. | Extended rather than replaced. Its tokenize call is the one `04` says not to touch, so it isn't touched. What changes is that the server writes a **donation intent** before charging, and a new webhook records the donation. |
| `/donate` shows **"Charity No. 1205473"**. Every other page, the brand brief and the bookkeeper's sheet say **1168817**. | Fixed on the donate page. A Gift Aid form showing the wrong charity number is exactly what an HMRC compliance check would notice. |
| The booking webhook (`/api/booking/webhooks/square`) is signed with **`BOOKING_SQUARE_WEBHOOK_SIGNATURE_KEY`**. That key belongs to the booking app's subscription, and donations use separate credentials (`04`, "Environment variables"). | Donations get **their own webhook endpoint and signature key** (`/api/donate/webhooks/square`, `DONATE_SQUARE_WEBHOOK_SIGNATURE_KEY`). Square subscriptions are per application. Sharing an endpoint would mean the booking handler and the donation handler each have to recognise and skip the other's payments. |
| A Square subscription sends **every** payment on the seller account: room bookings, card-reader takings, the raffle. | The donation webhook only acts on payments whose `reference_id` is a **donation intent it created** (`DI-…`). Anything else is ignored with a 200. It never infers a donation from a payment it did not start. |
| `iam.disableServiceAccountKeyCreation` is enforced on the Workspace (`spec/booking/08`), so **there is no downloadable service-account key** to put in Secret Manager. | The sheet writer **impersonates** a dedicated service account, the same pattern as `booking-app` and the raffle. A Secret Manager JSON key is kept only as an escape hatch (`GIFT_AID_SHEETS_SA_JSON`), unset today. See "Sheet access". |
| `termsVersion` is a constant in `api/booking/create.ts`, mirrored in a Keystatic `version` field, with a test that fails if they disagree. | The declaration wording follows the **config** half of that pattern: `src/lib/gift-aid/declaration.ts`, keyed by version, with a test pinning the v1 text word for word. It does **not** go in Keystatic. The wording is a legal declaration, not page copy, and Keystatic would let anyone with CMS access change it without bumping the version. That is the one failure this design must prevent. |
| The newsletter opt-in (`spec/booking/16`) stores the **wording shown** alongside the tick. | Every declaration stores both `wordingVersion` and the **rendered sentence** the donor saw, amount included. |
| The bookkeeper's sheet already exists, with the exact input columns in the brief and formula columns to their right (Declarations **S**, Donations **L–X**, Small donations **H**). Its Settings tab says the **financial year ends 31 March** and the wording version is `v1`. | Column order is pinned by a test. Retention is computed from a 31 March year end. The sheet's Status formula already treats a Verbal declaration with no "Confirmation sent" date as *Awaiting confirmation*, so the sheet and Firestore agree on what isn't claimable. |
| The **Small donations tab has no ID column.** | The append still has to be idempotent. The row's reference (`SD-…`) is written at the end of the Notes cell, `… [SD-7K2QX4]`, and a retry looks for it before appending. This is the one place an ID lands in a human column. See "Open questions". |
| The admin allowlist and `mb_admin` cookie (`lib/booking/admin-auth.ts`) re-check the allowlist on every request. | `/admin/gift-aid` uses exactly that, with no second mechanism. It is reached from the admin header and never linked from a public page. |

Nothing major failed to fit, so the build went ahead without stopping for review.

---

## HMRC requirements

What a valid declaration must hold, and where each piece lives:

| Requirement | Field |
|---|---|
| Donor's full name | `title?`, `firstName`, `lastName` |
| Home address (house + postcode used in the claim; full address kept) | `houseNameOrNumber`, `addressLine`, `town`, `postcode` |
| Single (this donation) or Enduring (this, the past 4 years and the future) | `scope` |
| Explicit opt-in: an **unticked** box the donor ticks | Online: `giftAid.optIn === true`, strictly. Anything else is not a declaration. |
| The declaration wording, versioned | `wordingVersion = "v1"`, `wordingText` (rendered) |
| Tell donors to say if they cancel, move, change name or stop paying enough tax | Shown under the wording everywhere, and in every confirmation email |
| When, how, and who entered it | `madeOn`, `madeAt`, `method` (Online/Tablet/Paper/Verbal), `enteredBy`, `enteredAt` |

### The wording (v1)

Enduring, exactly as supplied:

> I want to Gift Aid my donation of £{amount} and any donations I make in the future or
> have made in the past 4 years to Dartington Recreation Association. I am a UK taxpayer
> and understand that if I pay less Income Tax and/or Capital Gains Tax than the amount of
> Gift Aid claimed on all my donations in that tax year it is my responsibility to pay any
> difference.

**Single.** The brief gives only the enduring wording but requires a Single choice. Showing
"…and any donations I make in the future…" to someone who has just chosen *this donation
only* contradicts their choice. So Single uses HMRC's model single-donation wording, which
is the same sentence without the past-and-future clause:

> I want to Gift Aid my donation of £{amount} to Dartington Recreation Association. I am a
> UK taxpayer and understand that … [unchanged] … to pay any difference.

**No amount.** Tablet, paper and verbal declarations may have no amount attached, for
example a standing-order donor declaring once. Then `£{amount}` reads "my donation" and the
rest is unchanged. The rendered text is stored, so what the donor saw is never in doubt.

Followed everywhere by:

> Please let us know if you want to cancel this declaration, change your name or home
> address, or no longer pay enough Income Tax and/or Capital Gains Tax.

And on the online form, before the box:

> **Not a UK taxpayer?** Please leave this unticked. Gift Aid can only be claimed on tax
> you have paid in the UK. Your donation is just as welcome without it.

Changing any of this means adding `v2` to `DECLARATIONS` in `declaration.ts`, switching
`DECLARATION_VERSION`, and bumping **Settings → Declaration wording version** in the sheet.
`v1` stays in the file forever, because stored declarations point at it.

---

## Part 1 — the public donation form

### The panel

Shown by default, below the amount:

> **Boost your donation by 25p of Gift Aid for every £1 you donate**
> ☐ Yes, I want to Gift Aid my donation *(+ live "£25 becomes £31.25")*

Unticked on load, always. Ticking reveals:

- **Scope:** radio, *All my donations (past 4 years and future)* (**default**, Enduring) /
  *This donation only* (Single). The wording beneath updates live.
- **Title** (optional, max 4 characters; HMRC's limit), **First name**, **Last name**
- **House name or number**, **Address** (street), **Town**, **Postcode**
- The declaration text with the live amount, and the "let us know" line

When Gift Aid is ticked the generic "Your name" field hides, and the bank's billing name is
built from first + last. Email stays required either way.

### Validation (shared by the form, the API and the admin page)

`src/lib/gift-aid/validate.ts`, pure:

| Field | Rule |
|---|---|
| title | optional, ≤ 4 characters after trimming |
| firstName, lastName | required, ≤ 35 characters (HMRC truncates there) |
| houseNameOrNumber | required, ≤ 40 |
| addressLine, town | required, ≤ 100 |
| postcode | required, a UK postcode. Stored **upper case with a single space** before the inward code (`tq96ej` → `TQ9 6EJ`). |
| email | required online and on the tablet; optional on paper and verbal |
| scope | `Single` \| `Enduring` |
| method | `Online` \| `Tablet` \| `Paper` \| `Verbal` |
| madeOn | ISO date, not in the future. Online and tablet: today. Paper: the date signed. |
| scanLink | optional, paper only, must be a `https://drive.google.com/` or `https://docs.google.com/` URL |

### When the donation is recorded: only once Square confirms

```
browser ──tokenize──► /api/donate ──► Firestore: donationIntents/DI-…  (pending, carries the declaration)
                          │
                          └──► Square /v2/payments  reference_id = DI-…, idempotency_key = DI-…
                                         │
Square ──payment.created/updated──► /api/donate/webhooks/square
                                         │  read the payment back from Square's API
                                         ▼
                      transaction: intent pending + payment COMPLETED
                         → giftAidDeclarations/GA-…   (if ticked)
                         → donations/DN-…             (status Received)
                         → intent marked recorded
                                         │
                                         ├──► thank-you email (best effort)
                                         └──► append to sheet (best effort, retried)
```

- **The intent is written before the charge**, so a declaration can never be lost to a
  crash between payment and record. If Firestore is unreachable, the donation is refused
  with "please try again" *before* any money moves.
- **The webhook body is a hint, not truth**, as in `04`: the payment is re-read from Square
  by id, and only `COMPLETED` records anything.
- **Idempotent by state, not by event id.** `payment.created` and `payment.updated` can both
  report `COMPLETED`, and Square retries. Either way the transaction sees the intent already
  `recorded` and does nothing, which is stronger than remembering event ids.
- The browser still shows "thank you" as soon as `/api/donate` sees `COMPLETED`. Only the
  *record* waits for the webhook.
- Unpaid intents carry `expiresAt` = 30 days and are swept by a Firestore TTL policy. That
  is the only place donor details are held before payment.

### Refunds

`refund.created` / `refund.updated` → re-read the refund → if `COMPLETED`, find the donation
by `squarePaymentId` and set **status Refunded**. Idempotent: refund ids already applied are
skipped. **A partial refund also marks the donation Refunded.** The sheet only knows
Received/Refunded, and over-claiming Gift Aid is the expensive mistake, so the conservative
reading wins. The refunded amount is kept in Firestore and an alert goes to `it@`, so the
treasurer can re-enter the net gift if they want it claimed.

The sheet's Status cell (Donations column **I**) is updated in place for that row: an
input column, written by finding the row by Donation ID.

### Campaign

`/donate?campaign=pool` records **Pool appeal**, and the pool page's button now links
there. Anything else records **General**. Online donations are always Method **Online**,
Source **Web**, Via platform **N**. Square processes the card but is not a giving platform
that claims Gift Aid itself.

### The thank-you email

Sent when the donation is recorded, through the booking system's Brevo `send()` (so dev
prints to the terminal and production refuses `console`). It contains the amount and, if a
declaration was made: the name and address as recorded, the scope, the exact wording, and how
to cancel or update it (reply, or email `contact@meadowbrookdartington.org`). Square also
sends its own card receipt; this one is the charity's.

---

## Part 2 — the committee capture page

`/admin/gift-aid`, server-rendered, `prerender = false`.

- **Guard:** `verifySession(mb_admin)` before anything else, exactly as `/admin/bookings`.
  No session → 302 to `/admin/signin`. The API (`/api/admin/gift-aid`) returns **401**
  without one, *before reading the body*. Removing someone from `BOOKING_ADMIN_EMAILS`
  locks them out on their next request.
- `ADMIN_HEADERS` (`no-store`, `noindex, nofollow`, `no-referrer`) and the layout's
  `noindex` meta. Linked from the admin header, never from public pages.

### Modes

| Mode | What |
|---|---|
| **Tablet** | The donor fills it in themselves. Same fields, wording and unticked box as online. Shows nothing about other donors and clears itself after each submission, so the next person sees a blank form. Amount optional (wording only). `enteredBy` = the signed-in committee member. |
| **Paper** | Key in a signed form: declaration fields, **date signed**, scope, optional Drive scan link, notes. |
| **Verbal** | As paper, with date made. Flagged **"Written confirmation needed"** until a confirmation is recorded. |
| **Donation** | Look the donor up by **last name + postcode** → pick their declaration → amount, date received, method (Cheque / Bank transfer / Standing order / Cash), campaign, bank reference, notes. |
| **Small** | One total per collection: date, event or place, amount, cash or contactless, in the Meadowbrook building Y/N, notes. **No donor details.** Goes to the *Small donations* tab. |
| **Records** | Verbal declarations awaiting confirmation, rows not yet in the sheet (with a retry button), and look up → cancel a declaration. |

### Verbal declarations

HMRC accepts a verbal declaration only once the charity has sent a **written record** of it,
and the donor then has **30 days from that record** to cancel, in which case it is treated as
never made.

- Saved with `confirmationSentOn = null`. Not claimable. In the sheet, column **N** is blank,
  so the sheet's Status formula reads *Awaiting confirmation* and its Check column refuses it.
- **Records → "Email written confirmation"** (when there is an email address) sends a letter
  stating the declaration, the scope, the wording and the 30-day right to cancel, and records
  today's date. **"Mark as posted"** records a date for a paper letter.
- Either one sets `confirmationSentOn` and `claimableFrom = confirmationSentOn + 30 days`,
  and updates column **N** in the sheet.
- The sheet's formula does not wait out the 30 days. The page shows `claimableFrom`. See
  "Open questions".

### Cancelling

Records → look up → **Cancel declaration** sets `cancelledOn` (today, or a date given) and
updates column **O**. Nothing is deleted. The declaration stays as evidence of what was
claimed before it was cancelled.

### Cash

The brief's rule is that donor-identified cash is recorded when it's **over £30**, and
smaller gifts go to Small donations. The page says so beside the method. It **does not
refuse** a declared donor's £20 cash, because that gift is claimable under ordinary Gift Aid
(and doesn't count against the £8,000 small-donations cap). It warns instead.

---

## Data model (Firestore, `meadowbrook-booking`)

Same database, same `booking-app` identity and same conventions as `spec/booking/01`: string
ids with a prefix, Crockford base32, `Timestamp` for instants, `LocalDate` strings
(`yyyy-mm-dd`, London) for calendar dates, append-only `history`, `isTest` outside production.

### `giftAidDeclarations/{GA-XXXXXX}`

```ts
{
  title: string | null; firstName: string; lastName: string; lastNameLower: string;
  houseNameOrNumber: string; addressLine: string; town: string; postcode: string; // "TQ9 6EJ"
  email: string | null;
  scope: 'Single' | 'Enduring';
  method: 'Online' | 'Tablet' | 'Paper' | 'Verbal';
  madeOn: LocalDate; madeAt: Timestamp;
  wordingVersion: 'v1'; wordingText: string;          // the sentence as shown, amount included
  enteredBy: string;                                   // 'website' online; the admin's email otherwise
  enteredAt: Timestamp;
  confirmationSentOn: LocalDate | null;                // verbal only
  confirmationMethod: 'email' | 'post' | null;
  claimableFrom: LocalDate | null;                     // verbal: confirmation + 30 days
  cancelledOn: LocalDate | null;
  scanLink: string | null;
  notes: string | null;
  lastGiftOn: LocalDate | null;
  retainUntil: LocalDate;                              // see Retention
  sheet: SheetSync;
  history: { at: Timestamp; action: string; actor: string }[];
  isTest?: true;
}
```

### `donations/{DN-XXXXXX}`

```ts
{
  declarationId: string | null;
  receivedOn: LocalDate; amountPence: number;          // integer pence, as everywhere
  method: 'Online' | 'Cheque' | 'Bank transfer' | 'Standing order' | 'Cash';
  campaign: 'Pool appeal' | 'General' | 'Event';
  source: 'Web' | 'Offline'; viaPlatform: false;
  status: 'Received' | 'Refunded';
  refundedPence: number; squareRefundIds: string[];
  squarePaymentId: string | null; intentId: string | null;
  bankReference: string | null; notes: string | null;
  donorEmail: string | null;
  enteredBy: string; enteredAt: Timestamp;
  sheet: SheetSync; history: […]; isTest?: true;
}
```

### `smallDonations/{SD-XXXXXX}`

`collectedOn, eventOrPlace, amountPence, kind: 'Cash' | 'Contactless', inBuilding: boolean,
notes, enteredBy, enteredAt, sheet`.

### `donationIntents/{DI-XXXXXXXXXXXX}`

`amountPence, campaign, name, email, giftAid: ValidDeclaration | null, wordingText | null,
status: 'pending' | 'recorded', donationId?, declarationId?, createdAt, expiresAt` (TTL).

### `SheetSync`

```ts
{ appended: boolean; appendedAt: Timestamp | null; attempts: number; lastError: string | null;
  pendingUpdates: { column: string; value: string }[] }   // e.g. { column: 'N', value: '2026-10-25' }
```

### Indexes and TTL

- Single-field (automatic): `giftAidDeclarations.postcode`, `donations.squarePaymentId`,
  `*.sheet.appended`.
- **TTL policy on `donationIntents.expiresAt`.** One `gcloud` command, below.

---

## Storage: the sheet

Spreadsheet `1h-eMAKXv22b9oTQzXqg9RKh4y0t9ZeMOhcBfLh3VBRE`, configured as `GIFT_AID_SHEET_ID`.
**Unset means sync is off**, and records stay `appended: false` until it is set. Local
development and PR previews therefore never write to the bookkeeper's sheet by accident,
the same principle as `BOOKING_EMAIL_TRANSPORT`.

### Rows, in this exact order (pinned by a test)

| Tab | Range | Columns |
|---|---|---|
| Declarations | `A:R` | Declaration ID, Title, First name, Last name, House name or number, Address, Town, Postcode, Email, Scope, Method, Date made, Wording version, Confirmation sent, Cancelled date, Scan link, Entered by, Notes |
| Donations | `A:K` | Donation ID, Declaration ID, Date received, Amount (£), Method, Campaign, Source, Via platform, Status, Claim ID (**always blank**), Notes |
| Small donations | `A:G` | Date collected, Event or place, Amount (£), Cash or contactless, In Meadowbrook building, Entered by, Notes |

- `values:append`, `valueInputOption=USER_ENTERED`, `insertDataOption=OVERWRITE`: it writes
  into the first empty row after the data, **never inserts rows**, and so never moves
  anything above. The response's `updatedRange` is checked to start in column A and end at
  R / K / G; anything else is logged loudly as an error.
- **Dates** are ISO `yyyy-mm-dd`, which USER_ENTERED turns into real dates. The sheet's
  formulas compare them.
- **Amounts** are plain numbers in pounds (`25.5`), so `D:D*Settings!B8` works.
- **Every free-text cell is prefixed with `'`**: house numbers (so `12` stays text, as HMRC
  wants) and also names, addresses and notes. USER_ENTERED evaluates anything that looks
  like a formula, and a donor called `=IMPORTXML(…)` would otherwise run it in the
  bookkeeper's sheet. Enumerated values (Scope, Method, Y/N…) are written bare.
- Bank reference has no column, so it goes in **Notes** as `Bank ref: …`.

### Idempotent and retryable

1. The Firestore record is committed with `sheet.appended = false`. **A sheet failure never
   touches it.**
2. Sync reads the tab's ID column (A, or G for Small donations). If the ID is already there,
   for example because a previous attempt appended but crashed before marking it, the row
   is not appended again. Otherwise it appends.
3. Then `sheet.appended = true`. On failure: `attempts++`, `lastError`, and it stays pending.
4. Later changes (verbal confirmation → N, cancellation → O, refund → Donations I) queue in
   `pendingUpdates` and are written **one cell at a time** to the row found by ID, so a
   bookkeeper's own entries in that row (Claim ID above all) are never overwritten.
5. Retried by `POST /api/gift-aid/cron/sync` (Cloud Scheduler, hourly, OIDC as in `08`) and by
   the **Retry** button on the Records tab. Sync is best-effort right after each write too.

### Sheet access

Not a key in Secret Manager, because none can be created (above). Instead:

- A dedicated service account, **`gift-aid-sheets@meadowbrook-booking.iam.gserviceaccount.com`**,
  with **no IAM roles at all**. Its only access to anything is being shared as **Editor on
  this one spreadsheet**. A service account sees no Drive files except those shared with
  it, so that is "edit access to that one sheet only".
- `booking-app` is **not** used for this. It is shared on the room calendars, and the sheet
  holds donors' home addresses. Separate identities keep a mistake in one from reaching the
  other.
- The Cloud Run runtime SA (and your ADC locally) gets
  `roles/iam.serviceAccountTokenCreator` on it, and the app sets
  `GIFT_AID_SHEETS_IMPERSONATE_SA`.
- `GIFT_AID_SHEETS_SA_JSON`, mounted from Secret Manager, is honoured first if it ever
  exists.

---

## Retention

**6 years after the end of the accounting period of the donor's last gift.** The DRA's
accounting period ends **31 March** (sheet Settings). So:

```
retainUntil = (31 March ending the financial year of lastGiftOn, or madeOn if no gift yet) + 6 years
  gift on 2026-10-25 → period ends 2027-03-31 → retain until 2033-03-31
  gift on 2027-03-31 → period ends 2027-03-31 → retain until 2033-03-31
  gift on 2027-04-01 → period ends 2028-03-31 → retain until 2034-03-31
```

Recomputed on the declaration each time a gift is recorded against it. Donations and small
donations carry their own `retainUntil` from their own date. **Nothing deletes on that date
yet**, the same position the booking records are in (`12`, "When the purge is built"). The
field is there so the purge is a query, not an investigation.

---

## Privacy policy: draft notes (not applied)

The live policy is a Google Doc (`spec/booking/12`). **Not changed.** Copy-paste-ready text:

### Section 2: What we collect

> **Gift Aid declarations.** If you choose to Gift Aid a donation, we collect your title,
> name, home address, postcode and email address, whether your declaration covers one
> donation or all of them, the date you made it and how (online, on paper, in person or by
> phone), and a record of each donation it covers.

### Section 4: How we use it

> **To claim Gift Aid.** We use your name and address to claim Gift Aid on your donations
> from HM Revenue & Customs, and your email address to confirm your declaration and tell you
> how to change or cancel it.

### Section 5: Who we share it with

> - **HM Revenue & Customs**: your name, house name or number, postcode and the date and
>   amount of each donation, so that we can claim Gift Aid. We share Gift Aid details with
>   HMRC only.

(Plus Square and Brevo as already listed. Google already covers Firestore and Sheets.)

### Section 7: Retention

> **Gift Aid.** We keep your declaration and the record of your donations for **6 years**
> after the end of the financial year (to 31 March) in which you last donated, because HMRC
> requires charities to keep Gift Aid records for that long.

### Legal basis

> - **To comply with a legal obligation**: keeping Gift Aid declarations and donation
>   records as HMRC requires.

Note for whoever applies it: "6 years after the last donation" (the brief's wording) and
"6 years after the end of the accounting period of the last gift" (HMRC's rule, and what the
code computes) differ by up to a year. The draft uses the latter so the policy states what is
actually kept.

---

## Configuration

| Var | Where | Notes |
|---|---|---|
| `DONATE_SQUARE_WEBHOOK_SIGNATURE_KEY` | Secret Manager | From the new Square subscription |
| `DONATE_SQUARE_WEBHOOK_URL` | env | `https://meadowbrookdartington.org/api/donate/webhooks/square`, exactly as in Square |
| `GIFT_AID_SHEET_ID` | env | `1h-eMAKXv22b9oTQzXqg9RKh4y0t9ZeMOhcBfLh3VBRE` in production. Unset = no sync |
| `GIFT_AID_SHEETS_IMPERSONATE_SA` | env | `gift-aid-sheets@meadowbrook-booking.iam.gserviceaccount.com` |
| `GIFT_AID_SHEETS_SA_JSON` | Secret Manager, optional | Escape hatch; unset |

Reused: `SQUARE_ACCESS_TOKEN` and `PUBLIC_SQUARE_*` (donate's own), `BOOKING_IMPERSONATE_SA`
and `BOOKING_PROJECT_ID` (Firestore), `BREVO_API_KEY` and `BOOKING_EMAIL_TRANSPORT`,
`BOOKING_ADMIN_*`, `BOOKING_CRON_SECRET`.

### Human setup, in order

```bash
# 1. The sheet-writer identity: no roles, only the one spreadsheet.
gcloud iam service-accounts create gift-aid-sheets --project=meadowbrook-booking \
  --display-name="Gift Aid sheet writer"
gcloud iam service-accounts add-iam-policy-binding \
  gift-aid-sheets@meadowbrook-booking.iam.gserviceaccount.com --project=meadowbrook-booking \
  --member=serviceAccount:589136616970-compute@developer.gserviceaccount.com \
  --role=roles/iam.serviceAccountTokenCreator
# and for local testing, your own account:
#   --member=user:michael.campbell@meadowbrookdartington.org

# 2. Share the spreadsheet (Share → Editor) with
#    gift-aid-sheets@meadowbrook-booking.iam.gserviceaccount.com. Untick "Notify".

# 3. TTL on unpaid intents.
gcloud firestore fields ttls update expiresAt --collection-group=donationIntents \
  --enable-ttl --project=meadowbrook-booking

# 4. Square Developer Dashboard → the *donate* application (sq0idp-SJPH8U9…) →
#    Webhooks → Add subscription, production:
#      URL     https://meadowbrookdartington.org/api/donate/webhooks/square
#      Events  payment.created, payment.updated, refund.created, refund.updated
#    Then store its signature key, and let Cloud Run read it. The script prompts
#    for it (input hidden, checked for a doubled paste) and grants the accessor role:
bash spec/booking/setup-secrets.sh

# 5. Hourly sheet retry.
gcloud scheduler jobs create http gift-aid-sheet-sync --project=meadowbrook-booking \
  --location=europe-west2 --schedule="40 * * * *" --time-zone=Europe/London \
  --uri=https://meadowbrookdartington.org/api/gift-aid/cron/sync --http-method=POST \
  --oidc-service-account-email=booking-scheduler@meadowbrook-booking.iam.gserviceaccount.com \
  --oidc-token-audience=https://meadowbrookdartington.org/api/gift-aid/cron/sync
```

Step 6, `deploy.yml`, is already in this change: the new env vars and the secret mount. **The
deploy fails until step 4's secret exists**, because Cloud Run refuses to mount a missing
secret. That is deliberate: Gift Aid shipping without its webhook would take money and
record nothing.

### Before the first real claim

- A **real-money test**, per `04`: a £1 donation with Gift Aid ticked on a real card, then
  a refund, checking Firestore, the sheet (rows and the Refunded status) and both emails.
- Delete the sheet's EXAMPLE rows once real rows are in (Read me says so).
- Fill in **Settings → HMRC charities reference**. The sheet notes no claim can be made
  without it.

---

## Open questions

1. **Single-scope wording.** The brief gives only the enduring sentence. v1 uses HMRC's model
   single-donation sentence for Single. Confirm, or drop Single online.
2. **Small donations ID in Notes.** Needed for idempotent retries, because that tab has no ID
   column. Alternative: add an ID column to the tab (input columns would then be `A:H`, and
   the Tax year formula moves to I).
3. **Verbal: the 30 days.** The sheet's Check column treats a verbal declaration as claimable
   as soon as column N has a date. HMRC treats it as cancelled-from-the-start if the donor
   cancels within 30 days. Either claim only after `claimableFrom`, or add that test to the
   sheet's Check formula.
4. **Partial refunds** mark the whole donation Refunded (conservative). OK?
5. **Non-Gift-Aid donations** are appended to the Donations tab too, with a blank
   Declaration ID (the sheet shows *No declaration*). That keeps the Report tab's campaign
   totals complete. Say if the tab should hold Gift Aid gifts only.
6. **Who may use `/admin/gift-aid`.** Today, everyone on `BOOKING_ADMIN_EMAILS`. Donor home
   addresses might warrant a narrower list (treasurer, bookkeeper).
7. **Sender.** Emails go from `bookings@` (the only verified Brevo transactional sender in the
   booking code) with reply-to `contact@`. A `donations@` sender would need verifying in Brevo.
8. **Overseas taxpayers.** HMRC accepts `X` as the postcode for a UK taxpayer living abroad.
   Not supported. The form asks for a UK postcode.

## Acceptance criteria

- [ ] The Gift Aid box on `/donate` is unticked on every load, and an untrue `optIn` records no declaration.
- [ ] Ticked with a missing field, a bad postcode or a 5-character title is refused, field by field.
- [ ] `tq96ej` is stored as `TQ9 6EJ`.
- [ ] A donation is recorded only when Square reports the payment `COMPLETED`, read back from the API.
- [ ] The same webhook twice, or `created` then `updated`, records one donation and one declaration.
- [ ] A completed refund marks the donation Refunded in Firestore and in the sheet's column I.
- [ ] A payment the donation flow did not start is ignored.
- [ ] Sheet rows match the column order above exactly, never touch formula columns, and never insert rows.
- [ ] A sheet failure leaves the Firestore record intact and pending, and the next sync appends it once.
- [ ] `/admin/gift-aid` redirects without a session, and its API returns 401 before reading the body.
- [ ] A verbal declaration is "Awaiting confirmation" until a written confirmation is recorded.
- [ ] Every row records who entered it and when.
