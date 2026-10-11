// robots.txt + a sitemap that's regenerated on every request (not a static file) so newly
// posted events show up in it immediately, without a build step or a background job.
const express = require('express');
const db = require('../lib/db');
const { asyncRoute } = require('../lib/asyncRoute');
const { CITIES } = require('../lib/hamptonRoadsCities');
const router = express.Router();

// Public, evergreen marketing/browse pages worth listing. Anything account-specific
// (dashboard, admin, account, password reset, etc.) is left out and blocked in robots.txt below.
const STATIC_PATHS = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/board', changefreq: 'hourly', priority: '0.9' },
  { path: '/cities', changefreq: 'weekly', priority: '0.8' },
  { path: '/hampton-roads-events-calendar', changefreq: 'weekly', priority: '0.8' },
  { path: '/about', changefreq: 'monthly', priority: '0.5' },
  { path: '/vs/facebook-events', changefreq: 'monthly', priority: '0.5' },
  { path: '/vs/eventbrite', changefreq: 'monthly', priority: '0.5' },
  { path: '/post', changefreq: 'monthly', priority: '0.6' },
  { path: '/pricing', changefreq: 'monthly', priority: '0.5' },
  { path: '/ambassadors', changefreq: 'monthly', priority: '0.4' },
  { path: '/contact', changefreq: 'monthly', priority: '0.3' },
  { path: '/login', changefreq: 'yearly', priority: '0.2' },
  { path: '/signup', changefreq: 'yearly', priority: '0.3' }
];

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

router.get('/sitemap.xml', asyncRoute(async (req, res) => {
  const siteUrl = res.locals.siteUrl;
  const events = await db.publishedEvents();

  const urls = [
    ...STATIC_PATHS.map((p) => ({ loc: `${siteUrl}${p.path}`, changefreq: p.changefreq, priority: p.priority })),
    ...CITIES.map((c) => ({ loc: `${siteUrl}/cities/${c.slug}`, changefreq: 'daily', priority: '0.7' })),
    ...events.map((e) => ({ loc: `${siteUrl}/events/${e.slug}`, changefreq: 'daily', priority: '0.8', lastmod: e.date }))
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (u) =>
        `  <url>\n    <loc>${xmlEscape(u.loc)}</loc>\n${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : ''}    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    )
    .join('\n')}\n</urlset>\n`;

  res.set('Content-Type', 'application/xml');
  res.send(body);
}));

// llms.txt — a plain-text summary for AI assistants and crawlers, same idea as robots.txt but for
// LLMs rather than search spiders (site audit D5.5: this 404'd before). Regenerated per request,
// same as the sitemap, so it never drifts from the site's actual canonical URLs.
router.get('/llms.txt', (req, res) => {
  const siteUrl = res.locals.siteUrl;
  res.set('Content-Type', 'text/plain');
  res.send(
    `# NoClash

> NoClash is a free community events calendar for Hampton Roads, Virginia. Organizers check what's already scheduled in their city before picking a date, then post their own listing from $1. Browsing is always free, no account required.

## Key pages

- [Home](${siteUrl}/): What NoClash is and how it works.
- [Board](${siteUrl}/board): Browse and filter every listed event by city, state, date, and category; see which days already have events booked.
- [Cities](${siteUrl}/cities): Hampton Roads events by city — Norfolk, Virginia Beach, Chesapeake, Portsmouth, Suffolk, Hampton, Newport News, Williamsburg, and Poquoson.
- [Hampton Roads community events calendar](${siteUrl}/hampton-roads-events-calendar): Region-wide overview of NoClash's coverage.
- [Pricing](${siteUrl}/pricing): Listings from $1–$5 per event, or $49/year for unlimited postings with the Organizer Pass.
- [Post an event](${siteUrl}/post): Organizers list an event after checking the conflict calendar.
- [About](${siteUrl}/about): Who built NoClash and why.
- [NoClash vs Facebook Events](${siteUrl}/vs/facebook-events)
- [NoClash vs Eventbrite](${siteUrl}/vs/eventbrite)
`
  );
});

router.get('/robots.txt', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(
    `User-agent: *
Allow: /
Disallow: /admin
Disallow: /dashboard
Disallow: /account
Disallow: /post/confirm
Disallow: /forgot-password
Disallow: /reset-password

Sitemap: ${res.locals.siteUrl}/sitemap.xml
`
  );
});

module.exports = router;
