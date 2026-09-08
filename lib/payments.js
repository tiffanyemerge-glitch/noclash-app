// Real payments, via Stripe Checkout — a Stripe-hosted page that collects the card, so this
// app never touches raw card numbers itself. Falls back to a clearly-labeled free "demo mode"
// wherever STRIPE_SECRET_KEY isn't set, so the app still works end-to-end without an account.
//
// Simplification worth knowing about: the Organizer Pass is a one-time $49 charge that sets
// passActiveUntil to a year out, not an auto-renewing Stripe subscription. A real subscription
// (auto-charging the card again next year) is more moving parts — webhook handling for renewals,
// failed-payment retries, cancellation — than a first payment integration needs. See README.

function isConfigured() {
  return !!process.env.STRIPE_SECRET_KEY;
}

let _stripe = null;
function stripe() {
  if (!_stripe) {
    _stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

async function createListingCheckout({ plan, priceCents, eventName, successUrl, cancelUrl, metadata }) {
  return stripe().checkout.sessions.create({
    mode: 'payment',
    // Managed Payments (on by default for newer Stripe accounts) requires every product to
    // carry a digital-goods tax code, and explicitly excludes "professional services" and
    // "live in-person events" from eligibility — see
    // https://docs.stripe.com/payments/managed-payments/eligibility#product-tax-code-requirements
    // A NoClash listing is a paid spot for a real-world event, not a digital good, so this
    // opts the session out of Managed Payments rather than mis-tagging it with a tax code
    // that doesn't really fit. See also the payment_method_types note this replaced, in git
    // history: Managed Payments used to also reject that parameter outright.
    managed_payments: { enabled: false },
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: priceCents,
          product_data: { name: `NoClash listing (${plan}) — ${eventName}` }
        },
        quantity: 1
      }
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata
  });
}

async function createPassCheckout({ successUrl, cancelUrl, metadata }) {
  return stripe().checkout.sessions.create({
    mode: 'payment',
    // See the note in createListingCheckout above.
    managed_payments: { enabled: false },
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: 4900,
          product_data: { name: 'NoClash Organizer Pass (1 year, unlimited listings)' }
        },
        quantity: 1
      }
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata
  });
}

// The only trustworthy way to know a Checkout Session was actually paid: ask Stripe directly
// with the secret key, rather than trusting anything the browser sends back on redirect.
async function retrieveSession(sessionId) {
  return stripe().checkout.sessions.retrieve(sessionId);
}

module.exports = { isConfigured, createListingCheckout, createPassCheckout, retrieveSession };
