const express = require('express');
const db = require('../lib/db');
const { requireRole } = require('../lib/auth');
const { eventsOnDate, monthCounts } = require('../lib/availability');
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

router.get('/post', requireRole('organizer'), (req, res) => {
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
    categories: db.CATEGORIES,
    PLANS: db.PLANS,
    hasPass: !!(res.locals.currentUser.passActiveUntil && res.locals.currentUser.passActiveUntil > db.todayISO()),
    values: {},
    errors: req.query.error ? [req.query.error] : []
  });
});

router.post('/post', requireRole('organizer'), (req, res) => {
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
  if (plan === 'pass' && !hasPass) errors.push('You don\'t have an active Organizer Pass yet — activate the demo pass from your dashboard, or choose a per-listing plan.');

  if (errors.length) {
    return res.redirect(
      `/post?city=${encodeURIComponent(city || '')}&state=${encodeURIComponent(state || '')}&date=${encodeURIComponent(date || '')}&error=${encodeURIComponent(errors.join(' '))}`
    );
  }

  const event = db.createEvent({
    organizerId: user.id,
    name,
    date,
    startTime,
    city: city.trim(),
    state: state.trim().toUpperCase(),
    category,
    link: noLink ? '' : (link || ''),
    plan
  });

  req.session.flash = `"${event.name}" is posted. (Demo checkout only — ${plan === 'pass' ? 'covered by your Organizer Pass' : `$${db.PLANS[plan].price} was not actually charged`}.)`;
  res.redirect('/dashboard');
});

module.exports = router;
