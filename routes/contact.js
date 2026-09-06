const express = require('express');
const mailer = require('../lib/mailer');
const router = express.Router();

router.get('/contact', (req, res) => {
  res.render('contact', { title: 'Contact Us', values: {}, errors: [] });
});

router.post('/contact', async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim();
  const phone = (req.body.phone || '').trim();
  const message = (req.body.message || '').trim();
  const errors = [];

  if (!name) errors.push('Enter your name.');
  if (!email) errors.push('Enter your email.');
  if (!phone) errors.push('Enter your phone number.');

  if (errors.length) {
    return res.render('contact', { title: 'Contact Us', values: { name, email, phone, message }, errors });
  }

  try {
    const info = await mailer.sendContactMessage({ name, email, phone, message });
    console.log('[contact] send result:', info);
    req.session.flash = "Thanks — we've got your message and will get back to you soon.";
    res.redirect('/contact');
  } catch (err) {
    console.error('[contact] send failed:', (err && err.stack) || err);
    res.render('contact', {
      title: 'Contact Us',
      values: { name, email, phone, message },
      errors: ['Could not send your message right now — please try again in a moment.']
    });
  }
});

module.exports = router;
