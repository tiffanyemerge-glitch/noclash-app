// Optional add-on to the conflict checker: look at outside ticketed-event platforms for
// the same city + day, not just what's been posted inside NoClash.
//
// Eventbrite specifically can't power this: their public Event Search API was shut down to
// third-party apps in Feb 2020 (see https://github.com/Automattic/eventbrite-api/issues/83
// and Eventbrite's own platform changelog) — their API now only returns events belonging to
// an organization you already have OAuth access to, which is no help for "what else is
// happening in this city." There is no way around that from an app like this one; it isn't
// a bug in this code, it's Eventbrite's own access policy.
//
// Ticketmaster's Discovery API is the practical stand-in: free to get a key for, and it
// does support searching by city + date range. Its coverage skews toward larger ticketed
// events (concerts, sports, theater) — it won't see a church bake sale or a Little League
// game — so treat this as a supplement to NoClash's own listings, not a replacement.
//
// A broader (but paid, enterprise-priced) option is PredictHQ's Events API, which aggregates
// many categories including community events, festivals, and school/public holidays. Swap or
// add a `checkPredictHQ()` function alongside `checkTicketmaster()` below if that's worth the
// cost for your city coverage — the route that calls this module doesn't care which providers
// are wired in, only that each one returns `{ configured, events, error }`.

const TM_BASE = 'https://app.ticketmaster.com/discovery/v2/events.json';

function ticketmasterConfigured() {
  return !!process.env.TICKETMASTER_API_KEY;
}

function fmtLocalTime(hhmmss) {
  if (!hhmmss) return null;
  const [h, m] = hhmmss.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

// Looks up ticketed events on Ticketmaster for a given city/state/date.
// Always resolves (never throws) — callers get { configured, events, error } and decide what to show.
async function checkTicketmaster({ city, state, date }) {
  if (!ticketmasterConfigured()) {
    return { provider: 'Ticketmaster', configured: false, events: [], error: null };
  }

  const params = new URLSearchParams({
    apikey: process.env.TICKETMASTER_API_KEY,
    city,
    stateCode: state,
    startDateTime: `${date}T00:00:00Z`,
    endDateTime: `${date}T23:59:59Z`,
    size: '10'
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const resp = await fetch(`${TM_BASE}?${params.toString()}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) {
      return { provider: 'Ticketmaster', configured: true, events: [], error: `Ticketmaster returned an error (HTTP ${resp.status}).` };
    }
    const data = await resp.json();
    const raw = (data._embedded && data._embedded.events) || [];
    const events = raw.map((e) => ({
      name: e.name,
      url: e.url,
      venue: e._embedded && e._embedded.venues && e._embedded.venues[0] && e._embedded.venues[0].name,
      timeLabel: fmtLocalTime(e.dates && e.dates.start && e.dates.start.localTime)
    }));
    return { provider: 'Ticketmaster', configured: true, events, error: null };
  } catch (err) {
    clearTimeout(timeout);
    const message = err.name === 'AbortError' ? 'Ticketmaster took too long to respond.' : 'Could not reach Ticketmaster right now.';
    return { provider: 'Ticketmaster', configured: true, events: [], error: message };
  }
}

// Runs every wired-up external provider in parallel. Add more functions above and list
// them here — the Post route and view don't need to change to pick up a new provider.
async function checkExternalProviders({ city, state, date }) {
  const results = await Promise.all([checkTicketmaster({ city, state, date })]);
  return results;
}

// Powers the board's "Public Search" results: given just a city + state (no date), pull
// whatever's already scheduled on Ticketmaster in one call, so the board can slot each
// result under its own day instead of looping a request per date. By default that's a
// rolling window from now (windowDays out), but a caller that already knows which exact
// range it needs (e.g. the calendar view scoping to one displayed month) can pass an
// explicit startDate/endDate instead, so results aren't limited to whatever fits in the
// default window's `size` cap. Always resolves (never throws) — same contract as
// checkTicketmaster.
async function checkTicketmasterCity({ city, state, windowDays = 90, size = 40, startDate, endDate }) {
  if (!ticketmasterConfigured()) {
    return { provider: 'Ticketmaster', configured: false, events: [], error: null };
  }

  const now = new Date();
  const start = startDate || now;
  const end = endDate || new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    apikey: process.env.TICKETMASTER_API_KEY,
    city,
    stateCode: state,
    startDateTime: `${start.toISOString().slice(0, 19)}Z`,
    endDateTime: `${end.toISOString().slice(0, 19)}Z`,
    sort: 'date,asc',
    size: String(size)
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const resp = await fetch(`${TM_BASE}?${params.toString()}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) {
      return { provider: 'Ticketmaster', configured: true, events: [], error: `Ticketmaster returned an error (HTTP ${resp.status}).` };
    }
    const data = await resp.json();
    const raw = (data._embedded && data._embedded.events) || [];
    const events = raw
      .map((e) => ({
        name: e.name,
        url: e.url,
        venue: e._embedded && e._embedded.venues && e._embedded.venues[0] && e._embedded.venues[0].name,
        date: e.dates && e.dates.start && e.dates.start.localDate,
        timeLabel: fmtLocalTime(e.dates && e.dates.start && e.dates.start.localTime)
      }))
      .filter((e) => e.date);
    return { provider: 'Ticketmaster', configured: true, events, error: null };
  } catch (err) {
    clearTimeout(timeout);
    const message = err.name === 'AbortError' ? 'Ticketmaster took too long to respond.' : 'Could not reach Ticketmaster right now.';
    return { provider: 'Ticketmaster', configured: true, events: [], error: message };
  }
}

module.exports = { checkTicketmaster, checkTicketmasterCity, checkExternalProviders, ticketmasterConfigured };
