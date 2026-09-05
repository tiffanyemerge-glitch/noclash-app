// The core mechanic: given a set of published events, tell an organizer (or a browsing
// visitor) how many events already exist on a given day, so a date can be picked with
// eyes open. The same function backs the Board's calendar view, the Post page's
// availability calendar, and the red/green flags in the Board's list view.

function matches(event, filters) {
  if (filters.city && filters.city !== 'all' && event.city.toLowerCase() !== filters.city.toLowerCase()) return false;
  if (filters.state && filters.state !== 'all' && event.state.toUpperCase() !== filters.state.toUpperCase()) return false;
  if (filters.category && filters.category !== 'all' && event.category !== filters.category) return false;
  return true;
}

// events already booked on `date`, matching the given filters (city/state/category are optional)
function eventsOnDate(events, date, filters = {}) {
  return events.filter((e) => e.date === date && matches(e, filters));
}

// { 'YYYY-MM-DD': count } for every day in the given month, matching filters
function monthCounts(events, year, month /* 0-indexed */, filters = {}) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const counts = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    counts[dateStr] = eventsOnDate(events, dateStr, filters).length;
  }
  return counts;
}

// group events by date, then by city — this is what the Board's pinned-flyer list view renders
function groupByDateThenCity(events) {
  const byDate = {};
  events.forEach((e) => {
    byDate[e.date] = byDate[e.date] || {};
    const cityKey = `${e.city}, ${e.state}`;
    byDate[e.date][cityKey] = byDate[e.date][cityKey] || [];
    byDate[e.date][cityKey].push(e);
  });
  const dates = Object.keys(byDate).sort();
  return dates.map((date) => ({
    date,
    cities: Object.keys(byDate[date])
      .sort()
      .map((cityKey) => ({ cityKey, events: byDate[date][cityKey] }))
  }));
}

module.exports = { eventsOnDate, monthCounts, groupByDateThenCity };
