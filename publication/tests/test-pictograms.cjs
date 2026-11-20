const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const slugSource = read("publication/pictograms/registry.ts");
const artSource = read("publication/pictograms/art.tsx");
const backgroundSource = read("publication/blog-defense/page-background.tsx");

// Every article in the seed edition must have a registered pictogram.
const seedContent = JSON.parse(read("publication/seed/seed-edition-content.json"));
const articleSlugs = seedContent.articles.map((article) => article.slug);
assert(articleSlugs.length >= 18, `Expected at least 18 seed articles, found ${articleSlugs.length}`);

for (const slug of articleSlugs) {
  assert(slugSource.includes(`"${slug}"`), `Missing pictogram slug ${slug}`);
  assert(artSource.includes(`"${slug}"`), `Missing pictogram art registry entry for ${slug}`);
}

assert(slugSource.includes("PICTOGRAM_CYCLE_MS = 20_000"), "Expected shared 20-second pictogram cycle");
assert(artSource.includes("THREAT_INTELLIGENCE_PICTOGRAM_REGISTRY"), "Pictogram art registry should export slug map");
assert(backgroundSource.includes('from "../pictograms/registry"'), "Hero background should import shared pictogram timing");

console.log("Threat Intelligence pictogram static checks passed.");
