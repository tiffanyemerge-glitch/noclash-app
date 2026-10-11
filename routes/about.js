// /about — see the site audit's D3.3 finding ("founder-led trust"): the page 404'd before this,
// with no founder name, photo, or story anywhere on the site. The content below is a clean
// stub, not an invented bio — see views/about.ejs for the exact fields still marked TODO that
// only the founder can fill in (name, photo, the real "why I built this" story, a LinkedIn/X
// link). Flagged for follow-up in the audit change log.
const express = require('express');
const router = express.Router();

router.get('/about', (req, res) => {
  res.render('about', {
    title: 'About',
    metaDescription: "Why NoClash exists — a shared events calendar built for Hampton Roads community organizers so they can see what's already on the books before they pick a date."
  });
});

module.exports = router;
