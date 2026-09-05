const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const router = express.Router();

router.get('/signup', (req, res) => {
  res.render('signup', { title: 'Create an Account', categories: db.CATEGORIES, values: {}, errors: [] });
});

router.post('/signup', (req, res) => {
  const { role, email, password, confirmPassword, orgName, location, frequency } = req.body;
  const interests = [].concat(req.body.interests || []);
  const errors = [];

  if (role !== 'organizer' && role !== 'viewer') errors.push('Choose an account type: Organizer or Viewer.');
  if (!email || !email.includes('@')) errors.push('Enter a valid email address.');
  if (!password || password.length < 8) errors.push('Password must be at least 8 characters.');
  if (password !== confirmPassword) errors.push('Passwords do not match.');
  if (email && db.findUserByEmail(email)) errors.push('An account with that email already exists.');
  if (role === 'organizer' && !orgName) errors.push('Enter an organization or organizer name.');

  if (errors.length) {
    return res.status(400).render('signup', {
      title: 'Create an Account',
      categories: db.CATEGORIES,
      values: req.body,
      errors
    });
  }

  const user = db.createUser({
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    orgName: role === 'organizer' ? orgName : '',
    interests: role === 'viewer' ? interests : [],
    location: role === 'viewer' ? location || '' : '',
    frequency: role === 'viewer' ? frequency || 'daily' : 'daily'
  });

  req.session.userId = user.id;
  req.session.flash =
    role === 'organizer'
      ? 'Account created. You can post your first event whenever you\'re ready.'
      : 'Account created. We\'ll alert you when something matches your interests.';
  res.redirect(role === 'organizer' ? '/dashboard' : '/account');
});

router.get('/login', (req, res) => {
  res.render('login', { title: 'Log In', values: {}, errors: [] });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.findUserByEmail(email || '');
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(400).render('login', { title: 'Log In', values: req.body, errors: ['Email or password is incorrect.'] });
  }
  req.session.userId = user.id;
  const redirectTo = req.session.redirectTo;
  delete req.session.redirectTo;
  res.redirect(redirectTo || (user.role === 'organizer' ? '/dashboard' : '/board'));
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
