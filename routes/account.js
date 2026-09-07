const express = require('express');
const db = require('../lib/db');
const { requireRole } = require('../lib/auth');
const { asyncRoute } = require('../lib/asyncRoute');
const { checkTicketmasterCity } = require('../lib/externalEvents');
const router = express.Router();

// Older accounts (and the original signup form) stored this as one free-text field, e.g.
// "Rivertown, OR" or "Rivertown, OR -- within 25 miles". Pull a city + recognized state code
// out of that so we can reuse it for a live Public Search lookup, same as the board.
function parseLocation(location) {
  if (!location) return { city: '', state: '' };
  const match = location.match(/^([^,]+),\s*([A-Za-z]{2})\b/);
  if (match && db.US_STATES.some((s) => s.value === match[2].toUpperCase())) {
    return { city: match[1].trim(), state: match[2].toUpperCase() };
  }
  return { city: location.trim(), state: '' };
}

router.get('/account', requireRole('viewer'), asyncRoute(async (req, res) => {
  const user = res.locals.currentUser;
  const { city, state } = parseLocation(user.location);

  const publicSearch = { active: false, configured: true, error: null, city, state };
  let publicResults = [];
  if (city && state) {
    publicSearch.active = true;
    const result = await checkTicketmasterCity({ city, state, size: 12 });
    publicSearch.configured = result.configured;
    publicSearch.error = result.error;
    publicResults = result.events;
  }

  res.render('account', {
    title: 'My Alerts',
    categories: db.CATEGORIES,
    usStates: db.US_STATES,
    user,
    city,
    state,
    publicSearch,
    publicResults,
    errors: []
  });
}));

router.post('/account', requireRole('viewer'), asyncRoute(async (req, res) => {
  const interests = [].concat(req.body.interests || []);
  const city = (req.body.city || '').trim();
  const state = req.body.state || '';
  const location = city && state ? `${city}, ${state}` : city;
  const frequency = req.body.frequency || 'daily';

  await db.updateUser(res.locals.currentUser.id, { interests, location, frequency });
  req.session.flash = 'Your alert preferences are saved.';
  res.redirect('/account');
}));

module.exports = router;
