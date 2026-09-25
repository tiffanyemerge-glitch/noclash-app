// SEO locality pages: a hub page (/cities) and one page per principal Hampton Roads city
// (/cities/:slug — e.g. /cities/norfolk-va). Distinct from /board, which is the interactive,
// filterable, query-string-driven browse tool that isn't meaningfully crawlable or indexable
// (see routes/event.js's header comment for the same reasoning applied to /events/:slug vs.
// /board). These pages exist so someone searching "events in Norfolk VA" lands on a clean,
// canonical, keyword-matching URL instead of a generic homepage or an un-indexable query string.
const express = require('express');
const db = require('../lib/db');
const { asyncRoute } = require('../lib/asyncRoute');
const { CITIES, findCityBySlug } = require('../lib/hamptonRoadsCities');
const { checkHamptonRoadsCity, isHamptonRoadsCity } = require('../lib/hamptonRoadsEvents');
const router = express.Router();

function fmtDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}
function sameCity(a, b) {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
}

router.get('/cities', asyncRoute(async (req, res) => {
  const events = await db.publishedEvents();
  const today = db.todayISO();
  const upcoming = events.filter((e) => e.date >= today);

  const cities = CITIES.map((c) => ({
    ...c,
    eventCount: upcoming.filter((e) => sameCity(e.city, c.name) && e.state === c.state).length
  }));

  const siteUrl = res.locals.siteUrl;
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Hampton Roads Events by City',
    description: "Browse upcoming events in every major Hampton Roads, VA city — Norfolk, Virginia Beach, Chesapeake, Portsmouth, Suffolk, Hampton, Newport News, Williamsburg, and Poquoson.",
    url: res.locals.canonicalUrl,
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteUrl}/` },
        { '@type': 'ListItem', position: 2, name: 'Cities', item: res.locals.canonicalUrl }
      ]
    },
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: CITIES.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${siteUrl}/cities/${c.slug}`,
        name: `${c.name}, VA`
      }))
    }
  });

  res.render('cities', {
    title: 'Cities',
    metaTitle: 'Hampton Roads Events by City | NoClash',
    metaDescription: "Browse upcoming events in Norfolk, Virginia Beach, Chesapeake, Portsmouth, Suffolk, Hampton, Newport News, Williamsburg, and Poquoson — see what's on the books before you pick a date.",
    jsonLd,
    cities
  });
}));

router.get('/cities/:slug', asyncRoute(async (req, res) => {
  const city = findCityBySlug(req.params.slug);
  if (!city) {
    return res.status(404).render('404', { title: 'Not Found' });
  }

  const events = await db.publishedEvents();
  const today = db.todayISO();
  const cityEvents = events
    .filter((e) => sameCity(e.city, city.name) && e.state === city.state && e.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, 24)
    .map((e) => ({ ...e, dateLabel: fmtDate(e.date), timeLabel: fmtTime(e.startTime), categoryLabel: db.categoryLabel(e.category) }));

  // For the handful of cities whose own public calendar NoClash already knows how to read
  // (see lib/hamptonRoadsEvents.js), pull a few of its upcoming entries in too — real,
  // city-specific content, and infrastructure the near-conflict board feature already relies
  // on and trusts. checkHamptonRoadsCity always resolves (never throws), so a feed outage
  // just means an empty/error state here, not a broken page.
  let cityFeed = null;
  if (isHamptonRoadsCity(city.name, city.state)) {
    const result = await checkHamptonRoadsCity({ city: city.name, state: city.state });
    cityFeed = {
      provider: result.provider,
      error: result.error,
      events: result.events.slice(0, 6).map((e) => ({ ...e, dateLabel: fmtDate(e.date) }))
    };
  }

  const otherCities = CITIES.filter((c) => c.slug !== city.slug);
  const locationLabel = `${city.name}, ${city.state}`;
  const siteUrl = res.locals.siteUrl;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${locationLabel} Events Calendar`,
    description: city.metaDescription,
    url: res.locals.canonicalUrl,
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteUrl}/` },
        { '@type': 'ListItem', position: 2, name: 'Cities', item: `${siteUrl}/cities` },
        { '@type': 'ListItem', position: 3, name: locationLabel, item: res.locals.canonicalUrl }
      ]
    }
  });

  res.render('city', {
    title: locationLabel,
    metaTitle: `${locationLabel} Events Calendar | NoClash`,
    metaDescription: city.metaDescription,
    jsonLd,
    city,
    locationLabel,
    cityEvents,
    cityFeed,
    otherCities
  });
}));

module.exports = router;
