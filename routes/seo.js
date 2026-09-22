// robots.txt + a sitemap that's regenerated on every request (not a static file) so newly
// posted events show up in it immediately, without a build step or a background job.
const express = require('express');
const db = require('../lib/db');
const { asyncRoute } = require('../lib/asyncRoute');
const router = express.Router();

// Public, evergreen marketing/browse pages worth listing. Anything account-specific
// (dashboard, admin, account, password reset, etc.) is left out and blocked in robots.txt below.
const STATIC_PATHS = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/board', changefreq: 'hourly', priority: '0.9' },
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
