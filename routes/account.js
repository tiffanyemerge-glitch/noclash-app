const express = require('express');
const db = require('../lib/db');
const { requireRole } = require('../lib/auth');
const { asyncRoute } = require('../lib/asyncRoute');
const router = express.Router();

router.get('/account', requireRole('viewer'), (req, res) => {
  res.render('account', { title: 'My Alerts', categories: db.CATEGORIES, user: res.locals.currentUser, errors: [] });
});

router.post('/account', requireRole('viewer'), asyncRoute(async (req, res) => {
  const interests = [].concat(req.body.interests || []);
  const location = (req.body.location || '').trim();
  const frequency = req.body.frequency || 'daily';

  await db.updateUser(res.locals.currentUser.id, { interests, location, frequency });
  req.session.flash = 'Your alert preferences are saved.';
  res.redirect('/account');
}));

module.exports = router;
