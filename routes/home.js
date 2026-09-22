const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('home', {
    title: 'Home',
    metaTitle: 'NoClash — see what\'s already on the books before you pick a date',
    metaDescription: 'NoClash is the shared community events calendar for organizers. Browse local events for free, check a city\'s calendar before you pick a date, and post your own listing from $1.'
  });
});

module.exports = router;
