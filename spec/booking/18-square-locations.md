# 18 — Square locations per room

## Why
DRA wants Square payouts split by income stream so the bookkeeper can see what came from where. Square pays out per location, so each bookable room should charge against its own Square location.

Locations now exist in the Square Dashboard:

| Facility (slug)  | Name in content | Square location        |
|------------------|-----------------|------------------------|
| `snooker-room`   | Snooker Room    | Snooker `L3JVJABCDB86K` |
| `large-room`     | Studio          | Studio `LFQHKA4RM1P51` |
| `small-room`     | Lounge          | Lounge `L22B8R37R9508` |
| `/donate` + misc | —               | Existing (`LT08J54D3THKE`), unchanged |

These are production IDs. Production value for the env var:

```json
{"snooker-room":"L3JVJABCDB86K","large-room":"LFQHKA4RM1P51","small-room":"L22B8R37R9508"}
```

## Current state
- Booking uses a single location from `PUBLIC_BOOKING_SQUARE_LOCATION_ID`:
  - server: `squareConfig()` in `src/lib/booking/square.ts` → `charge()` sets `location_id`
  - client: `Square.payments(appId, locationId)` in `src/components/BookingWidget.astro` and `src/pages/bookings/[ref].astro`
- Charge already sets `reference_id` (booking ref) and a `note` with the room name.
- Refunds go by `payment_id`, so they follow the original payment's location automatically.
- `/donate` uses its own env vars (`PUBLIC_SQUARE_LOCATION_ID`). Out of scope — leave it alone.

## Change
1. **Location map by facility slug.** Add env var `BOOKING_SQUARE_LOCATION_IDS` (JSON, e.g. `{"snooker-room":"L...","large-room":"L...","small-room":"L..."}`). Keep `PUBLIC_BOOKING_SQUARE_LOCATION_ID` as the fallback for any room not in the map. Don't put location IDs in Keystatic content — sandbox and production IDs differ.
2. **Server.** Add a helper (e.g. `squareLocationFor(roomSlug)`) and use it wherever `charge()` is called: `api/booking/create.ts` and `api/booking/amend.ts`. `SquareConfig.locationId` becomes the fallback, not the only value.
3. **Client.** Both the booking widget and the manage-booking page must initialise `Square.payments()` with the same location the server will charge, resolved per room at render time. Mismatched location between tokenise/verify and charge is the likely failure mode — test it.
4. **Record it.** Store `squareLocationId` on each payment record in Firestore (`store.ts`, update `01-data-model.md`). Older payments without it are assumed to be the fallback location.
5. **Amendments that change room.** A top-up charge goes to the *new* room's location. The original payment stays where it was; refunds follow the payment. That's acceptable — just make it explicit in code comments and `04-payments-and-refunds.md`.
6. **Reporting/export.** Add location (or room-derived income stream) as a column in `api/admin/export.ts` and the admin reporting page, so the split is visible without logging into Square.
7. **Reconcile cron / webhook.** Check `reconcile.ts` and `webhooks/square.ts` don't filter or assume a single location. Fix if they do.

## Config
- Add `BOOKING_SQUARE_LOCATION_IDS` to Cloud Run env (production) and `.env` / `11-local-development.md` (sandbox).
- Sandbox: create matching locations in the sandbox seller account, or leave the map empty so everything falls back.
- Update `08-infrastructure.md` env table and `setup-secrets.sh` hints.

## Tests
- Unit: location resolution (mapped slug, unmapped slug → fallback, missing/invalid JSON → fallback with a logged warning, not a crash).
- Charge sends the room's `location_id`.
- Amend to a different room charges the new room's location.
- Manual sandbox run: book each room, confirm payment appears under the right location in the sandbox dashboard, including a 3-D Secure card.

## Out of scope
- `/donate` flow.
- Acuity (still live in parallel) — any income through it won't be split by this change.
- In-person card readers — set up in the Square app per location, not in code.

## Open questions
- Is the booking access token (`BOOKING_SQUARE_ACCESS_TOKEN`) for the same Square account the new locations were created in? If not, the locations need creating there instead.
- Go-live date: agree with the bookkeeper (month boundary).
