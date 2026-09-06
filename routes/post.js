const express = require('express');
const db = require('../lib/db');
const { requireRole } = require('../lib/auth');
const { eventsOnDate, monthCounts } = require('../lib/availability');
const { checkExternalProviders, ticketmasterConfigured } = require('../lib/externalEvents');
const payments = require('../lib/payments');
const router = express.Router();

function fmtTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}
function fmtDateLong(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

router.get('/post', requireRole('organizer'), async (req, res) => {
  const city = (req.query.city || '').trim();
  const state = (req.query.state || '').trim().toUpperCase();
  const today = new Date();
  const monthParam = req.query.month;
  const [year, month] = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
    ? [Number(monthParam.slice(0, 4)), Number(monthParam.slice(5, 7)) - 1]
    : [today.getFullYear(), today.getMonth()];

  let calDays = null;
  let selectedDate = req.query.date || null;
  let conflicts = [];
  let externalResults = [];

  if (city && state) {
    const events = db.publishedEvents();
    const counts = monthCounts(events, year, month, { city, state });
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    calDays = [];
    for (let i = 0; i < firstDow; i++) calDays.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      calDays.push({ day: d, date: dateStr, count: counts[dateStr] || 0 });
    }
    if (selectedDate) {
      conflicts = eventsOnDate(events, selectedDate, { city, state }).map((e) => ({
        ...e,
        timeLabel: fmtTime(e.startTime)
      }));
      // also check outside ticketed-event platforms for the same city/day — see
      // lib/externalEvents.js for why this is Ticketmaster rather than Eventbrite
      externalResults = await checkExternalProviders({ city, state, date: selectedDate });
    }
  } else {
    selectedDate = null;
  }

  const prevMonth = new Date(year, month - 1, 1);
  const nextMonth = new Date(year, month + 1, 1);

  res.render('post', {
    title: 'Post an Event',
    city,
    state,
    monthLabel: new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    monthParam: `${year}-${String(month + 1).padStart(2, '0')}`,
    prevMonthParam: `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`,
    nextMonthParam: `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`,
    calDays,
    selectedDate,
    selectedDateLabel: selectedDate ? fmtDateLong(selectedDate) : null,
    conflicts,
    externalResults,
    ticketmasterConfigured: ticketmasterConfigured(),
    stripeConfigured: payments.isConfigured(),
    categories: db.CATEGORIES,
    usStates: db.US_STATES,
    PLANS: db.PLANS,
    hasPass: !!(res.locals.currentUser.passActiveUntil && res.locals.currentUser.passActiveUntil > db.todayISO()),
    values: {},
    errors: req.query.error ? [req.query.error] : []
  });
});

router.post('/post', requireRole('organizer'), async (req, res) => {
  const { name, date, city, state, startTime, category, link, plan } = req.body;
  const noLink = req.body.noLink === 'on';
  const errors = [];

  if (!name) errors.push('Enter an event name.');
  if (!date) errors.push('Pick a date from the calendar above.');
  if (!city || !state) errors.push('Enter a city and state.');
  if (!startTime) errors.push('Enter a start time.');
  if (!['basic', 'standard', 'featured', 'pass'].includes(plan)) errors.push('Choose how you\'re paying.');

  const user = res.locals.currentUser;
  const hasPass = !!(user.passActiveUntil && user.passActiveUntil > db.todayISO());
  if (plan === 'pass' && !hasPass) errors.push('You don\'t have an active Organizer Pass yet — activate it from your dashboard, or choose a per-listing plan.');

  const backToPost = (extraError) =>
    res.redirect(
      `/post?city=${encodeURIComponent(city || '')}&state=${encodeURIComponent(state || '')}&date=${encodeURIComponent(date || '')}&error=${encodeURIComponent(extraError || errors.join(' '))}`
    );

  if (errors.length) return backToPost();

  const pendingEvent = {
    organizerId: user.id,
    name,
    date,
    startTime,
    city: city.trim(),
    state: state.trim().toUpperCase(),
    category,
    link: noLink ? '' : (link || ''),
    plan
  };

  // covered by an existing pass — no charge, post it right away
  if (plan === 'pass') {
    const event = db.createEvent(pendingEvent);
    req.session.flash = `"${event.name}" is posted — covered by your Organizer Pass.`;
    return res.redirect('/dashboard');
  }

  // payments aren't set up — keep the old demo behavior so the app still works without Stripe
  if (!payments.isConfigured()) {
    const event = db.createEvent(pendingEvent);
    req.session.flash = `"${event.name}" is posted. (Demo mode — payments aren't configured yet, so $${db.PLANS[plan].price} was not actually charged. See README.md to turn on real checkout.)`;
    return res.redirect('/dashboard');
  }

  // real payment: hold the event details in the session and send the organizer to Stripe.
  // The event itself isn't created until /post/confirm verifies the charge actually went through.
  req.session.pendingEvent = pendingEvent;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  try {
    const checkoutSession = await payments.createListingCheckout({
      plan,
      priceCents: db.PLANS[plan].price * 100,
      eventName: name,
      successUrl: `${baseUrl}/post/confirm?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/post?city=${encodeURIComponent(pendingEvent.city)}&state=${encodeURIComponent(pendingEvent.state)}&date=${encodeURIComponent(date)}&error=${encodeURIComponent('Checkout cancelled — nothing was charged, and nothing was posted.')}`,
      metadata: { organizerId: user.id, plan }
    });
    res.redirect(303, checkoutSession.url);
  } catch (err) {
    backToPost(`Could not start checkout: ${err.message}`);
  }
});

// Stripe sends the organizer back here after Checkout. We don't trust the redirect by
// itself — we ask Stripe directly (with the secret key) whether this session was actually
// paid before creating the listing.
router.get('/post/confirm', requireRole('organizer'), async (req, res) => {
  const sessionId = req.query.session_id;
  const pending = req.session.pendingEvent;

  if (!sessionId || !pending) {
    req.session.flash = 'Nothing to confirm — start posting again.';
    req.session.flashType = 'error';
    return res.redirect('/post');
  }

  try {
    const checkoutSession = await payments.retrieveSession(sessionId);
    if (checkoutSession.payment_status !== 'paid') {
      req.session.flash = 'That payment did not go through, so nothing was posted.';
      req.session.flashType = 'error';
      return res.redirect('/post');
    }
    const event = db.createEvent(pending);
    delete req.session.pendingEvent;
    req.session.flash = `"${event.name}" is posted — $${(checkoutSession.amount_total / 100).toFixed(2)} charged.`;
    res.redirect('/dashboard');
  } catch (err) {
    req.session.flash = 'Could not confirm your payment with Stripe. If your card was charged and this keeps happening, check the server logs.';
    req.session.flashType = 'error';
    res.redirect('/post');
  }
});

module.exports = router;
