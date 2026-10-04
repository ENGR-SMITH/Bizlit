import { statSync } from "node:fs";
import { execFileSync } from "node:child_process";

const TRADES = [
  ["knowledge", "clothes rack fashion store"],
  ["knowledge", "folded clothes stack"],
  ["stock", "hardware tools workbench"],
  ["stock", "toolbox screwdriver"],
];

function curl(args) {
  return execFileSync("curl", ["-s", "--max-time", "30", ...args], { maxBuffer: 1 << 26 });
}

for (const [slug, query] of TRADES) {
  try {
    const url = `https://unsplash.com/napi/search/photos?query=${encodeURIComponent(query)}&per_page=3&orientation=squarish`;
    const body = curl(["-H", "Accept: application/json", url]).toString("utf8");
    const photo = JSON.parse(body).results?.[0];
    if (!photo) throw new Error("no result");
    const path = `public/img/products/${slug}.jpg`;
    curl(["-f", "-o", path, `${photo.urls.raw}&w=320&h=320&fit=crop&crop=entropy&q=72&fm=jpg`]);
    console.log(`ok   ${slug}  ${Math.round(statSync(path).size / 1024)}kb  ${photo.id}  "${query}"`);
  } catch (error) {
    console.log(`FAIL ${slug}  ${error.message}  "${query}"`);
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
}
