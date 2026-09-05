const express = require('express');
const db = require('../lib/db');
const router = express.Router();

router.get('/pricing', (req, res) => {
  res.render('pricing', { title: 'Pricing', PLANS: db.PLANS });
});

module.exports = router;
