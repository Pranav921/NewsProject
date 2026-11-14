// Synthetic publisher metadata. No external reporting or model requests.
export const editorialNow = new Date("2026-11-13T12:00:00Z");
export const editorialArticles = [
  { title: "Coastal evacuation ordered before storm", category: "general", source: "Coast Wire", summary: "Officials ordered coastal residents to evacuate before the storm arrives. Shelters opened Thursday.", ageHours: 3 },
  { title: "Central bank lowers interest rates", category: "business", source: "Economy Desk", summary: "The central bank announced lower interest rates. Its statement did not forecast household borrowing costs.", ageHours: 2 },
  { title: "Health agency recalls contaminated medicine", category: "health", source: "Public Radio", summary: "The health agency recalled one batch of medicine after a contamination test. No illnesses were reported.", ageHours: 1 },
  { title: "Parliament approves education legislation", category: "politics", source: "Civic News", summary: "Parliament approved legislation funding school repairs. The bill still needs the president's signature.", ageHours: 4 },
  { title: "Researchers publish ocean temperature measurements", category: "environment", source: "Science Journal", summary: "Researchers published ocean temperature measurements collected over the last year.", ageHours: 2 },
  { title: "Telescope photographs distant nebula", category: "science", source: "Observatory", summary: null, ageHours: 1 },
  { title: "Falcons win regional cup", category: "sports", source: "Match Desk", summary: "The Falcons won the regional cup in the final match of the season.", ageHours: 0.01 },
  { title: "Actor announces upcoming film", category: "entertainment", source: "Culture Desk", summary: "An actor announced the title of an upcoming film at a festival.", ageHours: 0.02 },
].map(({ ageHours, ...article }, index) => ({ ...article, link: `https://example.test/editorial/${index}`, publishedAt: new Date(editorialNow.getTime() - ageHours * 3600000).toISOString() }));

// Review against the complete summary, not just the headline. These are human
// assessment examples, not an automated semantic entailment oracle.
export const groundingReview = [
  { link: editorialArticles[1].link, acceptable: "The central bank announced lower interest rates.", unsupported: "Mortgage payments will fall next month." },
  { link: editorialArticles[2].link, acceptable: "One batch was recalled; no illnesses were reported.", unsupported: "The medicine caused widespread illness." },
  { link: editorialArticles[3].link, acceptable: "The school-repair bill still needs the president's signature.", unsupported: "The school funding law has taken effect." },
  { link: editorialArticles[5].link, acceptable: "The observatory reports a photograph of a distant nebula.", unsupported: "The photograph proves a new theory of star formation." },
];
