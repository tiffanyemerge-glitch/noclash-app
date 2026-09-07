const express = require('express');
const db = require('../lib/db');
const { monthCounts, groupByDateThenCity } = require('../lib/availability');
const { asyncRoute } = require('../lib/asyncRoute');
const { checkTicketmasterCity } = require('../lib/externalEvents');
const router = express.Router();

function fmtDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtDateLong(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
function fmtTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}
function sameCity(a, b) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

router.get('/board', asyncRoute(async (req, res) => {
  const events = await db.publishedEvents();

  const filters = {
    city: (req.query.city || '').trim() || 'all',
    state: req.query.state || 'all',
    date: req.query.date || 'all',
    category: req.query.category || 'all'
  };
  const view = req.query.view === 'calendar' ? 'calendar' : 'list';

  // dropdown/suggestion lists, built from whatever is actually on the board
  const cities = [...new Set(events.map((e) => e.city))].sort();
  const states = [...new Set(events.map((e) => e.state))].sort();
  const dates = [...new Set(events.map((e) => e.date))].sort();

  const filtered = events.filter((e) => {
    if (filters.city !== 'all' && !sameCity(e.city, filters.city)) return false;
    if (filters.state !== 'all' && e.state !== filters.state) return false;
    if (filters.date !== 'all' && e.date !== filters.date) return false;
    if (filters.category !== 'all' && e.category !== filters.category) return false;
    return true;
  });

  const groups = groupByDateThenCity(filtered).map((g) => ({
    date: g.date,
    dateLabel: fmtDate(g.date),
    cities: g.cities.map((c) => ({
      cityKey: c.cityKey,
      clash: c.events.length > 1,
      events: c.events.map((e) => ({ ...e, timeLabel: fmtTime(e.startTime), categoryLabel: db.categoryLabel(e.category) }))
    })),
    publicEvents: []
  }));

  // Public Search: once someone has picked one specific city + state, look up what's
  // already scheduled on Ticketmaster there and show it alongside NoClash's own listings,
  // tagged "Public Search." This is a live lookup on every request — nothing is imported
  // or stored, so there's no background job and no new table to keep in sync.
  const publicSearch = { active: false, configured: true, error: null, city: null, state: null };
  const publicByDate = {};
  if (filters.city !== 'all' && filters.state !== 'all') {
    publicSearch.active = true;
    publicSearch.city = filters.city;
    publicSearch.state = filters.state;
    const result = await checkTicketmasterCity({ city: filters.city, state: filters.state });
    publicSearch.configured = result.configured;
    publicSearch.error = result.error;

    let publicEvents = result.events;
    if (filters.date !== 'all') publicEvents = publicEvents.filter((e) => e.date === filters.date);
    // Ticketmaster results aren't sorted into NoClash's own categories, so a category
    // filter (which only makes sense for organizer listings) hides them rather than guess.
    if (filters.category !== 'all') publicEvents = [];

    publicEvents.forEach((e) => {
      if (!publicByDate[e.date]) publicByDate[e.date] = [];
      publicByDate[e.date].push(e);
    });
  }

  // fold in any dates that only have public results, no organizer listings yet
  const groupDates = new Set(groups.map((g) => g.date));
  Object.keys(publicByDate).forEach((date) => {
    if (!groupDates.has(date)) {
      groups.push({ date, dateLabel: fmtDate(date), cities: [], publicEvents: [] });
      groupDates.add(date);
    }
  });
  groups.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  groups.forEach((g) => {
    g.publicEvents = (publicByDate[g.date] || []).map((e) => ({ ...e, timeLabel: e.timeLabel || 'Time TBA' }));
  });
  const publicCount = Object.values(publicByDate).reduce((sum, arr) => sum + arr.length, 0);

  // month grid for the calendar view — respects the same filters minus the date filter
  const today = new Date();
  const monthParam = req.query.month; // "YYYY-MM"
  const [year, month] = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
    ? [Number(monthParam.slice(0, 4)), Number(monthParam.slice(5, 7)) - 1]
    : [today.getFullYear(), today.getMonth()];

  const counts = monthCounts(events, year, month, { city: filters.city, state: filters.state, category: filters.category });
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const calDays = [];
  for (let i = 0; i < firstDow; i++) calDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    calDays.push({ day: d, date: dateStr, count: counts[dateStr] || 0 });
  }
  const selectedDate = filters.date !== 'all' && filters.date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`) ? filters.date : null;
  const detail = selectedDate ? filtered.filter((e) => e.date === selectedDate) : [];
  const detailPublic = selectedDate ? (publicByDate[selectedDate] || []).map((e) => ({ ...e, timeLabel: e.timeLabel || 'Time TBA' })) : [];

  const prevMonth = new Date(year, month - 1, 1);
  const nextMonth = new Date(year, month + 1, 1);
  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  res.render('board', {
    title: 'Board',
    filters,
    cities,
    states,
    usStates: db.US_STATES,
    dates: dates.map((d) => ({ value: d, label: fmtDate(d) })),
    categories: db.CATEGORIES,
    view,
    groups,
    count: filtered.length,
    publicSearch,
    publicCount,
    calDays,
    monthLabel,
    monthParam: `${year}-${String(month + 1).padStart(2, '0')}`,
    prevMonthParam: `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`,
    nextMonthParam: `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`,
    selectedDate,
    selectedDateLabel: selectedDate ? fmtDateLong(selectedDate) : null,
    detail: detail.map((e) => ({ ...e, timeLabel: fmtTime(e.startTime), categoryLabel: db.categoryLabel(e.category) })),
    detailPublic
  });
}));

module.exports = router;
