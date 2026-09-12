const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const mailer = require('../lib/mailer');
const { asyncRoute } = require('../lib/asyncRoute');
const router = express.Router();

router.get('/signup', (req, res) => {
  // supports links like /signup?ref=CODE that ambassadors share, prefilling the referral field
  const values = req.query.ref ? { referralCode: String(req.query.ref).toUpperCase() } : {};
  res.render('signup', { title: 'Create an Account', categories: db.CATEGORIES, values, errors: [] });
});

router.post('/signup', asyncRoute(async (req, res) => {
  const { role, email, password, confirmPassword, orgName, location, frequency } = req.body;
  const interests = [].concat(req.body.interests || []);
  const referralCode = (req.body.referralCode || '').trim().toUpperCase();
  const errors = [];

  if (role !== 'organizer' && role !== 'viewer') errors.push('Choose an account type: Organizer or Viewer.');
  if (!email || !email.includes('@')) errors.push('Enter a valid email address.');
  if (!password || password.length < 8) errors.push('Password must be at least 8 characters.');
  if (password !== confirmPassword) errors.push('Passwords do not match.');
  if (email && (await db.findUserByEmail(email))) errors.push('An account with that email already exists.');
  if (role === 'organizer' && !orgName) errors.push('Enter an organization or organizer name.');

  const ambassador = referralCode ? await db.findAmbassadorByCode(referralCode) : null;
  if (referralCode && !ambassador) errors.push('That referral code was not recognized.');

  if (errors.length) {
    return res.status(400).render('signup', {
      title: 'Create an Account',
      categories: db.CATEGORIES,
      values: { ...req.body, referralCode },
      errors
    });
  }

  // Ambassadors get a free Organizer Pass. This checks the signup's OWN email against the
  // ambassador list (separate from `ambassador` above, which is whoever's referral code they
  // used, if any) — so an approved ambassador signing up as an organizer gets the pass activated
  // immediately instead of being asked to pay. See db.approveAmbassador for the other half of
  // this: granting the pass right away if they already had an organizer account when approved.
  const ownAmbassadorRecord = role === 'organizer' ? await db.findApprovedAmbassadorByEmail(email) : null;

  const user = await db.createUser({
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    orgName: role === 'organizer' ? orgName : '',
    interests: role === 'viewer' ? interests : [],
    location: role === 'viewer' ? location || '' : '',
    frequency: role === 'viewer' ? frequency || 'daily' : 'daily',
    referredByAmbassadorId: ambassador ? ambassador.id : null,
    passActiveUntil: ownAmbassadorRecord ? db.addDays(db.todayISO(), 365) : null
  });

  req.session.userId = user.id;
  req.session.flash =
    role === 'organizer'
      ? ownAmbassadorRecord
        ? 'Account created — your free ambassador Organizer Pass is active. Post your first event whenever you\'re ready.'
        : 'Account created. You can post your first event whenever you\'re ready.'
      : 'Account created. We\'ll alert you when something matches your interests.';
  res.redirect(role === 'organizer' ? '/dashboard' : '/account');
}));

router.get('/login', (req, res) => {
  res.render('login', { title: 'Log In', values: {}, errors: [] });
});

router.post('/login', asyncRoute(async (req, res) => {
  const { email, password } = req.body;
  const user = await db.findUserByEmail(email || '');
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(400).render('login', { title: 'Log In', values: req.body, errors: ['Email or password is incorrect.'] });
  }
  req.session.userId = user.id;
  const redirectTo = req.session.redirectTo;
  delete req.session.redirectTo;
  res.redirect(redirectTo || (user.role === 'organizer' ? '/dashboard' : '/board'));
}));

router.get('/forgot-password', (req, res) => {
  res.render('forgot-password', { title: 'Reset Your Password', sent: false, errors: [] });
});

router.post('/forgot-password', asyncRoute(async (req, res) => {
  const email = (req.body.email || '').trim();
  const user = email ? await db.findUserByEmail(email) : null;

  // Always show the same confirmation whether or not the account exists — so this form can't
  // be used to check which emails have accounts.
  if (user) {
    const token = await db.createPasswordResetToken(user.id);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    try {
      await mailer.sendPasswordReset({ to: user.email, resetUrl: `${baseUrl}/reset-password/${token}` });
    } catch (err) {
      console.error('[auth] failed to send password reset email:', (err && err.stack) || err);
    }
  }
  res.render('forgot-password', { title: 'Reset Your Password', sent: true, errors: [] });
}));

router.get('/reset-password/:token', asyncRoute(async (req, res) => {
  const valid = await db.findValidResetToken(req.params.token);
  res.render('reset-password', { title: 'Reset Your Password', invalid: !valid, errors: [] });
}));

router.post('/reset-password/:token', asyncRoute(async (req, res) => {
  const valid = await db.findValidResetToken(req.params.token);
  if (!valid) {
    return res.render('reset-password', { title: 'Reset Your Password', invalid: true, errors: [] });
  }

  const { password, confirmPassword } = req.body;
  const errors = [];
  if (!password || password.length < 8) errors.push('Password must be at least 8 characters.');
  if (password !== confirmPassword) errors.push('Passwords do not match.');
  if (errors.length) {
    return res.status(400).render('reset-password', { title: 'Reset Your Password', invalid: false, errors });
  }

  await db.updateUser(valid.userId, { passwordHash: bcrypt.hashSync(password, 10) });
  await db.consumeResetToken(req.params.token);
  req.session.flash = 'Your password has been changed — log in below.';
  res.redirect('/login');
}));

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
