// Near-Conflict Auto-Flag API — backs the live in-form check, the date-picker's red/amber dots,
// and (indirectly, via lib/conflictScoring.js) the server-side re-check that routes/post.js and
// routes/dashboard.js run before actually saving an event. See the "NoClash — Near-Conflict
// Auto-Flag Spec" project doc for the full design.
//
// Both routes require an organizer login (same as /post and /dashboard) since they only ever get
// called from those pages and need req.session's current user to exclude the organizer's own
// events from candidates.

const express = require('express');
const db = require('../lib/db');
const { requireRole } = require('../lib/auth');
const { geocode } = require('../lib/geocoding');
const { checkConflicts, suggestClearDates, monthTiers } = require('../lib/conflictScoring');
const { asyncRoute } = require('../lib/asyncRoute');
const router = express.Router();

function parseTags(raw) {
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean).slice(0, 5);
  return String(raw || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5);
}

// Builds the {lat,lng,...} shape lib/conflictScoring.js expects from a form-shaped request body,
// geocoding the venue/address when one was given and this isn't a virtual event.
async function resolveEventInput(body) {
  const isVirtual = body.isVirtual === true || body.isVirtual === 'true' || body.isVirtual === 'on';
  const venue = (body.venue || '').trim();
  const city = (body.city || '').trim();
  const state = (body.state || '').trim().toUpperCase();

  let lat = null;
  let lng = null;
  let venueAttempted = false;
  if (!isVirtual && (venue || (city && state))) {
    venueAttempted = true;
    const point = await geocode({ venue, city, state });
    if (point) {
      lat = point.lat;
      lng = point.lng;
    }
  }

  return {
    date: body.date || '',
    startTime: body.startTime || '',
    endTime: body.endTime || null,
    city,
    state,
    category: body.category || '',
    tags: parseTags(body.tags),
    audienceType: body.audienceType || 'all_ages',
    expectedAttendance: body.expectedAttendance ? parseInt(body.expectedAttendance, 10) : null,
    isVirtual,
    venue,
    lat,
    lng,
    venueAttempted
  };
}

router.post('/api/conflicts/check', requireRole('organizer'), asyncRoute(async (req, res) => {
  const newEvent = await resolveEventInput(req.body);
  if (!newEvent.date || !newEvent.startTime || !newEvent.category || (!newEvent.isVirtual && !newEvent.city)) {
    return res.json({ flags: [], clearDates: [], moreCount: 0, ungeocodable: false, ready: false });
  }

  const allEvents = await db.publishedEvents();
  const excludeEventId = req.body.excludeEventId || null;
  const organizerId = res.locals.currentUser.id;

  const result = checkConflicts(newEvent, allEvents, { excludeEventId, organizerId });
  const clearDates = result.flags.length ? suggestClearDates(newEvent, allEvents, { excludeEventId, organizerId }) : [];

  res.json({
    ready: true,
    geocoded: newEvent.lat != null && newEvent.lng != null,
    ungeocodable: result.ungeocodable,
    flags: result.flags.map((f) => ({
      eventId: f.event.id,
      title: f.event.name,
      slug: f.event.slug,
      date: f.event.date,
      startTime: f.event.startTime,
      venue: f.event.venue || null,
      city: f.event.city,
      state: f.event.state,
      distanceMi: f.distanceMi,
      score: f.score,
      tier: f.tier,
      reason: f.reason
    })),
    moreCount: result.moreCount,
    clearDates
  });
}));

router.get('/api/conflicts/calendar', requireRole('organizer'), asyncRoute(async (req, res) => {
  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10); // 0-indexed, matches routes/post.js's convention
  if (!Number.isFinite(year) || !Number.isFinite(month)) return res.json({ tiers: {} });

  const isVirtual = req.query.isVirtual === 'true';
  const venue = (req.query.venue || '').trim();
  const city = (req.query.city || '').trim();
  const state = (req.query.state || '').trim().toUpperCase();
  if (!isVirtual && !city) return res.json({ tiers: {} });

  let lat = null;
  let lng = null;
  if (!isVirtual) {
    const point = await geocode({ venue, city, state });
    if (point) {
      lat = point.lat;
      lng = point.lng;
    }
  }

  const allEvents = await db.publishedEvents();
  const tiers = monthTiers(
    {
      city,
      state,
      lat,
      lng,
      isVirtual,
      category: req.query.category || '',
      audienceType: req.query.audienceType || 'all_ages',
      tags: parseTags(req.query.tags)
    },
    allEvents,
    { year, month, organizerId: res.locals.currentUser.id }
  );
  res.json({ tiers });
}));

module.exports = router;
