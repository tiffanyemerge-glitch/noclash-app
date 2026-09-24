// Near-Conflict Auto-Flag scoring engine — see the "NoClash — Near-Conflict Auto-Flag Spec"
// project doc for the full design. One scoring function backs three things: the live in-form
// check, the date-picker's red/amber dots, and the server-side re-check on submit — so the
// number an organizer sees while typing is exactly the number that gets stored.
//
// Thresholds, radius and points are grouped in CONFIG below on purpose (per the spec: "live in
// config so they can be tuned after launch without a deploy") — nothing else in this file should
// need to change to retune scoring.

const { distanceMiles } = require('./geocoding');

const CONFIG = {
  candidateWindowDays: 1, // ± this many calendar days
  candidateRadiusMiles: 25,
  sameVenueRadiusMiles: 0.15, // close enough to call it "the same place" even with geocoding jitter
  closeTimeGapHours: 3,
  directClashScore: 70,
  nearConflictScore: 45,
  // Virtual events skip distance entirely (see scorePair), so the spec asks for a stricter bar
  // before they're worth flagging at all — a virtual event's real threshold is this, not the
  // normal nearConflictScore.
  virtualFlagFloor: 50,
  points: {
    time: { overlap: 40, sameDayClose: 30, sameDayFar: 20, adjacentDay: 10 },
    distance: { sameVenue: 30, under5mi: 25, under15mi: 15, under25mi: 5 },
    audience: { sameCategory: 20, relatedCategory: 10, perSharedTag: 5, maxSharedTagBonus: 10 },
    sizeBonus: 10,
    sizeBonusThreshold: 500
  },
  panelMax: 5,
  clearDateSuggestions: 3,
  clearDateSearchDays: 14
};

// Category pairs that count as "related" for the audience score — a config object rather than a
// DB table for now (NoClash's existing CATEGORIES list is itself a flat in-code array, not a DB
// table, so this matches that pattern). Move this to an admin-editable table later if the list
// needs to change more often than a deploy allows.
const RELATED_CATEGORIES = [
  ['Music', 'Arts'],
  ['Arts', 'Market'],
  ['Market', 'Food'],
  ['Food', 'Family'],
  ['Civic', 'Fundraiser'],
  ['Family', 'Fundraiser']
];

function categoriesRelated(a, b) {
  if (!a || !b) return false;
  return RELATED_CATEGORIES.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

// Audience types that shouldn't count as competing for the same crowd even if everything else
// matches — e.g. a kids' storytime and a 21+ bar crawl aren't really fighting for the same people.
const INCOMPATIBLE_AUDIENCE_PAIRS = [
  ['all_ages', 'adult_21'],
  ['family', 'adult_21']
];

function audienceIncompatible(a, b) {
  if (!a || !b || a === b) return false;
  return INCOMPATIBLE_AUDIENCE_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

function dateDiffDays(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00');
  const b = new Date(isoB + 'T00:00:00');
  return Math.round((a - b) / 86400000);
}

// Local copy of lib/db.js's addDays — duplicated rather than required so this module has no
// dependency on the DB layer (which needs pg/bcryptjs and a live connection string) and can be
// unit-tested in isolation. Keep in sync if the date-string format ever changes.
function addDaysLocal(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Minutes since midnight. All-day/missing-time events aren't a real case in NoClash today (every
// event requires a start time), so this only ever fills in a missing END time (default: start + 2h).
function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '0:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

function timeRange(event) {
  const start = toMinutes(event.startTime);
  const end = event.endTime ? toMinutes(event.endTime) : start + 120;
  return { start, end: Math.max(end, start + 15) };
}

function timeOfDayLabel(hhmm) {
  const h = Number(String(hhmm || '0').split(':')[0]);
  if (h < 5) return 'night';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

// Scores how "same day" two events' clocks are: overlap > close-together > same-day-but-far-apart.
function scoreTimeSameDay(newEvent, existing, pts) {
  const a = timeRange(newEvent);
  const b = timeRange(existing);
  const overlaps = a.start < b.end && b.start < a.end;
  if (overlaps) return { points: pts.overlap, label: `Same ${timeOfDayLabel(existing.startTime)} · overlapping times` };

  const gapMinutes = a.end <= b.start ? b.start - a.end : a.start - b.end;
  if (gapMinutes < CONFIG.closeTimeGapHours * 60) {
    return { points: pts.sameDayClose, label: `Same ${timeOfDayLabel(existing.startTime)}` };
  }
  return { points: pts.sameDayFar, label: 'Same day' };
}

function scoreTime(newEvent, existing) {
  const pts = CONFIG.points.time;
  const diff = dateDiffDays(newEvent.date, existing.date);
  if (diff === 0) return scoreTimeSameDay(newEvent, existing, pts);
  if (Math.abs(diff) === 1) {
    return { points: pts.adjacentDay, label: diff > 0 ? 'The day before' : 'The day after' };
  }
  return { points: 0, label: null };
}

function scoreDistance(newEvent, existing) {
  const pts = CONFIG.points.distance;
  if (newEvent.isVirtual || existing.isVirtual) return { points: 0, label: null, distanceMi: null, skipped: 'virtual' };
  const a = newEvent.lat != null && newEvent.lng != null ? { lat: newEvent.lat, lng: newEvent.lng } : null;
  const b = existing.lat != null && existing.lng != null ? { lat: existing.lat, lng: existing.lng } : null;
  if (!a || !b) return { points: 0, label: null, distanceMi: null, skipped: 'ungeocoded' };

  const miles = distanceMiles(a, b);
  const sameVenue =
    miles <= CONFIG.sameVenueRadiusMiles ||
    (newEvent.venue && existing.venue && newEvent.venue.trim().toLowerCase() === existing.venue.trim().toLowerCase());

  if (sameVenue) return { points: pts.sameVenue, label: 'same venue', distanceMi: miles };
  if (miles < 5) return { points: pts.under5mi, label: `${miles.toFixed(1)} mi away`, distanceMi: miles };
  if (miles < 15) return { points: pts.under15mi, label: `${miles.toFixed(1)} mi away`, distanceMi: miles };
  if (miles < 25) return { points: pts.under25mi, label: `${miles.toFixed(1)} mi away`, distanceMi: miles };
  return { points: 0, label: `${miles.toFixed(1)} mi away`, distanceMi: miles };
}

function scoreAudience(newEvent, existing) {
  const pts = CONFIG.points.audience;
  if (audienceIncompatible(newEvent.audienceType, existing.audienceType)) {
    return { points: 0, label: null };
  }

  let points = 0;
  let label = null;
  if (newEvent.category && newEvent.category === existing.category) {
    points += pts.sameCategory;
    label = `also a ${existing.categoryLabel || existing.category} event`;
  } else if (categoriesRelated(newEvent.category, existing.category)) {
    points += pts.relatedCategory;
    label = 'a related kind of event';
  }

  const newTags = new Set((newEvent.tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean));
  const existingTags = (existing.tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  const shared = existingTags.filter((t) => newTags.has(t));
  if (shared.length) {
    points += Math.min(shared.length, 2) * pts.perSharedTag;
    label = shared.length === 1 ? `both tagged "${shared[0]}"` : `share ${shared.length} tags`;
  }

  return { points: Math.min(points, 30), label };
}

function scoreSizeBonus(existing) {
  const pts = CONFIG.points.sizeBonus;
  if ((existing.expectedAttendance || 0) >= CONFIG.points.sizeBonusThreshold) return pts;
  return 0;
}

function tierFor(score, isVirtualEither) {
  const floor = isVirtualEither ? CONFIG.virtualFlagFloor : CONFIG.nearConflictScore;
  if (score >= CONFIG.directClashScore) return 'direct';
  if (score >= floor) return 'near';
  return null;
}

// Scores one existing event against the event being submitted/edited. Returns null if it doesn't
// clear the flag floor at all (the common case — most pairs of events score 0).
function scorePair(newEvent, existing) {
  const time = scoreTime(newEvent, existing);
  const distance = scoreDistance(newEvent, existing);
  const audience = scoreAudience(newEvent, existing);
  const size = scoreSizeBonus(existing);
  const score = Math.min(100, time.points + distance.points + audience.points + size);
  const isVirtualEither = !!(newEvent.isVirtual || existing.isVirtual);
  const tier = tierFor(score, isVirtualEither);
  if (!tier) return null;

  const reasonParts = [time.label, distance.label, audience.label].filter(Boolean);
  const reason = reasonParts.length
    ? reasonParts[0].charAt(0).toUpperCase() + reasonParts[0].slice(1) + (reasonParts.length > 1 ? ' · ' + reasonParts.slice(1).join(' · ') : '')
    : 'Close in time and audience';

  return {
    score,
    tier, // 'direct' | 'near'
    reason,
    distanceMi: distance.distanceMi,
    distanceSkipped: distance.skipped || null,
    breakdown: { time: time.points, distance: distance.points, audience: audience.points, size }
  };
}

// Which published events are even worth scoring against `newEvent`. Keeps the ±1-day/25mi window
// from the spec; a virtual event (or one whose venue couldn't be geocoded) can't be filtered by
// distance, so it widens to every event in the day window instead of silently finding nothing.
function findCandidates(newEvent, allEvents, { excludeEventId, organizerId } = {}) {
  const hasCoords = newEvent.lat != null && newEvent.lng != null;
  return allEvents.filter((e) => {
    if (e.status !== 'published') return false;
    if (excludeEventId && e.id === excludeEventId) return false;
    if (organizerId && e.organizerId === organizerId) return false;
    if (Math.abs(dateDiffDays(newEvent.date, e.date)) > CONFIG.candidateWindowDays) return false;

    if (newEvent.isVirtual || e.isVirtual || !hasCoords || e.lat == null || e.lng == null) {
      // No usable coordinates on one side or the other — fall back to same city/state, which is
      // the best proxy available (matches the pre-existing simple same-city conflict check).
      return (e.city || '').toLowerCase() === (newEvent.city || '').toLowerCase() && (e.state || '').toUpperCase() === (newEvent.state || '').toUpperCase();
    }
    const miles = distanceMiles({ lat: newEvent.lat, lng: newEvent.lng }, { lat: e.lat, lng: e.lng });
    return miles <= CONFIG.candidateRadiusMiles;
  });
}

// The main entry point: scores every real candidate, sorts worst-first, caps the panel at 5.
function checkConflicts(newEvent, allEvents, { excludeEventId, organizerId } = {}) {
  const candidates = findCandidates(newEvent, allEvents, { excludeEventId, organizerId });
  const scored = candidates
    .map((existing) => {
      const result = scorePair(newEvent, existing);
      return result ? { event: existing, ...result } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const ungeocodable = !newEvent.isVirtual && (newEvent.lat == null || newEvent.lng == null) && !!newEvent.venueAttempted;

  return {
    flags: scored.slice(0, CONFIG.panelMax), // capped, for the UI panel
    flagsAll: scored, // uncapped — callers that persist conflict_flags rows want every match, not just the panel's top 5
    totalFlagged: scored.length,
    moreCount: Math.max(0, scored.length - CONFIG.panelMax),
    ungeocodable
  };
}

// "Pick another date" suggestions: the next N dates within `clearDateSearchDays` that have no
// flags at all for this same time/place/category, so the organizer can jump straight to a clear day.
function suggestClearDates(newEvent, allEvents, { excludeEventId, organizerId } = {}) {
  const found = [];
  for (let i = 1; i <= CONFIG.clearDateSearchDays && found.length < CONFIG.clearDateSuggestions; i++) {
    const candidateDate = addDaysLocal(newEvent.date, i);
    const result = checkConflicts({ ...newEvent, date: candidateDate }, allEvents, { excludeEventId, organizerId });
    if (result.totalFlagged === 0) found.push(candidateDate);
  }
  return found;
}

// Highest tier per day in a month, for the date-picker's red/amber dots — same scoring function,
// just run once per day of the month at a fixed midday time (the organizer hasn't picked a time
// yet at this point in the form, so this is necessarily an approximation biased toward "would this
// day even be worth a closer look").
function monthTiers(partialEvent, allEvents, { year, month, organizerId } = {}) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const tiers = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const result = checkConflicts({ ...partialEvent, date, startTime: partialEvent.startTime || '12:00' }, allEvents, { organizerId });
    if (result.flags.length) tiers[date] = result.flags[0].tier;
  }
  return tiers;
}

module.exports = {
  CONFIG,
  RELATED_CATEGORIES,
  categoriesRelated,
  audienceIncompatible,
  scorePair,
  findCandidates,
  checkConflicts,
  suggestClearDates,
  monthTiers
};
