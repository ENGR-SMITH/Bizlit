import { statSync } from "node:fs";
import { execFileSync } from "node:child_process";

/** Eleven more goods, so all 35 tiles of the wall are different. */
const EXTRA = [
  ["cameras", "camera product photography"],
  ["sneakers", "sneakers pair shoes"],
  ["watches", "wristwatch product"],
  ["wine", "wine bottles shelf"],
  ["cheese", "cheese dairy board"],
  ["plants", "potted plants nursery"],
  ["toys", "wooden toys children"],
  ["paint", "paint cans colour"],
  ["fabric", "fabric rolls textile"],
  ["stationery", "stationery notebooks desk"],
  ["bikes", "bicycle shop wheel"],
];

function curl(args) {
  return execFileSync("curl", ["-s", "--max-time", "30", ...args], { maxBuffer: 1 << 26 });
}

for (const [slug, query] of EXTRA) {
  try {
    const url = `https://unsplash.com/napi/search/photos?query=${encodeURIComponent(query)}&per_page=3&orientation=squarish`;
    const body = curl(["-H", "Accept: application/json", url]).toString("utf8");
    const photo = JSON.parse(body).results?.[0];
    if (!photo) throw new Error("no result");
    const path = `public/img/products/${slug}.jpg`;
    curl(["-f", "-o", path, `${photo.urls.raw}&w=320&h=320&fit=crop&crop=entropy&q=72&fm=jpg`]);
    console.log(`ok   ${slug.padEnd(12)} ${String(Math.round(statSync(path).size / 1024)).padStart(4)}kb  ${photo.id}`);
  } catch (error) {
    console.log(`FAIL ${slug.padEnd(12)} ${error.message}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
}
