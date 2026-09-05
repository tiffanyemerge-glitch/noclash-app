// Tiny JSON-file "database" for the prototype.
// Swap this module out for Postgres/Prisma (see the product spec) when moving past a demo —
// the read/write functions below are the only thing that would need to change; every
// route calls into here rather than touching the file directly.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DATA_FILE = path.join(__dirname, '..', 'data', 'db.json');

const CATEGORIES = [
  { value: 'Music', label: 'Music' },
  { value: 'Sports', label: 'Sports & Rec' },
  { value: 'Arts', label: 'Arts' },
  { value: 'Food', label: 'Food & Drink' },
  { value: 'Civic', label: 'Civic' },
  { value: 'Market', label: 'Market' },
  { value: 'Family', label: 'Family' },
  { value: 'Fundraiser', label: 'Fundraiser' },
  { value: 'Other', label: 'Other' }
];

// All 50 states + DC, so organizers and browsers pick a state from a list instead of typing a
// two-letter code freehand (which is where most of the "state" typos/mismatches were coming from).
const US_STATES = [
  { value: 'AL', label: 'Alabama' }, { value: 'AK', label: 'Alaska' }, { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' }, { value: 'CA', label: 'California' }, { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' }, { value: 'DE', label: 'Delaware' }, { value: 'DC', label: 'District of Columbia' },
  { value: 'FL', label: 'Florida' }, { value: 'GA', label: 'Georgia' }, { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' }, { value: 'IL', label: 'Illinois' }, { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' }, { value: 'KS', label: 'Kansas' }, { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' }, { value: 'ME', label: 'Maine' }, { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' }, { value: 'MI', label: 'Michigan' }, { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' }, { value: 'MO', label: 'Missouri' }, { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' }, { value: 'NV', label: 'Nevada' }, { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' }, { value: 'NM', label: 'New Mexico' }, { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' }, { value: 'ND', label: 'North Dakota' }, { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' }, { value: 'OR', label: 'Oregon' }, { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' }, { value: 'SC', label: 'South Carolina' }, { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' }, { value: 'TX', label: 'Texas' }, { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' }, { value: 'VA', label: 'Virginia' }, { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' }, { value: 'WI', label: 'Wisconsin' }, { value: 'WY', label: 'Wyoming' }
];

const PLANS = {
  basic: { label: 'Basic', price: 1 },
  standard: { label: 'Standard', price: 3 },
  featured: { label: 'Featured', price: 5 },
  pass: { label: 'Organizer Pass', price: 0 }
};

function categoryLabel(value) {
  const c = CATEGORIES.find((c) => c.value === value);
  return c ? c.label : value;
}

// Date-only helpers, kept in the server's LOCAL time zone on purpose. The calendar grids in
// routes/board.js and routes/post.js are built from local Date methods (getFullYear/getMonth/
// getDate), so "today" and every date computed here has to use the same local-time convention —
// mixing in toISOString() (which is UTC) used to make events land a day off from what the
// calendar grid showed whenever the server's local time and UTC fell on different calendar days.
function localISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayISO() {
  return localISO(new Date());
}

function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return localISO(d);
}

// -------- seed data: a demo organizer account + the sample events from the design mockup --------
function buildSeed() {
  const demoOrganizerId = crypto.randomUUID();
  const today = todayISO();

  function seededEvent(daysFromToday, city, state, name, startTime, category, plan) {
    const date = addDays(today, daysFromToday);
    const expiresOn = plan === 'basic' ? addDays(date, 60) : date;
    return {
      id: crypto.randomUUID(),
      organizerId: demoOrganizerId,
      name,
      date,
      startTime,
      city,
      state,
      category,
      link: '',
      plan,
      status: 'published',
      expiresOn,
      createdAt: new Date().toISOString()
    };
  }

  return {
    users: [
      {
        id: demoOrganizerId,
        email: 'demo-organizer@example.com',
        passwordHash: bcrypt.hashSync('password123', 10),
        role: 'organizer',
        orgName: 'Rivertown Parks & Rec',
        interests: [],
        location: '',
        frequency: 'daily',
        passActiveUntil: null,
        featuredCreditsRemaining: 0,
        createdAt: new Date().toISOString()
      }
    ],
    events: [
      seededEvent(13, 'Bellhaven', 'TX', 'Bellhaven Night Market', '17:00', 'Market', 'basic'),
      seededEvent(14, 'Rivertown', 'OR', 'Riverfront Fall Festival', '10:00', 'Market', 'standard'),
      seededEvent(14, 'Rivertown', 'OR', 'Rivertown Youth Soccer Cup', '09:00', 'Sports', 'basic'),
      seededEvent(14, 'Ashford', 'NC', 'Ashford Community Choir Night', '19:00', 'Arts', 'basic'),
      seededEvent(15, 'Bellhaven', 'TX', 'Second Sunday Food Truck Rally', '12:00', 'Food', 'standard'),
      seededEvent(20, 'Rivertown', 'OR', 'Rivertown Chamber Mixer', '18:00', 'Civic', 'standard'),
      seededEvent(20, 'Rivertown', 'OR', 'Open Mic at The Grange', '18:30', 'Music', 'featured'),
      seededEvent(21, 'Ashford', 'NC', 'Ashford Harvest Fair', '11:00', 'Family', 'basic')
    ]
  };
}

function load() {
  if (!fs.existsSync(DATA_FILE)) {
    const seed = buildSeed();
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2));
    return seed;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// -------- users --------
function findUserByEmail(email) {
  const db = load();
  return db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
}

function findUserById(id) {
  const db = load();
  return db.users.find((u) => u.id === id);
}

function createUser(user) {
  const db = load();
  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    interests: [],
    location: '',
    frequency: 'daily',
    passActiveUntil: null,
    featuredCreditsRemaining: 0,
    orgName: '',
    ...user
  };
  db.users.push(record);
  save(db);
  return record;
}

function updateUser(id, patch) {
  const db = load();
  const u = db.users.find((u) => u.id === id);
  if (!u) return null;
  Object.assign(u, patch);
  save(db);
  return u;
}

// -------- events --------
function listEvents() {
  const db = load();
  const today = todayISO();
  // lazily flip anything past its expiry to "expired" as it's read, mirroring the
  // daily scheduled job described in the spec (fine for a prototype's data volume)
  let changed = false;
  db.events.forEach((e) => {
    if (e.status === 'published' && e.expiresOn < today) {
      e.status = 'expired';
      changed = true;
    }
  });
  if (changed) save(db);
  return db.events;
}

function publishedEvents() {
  return listEvents().filter((e) => e.status === 'published');
}

function eventsForOrganizer(organizerId) {
  return listEvents().filter((e) => e.organizerId === organizerId);
}

function createEvent(event) {
  const db = load();
  const plan = event.plan;
  const expiresOn = plan === 'basic' ? addDays(event.date, 60) : event.date;
  const record = {
    id: crypto.randomUUID(),
    status: 'published',
    link: '',
    expiresOn,
    createdAt: new Date().toISOString(),
    ...event
  };
  db.events.push(record);
  save(db);
  return record;
}

function updateEvent(id, organizerId, patch) {
  const db = load();
  const e = db.events.find((e) => e.id === id && e.organizerId === organizerId);
  if (!e) return null;
  Object.assign(e, patch);
  if (patch.date && e.plan !== 'basic') e.expiresOn = e.date;
  save(db);
  return e;
}

function cancelEvent(id, organizerId) {
  return updateEvent(id, organizerId, { status: 'cancelled' });
}

module.exports = {
  CATEGORIES,
  PLANS,
  US_STATES,
  categoryLabel,
  todayISO,
  addDays,
  findUserByEmail,
  findUserById,
  createUser,
  updateUser,
  listEvents,
  publishedEvents,
  eventsForOrganizer,
  createEvent,
  updateEvent,
  cancelEvent
};
