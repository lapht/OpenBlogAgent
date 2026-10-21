/** Fixture articles for the content validation tests. Built in code to keep the corpus small. */

export const fixtureOutline = [
  "Why caching matters",
  "Choosing a cache strategy",
  "Invalidation in practice",
  "Measuring the results"
];

const sentence = (section: string, n: number) =>
  `In the ${section.toLowerCase()} part, point number ${n} shows how teams reduce latency, keep data fresh and avoid surprises when traffic grows beyond the original estimates.`;

const paragraph = (section: string, index: number) =>
  Array.from({ length: 5 }, (_, i) => sentence(section, index * 5 + i + 1)).join(" ");

/** Builds a valid article of roughly `paragraphsPerSection * 4 * 140` words. */
export function buildArticle(paragraphsPerSection = 3, sections = fixtureOutline): string {
  const intro =
    "Caching is one of the simplest ways to make a service feel fast, and this guide explains how to use it well in everyday projects.";
  const body = sections.map((section) =>
    [
      `## ${section}`,
      ...Array.from({ length: paragraphsPerSection }, (_, i) => paragraph(section, i))
    ].join("\n\n")
  );
  const conclusion =
    "## Conclusion\n\nStart small, measure the effect and keep the invalidation rules simple enough that the whole team can explain them.";
  return [intro, ...body, conclusion].join("\n\n");
}

export const goodArticle = buildArticle(); // ~1,100 words
export const tooShortArticle =
  "## Why caching matters\n\nCaching is good.\n\n## Choosing a cache strategy\n\nPick one.";
export const truncatedArticle = goodArticle.slice(0, Math.floor(goodArticle.length * 0.4));
export const placeholderArticle = `${goodArticle}\n\n[...]\n\nTODO: add a real example.`;
