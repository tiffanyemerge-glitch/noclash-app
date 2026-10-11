// A fast, free, best-effort count of "public events we're already tracking" across the five
// Hampton Roads cities whose own public calendars NoClash knows how to read (see
// lib/hamptonRoadsEvents.js's header for which five, and why only those). Used to reframe the
// board and cities pages' event counters so they don't just say "0" while NoClash is still thin
// on organizer-posted listings — see the site audit's D3.1 finding ("Make the board visibly
// alive before asking anyone to pay").
//
// Deliberately NOT part of hamptonRoadsEvents.js itself: that module answers "what's on in THIS
// city" for a single request; this one answers "how much are we tracking, region-wide" for a
// page that doesn't want to make five outbound HTTP calls on every single load. A 15-minute
// in-memory cache (reset on process restart — fine, since a stale minute or two of this number
// is harmless) keeps the five feed fetches off the hot path most of the time, and in-flight
// de-duplication (`_pending`) keeps concurrent requests during a cache miss from firing the same
// five fetches five times over.

const { HAMPTON_ROADS_CITIES, checkHamptonRoadsCity } = require('./hamptonRoadsEvents');

const CACHE_TTL_MS = 15 * 60 * 1000;
let _cache = null; // { generatedAt, totalCount, perCity: { [cityNameLowercase]: count } }
let _pending = null;

async function fetchSummary() {
  const results = await Promise.all(
    HAMPTON_ROADS_CITIES.map((c) => checkHamptonRoadsCity({ city: c.city, state: c.state }))
  );
  const perCity = {};
  let totalCount = 0;
  HAMPTON_ROADS_CITIES.forEach((c, i) => {
    const count = results[i].events.length;
    perCity[c.city.toLowerCase()] = count;
    totalCount += count;
  });
  return { generatedAt: Date.now(), totalCount, perCity };
}

// Returns { generatedAt, totalCount, perCity }. Never throws — a feed outage just means that
// city contributes 0 to the total this cycle, same as checkHamptonRoadsCity's own
// never-throws contract.
async function getHamptonRoadsTrackedSummary() {
  if (_cache && Date.now() - _cache.generatedAt < CACHE_TTL_MS) return _cache;
  if (_pending) return _pending;
  _pending = fetchSummary()
    .then((summary) => {
      _cache = summary;
      _pending = null;
      return summary;
    })
    .catch(() => {
      _pending = null;
      // Fall back to the last good cache if we have one; otherwise report zero rather than throw
      // and break the page that's asking.
      return _cache || { generatedAt: Date.now(), totalCount: 0, perCity: {} };
    });
  return _pending;
}

function trackedCountFor(cityName, summary) {
  return (summary && summary.perCity[(cityName || '').toLowerCase()]) || 0;
}

module.exports = { getHamptonRoadsTrackedSummary, trackedCountFor };
