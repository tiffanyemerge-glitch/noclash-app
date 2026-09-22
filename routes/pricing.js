const express = require('express');
const db = require('../lib/db');
const router = express.Router();

router.get('/pricing', (req, res) => {
  res.render('pricing', {
    title: 'Pricing',
    PLANS: db.PLANS,
    metaDescription: 'NoClash listing prices: $1–$5 per event, or $49/year for an unlimited Organizer Pass. Browsing the events board is always free.'
  });
});

module.exports = router;
