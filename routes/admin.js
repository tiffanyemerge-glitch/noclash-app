const express = require('express');
const db = require('../lib/db');
const mailer = require('../lib/mailer');
const { requireAdmin } = require('../lib/auth');
const { asyncRoute } = require('../lib/asyncRoute');
const router = express.Router();

router.get('/admin', requireAdmin, asyncRoute(async (req, res) => {
  const [ambassadors, commissions] = await Promise.all([db.listAmbassadors(), db.listCommissions()]);

  const withStats = ambassadors.map((a) => {
    const own = commissions.filter((c) => c.ambassadorId === a.id);
    const owedCents = own.filter((c) => !c.paidOut).reduce((sum, c) => sum + c.amountCents, 0);
    const paidCents = own.filter((c) => c.paidOut).reduce((sum, c) => sum + c.amountCents, 0);
    return { ...a, referralCount: own.length, owedCents, paidCents, commissions: own.filter((c) => !c.paidOut) };
  });

  res.render('admin', {
    title: 'Admin',
    pending: withStats.filter((a) => a.status === 'pending'),
    approved: withStats.filter((a) => a.status === 'approved'),
    rejected: withStats.filter((a) => a.status === 'rejected')
  });
}));

router.post('/admin/ambassadors/:id/approve', requireAdmin, asyncRoute(async (req, res) => {
  const ambassador = await db.approveAmbassador(req.params.id);
  if (!ambassador) {
    req.session.flash = 'That application was not found.';
    req.session.flashType = 'error';
    return res.redirect('/admin');
  }

  try {
    await mailer.sendAmbassadorApproved({ to: ambassador.email, name: ambassador.name, code: ambassador.code });
  } catch (err) {
    console.error('[admin] ambassador approval email failed:', (err && err.stack) || err);
  }

  req.session.flash = `Approved ${ambassador.name} — code ${ambassador.code}.`;
  res.redirect('/admin');
}));

// Resends the approval email (code + free-pass note) to an already-approved ambassador,
// without touching their status, code, or reviewed_at — for cases like a first send that failed
// (e.g. before the sending domain was verified) that the admin only discovers after the fact.
router.post('/admin/ambassadors/:id/resend-email', requireAdmin, asyncRoute(async (req, res) => {
  const ambassador = await db.findAmbassadorById(req.params.id);
  if (!ambassador || ambassador.status !== 'approved') {
    req.session.flash = 'That ambassador was not found.';
    req.session.flashType = 'error';
    return res.redirect('/admin');
  }

  try {
    await mailer.sendAmbassadorApproved({ to: ambassador.email, name: ambassador.name, code: ambassador.code });
    req.session.flash = `Resent the approval email to ${ambassador.email}.`;
  } catch (err) {
    console.error('[admin] ambassador resend email failed:', (err && err.stack) || err);
    req.session.flash = `Could not send the email to ${ambassador.email} — check the server logs.`;
    req.session.flashType = 'error';
  }
  res.redirect('/admin');
}));

router.post('/admin/ambassadors/:id/reject', requireAdmin, asyncRoute(async (req, res) => {
  await db.rejectAmbassador(req.params.id);
  req.session.flash = 'Application rejected.';
  res.redirect('/admin');
}));

router.post('/admin/commissions/:id/mark-paid', requireAdmin, asyncRoute(async (req, res) => {
  await db.markCommissionPaid(req.params.id);
  req.session.flash = 'Marked as paid.';
  res.redirect('/admin');
}));

module.exports = router;
