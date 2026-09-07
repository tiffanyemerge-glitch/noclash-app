const express = require('express');
const db = require('../lib/db');
const { monthCounts, groupByDateThenCity } = require('../lib/availability');
const { asyncRoute } = require('../lib/asyncRoute');
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

router.get('/board', asyncRoute(async (req, res) => {
  const events = await db.publishedEvents();

  const filters = {
    city: req.query.city || 'all',
    state: req.query.state || 'all',
    date: req.query.date || 'all',
    category: req.query.category || 'all'
  };
  const view = req.query.view === 'calendar' ? 'calendar' : 'list';

  // dropdown option lists, built from whatever is actually on the board
  const cities = [...new Set(events.map((e) => e.city))].sort();
  const states = [...new Set(events.map((e) => e.state))].sort();
  const dates = [...new Set(events.map((e) => e.date))].sort();

  const filtered = events.filter((e) => {
    if (filters.city !== 'all' && e.city !== filters.city) return false;
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
    }))
  }));

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
    calDays,
    monthLabel,
    monthParam: `${year}-${String(month + 1).padStart(2, '0')}`,
    prevMonthParam: `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`,
    nextMonthParam: `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`,
    selectedDate,
    selectedDateLabel: selectedDate ? fmtDateLong(selectedDate) : null,
    detail: detail.map((e) => ({ ...e, timeLabel: fmtTime(e.startTime), categoryLabel: db.categoryLabel(e.category) }))
  });
}));

module.exports = router;
