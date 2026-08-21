import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(here, "..", "..", "web");
const html = readFileSync(path.join(webRoot, "index.html"), "utf8");
const robots = readFileSync(path.join(webRoot, "public", "robots.txt"), "utf8");
const sitemap = readFileSync(path.join(webRoot, "public", "sitemap.xml"), "utf8");

test("MiOrdenGo publica señales SEO consistentes para el dominio canónico", () => {
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.miordengo\.com\/"/);
  assert.match(html, /<meta name="description" content="[^"]+"/);
  assert.match(html, /<meta name="robots" content="index,follow/);
  assert.match(html, /application\/ld\+json/);
  assert.match(robots, /Sitemap: https:\/\/www\.miordengo\.com\/sitemap\.xml/);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(sitemap, /<loc>https:\/\/www\.miordengo\.com\/<\/loc>/);
});
