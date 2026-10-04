import { statSync } from "node:fs";
import { execFileSync } from "node:child_process";

const QUERIES = ["road bicycle", "mountain bike", "bike wheel close up", "bicycle"];

function curl(args) {
  return execFileSync("curl", ["-s", "--max-time", "30", ...args], { maxBuffer: 1 << 26 });
}

for (const query of QUERIES) {
  try {
    const url = `https://unsplash.com/napi/search/photos?query=${encodeURIComponent(query)}&per_page=3&orientation=squarish`;
    const body = curl(["-H", "Accept: application/json", url]).toString("utf8");
    const photo = JSON.parse(body).results?.[0];
    if (!photo) throw new Error("no result");
    const path = "public/img/products/bikes.jpg";
    curl(["-f", "-o", path, `${photo.urls.raw}&w=320&h=320&fit=crop&crop=entropy&q=72&fm=jpg`]);
    console.log(`ok   bikes  ${Math.round(statSync(path).size / 1024)}kb  ${photo.id}  "${query}"`);
    break;
  } catch (error) {
    console.log(`FAIL bikes  ${error.message}  "${query}"`);
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
}
