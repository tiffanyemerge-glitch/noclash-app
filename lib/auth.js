const db = require('./db');

// runs on every request: makes the logged-in user (if any) available as res.locals.currentUser
async function attachUser(req, res, next) {
  if (req.session && req.session.userId) {
    try {
      res.locals.currentUser = await db.findUserById(req.session.userId);
    } catch (err) {
      console.error('[auth] failed to load current user:', (err && err.stack) || err);
      res.locals.currentUser = null;
    }
  } else {
    res.locals.currentUser = null;
  }
  next();
}

function requireLogin(req, res, next) {
  if (!res.locals.currentUser) {
    req.session.flash = 'Log in to continue.';
    req.session.redirectTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!res.locals.currentUser) {
      req.session.flash = 'Log in to continue.';
      req.session.redirectTo = req.originalUrl;
      return res.redirect('/login');
    }
    if (res.locals.currentUser.role !== role) {
      req.session.flash = role === 'organizer'
        ? 'That page is for organizer accounts. You are signed in as a viewer.'
        : 'That page is for viewer accounts. You are signed in as an organizer.';
      return res.redirect('/');
    }
    next();
  };
}

// Admin access isn't a user role in the database — it's whoever is logged in as the address in
// ADMIN_EMAIL (set in Render's environment variables). That's enough for a single site owner
// without adding an 'admin' row to accounts or a promotion flow to build and secure.
function requireAdmin(req, res, next) {
  if (!res.locals.currentUser) {
    req.session.flash = 'Log in to continue.';
    req.session.redirectTo = req.originalUrl;
    return res.redirect('/login');
  }
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  if (!adminEmail || res.locals.currentUser.email.toLowerCase() !== adminEmail) {
    req.session.flash = 'That page is restricted.';
    return res.redirect('/');
  }
  next();
}

module.exports = { attachUser, requireLogin, requireRole, requireAdmin };
