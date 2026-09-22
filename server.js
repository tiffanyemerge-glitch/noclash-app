require('./lib/loadEnv')();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { attachUser } = require('./lib/auth');

const app = express();

// Render sits behind its own proxy — without this, req.protocol always reports "http" (so
// canonical/OG URLs would be built wrong) even though the site is only ever served over https.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'noclash-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 14 } // 2 weeks
  })
);

// make the logged-in user, current path, and any one-shot flash message
// available to every view without repeating it in every route
app.use(attachUser);
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  // Base URL + canonical link for every page (routes/event.js overrides canonicalUrl for the
  // one case — filtered /board or /post query strings — where the canonical page is the bare
  // path, not the exact URL requested; everywhere else this default is already correct).
  res.locals.siteUrl = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
  res.locals.canonicalUrl = `${res.locals.siteUrl}${req.path}`;
  res.locals.flash = req.session.flash || null;
  res.locals.flashType = req.session.flashType || null;
  delete req.session.flash;
  delete req.session.flashType;
  // whoever is logged in as ADMIN_EMAIL (an env var, not a stored role) sees the Admin nav link —
  // see lib/auth.js requireAdmin, which is the actual gate on the /admin routes themselves
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  res.locals.isAdmin = !!(adminEmail && res.locals.currentUser && res.locals.currentUser.email.toLowerCase() === adminEmail);
  next();
});

app.use('/', require('./routes/home'));
app.use('/', require('./routes/board'));
app.use('/', require('./routes/pricing'));
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/post'));
app.use('/', require('./routes/dashboard'));
app.use('/', require('./routes/account'));
app.use('/', require('./routes/contact'));
app.use('/', require('./routes/ambassadors'));
app.use('/', require('./routes/admin'));
app.use('/', require('./routes/event'));
app.use('/', require('./routes/seo'));

app.use((req, res) => {
  res.status(404).render('404', { title: 'Not Found' });
});

// catches anything thrown or rejected by an async route (see lib/asyncRoute.js) so a database
// hiccup shows an error page instead of hanging the request
app.use((err, req, res, next) => {
  console.error('[server] unhandled error:', (err && err.stack) || err);
  if (res.headersSent) return next(err);
  res.status(500).send('Something went wrong on our end. Please try again in a moment.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`NoClash running at http://localhost:${PORT}`);
});
