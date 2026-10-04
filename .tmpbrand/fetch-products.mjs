import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

const OUT = "public/img/products";

/** slug -> the thing a customer of that trade actually buys. */
const TRADES = [
  ["accountant", "cosmetics lipstick flatlay"],
  ["knowledge", "clothing rail boutique shop"],
  ["sign", "smartphone on desk"],
  ["crm", "headphones product"],
  ["web_studio", "printing paper press design"],
  ["sale_subscription", "coffee beans bag"],
  ["ai_app", "kitchen blender appliance"],
  ["point_of_sale", "market stall vegetables"],
  ["mail", "car parts workshop"],
  ["documents", "pharmacy shelves medicine"],
  ["project", "spa salon treatment products"],
  ["hr_timesheet", "gym dumbbells weights"],
  ["industry_fsm", "electrician tools hands"],
  ["planning", "modern armchair furniture"],
  ["helpdesk", "fresh vegetables crate"],
  ["website_sale", "shopping bags retail"],
  ["website", "restaurant plated dish"],
  ["mass_mailing", "bakery fresh bread"],
  ["purchase", "warehouse pallets boxes"],
  ["stock", "hardware store tools"],
  ["mrp", "factory production machine"],
  ["sale", "supermarket aisle shelves"],
  ["hr", "office desk laptop workspace"],
  ["spreadsheet_dashboard", "delivery truck logistics"],
];

/* the site's own search endpoint only answers curl's headers, not node's fetch */
function curl(args) {
  return execFileSync("curl", ["-s", "--max-time", "30", ...args], { maxBuffer: 1 << 26 });
}

function pick(query) {
  const url = `https://unsplash.com/napi/search/photos?query=${encodeURIComponent(query)}&per_page=3&orientation=squarish`;
  const body = curl(["-H", "Accept: application/json", url]).toString("utf8");
  if (!body.trim().startsWith("{")) throw new Error(`search ${body.slice(0, 40)}`);
  const photo = JSON.parse(body).results?.[0];
  if (!photo) throw new Error("no result");
  return { id: photo.id, raw: photo.urls.raw, credit: photo.user?.name ?? "", link: photo.links?.html ?? "" };
}

function grab(slug, raw) {
  const url = `${raw}&w=320&h=320&fit=crop&crop=entropy&q=72&fm=jpg`;
  const path = `${OUT}/${slug}.jpg`;
  curl(["-f", "-o", path, url]);
  return statSync(path).size;
}

await mkdir(OUT, { recursive: true });

const credits = [];
for (const [slug, query] of TRADES) {
  try {
    const photo = pick(query);
    const bytes = grab(slug, photo.raw);
    credits.push({ slug, query, id: photo.id, credit: photo.credit, link: photo.link, bytes });
    console.log(`ok   ${slug.padEnd(22)} ${String(Math.round(bytes / 1024)).padStart(4)}kb  ${photo.id}`);
  } catch (error) {
    console.log(`FAIL ${slug.padEnd(22)} ${error.message}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 350));
}

await writeFile(".tmpbrand/product-credits.json", JSON.stringify(credits, null, 2));
console.log(`done ${credits.length}/${TRADES.length}`);
