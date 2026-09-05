const express = require('express');
const db = require('../lib/db');
const { requireRole } = require('../lib/auth');
const router = express.Router();

function fmtDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

router.get('/dashboard', requireRole('organizer'), (req, res) => {
  const events = db
    .eventsForOrganizer(res.locals.currentUser.id)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((e) => ({ ...e, dateLabel: fmtDate(e.date), categoryLabel: db.categoryLabel(e.category), planLabel: db.PLANS[e.plan].label }));

  const user = res.locals.currentUser;
  res.render('dashboard', {
    title: 'Dashboard',
    events,
    hasPass: !!(user.passActiveUntil && user.passActiveUntil > db.todayISO()),
    passActiveUntil: user.passActiveUntil ? fmtDate(user.passActiveUntil) : null
  });
});

router.post('/dashboard/pass/activate', requireRole('organizer'), (req, res) => {
  // demo only — a real build swaps this for a Stripe Billing subscription webhook
  const oneYearOut = db.addDays(db.todayISO(), 365);
  db.updateUser(res.locals.currentUser.id, { passActiveUntil: oneYearOut });
  req.session.flash = 'Organizer Pass activated. (Demo only — no card was charged.) Unlimited postings for the next year.';
  res.redirect('/dashboard');
});

router.get('/dashboard/events/:id/edit', requireRole('organizer'), (req, res) => {
  const event = db.eventsForOrganizer(res.locals.currentUser.id).find((e) => e.id === req.params.id);
  if (!event) {
    req.session.flash = 'That listing was not found.';
    req.session.flashType = 'error';
    return res.redirect('/dashboard');
  }
  res.render('edit-event', { title: 'Edit Listing', event, categories: db.CATEGORIES, errors: [] });
});

router.post('/dashboard/events/:id/edit', requireRole('organizer'), (req, res) => {
  const { name, date, startTime, city, state, category, link } = req.body;
  const noLink = req.body.noLink === 'on';
  const errors = [];
  if (!name) errors.push('Enter an event name.');
  if (!date) errors.push('Enter a date.');
  if (!city || !state) errors.push('Enter a city and state.');

  const existing = db.eventsForOrganizer(res.locals.currentUser.id).find((e) => e.id === req.params.id);
  if (!existing) {
    req.session.flash = 'That listing was not found.';
    req.session.flashType = 'error';
    return res.redirect('/dashboard');
  }

  if (errors.length) {
    return res.status(400).render('edit-event', {
      title: 'Edit Listing',
      event: { ...existing, name, date, startTime, city, state, category, link },
      categories: db.CATEGORIES,
      errors
    });
  }

  db.updateEvent(req.params.id, res.locals.currentUser.id, {
    name,
    date,
    startTime,
    city: city.trim(),
    state: state.trim().toUpperCase(),
    category,
    link: noLink ? '' : link || ''
  });
  req.session.flash = 'Listing updated.';
  res.redirect('/dashboard');
});

router.post('/dashboard/events/:id/cancel', requireRole('organizer'), (req, res) => {
  db.cancelEvent(req.params.id, res.locals.currentUser.id);
  req.session.flash = 'Listing cancelled.';
  res.redirect('/dashboard');
});

module.exports = router;
