// Turns a venue name / street address into { lat, lng } so the near-conflict scorer (see
// lib/conflictScoring.js) can measure real distance between events instead of just comparing
// city names. Uses the US Census Bureau's public geocoder — free, no API key/env var, no signup —
// which is a fine fit here since NoClash only covers US events (see the near-conflict spec's
// "Geocoding" decision). If Census can't be reached or can't match the address, callers get back
// null and are expected to fall back gracefully (skip distance scoring, or geocode city+state only).
//
// Docs: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.pdf
// Endpoint used: /geocoder/locations/onelineaddress (matches a single free-text address string —
// no need to parse street/city/state/zip into separate fields ourselves).

const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

// Small in-memory cache so the live-typing check (POST /api/conflicts/check, debounced but still
// firing on every keystroke pause) doesn't re-hit Census for the same address over and over, and
// so a page of date-picker dots doesn't re-geocode the same handful of venues on every request.
// Capped and never persisted — geocoding results are also saved on the event row itself once an
// event is actually created, so this cache only matters for the same-session churn before that.
const CACHE_MAX = 500;
const cache = new Map();

function cacheGet(key) {
  if (!cache.has(key)) return undefined;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value); // refresh LRU order
  return value;
}

function cacheSet(key, value) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

// Builds the one-line address Census expects. `venue` may be a venue name, a street address, or
// both — Census's free-text matcher handles a fair range of formats, but a bare venue name with
// no street number often won't match (that's a real, expected "couldn't geocode" case, not a bug).
function buildAddressLine({ venue, city, state }) {
  const parts = [venue, city, state].map((p) => (p || '').trim()).filter(Boolean);
  return parts.join(', ');
}

async function geocode({ venue, city, state }, timeoutMs = 4000) {
  const addressLine = buildAddressLine({ venue, city, state });
  if (!addressLine) return null;

  const cacheKey = addressLine.toLowerCase();
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const url = `${CENSUS_URL}?address=${encodeURIComponent(addressLine)}&benchmark=Public_AR_Current&format=json`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'NoClashBot/1.0 (+https://noclashcalendar.com)' } });
    clearTimeout(timeout);
    if (!resp.ok) {
      cacheSet(cacheKey, null);
      return null;
    }
    const data = await resp.json();
    const match = data && data.result && data.result.addressMatches && data.result.addressMatches[0];
    if (!match || !match.coordinates) {
      cacheSet(cacheKey, null);
      return null;
    }
    const result = { lat: Number(match.coordinates.y), lng: Number(match.coordinates.x) };
    if (!Number.isFinite(result.lat) || !Number.isFinite(result.lng)) {
      cacheSet(cacheKey, null);
      return null;
    }
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    clearTimeout(timeout);
    // Network hiccup or timeout — don't cache these, so a transient failure gets retried on the
    // next call instead of being remembered as "ungeocodable" for the rest of the process's life.
    return null;
  }
}

// Great-circle distance in miles between two lat/lng points (haversine).
function distanceMiles(a, b) {
  if (!a || !b) return null;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 3958.8; // earth radius in miles
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

module.exports = { geocode, distanceMiles, buildAddressLine };
