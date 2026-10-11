const express = require('express');
const db = require('../lib/db');
const router = express.Router();

router.get('/pricing', (req, res) => {
  const siteUrl = res.locals.siteUrl;

  // Product/Offer schema for all four tiers (site audit D5.5 — pricing page had none).
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: [
      {
        '@type': 'Product',
        name: 'NoClash Basic Listing',
        description: 'One event listing, live for 60 days.',
        offers: { '@type': 'Offer', price: '1.00', priceCurrency: 'USD', url: `${siteUrl}/pricing`, availability: 'https://schema.org/InStock' }
      },
      {
        '@type': 'Product',
        name: 'NoClash Standard Listing',
        description: 'One event listing, live through the day of your event, shown in category highlights.',
        offers: { '@type': 'Offer', price: '3.00', priceCurrency: 'USD', url: `${siteUrl}/pricing`, availability: 'https://schema.org/InStock' }
      },
      {
        '@type': 'Product',
        name: 'NoClash Featured Listing',
        description: 'Everything in Standard, pinned to the top of its city and day for 7 days.',
        offers: { '@type': 'Offer', price: '5.00', priceCurrency: 'USD', url: `${siteUrl}/pricing`, availability: 'https://schema.org/InStock' }
      },
      {
        '@type': 'Product',
        name: 'NoClash Organizer Pass',
        description: 'Unlimited event listings for one year, plus 4 featured pins and priority email support.',
        offers: { '@type': 'Offer', price: '49.00', priceCurrency: 'USD', url: `${siteUrl}/pricing`, availability: 'https://schema.org/InStock' }
      }
    ]
  });

  res.render('pricing', {
    title: 'Pricing',
    metaTitle: 'NoClash pricing: list a community event from $1 | NoClash',
    PLANS: db.PLANS,
    jsonLd,
    metaDescription: 'NoClash listing prices: $1–$5 per event, or $49/year for an unlimited Organizer Pass. Browsing the events board is always free.'
  });
});

module.exports = router;
