const express = require('express');
const db = require('../lib/db');
const mailer = require('../lib/mailer');
const { asyncRoute } = require('../lib/asyncRoute');
const router = express.Router();

router.get('/ambassadors', (req, res) => {
  res.render('ambassadors', { title: 'Ambassador Program', values: {}, errors: [] });
});

router.post('/ambassadors/apply', asyncRoute(async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim();
  const instagram = (req.body.instagram || '').trim();
  const tiktok = (req.body.tiktok || '').trim();
  const youtube = (req.body.youtube || '').trim();
  const twitter = (req.body.twitter || '').trim();
  const otherLink = (req.body.otherLink || '').trim();
  const note = (req.body.note || '').trim();
  const followerCount = parseInt(req.body.followerCount, 10);
  const errors = [];

  if (!name) errors.push('Enter your name.');
  if (!email || !email.includes('@')) errors.push('Enter a valid email address.');
  if (!instagram && !tiktok && !youtube && !twitter && !otherLink) errors.push('Add at least one social media link.');
  if (!req.body.followerCount || Number.isNaN(followerCount) || followerCount < 0) {
    errors.push('Enter your total follower / audience count.');
  }

  const values = { name, email, instagram, tiktok, youtube, twitter, otherLink, note, followerCount: req.body.followerCount };

  if (errors.length) {
    return res.status(400).render('ambassadors', { title: 'Ambassador Program', values, errors });
  }

  await db.applyForAmbassador({ name, email, instagram, tiktok, youtube, twitter, otherLink, followerCount, note });

  try {
    await mailer.sendAmbassadorApplicationReceived({ name, email });
  } catch (err) {
    console.error('[ambassadors] admin notify failed:', (err && err.stack) || err);
  }

  req.session.flash = "Thanks! Your application is in — we'll email you once it's reviewed.";
  res.redirect('/ambassadors');
}));

module.exports = router;
