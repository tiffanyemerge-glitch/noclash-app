// Extends the board's "Public Search" results with real local events pulled straight from
// Hampton Roads city governments' own public calendars — not scraped newspaper listings, and
// nothing gets copied into NoClash's own database. Same live-lookup, same-request pattern as
// Ticketmaster in lib/externalEvents.js: nothing is imported or stored, so there's no
// background job and no new table to keep in sync, and every event links back out to the
// source's own page.
//
// Sources, and why these five and not others:
//   - Norfolk, Hampton, Chesapeake, Newport News run the CivicEngage/CivicPlus municipal CMS,
//     which publishes a public RSS feed for "Calendar > All" at a consistent URL pattern —
//     no key, no partner agreement, just a feed anyone can read.
//   - Portsmouth's city site doesn't run CivicEngage; its public events calendar instead lives
//     on a separate WordPress site (portsvaevents.com) that ships a standard iCal export from
//     the widely used "The Events Calendar" plugin — also a plain public feed.
//   - Virginia Beach's calendar setup hasn't been confirmed yet, so it's left out for now
//     rather than guessed at.
//   - Eventbrite's public Event Search API was shut off to third-party apps in Feb 2020 (see
//     the comment in externalEvents.js) and pilotonline.com's calendar runs on Evvnt, whose feed
//     access is partner-gated — neither is reachable without a business relationship, so neither
//     is wired in here.
//   - WAVY/WTKR/WVEC: WTKR's own community calendar is a public Google Calendar, confirmed
//     reachable, but effectively abandoned (one upcoming entry across the whole feed as of this
//     writing) — not worth surfacing as a "local events" source. WAVY's and WVEC's setups
//     haven't been confirmed. None are wired in.
//
// Each source function always resolves (never throws) and returns { provider, events, error } —
// same contract as the Ticketmaster functions, so callers don't need to special-case failures.

const CIVIC_ENGAGE_CITIES = [
  { key: 'norfolk', city: 'Norfolk', state: 'VA', label: 'Norfolk, VA — City Calendar', feedUrl: 'https://www.norfolk.gov/RSSFeed.aspx?ModID=58&CID=All-calendar.xml' },
  { key: 'hampton', city: 'Hampton', state: 'VA', label: 'Hampton, VA — City Calendar', feedUrl: 'https://www.hampton.gov/RSSFeed.aspx?ModID=58&CID=All-calendar.xml' },
  { key: 'chesapeake', city: 'Chesapeake', state: 'VA', label: 'Chesapeake, VA — City Calendar', feedUrl: 'https://www.cityofchesapeake.net/RSSFeed.aspx?ModID=58&CID=All-calendar.xml' },
  { key: 'newport news', city: 'Newport News', state: 'VA', label: 'Newport News, VA — City Calendar', feedUrl: 'https://www.nnva.gov/RSSFeed.aspx?ModID=58&CID=All-calendar.xml' }
];

const ICAL_CITIES = [
  { key: 'portsmouth', city: 'Portsmouth', state: 'VA', label: 'Portsmouth, VA — Events Calendar', feedUrl: 'https://portsvaevents.com/events/list/?ical=1' }
];

const HAMPTON_ROADS_CITIES = [...CIVIC_ENGAGE_CITIES, ...ICAL_CITIES];

function sameCity(a, b) {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
}

function findHamptonRoadsCity(city, state) {
  if ((state || '').toUpperCase() !== 'VA') return null;
  return HAMPTON_ROADS_CITIES.find((c) => sameCity(c.city, city)) || null;
}

function isHamptonRoadsCity(city, state) {
  return !!findHamptonRoadsCity(city, state);
}

async function fetchText(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'NoClashBot/1.0 (+https://noclashcalendar.com)' } });
    clearTimeout(timeout);
    if (!resp.ok) return { text: null, error: `returned an error (HTTP ${resp.status})` };
    return { text: await resp.text(), error: null };
  } catch (err) {
    clearTimeout(timeout);
    return { text: null, error: err.name === 'AbortError' ? 'took too long to respond' : 'could not be reached right now' };
  }
}

function decodeXmlEntities(str) {
  return (str || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function stripCdata(str) {
  const m = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec((str || '').trim());
  return m ? m[1] : str;
}

// "September 24, 2026" or "September 21, 2026 - September 24, 2026" -> the FIRST date, as YYYY-MM-DD.
// Multi-day entries (a lot of what these feeds carry is road closures spanning weeks) are shown
// on their start date only — good enough for "what's going on that day," which is what the
// board's Public Search is for.
const MONTHS = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
function parseCivicEngageDate(raw) {
  const text = decodeXmlEntities(raw || '');
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/.exec(text);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${String(m[2]).padStart(2, '0')}`;
}

// "07:00 PM - 10:00 PM" -> "7:00 PM"
function parseCivicEngageTime(raw) {
  const text = decodeXmlEntities(raw || '');
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(text);
  return m ? `${Number(m[1])}:${m[2]} ${m[3].toUpperCase()}` : null;
}

function parseCivicEngageRss(xml, source) {
  const events = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRe.exec(xml))) {
    const block = match[1];
    const title = decodeXmlEntities(stripCdata((/<title>([\s\S]*?)<\/title>/.exec(block) || [])[1]));
    const link = decodeXmlEntities(stripCdata((/<link>([\s\S]*?)<\/link>/.exec(block) || [])[1]));
    const dates = (/<calendarEvent:EventDates>([\s\S]*?)<\/calendarEvent:EventDates>/.exec(block) || [])[1];
    const times = (/<calendarEvent:EventTimes>([\s\S]*?)<\/calendarEvent:EventTimes>/.exec(block) || [])[1];
    const location = (/<calendarEvent:Location>([\s\S]*?)<\/calendarEvent:Location>/.exec(block) || [])[1];
    const date = parseCivicEngageDate(dates);
    if (!title || !link || !date) continue; // skip anything we can't place on a day
    events.push({
      name: title,
      url: link,
      venue: location ? decodeXmlEntities(location) : null,
      date,
      timeLabel: parseCivicEngageTime(times),
      source
    });
  }
  return events;
}

// Minimal RFC 5545 iCal parser — just enough to pull out SUMMARY/DTSTART/LOCATION/URL per VEVENT.
// Unfolds continuation lines (a line starting with a space/tab is a continuation of the previous
// one) before splitting into events, per the spec.
function parseIcalEvents(ics, source) {
  const unfolded = ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const events = [];
  const veventRe = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  let match;
  while ((match = veventRe.exec(unfolded))) {
    const lines = match[1].split('\n').map((l) => l.trim()).filter(Boolean);
    const get = (prefix) => {
      const line = lines.find((l) => l === prefix || l.startsWith(prefix + ':') || l.startsWith(prefix + ';'));
      if (!line) return null;
      const idx = line.indexOf(':');
      return idx === -1 ? null : line.slice(idx + 1).trim();
    };
    const summary = get('SUMMARY');
    const dtstartRaw = get('DTSTART');
    const url = get('URL');
    const location = get('LOCATION');
    if (!summary || !dtstartRaw) continue;

    // DTSTART is either an all-day "YYYYMMDD" or a timestamp "YYYYMMDDTHHMMSS[Z]".
    const dm = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(dtstartRaw);
    if (!dm) continue;
    const date = `${dm[1]}-${dm[2]}-${dm[3]}`;
    let timeLabel = null;
    if (dm[4]) {
      const h = Number(dm[4]);
      const period = h >= 12 ? 'PM' : 'AM';
      const hour12 = ((h + 11) % 12) + 1;
      timeLabel = `${hour12}:${dm[5]} ${period}`;
    }
    events.push({
      name: summary.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' '),
      url: url || null,
      venue: location ? location.replace(/\\,/g, ',').replace(/\\n/gi, ', ') : null,
      date,
      timeLabel,
      source
    });
  }
  return events;
}

// Looks up one Hampton Roads city's own public calendar. Always resolves (never throws) —
// same { provider, configured, events, error } shape as the Ticketmaster functions in
// externalEvents.js, so routes/board.js can treat every provider the same way.
async function checkHamptonRoadsCity({ city, state }) {
  const config = findHamptonRoadsCity(city, state);
  if (!config) {
    return { provider: null, configured: true, events: [], error: null };
  }

  const { text, error } = await fetchText(config.feedUrl);
  if (error) {
    return { provider: config.label, configured: true, events: [], error: `${config.label} ${error}.` };
  }

  try {
    const isIcal = ICAL_CITIES.some((c) => c.key === config.key);
    const events = isIcal ? parseIcalEvents(text, config.label) : parseCivicEngageRss(text, config.label);
    // These are live municipal calendars, so they include everything from festivals and
    // farmers markets to city council meetings and road closures — same mix the city's own
    // calendar page shows. Only trim to "not already in the past."
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = events.filter((e) => e.date >= today).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return { provider: config.label, configured: true, events: upcoming, error: null };
  } catch (err) {
    return { provider: config.label, configured: true, events: [], error: `Could not read ${config.label}'s calendar feed.` };
  }
}

module.exports = { HAMPTON_ROADS_CITIES, isHamptonRoadsCity, findHamptonRoadsCity, checkHamptonRoadsCity, parseCivicEngageRss, parseIcalEvents };
