// Comparison pages (site audit D5.3, "Do this quarter"): honest, factual comparisons against the
// two competitors the audit itself spotlighted (Luma and Eventbrite) plus Facebook Events, the
// free default most community organizers already use. These are the highest-leverage SEO content
// the audit identified as missing, since nine city pages exist but nothing targets "X vs Y"
// searches. Kept deliberately plain and specific rather than sales copy — see the audit's own
// instruction to write in the audience's language, not marketing-speak.
const express = require('express');
const router = express.Router();

const PAGES = {
  'facebook-events': {
    slug: 'facebook-events',
    competitor: 'Facebook Events',
    title: 'NoClash vs Facebook Events',
    metaDescription: 'How NoClash compares to Facebook Events for Hampton Roads community organizers posting a one-off event.',
    intro: "Facebook Events is free and lives inside a social network most of your attendees already use, which makes it the default choice for a lot of community organizers. It's genuinely good at one thing: getting your event in front of people who already follow your page or group.",
    points: [
      {
        heading: "What Facebook Events doesn't do",
        body: "It isn't built to answer a scheduling question. There's no city-wide calendar view, no way to see what else is already happening in your town on the same day, and a public event sits inside an algorithmic feed rather than a browsable board — so someone who isn't already following you is unlikely to stumble onto it."
      },
      {
        heading: 'What NoClash does instead',
        body: "NoClash is a shared calendar scoped to real-world community events in Hampton Roads, with a conflict checker that shows you what's already been posted in your city before you commit to a date. City pages stay browsable without a Facebook account, and nothing requires attendees to be on any particular platform."
      },
      {
        heading: 'Cost',
        body: 'Facebook Events is free to post. NoClash charges $1–$5 per listing (or $49/year for unlimited listings) to keep the board a checked, curated calendar rather than an open feed — browsing NoClash is always free, no account required.'
      }
    ],
    verdict: "The two aren't really competitors for the same job: Facebook Events is for reaching people who already know you, and NoClash is for making sure your date doesn't collide with someone else's — a lot of organizers end up using both."
  },
  eventbrite: {
    slug: 'eventbrite',
    competitor: 'Eventbrite',
    title: 'NoClash vs Eventbrite',
    metaDescription: 'How NoClash compares to Eventbrite for Hampton Roads community organizers who need a date-conflict check, not a ticketing platform.',
    intro: 'Eventbrite is built for selling tickets — registration, payment processing, check-in — for events of any size, and it charges a per-ticket fee on top of the ticket price.',
    points: [
      {
        heading: "What NoClash isn't",
        body: "NoClash doesn't sell tickets and never will try to replace a registration system. It's a listing board, not a checkout flow, so there's no per-attendee fee and nothing to integrate with your payment processor."
      },
      {
        heading: 'What NoClash is for',
        body: "Before you've even settled on a date, NoClash's conflict checker shows you what's already been posted in your city so your fundraiser isn't fighting the school's fall festival for the same Saturday. Once you've picked a date, a listing from $1 puts it on the shared board for the region."
      },
      {
        heading: 'Use both, if you need to',
        body: 'If attendees need to register or pay to get in, pair a NoClash listing with whatever registration link you already use — Eventbrite included. NoClash handles the "is this date already taken" question; Eventbrite handles ticketing.'
      }
    ],
    verdict: 'These solve different problems: Eventbrite runs your ticketing, NoClash helps you pick a date that doesn\'t clash with your neighbors\' events and then lists it locally.'
  }
};

router.get('/vs/:slug', (req, res) => {
  const page = PAGES[req.params.slug];
  if (!page) return res.status(404).render('404', { title: 'Not Found' });

  const siteUrl = res.locals.siteUrl;
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: `Is NoClash better than ${page.competitor}?`,
        acceptedAnswer: { '@type': 'Answer', text: page.verdict }
      }
    ]
  });

  res.render('vs', {
    title: page.title,
    metaTitle: `${page.title} | NoClash`,
    metaDescription: page.metaDescription,
    jsonLd,
    page,
    siteUrl
  });
});

module.exports = router;
