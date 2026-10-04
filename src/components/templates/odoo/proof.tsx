import { Container, Doodle } from "./bits";
import { SOURCES } from "./apps-grid";

/*
 * Social proof in odoo.com's two shapes.
 *
 * The users band is a wall of 80px tiles with a white pill floating over the
 * middle of it: an h6 in display-2, the word "happy" lifted above the line
 * beside a circular doodled arrow, and the rest of the sentence at fs-4.
 *
 * The testimonial band opens with Odoo's grey looped arrow (150px, turned
 * 350deg, pulled up 3rem and in from the right 4rem), then the quote icon and
 * a 0.75rem grey card in two columns.
 *
 * The tiles are photographs of real goods — a product or a service from every
 * trade the desk is run for, the same trades the sources wall names, plus a
 * few more lines of stock (cameras, sneakers, wine, plants) — cropped into
 * Odoo's circles, squircles and rounded squares. They stand in for the
 * portraits the reference site uses, which we have no library of, and the
 * tints behind them are only there so a tile never flashes empty while its
 * photo loads.
 */

/** The eleven trades beyond the sources wall's own list, kept as stock photos. */
const GOOD_SLUGS = [
  "cameras",
  "sneakers",
  "watches",
  "wine",
  "cheese",
  "plants",
  "toys",
  "paint",
  "fabric",
  "stationery",
  "bikes",
];

/*
 * One photo per tile, and no photo twice: the 24 trade shots run down the wall
 * two at a time with one of the eleven goods between them — 35 tiles, 35
 * files. (The reference site fills its wall with people; a wall of goods from
 * every trade says the same thing about who is already selling here.)
 */
const MOSAIC_PHOTOS: string[] = (() => {
  const goods = [...GOOD_SLUGS];
  const trades = SOURCES.map((source) => source.slug);
  const photos: string[] = [];
  for (let i = 0; i < 35; i++) {
    photos.push(i % 3 === 2 ? goods.shift()! : trades.shift()!);
  }
  return photos;
})();

const MOSAIC_TINTS = [
  "var(--od-tile-1)",
  "var(--od-tile-2)",
  "var(--od-tile-3)",
  "var(--od-tile-4)",
  "var(--od-tile-5)",
  "var(--od-tile-6)",
  "var(--od-tile-7)",
  "var(--od-tile-8)",
];

const TILE_SHAPES = ["rounded-full", "rounded-[38%]", "rounded-[0.5rem]"];

/** 80px tiles, four to seven per row, centred under the white pill. */
function Mosaic() {
  const cells = Array.from({ length: 35 }, (_, i) => i);

  return (
    <div className="od-mosaic flex flex-wrap justify-between" aria-hidden>
      {cells.map((i) => (
        <div
          key={i}
          className={`m-[0.25rem] h-20 w-20 overflow-hidden md:m-[0.75rem] ${TILE_SHAPES[i % TILE_SHAPES.length]}`}
          style={{ backgroundColor: MOSAIC_TINTS[i % MOSAIC_TINTS.length] }}
        >
          {/* each tile has its own file; nothing in the wall repeats */}
          <img
            src={`/img/products/${MOSAIC_PHOTOS[i]}.jpg`}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </div>
      ))}
    </div>
  );
}

/**
 * The breather Odoo puts between the features band and the users wall: nothing
 * but `arrow_doodle_4` at 120px, turned 340deg and pulled up 3rem.
 */
export function ArrowBand() {
  return (
    <section className="hidden md:block">
      <Container>
        <Doodle
          src="/img/odoo/arrow_doodle_4.svg"
          width={120}
          className="-mt-[3rem] mb-[1.5rem] rotate-[340deg]"
        />
      </Container>
    </section>
  );
}

export function UsersBand() {
  return (
    <section>
      <Container className="relative min-h-[20rem]">
        {/* the white pill, centred over the wall at z-1 */}
        <div className="absolute inset-0 z-[1] flex items-center justify-center">
          <div className="rounded-[50rem] bg-[var(--od-surface)] px-[4rem] py-[4rem] text-center lg:px-[8rem]">
            <h6 className="od-d2 relative mb-[0.5rem]">
              Join retailers{" "}
              <span className="od-sup hidden md:inline">
                <Doodle
                  src="/img/odoo/arrow_circular_down_left.svg"
                  width={37}
                  height={40}
                  className="me-[0.5rem] -ms-[0.5rem] mt-[1.5rem] inline-block"
                />
                happy
              </span>{" "}
              to grow
            </h6>
            <span className="text-[1.5rem]">their business with BIZLIT</span>
          </div>
        </div>

        <Mosaic />
      </Container>
    </section>
  );
}

export function TestimonialBand() {
  return (
    <section>
      <Container>
        <Doodle
          src="/img/odoo/grey_arrow_loop_02.svg"
          width={150}
          className="ms-auto me-[4rem] -mt-[3rem] mb-[3rem] hidden rotate-[350deg] md:block"
        />

        <div>
          <span
            className="relative z-[1] ms-[3rem] -mb-[1.5rem] hidden text-[var(--od-gold)] lg:block"
            aria-hidden
          >
            <svg viewBox="0 0 24 24" width={64} height={64} fill="currentColor">
              <path d="M9.5 4C5.9 4 3 6.9 3 10.5s2.9 6.5 6.5 6.5c.7 0 1.4-.1 2-.3-.6 1.6-2.1 2.8-3.9 3.1a1 1 0 0 0 .2 2c3.9-.5 6.7-3.9 6.7-7.8V10.5C14.5 6.9 12.6 4 9.5 4Zm9 0C15.9 4 14 6.9 14 10.5s1.9 6.1 4.5 6.5c.7 0 1.4-.1 2-.3-.6 1.6-2.1 2.8-3.9 3.1a1 1 0 0 0 .2 2c3.9-.5 6.7-3.9 6.7-7.8V10.5c0-3.6-1.9-6.5-5-6.5Z" />
            </svg>
          </span>

          <div className="relative grid gap-[1.5rem] rounded-[0.75rem] bg-[var(--od-band)] p-[1.5rem] md:grid-cols-3 md:p-[4rem]">
            <blockquote className="md:col-span-2 lg:pb-0">
              <p className="text-[1.5rem] leading-normal font-bold text-[var(--od-ink)]">
                Our SEO score was stuck at 61 and nobody could tell me why. The keyword gaps were
                the answer, written out plainly.
              </p>
            </blockquote>

            <div className="flex flex-col items-end justify-center gap-[1.5rem] lg:items-end">
              <div className="text-right">
                <b className="font-bold text-[var(--od-ink)]">Tom Whitfield</b>
                <br />
                <small className="text-[0.875rem] text-[var(--od-muted)]">
                  Wholesale buyer
                </small>
              </div>
              <span className="w-[100px] rounded-[0.25rem] border border-[rgba(109,40,217,0.15)] bg-[var(--od-surface)] p-[0.25rem] text-center text-sm font-semibold tracking-wide text-[var(--od-violet)]">
                WHITFIELD
              </span>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
