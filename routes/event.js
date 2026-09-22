// The public, permanent page for a single event — what an organizer actually shares to promote
// their listing (noclashcalendar.com/events/some-event-slug), and what shows up in search
// results, since /board only ever shows a filtered, paginated slice that search engines can't
// meaningfully crawl or index. See lib/db.js for how the slug is generated and kept stable.
const express = require('express');
const db = require('../lib/db');
const { asyncRoute } = require('../lib/asyncRoute');
const router = express.Router();

function fmtDateLong(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function fmtTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

router.get('/events/:slug', asyncRoute(async (req, res) => {
  const event = await db.findEventBySlug(req.params.slug);
  if (!event) {
    return res.status(404).render('404', { title: 'Not Found' });
  }

  const dateLabel = fmtDateLong(event.date);
  const timeLabel = fmtTime(event.startTime);
  const categoryLabel = db.categoryLabel(event.category);
  const locationLabel = `${event.city}, ${event.state}`;

  const metaDescription = (event.description || '').trim()
    ? event.description.trim().slice(0, 155)
    : `${event.name} — ${categoryLabel} in ${locationLabel} on ${dateLabel} at ${timeLabel}. See what else is on the books before you plan around it, on NoClash.`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.name,
    startDate: `${event.date}T${event.startTime}`,
    eventStatus: event.status === 'cancelled' ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: locationLabel,
      address: { '@type': 'PostalAddress', addressLocality: event.city, addressRegion: event.state, addressCountry: 'US' }
    },
    description: metaDescription,
    url: res.locals.canonicalUrl,
    ...(event.organizerName ? { organizer: { '@type': 'Organization', name: event.organizerName } } : {})
  });

  res.render('event', {
    title: event.name,
    metaTitle: `${event.name} — ${locationLabel} | NoClash`,
    metaDescription,
    ogType: 'article',
    jsonLd,
    event: { ...event, dateLabel, timeLabel, categoryLabel, locationLabel }
  });
}));

module.exports = router;
