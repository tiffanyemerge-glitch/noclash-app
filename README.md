# NoClash

A community events calendar for organizers: check what's already booked in a city before
picking a date, post a listing, and let people find out about events that match their
interests. This is a runnable prototype, not a finished product — see **What's stubbed**
below before showing it to anyone outside your team.

## Run it

```
npm install
npm start
```

Then open http://localhost:3000. The database is a single JSON file
(`data/db.json`) that's created automatically on first run, seeded with a demo
organizer account and eight sample events spread over the next few weeks (so
the board isn't empty the first time you look at it).

**Demo organizer login:** `demo-organizer@example.com` / `password123`

To start over with a clean slate, stop the server and delete `data/db.json` —
it will be recreated with the same seed data next time you run `npm start`.

### Turning on real payments

**This is already turned on.** A working Stripe **test-mode** secret key is already sitting in
`.env` (`STRIPE_SECRET_KEY`), so as soon as you run `npm install && npm start`, the Post page's
button says **Continue to payment** and the dashboard's pass button says **Buy Organizer
Pass — $49** — both send you to a real, Stripe-hosted checkout page.

Test-mode means no real money moves, ever, no matter what card number you use. To try it out,
use one of Stripe's [test card numbers](https://docs.stripe.com/testing) — the easiest is
`4242 4242 4242 4242`, any future expiry date, any 3-digit CVC, any ZIP.

A couple of things worth knowing about that key:
- It only works in test mode — it cannot charge a real card even by accident.
- `.env` is gitignored, so it won't be committed if you push this project to GitHub. But it
  also **won't travel automatically if you deploy** (e.g. to Render) — you'll need to copy this
  same `STRIPE_SECRET_KEY` value into your host's environment variable settings there too.
- If you ever want to generate your own key instead (e.g. once you're ready to move to a real
  Stripe account under your own business), create a free account at
  [dashboard.stripe.com/register](https://dashboard.stripe.com/register), go to
  **Developers → API keys** while toggled to **Test mode**, copy the **Secret key**, and paste
  it into `.env` in place of the one that's already there.
- When you're ready to take real payments, switch Stripe's dashboard to **Live mode**, copy the
  live secret key (`sk_live_...`) into `.env` (or your host's environment variables) instead,
  and finish Stripe's account verification — they'll ask for business/bank details before
  they'll pay out real charges to you. That's Stripe's process, not something this code can skip.

**How it works, if you're curious:** the app never touches a card number itself — Stripe
Checkout is a page hosted by Stripe that collects the card. When the organizer comes back,
the app asks Stripe directly (server-to-server, with your secret key) whether that specific
checkout actually succeeded before posting the listing or activating the pass, rather than
trusting the browser's redirect on its own. The Organizer Pass is a one-time $49 charge, not
an auto-renewing subscription — see `lib/payments.js` for why, and what a real subscription
would add.

Delete the `STRIPE_SECRET_KEY` line from `.env` (or delete `.env` entirely) to go back to demo
mode — everything keeps working, clearly labeled as such on every button and confirmation
message, just without a real charge.

### Optional: checking outside sites for conflicts too

The Post page can also check ticketed-event platforms outside NoClash for the same
city and day — not just other NoClash listings. **This can't be Eventbrite specifically:**
Eventbrite shut off public search access to third-party apps back in February 2020 ([details](https://github.com/Automattic/eventbrite-api/issues/83)) —
their API now only returns events for an organization you already have OAuth access to,
which can't answer "what else is happening in this city." That's a restriction on
Eventbrite's side, not something this code can work around.

What's wired up instead is **Ticketmaster's Discovery API**, which is free and does support
searching by city + date:

1. Get a free key at [developer.ticketmaster.com](https://developer.ticketmaster.com/) (no
   billing info required for the free developer tier at the time this was written).
2. Copy `.env.example` to `.env` and paste your key into `TICKETMASTER_API_KEY`.
3. Restart the server. The Post page will now show a second panel under the conflict
   checker for any date you pick.

Leave `.env` blank (or don't create it) and this feature just shows a note explaining
it isn't set up — everything else works the same either way.

**Coverage caveat:** Ticketmaster skews toward larger ticketed events (concerts, sports,
theater) — it won't see a church bake sale, a Little League game, or a farmers market, so
treat it as a supplement to NoClash's own listings, not a replacement. For broader coverage
(including community events, festivals, and public/school holidays), [PredictHQ's Events
API](https://www.predicthq.com/apis/event-api) is worth a look — it has a free trial but is
priced for businesses rather than a flat per-request rate, so it's left out of this
prototype pending a decision on whether the coverage is worth the cost. Adding it (or any
other provider) means writing one more function in `lib/externalEvents.js` alongside
`checkTicketmaster()` — the route and view don't need to change.

## What's real vs. stubbed

This mirrors the open questions in the product spec (`commalendar-spec.md`, if you
still have it from the design pass) — nothing here is hidden, just listed plainly:

| Area | Status |
|---|---|
| Accounts (Organizer or Viewer), sessions, password hashing | **Real.** Plain Express sessions + bcrypt; good enough for a prototype, swap the session store for Redis/Postgres before real traffic. |
| Event posting, editing, cancelling | **Real.** Backed by the JSON file store in `lib/db.js`. |
| Availability calendar + conflict checker | **Real.** `lib/availability.js` is the one place this logic lives; both the Board and the Post page call into it. |
| Board filters (city/state/date/category) + list/calendar view | **Real.** |
| Listing expiry (Basic = 60 days, others = day of event) | **Real**, checked lazily on read — a real deployment should run this as a daily scheduled job instead. |
| Organizer Pass | **Real** as a flag on the user record, but "buying" it is a fake button (`Activate demo pass`) that flips the flag with no charge. |
| Payments | **Real, but optional** — see "Turning on real payments" above. Off by default (demo mode, no card charged) until you add a Stripe key. The Organizer Pass is a one-time charge rather than an auto-renewing subscription; see `lib/payments.js`. |
| Alert emails | **Stubbed.** Viewer accounts store interests, location, and a frequency preference, but nothing actually sends an email yet. Add a transactional provider (Postmark/Resend/SendGrid) and a scheduled job that matches new listings against subscriber interests. |
| Admin/moderation | **Not built.** Anyone can post; there's no report button or admin queue yet. |
| City matching | Exact, case-sensitive-insensitive string match on city + state — no geocoding, no radius search. |
| Outside-platform conflict check | **Real, but optional and Ticketmaster-only** — see "Checking outside sites for conflicts too" above. Off by default until you add an API key. |

## Project layout

```
server.js            entry point — sessions, static files, mounts the routes below
lib/
  db.js              the "database" (a JSON file) — users, events, seed data
  availability.js     the conflict-checker / calendar-counting logic (used by Board + Post)
  externalEvents.js  optional Ticketmaster lookup for the Post page (see above)
  auth.js            session middleware, requireLogin / requireRole guards
  loadEnv.js         tiny .env file reader (no extra dependency for just this)
  payments.js        optional Stripe Checkout integration (see above)
routes/
  home.js, board.js, pricing.js, auth.js, post.js, dashboard.js, account.js
views/               EJS templates (server-rendered, mostly usable without JS)
public/styles.css    the whole visual design in one file
data/db.json          created on first run — this is your "database"
```

## Picking up from here

The fastest path from this prototype to something you'd actually launch:

1. **Turn on real payments** (Stripe Checkout is already wired up — see above,
   just needs a key) and, when you're ready for auto-renewal, replace the
   Organizer Pass's one-time charge with a real Stripe subscription
   (webhook handling for renewals, failed-payment retries, cancellation).
2. **Move `data/db.json` to a real database.** Postgres is the easiest swap —
   `lib/db.js` is the only file that would need rewriting; every route already
   calls through it rather than touching storage directly.
3. **Send the alert emails.** The data is already there (`interests`,
   `location`, `frequency` on each viewer); you need a provider and a scheduled
   job.
4. **Decide the open questions** from the spec: refund policy, whether city
   matching needs real geocoding, and pre- vs. post-moderation for new listings.
