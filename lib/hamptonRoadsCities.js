// Canonical list of principal Hampton Roads, VA cities that get their own SEO locality page
// (routes/cities.js: /cities and /cities/:slug) — the seven independent cities long known as
// "the Seven Cities of Hampton Roads" (Chesapeake, Hampton, Newport News, Norfolk, Portsmouth,
// Suffolk, Virginia Beach) plus Williamsburg and Poquoson, both commonly counted in the wider
// Hampton Roads / Virginia Beach-Norfolk-Newport News metro area. Counties in that metro
// (York, James City, Isle of Wight, Gloucester, ...) aren't included yet — see
// claude/near-conflict-autoflag-spec.md's neighbor doc, claude/chamber-partner-outreach.md, for
// where those areas already come up. Add a county the same way, as its own entry, if a
// dedicated page for it is ever worth building.
//
// `blurb` is a short, factual, city-specific description for the page body — deliberately not
// the same paragraph with the city name swapped in, since search engines treat that as thin,
// duplicate content across near-identical pages. `metaDescription` is a separate, shorter
// (~150-160 char) line built for the search-result snippet, matching the "before you pick a
// date" phrasing used sitewide (see routes/home.js, routes/event.js).

const CITIES = [
  {
    slug: 'norfolk-va',
    name: 'Norfolk',
    state: 'VA',
    blurb: "Home to the world's largest naval base and Hampton Roads' downtown arts hub — the NEON District, the Chrysler Museum, Harbor Park, and a busy year-round calendar of festivals and waterfront events.",
    metaDescription: 'See what\'s already happening in Norfolk, VA before you plan your event — browse local listings and avoid double-booking the same day, free on NoClash.'
  },
  {
    slug: 'virginia-beach-va',
    name: 'Virginia Beach',
    state: 'VA',
    blurb: "Virginia's largest city and its beach resort strip — the oceanfront Boardwalk, Town Center, and a packed summer schedule of concerts, races, and festivals.",
    metaDescription: 'Planning an event in Virginia Beach, VA? Check NoClash first to see what\'s already on the books, from oceanfront festivals to community fundraisers.'
  },
  {
    slug: 'chesapeake-va',
    name: 'Chesapeake',
    state: 'VA',
    blurb: 'A fast-growing suburban city stretching from the Great Dismal Swamp to the dense Greenbrier and Grassfield neighborhoods, with a steady mix of community festivals, school events, and farmers markets.',
    metaDescription: 'See what\'s already scheduled in Chesapeake, VA before you pick a date — free local events calendar for organizers and residents on NoClash.'
  },
  {
    slug: 'portsmouth-va',
    name: 'Portsmouth',
    state: 'VA',
    blurb: 'A historic waterfront city across the Elizabeth River from Norfolk, anchored by the naval shipyard and the walkable, well-preserved Olde Towne historic district.',
    metaDescription: 'Check Portsmouth, VA\'s events calendar before you plan your own — free to browse, from Olde Towne festivals to community fundraisers, on NoClash.'
  },
  {
    slug: 'suffolk-va',
    name: 'Suffolk',
    state: 'VA',
    blurb: 'Geographically the largest city in Virginia and still largely rural — known for its peanut-farming history, the annual Suffolk Peanut Fest, and a growing suburban population around Harbourview.',
    metaDescription: 'See what\'s already on the books in Suffolk, VA before you pick a date — free local events calendar for organizers, from Peanut Fest to farmers markets.'
  },
  {
    slug: 'hampton-va',
    name: 'Hampton',
    state: 'VA',
    blurb: 'One of the oldest continuously settled cities in America, home to NASA Langley Research Center and Fort Monroe, with a waterfront downtown that hosts Hampton Bay Days and a busy arts calendar.',
    metaDescription: 'Planning an event in Hampton, VA? See what\'s already scheduled first — free local events calendar for organizers and residents on NoClash.'
  },
  {
    slug: 'newport-news-va',
    name: 'Newport News',
    state: 'VA',
    blurb: "Anchored by Newport News Shipbuilding, the region's largest private employer, in a long, spread-out city running from the James River to City Center at Oyster Point.",
    metaDescription: 'Check Newport News, VA\'s events calendar before you pick a date — free to browse for organizers and residents, on NoClash.'
  },
  {
    slug: 'williamsburg-va',
    name: 'Williamsburg',
    state: 'VA',
    blurb: 'A small city built around Colonial Williamsburg and William & Mary, drawing tourist and event traffic year-round far out of proportion to its small year-round population.',
    metaDescription: 'See what\'s already happening in Williamsburg, VA before you plan your event — free local events calendar on NoClash.'
  },
  {
    slug: 'poquoson-va',
    name: 'Poquoson',
    state: 'VA',
    blurb: 'A small, tight-knit waterfront community on the Peninsula — mostly residential, with civic and church events more common than large public festivals.',
    metaDescription: 'Check Poquoson, VA\'s events calendar before you plan your own — free to browse for organizers and residents, on NoClash.'
  }
];

function findCityBySlug(slug) {
  return CITIES.find((c) => c.slug === slug) || null;
}

module.exports = { CITIES, findCityBySlug };
