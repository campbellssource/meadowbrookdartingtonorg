# 01 — Data Model

PostgreSQL. UUID primary keys except tickets, which also carry a human-readable sequential
number. All timestamps `timestamptz`, default `now()`. Money stored as integer **pennies**,
never floats.

## Tables

### `entrants`
One row per person, deduped on lowercased email.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text not null | |
| email | citext not null unique | lowercased; use `citext` or lower() unique index |
| phone | text not null | for contacting winners |
| consent_at | timestamptz not null | when they ticked the consent box |
| created_at | timestamptz not null default now() | |

### `payments`
One row per Square transaction.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| entrant_id | uuid FK → entrants.id | |
| square_payment_id | text | Square's payment id (sandbox) |
| amount_pennies | integer not null | total charged |
| currency | text not null default 'GBP' | |
| quantity | integer not null | number of entries bought |
| status | text not null | `pending` \| `completed` \| `failed` |
| created_at | timestamptz not null default now() | |

### `entries`
One row per ticket. This is the pool the draw selects from.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| entrant_id | uuid FK → entrants.id | |
| payment_id | uuid FK → payments.id | |
| ticket_number | text not null unique | human-readable, e.g. `MB-0042` |
| created_at | timestamptz not null default now() | |

Ticket numbers: monotonic sequence, zero-padded to 4+ digits, prefixed `MB-`. Generate from
a Postgres sequence so they're gapless and race-safe. Only created for `completed` payments.

### `prizes`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text not null | |
| description | text | |
| donor | text | who donated it (nice for the public page) |
| display_order | integer not null default 0 | |
| created_at | timestamptz not null default now() | |

### `draws`
One row per prize once drawn. A prize with no `draws` row hasn't been drawn yet.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| prize_id | uuid FK → prizes.id unique | one active draw per prize |
| winning_entry_id | uuid FK → entries.id | |
| pool_size | integer not null | how many entries were eligible at draw time (audit) |
| method | text not null | e.g. `crypto.randomInt` (audit / transparency) |
| drawn_by | text not null | admin identifier |
| drawn_at | timestamptz not null default now() | |

## Relationships (summary)

```
entrants 1───∞ payments 1───∞ entries ∞───1 (winning) draws 1───1 prizes
```

## Derived views (optional, handy)

- `public_entries` — `ticket_number` + first name / initial only. Powers the public list on
  `/entries` without exposing full contact details.
- `entry_counts` — count of entries, distinct entrants, total pennies raised. Powers admin.

## Acceptance criteria

- [ ] Schema migrates cleanly on an empty Cloud SQL Postgres instance.
- [ ] Ticket numbers are gapless, unique, and only exist for completed payments.
- [ ] Deleting is never required for the POC — nothing is hard-deleted.
- [ ] A single query returns the eligible pool for a given prize (see `05`).
- [ ] Money is integer pennies everywhere; no float columns.
