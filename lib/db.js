// Postgres-backed "database" — replaces the old JSON-file prototype storage. Render's disk is
// ephemeral (wiped on every deploy), which is why accounts kept disappearing; everything here
// now lives in a real Postgres database (Neon) so it survives deploys and restarts. Every route
// calls into this module rather than touching the database directly.
//
// Dates (event date/expiresOn, passActiveUntil) are stored as plain "YYYY-MM-DD" TEXT columns
// on purpose, not native Postgres DATE columns — the rest of the app treats dates as local-time
// strings and compares/formats them as strings (see localISO below); a native DATE column would
// come back from Postgres as a UTC-shifted JS Date and reintroduce the exact off-by-one-day bug
// the original localISO() helper was written to avoid.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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

// Options for the new "who's this for" field (near-conflict scoring uses this to zero out the
// audience score for genuinely incompatible crowds — see lib/conflictScoring.js).
const AUDIENCE_TYPES = [
  { value: 'all_ages', label: 'All ages' },
  { value: 'family', label: 'Family / kids' },
  { value: 'adult_21', label: '21+' },
  { value: 'other', label: 'Other' }
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

// Date-only helpers, kept in the server's LOCAL time zone on purpose — see the file header.
function localISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayISO() {
  return localISO(new Date());
}

// Sentinel "expires on" date for a comped, non-expiring Organizer Pass — far enough out that the
// existing `passActiveUntil > todayISO()` string comparisons everywhere else just treat it as
// always active, with no separate "is this forever?" flag needed anywhere.
const FOREVER_PASS_UNTIL = '9999-12-31';

function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return localISO(d);
}

// -------- schema --------
let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL,
          org_name TEXT NOT NULL DEFAULT '',
          interests JSONB NOT NULL DEFAULT '[]',
          location TEXT NOT NULL DEFAULT '',
          frequency TEXT NOT NULL DEFAULT 'daily',
          pass_active_until TEXT,
          featured_credits_remaining INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          organizer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          date TEXT NOT NULL,
          start_time TEXT NOT NULL,
          city TEXT NOT NULL,
          state TEXT NOT NULL,
          category TEXT NOT NULL,
          link TEXT NOT NULL DEFAULT '',
          plan TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'published',
          expires_on TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        ALTER TABLE events ADD COLUMN IF NOT EXISTS slug TEXT;
        ALTER TABLE events ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
        CREATE UNIQUE INDEX IF NOT EXISTS events_slug_idx ON events (slug) WHERE slug IS NOT NULL;
        -- Near-Conflict Auto-Flag fields (see the spec's "Event fields (add if missing)" table).
        -- venue_address is new to NoClash itself (the posting form only ever collected city+state
        -- before this) — it's optional; lat/lng are geocoded from it on save when present, and the
        -- app falls back to a same-city check when it's blank or can't be geocoded.
        ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_address TEXT NOT NULL DEFAULT '';
        ALTER TABLE events ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
        ALTER TABLE events ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
        ALTER TABLE events ADD COLUMN IF NOT EXISTS end_time TEXT;
        ALTER TABLE events ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]';
        ALTER TABLE events ADD COLUMN IF NOT EXISTS audience_type TEXT NOT NULL DEFAULT 'all_ages';
        ALTER TABLE events ADD COLUMN IF NOT EXISTS expected_attendance INTEGER;
        ALTER TABLE events ADD COLUMN IF NOT EXISTS is_virtual BOOLEAN NOT NULL DEFAULT false;
        CREATE INDEX IF NOT EXISTS events_date_idx ON events (date);
        CREATE INDEX IF NOT EXISTS events_lat_lng_idx ON events (lat, lng);
        -- One row per (new event, existing event) pair the scorer flagged at submit time. Kept
        -- even if the existing event is later cancelled (see the spec's edge-case table) — it
        -- just stops showing up in any UI once that event's status isn't 'published' any more.
        CREATE TABLE IF NOT EXISTS conflict_flags (
          id TEXT PRIMARY KEY,
          new_event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          existing_event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          score INTEGER NOT NULL,
          tier TEXT NOT NULL,
          reasons JSONB NOT NULL DEFAULT '{}',
          acknowledged_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS conflict_flags_new_event_idx ON conflict_flags (new_event_id);
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS ambassadors (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          instagram TEXT NOT NULL DEFAULT '',
          tiktok TEXT NOT NULL DEFAULT '',
          youtube TEXT NOT NULL DEFAULT '',
          twitter TEXT NOT NULL DEFAULT '',
          other_link TEXT NOT NULL DEFAULT '',
          follower_count INTEGER NOT NULL DEFAULT 0,
          note TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          code TEXT UNIQUE,
          applied_at TEXT NOT NULL,
          reviewed_at TEXT
        );
        ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_ambassador_id TEXT REFERENCES ambassadors(id);
        CREATE TABLE IF NOT EXISTS comped_passes (
          email TEXT PRIMARY KEY,
          granted_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS commissions (
          id TEXT PRIMARY KEY,
          ambassador_id TEXT NOT NULL REFERENCES ambassadors(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          stripe_session_id TEXT UNIQUE NOT NULL,
          amount_cents INTEGER NOT NULL,
          source TEXT NOT NULL DEFAULT 'pass',
          paid_out BOOLEAN NOT NULL DEFAULT false,
          paid_out_at TEXT,
          created_at TEXT NOT NULL
        );
      `)
      .catch((err) => {
        schemaReady = null; // don't cache a failed attempt — let the next call retry
        throw err;
      });
  }
  return schemaReady;
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    orgName: row.org_name,
    interests: row.interests || [],
    location: row.location,
    frequency: row.frequency,
    passActiveUntil: row.pass_active_until,
    featuredCreditsRemaining: row.featured_credits_remaining,
    referredByAmbassadorId: row.referred_by_ambassador_id,
    createdAt: row.created_at
  };
}

function mapEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizerId: row.organizer_id,
    name: row.name,
    date: row.date,
    startTime: row.start_time,
    city: row.city,
    state: row.state,
    category: row.category,
    link: row.link,
    plan: row.plan,
    status: row.status,
    expiresOn: row.expires_on,
    createdAt: row.created_at,
    slug: row.slug,
    description: row.description || '',
    venue: row.venue_address || '',
    lat: row.lat === null || row.lat === undefined ? null : Number(row.lat),
    lng: row.lng === null || row.lng === undefined ? null : Number(row.lng),
    endTime: row.end_time || null,
    tags: row.tags || [],
    audienceType: row.audience_type || 'all_ages',
    expectedAttendance: row.expected_attendance === null || row.expected_attendance === undefined ? null : Number(row.expected_attendance),
    isVirtual: !!row.is_virtual
  };
}

function mapConflictFlag(row) {
  if (!row) return null;
  return {
    id: row.id,
    newEventId: row.new_event_id,
    existingEventId: row.existing_event_id,
    score: row.score,
    tier: row.tier,
    reasons: row.reasons || {},
    acknowledgedAt: row.acknowledged_at,
    createdAt: row.created_at
  };
}

// -------- event URL slugs --------
// A short, readable, permanent URL per event (e.g. "food-truck-friday-austin-tx") that
// organizers can share to promote their listing — and that search engines can actually crawl
// and index, unlike the filtered /board list. Generated once at creation and never changed
// afterwards, so a link someone already shared/bookmarked/printed keeps working.
function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function generateUniqueSlug(name, city, state, excludeId) {
  const base = slugify(`${name} ${city} ${state}`) || 'event';
  let candidate = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { rows } = await pool.query('SELECT id FROM events WHERE slug = $1 AND id != $2', [candidate, excludeId || '']);
    if (rows.length === 0) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

// -------- users --------
async function findUserByEmail(email) {
  await ensureSchema();
  const { rows } = await pool.query('SELECT * FROM users WHERE lower(email) = lower($1)', [String(email)]);
  return mapUser(rows[0]);
}

async function findUserById(id) {
  await ensureSchema();
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return mapUser(rows[0]);
}

async function createUser(user) {
  await ensureSchema();
  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    interests: [],
    location: '',
    frequency: 'daily',
    passActiveUntil: null,
    featuredCreditsRemaining: 0,
    orgName: '',
    referredByAmbassadorId: null,
    ...user
  };
  await pool.query(
    `INSERT INTO users (id, email, password_hash, role, org_name, interests, location, frequency, pass_active_until, featured_credits_remaining, referred_by_ambassador_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      record.id,
      record.email,
      record.passwordHash,
      record.role,
      record.orgName,
      JSON.stringify(record.interests),
      record.location,
      record.frequency,
      record.passActiveUntil,
      record.featuredCreditsRemaining,
      record.referredByAmbassadorId,
      record.createdAt
    ]
  );
  return record;
}

async function updateUser(id, patch) {
  await ensureSchema();
  const current = await findUserById(id);
  if (!current) return null;
  const merged = { ...current, ...patch };
  await pool.query(
    `UPDATE users SET email=$2, password_hash=$3, role=$4, org_name=$5, interests=$6, location=$7, frequency=$8, pass_active_until=$9, featured_credits_remaining=$10, referred_by_ambassador_id=$11
     WHERE id=$1`,
    [
      id,
      merged.email,
      merged.passwordHash,
      merged.role,
      merged.orgName,
      JSON.stringify(merged.interests),
      merged.location,
      merged.frequency,
      merged.passActiveUntil,
      merged.featuredCreditsRemaining,
      merged.referredByAmbassadorId
    ]
  );
  return merged;
}

// -------- events --------
async function listEvents() {
  await ensureSchema();
  const today = todayISO();
  // lazily flip anything past its expiry to "expired" as it's read, mirroring the
  // daily scheduled job described in the spec (fine for this app's data volume)
  await pool.query(`UPDATE events SET status = 'expired' WHERE status = 'published' AND expires_on < $1`, [today]);
  const { rows } = await pool.query('SELECT * FROM events ORDER BY created_at');

  // Backfill a slug for any event created before URLs existed — rare (a handful of rows,
  // once each), so doing it lazily here beats a one-off migration script.
  for (const row of rows) {
    if (!row.slug) {
      const slug = await generateUniqueSlug(row.name, row.city, row.state, row.id);
      await pool.query('UPDATE events SET slug = $1 WHERE id = $2', [slug, row.id]);
      row.slug = slug;
    }
  }

  return rows.map(mapEvent);
}

async function publishedEvents() {
  return (await listEvents()).filter((e) => e.status === 'published');
}

async function eventsForOrganizer(organizerId) {
  return (await listEvents()).filter((e) => e.organizerId === organizerId);
}

// Public event page lookup (routes/event.js) — also pulls the organizer's org name so the
// page can show "Hosted by ___" without a second round trip.
async function findEventBySlug(slug) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT e.*, u.org_name AS organizer_org_name
     FROM events e LEFT JOIN users u ON u.id = e.organizer_id
     WHERE e.slug = $1`,
    [slug]
  );
  if (!rows[0]) return null;
  return { ...mapEvent(rows[0]), organizerName: rows[0].organizer_org_name || '' };
}

async function createEvent(event) {
  await ensureSchema();
  const plan = event.plan;
  const expiresOn = plan === 'basic' ? addDays(event.date, 60) : event.date;
  const record = {
    id: crypto.randomUUID(),
    status: 'published',
    link: '',
    description: '',
    venue: '',
    lat: null,
    lng: null,
    endTime: null,
    tags: [],
    audienceType: 'all_ages',
    expectedAttendance: null,
    isVirtual: false,
    expiresOn,
    createdAt: new Date().toISOString(),
    ...event
  };
  record.slug = await generateUniqueSlug(record.name, record.city, record.state, record.id);
  await pool.query(
    `INSERT INTO events (id, organizer_id, name, date, start_time, city, state, category, link, plan, status, expires_on, created_at, slug, description,
       venue_address, lat, lng, end_time, tags, audience_type, expected_attendance, is_virtual)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
    [
      record.id,
      record.organizerId,
      record.name,
      record.date,
      record.startTime,
      record.city,
      record.state,
      record.category,
      record.link,
      record.plan,
      record.status,
      record.expiresOn,
      record.createdAt,
      record.slug,
      record.description,
      record.venue,
      record.lat,
      record.lng,
      record.endTime,
      JSON.stringify(record.tags || []),
      record.audienceType,
      record.expectedAttendance,
      record.isVirtual
    ]
  );
  return record;
}

async function updateEvent(id, organizerId, patch) {
  await ensureSchema();
  const { rows } = await pool.query('SELECT * FROM events WHERE id=$1 AND organizer_id=$2', [id, organizerId]);
  const existing = mapEvent(rows[0]);
  if (!existing) return null;
  const merged = { ...existing, ...patch };
  if (patch.date && merged.plan !== 'basic') merged.expiresOn = merged.date;
  await pool.query(
    `UPDATE events SET name=$3, date=$4, start_time=$5, city=$6, state=$7, category=$8, link=$9, status=$10, expires_on=$11, description=$12,
       venue_address=$13, lat=$14, lng=$15, end_time=$16, tags=$17, audience_type=$18, expected_attendance=$19, is_virtual=$20
     WHERE id=$1 AND organizer_id=$2`,
    [
      id,
      organizerId,
      merged.name,
      merged.date,
      merged.startTime,
      merged.city,
      merged.state,
      merged.category,
      merged.link,
      merged.status,
      merged.expiresOn,
      merged.description || '',
      merged.venue || '',
      merged.lat,
      merged.lng,
      merged.endTime,
      JSON.stringify(merged.tags || []),
      merged.audienceType || 'all_ages',
      merged.expectedAttendance,
      !!merged.isVirtual
    ]
  );
  return merged;
}

// -------- near-conflict flags --------
// Called once per created/edited event with every candidate the scorer flagged (not just the
// panel's capped top 5 — see lib/conflictScoring.js's `flagsAll`), so the full picture survives
// for later tuning even though the organizer only ever saw the top 5 in the UI. acknowledgedAt is
// set at write time because these rows are only ever written at submit, when the organizer has
// (per the submission-UX flow) already seen the panel.
async function recordConflictFlags(newEventId, flags) {
  await ensureSchema();
  // Replace, not append — each call represents this event's full, current flag set (at creation,
  // or again after an edit re-runs the check), so the previous set is stale rather than additive.
  await pool.query('DELETE FROM conflict_flags WHERE new_event_id=$1', [newEventId]);
  if (!flags || !flags.length) return [];
  const now = new Date().toISOString();
  const rows = [];
  for (const flag of flags) {
    const { rows: inserted } = await pool.query(
      `INSERT INTO conflict_flags (id, new_event_id, existing_event_id, score, tier, reasons, acknowledged_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [crypto.randomUUID(), newEventId, flag.event.id, flag.score, flag.tier, JSON.stringify(flag.breakdown || {}), now, now]
    );
    rows.push(mapConflictFlag(inserted[0]));
  }
  return rows;
}

async function conflictFlagsForEvent(eventId) {
  await ensureSchema();
  const { rows } = await pool.query('SELECT * FROM conflict_flags WHERE new_event_id=$1 ORDER BY score DESC', [eventId]);
  return rows.map(mapConflictFlag);
}

async function cancelEvent(id, organizerId) {
  return updateEvent(id, organizerId, { status: 'cancelled' });
}

// -------- ambassador program --------
// Applications are public (no NoClash login required) and start "pending". Approving one mints
// a short, unique referral code from the applicant's name. Anyone who signs up with that code
// gets referred_by_ambassador_id set on their account; buying an Organizer Pass afterwards earns
// the ambassador a 15% commission (see recordCommission below) — see routes/ambassadors.js,
// routes/admin.js, and the pass-confirm step in routes/dashboard.js.
function mapAmbassador(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    instagram: row.instagram,
    tiktok: row.tiktok,
    youtube: row.youtube,
    twitter: row.twitter,
    otherLink: row.other_link,
    followerCount: row.follower_count,
    note: row.note,
    status: row.status,
    code: row.code,
    appliedAt: row.applied_at,
    reviewedAt: row.reviewed_at
  };
}

async function applyForAmbassador(application) {
  await ensureSchema();
  const record = {
    id: crypto.randomUUID(),
    instagram: '',
    tiktok: '',
    youtube: '',
    twitter: '',
    otherLink: '',
    note: '',
    appliedAt: new Date().toISOString(),
    ...application
  };
  await pool.query(
    `INSERT INTO ambassadors (id, name, email, instagram, tiktok, youtube, twitter, other_link, follower_count, note, status, applied_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11)`,
    [
      record.id,
      record.name,
      record.email,
      record.instagram,
      record.tiktok,
      record.youtube,
      record.twitter,
      record.otherLink,
      record.followerCount,
      record.note,
      record.appliedAt
    ]
  );
  return record;
}

async function listAmbassadors() {
  await ensureSchema();
  const { rows } = await pool.query('SELECT * FROM ambassadors ORDER BY applied_at DESC');
  return rows.map(mapAmbassador);
}

async function findAmbassadorById(id) {
  await ensureSchema();
  const { rows } = await pool.query('SELECT * FROM ambassadors WHERE id=$1', [id]);
  return mapAmbassador(rows[0]);
}

async function findAmbassadorByCode(code) {
  await ensureSchema();
  const { rows } = await pool.query(
    "SELECT * FROM ambassadors WHERE lower(code) = lower($1) AND status = 'approved'",
    [String(code)]
  );
  return mapAmbassador(rows[0]);
}

// Used both right after approval (to grant an existing organizer account its free pass
// immediately) and at signup (to grant it the moment an ambassador creates an account).
async function findApprovedAmbassadorByEmail(email) {
  await ensureSchema();
  const { rows } = await pool.query(
    "SELECT * FROM ambassadors WHERE lower(email) = lower($1) AND status = 'approved'",
    [String(email)]
  );
  return mapAmbassador(rows[0]);
}

// Letters/digits from the applicant's name, e.g. "Jane Smith" -> "JANESMITH". Falls back to a
// generic code (with a numeric suffix, same as below) for a name with no usable characters.
function codeFromName(name) {
  const base = String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  return base || 'AMBASSADOR';
}

async function approveAmbassador(id) {
  await ensureSchema();
  const existing = await findAmbassadorById(id);
  if (!existing) return null;
  const base = codeFromName(existing.name);
  let code = base;
  let suffix = 1;
  // codes are unique across all ambassadors, so append a counter on any collision
  for (;;) {
    const { rows } = await pool.query('SELECT 1 FROM ambassadors WHERE code=$1', [code]);
    if (!rows.length) break;
    suffix += 1;
    code = `${base}${suffix}`;
  }
  await pool.query("UPDATE ambassadors SET status='approved', code=$2, reviewed_at=$3 WHERE id=$1", [
    id,
    code,
    new Date().toISOString()
  ]);

  // Ambassadors get a free Organizer Pass. If they already have a NoClash organizer account
  // under this same email, grant it right away rather than waiting on a purchase; someone who
  // hasn't signed up yet gets it the moment they create an organizer account (see routes/auth.js).
  const account = await findUserByEmail(existing.email);
  if (account && account.role === 'organizer' && !(account.passActiveUntil && account.passActiveUntil > todayISO())) {
    await updateUser(account.id, { passActiveUntil: addDays(todayISO(), 365) });
  }

  return findAmbassadorById(id);
}

async function rejectAmbassador(id) {
  await ensureSchema();
  await pool.query("UPDATE ambassadors SET status='rejected', reviewed_at=$2 WHERE id=$1", [id, new Date().toISOString()]);
  return findAmbassadorById(id);
}

function mapCommission(row) {
  if (!row) return null;
  return {
    id: row.id,
    ambassadorId: row.ambassador_id,
    userId: row.user_id,
    stripeSessionId: row.stripe_session_id,
    amountCents: row.amount_cents,
    source: row.source,
    paidOut: row.paid_out,
    paidOutAt: row.paid_out_at,
    createdAt: row.created_at
  };
}

// Idempotent on stripe_session_id — the Stripe Checkout Session id for the pass purchase that
// earned it — so reloading the /dashboard/pass/confirm page never credits the same sale twice.
// Returns null (instead of the new row) when this session was already credited.
async function recordCommission({ ambassadorId, userId, stripeSessionId, amountCents, source }) {
  await ensureSchema();
  const { rows } = await pool.query(
    `INSERT INTO commissions (id, ambassador_id, user_id, stripe_session_id, amount_cents, source, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (stripe_session_id) DO NOTHING
     RETURNING *`,
    [crypto.randomUUID(), ambassadorId, userId, stripeSessionId, amountCents, source, new Date().toISOString()]
  );
  return mapCommission(rows[0]);
}

async function listCommissions() {
  await ensureSchema();
  const { rows } = await pool.query('SELECT * FROM commissions ORDER BY created_at DESC');
  return rows.map(mapCommission);
}

async function markCommissionPaid(id) {
  await ensureSchema();
  await pool.query('UPDATE commissions SET paid_out=true, paid_out_at=$2 WHERE id=$1', [id, new Date().toISOString()]);
}

// -------- comped organizer passes --------
// A manual admin comp (e.g. a partner or vendor) rather than an ambassador referral — same idea
// as the ambassador free-pass grant, but for one-off "give this email a permanent pass" cases.
// Recorded here so it also applies the moment the comped email signs up as an organizer, not
// just when it already has an account (see routes/auth.js).
async function grantForeverOrganizerPass(email) {
  await ensureSchema();
  await pool.query(
    `INSERT INTO comped_passes (email, granted_at) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET granted_at = EXCLUDED.granted_at`,
    [String(email).toLowerCase(), new Date().toISOString()]
  );

  const account = await findUserByEmail(email);
  if (account && account.role === 'organizer') {
    await updateUser(account.id, { passActiveUntil: FOREVER_PASS_UNTIL });
    return { accountFound: true };
  }
  return { accountFound: false };
}

async function findCompedPassByEmail(email) {
  await ensureSchema();
  const { rows } = await pool.query('SELECT 1 FROM comped_passes WHERE lower(email) = lower($1)', [String(email)]);
  return !!rows[0];
}

// For the admin view: every comped email alongside whether it's actively applied yet.
async function listCompedPasses() {
  await ensureSchema();
  const { rows } = await pool.query(`
    SELECT cp.email, cp.granted_at, u.role, u.pass_active_until
    FROM comped_passes cp
    LEFT JOIN users u ON lower(u.email) = lower(cp.email)
    ORDER BY cp.granted_at DESC
  `);
  return rows.map((row) => ({
    email: row.email,
    grantedAt: row.granted_at,
    active: row.role === 'organizer' && row.pass_active_until === FOREVER_PASS_UNTIL
  }));
}

// -------- password reset --------
async function createPasswordResetToken(userId) {
  await ensureSchema();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await pool.query('DELETE FROM password_reset_tokens WHERE user_id=$1', [userId]); // one live link per user
  await pool.query('INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES ($1,$2,$3)', [token, userId, expiresAt]);
  return token;
}

async function findValidResetToken(token) {
  await ensureSchema();
  const { rows } = await pool.query(
    'SELECT * FROM password_reset_tokens WHERE token=$1 AND used_at IS NULL AND expires_at > now()',
    [token]
  );
  return rows[0] ? { userId: rows[0].user_id } : null;
}

async function consumeResetToken(token) {
  await ensureSchema();
  await pool.query('UPDATE password_reset_tokens SET used_at = now() WHERE token=$1', [token]);
}

module.exports = {
  CATEGORIES,
  PLANS,
  US_STATES,
  AUDIENCE_TYPES,
  categoryLabel,
  todayISO,
  addDays,
  FOREVER_PASS_UNTIL,
  findUserByEmail,
  findUserById,
  createUser,
  updateUser,
  listEvents,
  publishedEvents,
  eventsForOrganizer,
  findEventBySlug,
  createEvent,
  updateEvent,
  cancelEvent,
  recordConflictFlags,
  conflictFlagsForEvent,
  createPasswordResetToken,
  findValidResetToken,
  consumeResetToken,
  applyForAmbassador,
  listAmbassadors,
  findAmbassadorById,
  findAmbassadorByCode,
  findApprovedAmbassadorByEmail,
  approveAmbassador,
  rejectAmbassador,
  recordCommission,
  listCommissions,
  markCommissionPaid,
  grantForeverOrganizerPass,
  findCompedPassByEmail,
  listCompedPasses
};
