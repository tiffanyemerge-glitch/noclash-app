const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const siteUrl = res.locals.siteUrl;

  // Organization schema (site audit D5.5 — homepage had none) + an FAQPage block backing the
  // on-page FAQ in views/home.ejs that answers the "board looks empty" objection (D1.4/D3.1).
  // Combined under one @graph so the page only needs the one <script> tag partials/top.ejs emits.
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: 'NoClash',
        url: siteUrl,
        logo: `${siteUrl}/logo.svg`,
        description: "NoClash is the shared community events calendar for Hampton Roads, Virginia organizers — see what's already on the books before you pick a date.",
        sameAs: [
          'https://www.instagram.com/noclashcalendar/',
          'https://www.facebook.com/noclashcalendar',
          'https://www.linkedin.com/company/no-clash-calendar/about/',
          'https://www.tiktok.com/@noclashcalendar'
        ]
      },
      {
        '@type': 'FAQPage',
        mainEntity: [
          {
            '@type': 'Question',
            name: 'The board looks empty near me — is it worth checking?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: "Yes — even where no organizer has posted yet, NoClash is already pulling in public events from Ticketmaster and, for Hampton Roads cities, straight from each city's own events calendar, tagged Public Search. Pick your city on the board to see what's already scheduled before you add your own."
            }
          },
          {
            '@type': 'Question',
            name: 'Why does posting cost $1 if Facebook Events is free?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: "A dollar keeps the board a curated, checked calendar instead of an open feed anyone can flood, and it pays for the conflict check that flags when another organizer already has your date and city. Browsing stays free either way."
            }
          },
          {
            '@type': 'Question',
            name: 'Who is NoClash for?',
            acceptedAnswer: {
              '@type': 'Answer',
              text: "Small-budget community organizers — PTAs, churches, nonprofits, neighborhood associations, school and civic groups. It's not built for professional event companies or venues running a packed commercial calendar."
            }
          }
        ]
      }
    ]
  });

  res.render('home', {
    title: 'Home',
    metaTitle: 'NoClash — see what\'s already on the books before you pick a date',
    metaDescription: 'NoClash is the shared community events calendar for organizers. Browse local events for free, check a city\'s calendar before you pick a date, and post your own listing from $1.',
    jsonLd
  });
});

module.exports = router;
