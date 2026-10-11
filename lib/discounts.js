// Organizer Pass discount codes. Flat, hand-maintained list rather than a database table —
// there's exactly one partner program right now (see claude/chamber-partner-outreach.md in the
// NoClash project) and it's a single shared code, not a per-partner system. If/when chambers
// need individually-attributable codes (open issue in that doc), this is the place to grow into
// a table keyed by partner.
const CODES = {
  CHAMBER: { percentOff: 10, label: 'Chamber Ambassador Partner' }
};

// Pass price lives here (not just in payments.js) so the discount math and the sticker price
// stay next to each other — $49.00 base, matches lib/payments.js createPassCheckout and the
// pricing page.
const PASS_BASE_CENTS = 4900;

// Returns { priceCents, percentOff, label } for a valid code (case/whitespace-insensitive),
// or null if the code is blank or not recognized. Never throws — callers treat an unrecognized
// code as "no discount applied", not a hard error, so a typo doesn't block checkout.
function applyPassDiscount(rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return null;
  const match = CODES[code];
  if (!match) return null;
  const priceCents = Math.round(PASS_BASE_CENTS * (1 - match.percentOff / 100));
  return { code, priceCents, percentOff: match.percentOff, label: match.label };
}

module.exports = { applyPassDiscount, PASS_BASE_CENTS };
