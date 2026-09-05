const db = require('./db');

// runs on every request: makes the logged-in user (if any) available as res.locals.currentUser
function attachUser(req, res, next) {
  if (req.session && req.session.userId) {
    res.locals.currentUser = db.findUserById(req.session.userId) || null;
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

module.exports = { attachUser, requireLogin, requireRole };
