import { Container, Doodle, Mark, odBtn, odBtnLight } from "./bits";

/*
 * The odoo.com hero, to the letter: `pt-5 pb-6 text-center`, an h1 in
 * display-1 with the bold yellow stroke behind its last words, then an h2 in
 * display-3 that carries Odoo's handwritten price note — the doodled arrow and
 * two lines of Caveat, hung off the bottom-right of the highlighted phrase,
 * turned 350deg and pulled 10rem past its edge. (Our bar is fixed, so the
 * 3rem of top padding starts below it.)
 */

export default function Hero() {
  return (
    <section className="pt-[calc(3rem+60px)] pb-[4rem] text-center">
      <Container>
        <h1 className="od-d1">
          Every competitor move, <Mark>on one desk.</Mark>
        </h1>

        <h2 className="od-d3 relative mb-[3rem]">
          Scanned on your cadence, ranked into{" "}
          <span className="od-mark-blue relative">
            one feed.
            <em className="od-doodle absolute end-0 top-full -mt-[1rem] -me-[10rem] hidden rotate-[350deg] lg:block">
              <Doodle
                src="/img/odoo/arrow_doodle_1.svg"
                width={50}
                className="mx-auto mb-[1rem]"
              />
              From $39 / month
              <br />
              for every source
            </em>
          </span>
        </h2>

        <div>
          <a href="/sign-up" className={odBtn + " mb-[0.5rem] me-[1rem]"}>
            Start now
            <span className="hidden md:inline"> - It&rsquo;s free</span>
          </a>
          <a href="#screens" className={odBtnLight + " mb-[0.5rem]"}>
            See the workspace
          </a>
        </div>
      </Container>
    </section>
  );
}
