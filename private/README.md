# `private/` — untracked working data

Put files here that must **not** reach the repository: Acuity CSV exports, booking
extracts, anything carrying real people's names, emails or phone numbers.

Everything in this directory is gitignored except this README. Check before you
commit, all the same:

```sh
git status --short private/     # should list nothing
git check-ignore -v private/your-file.csv   # should print the ignore rule
```

## The Acuity export

Drop it here as `private/acuity-bookings.csv`. That is the path
[spec/booking/17-acuity-backfill.md](../spec/booking/17-acuity-backfill.md) assumes
when the importer is built.

Worth knowing before that import runs: it must **not** create calendar events. The
events already exist, and a calendar event is not an inert record — it is what
provisions a door passcode on the building's locks. See
[spec/booking/13-door-access-integration.md](../spec/booking/13-door-access-integration.md).

## Why not just `.env`-style secrecy

These files are personal data rather than credentials. Deleting them when you are
done with them is the point — a CSV of every booker's email sitting in a working
directory for a year is the kind of thing a data-protection review asks about.
