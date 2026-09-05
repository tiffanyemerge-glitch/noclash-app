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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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
