import Header from "@/components/templates/odoo/header";
import Hero from "@/components/templates/odoo/hero";
import SourcesBand from "@/components/templates/odoo/apps-grid";
import { ScreensBand } from "@/components/templates/odoo/app-screens";
import { ArrowBand, UsersBand, TestimonialBand } from "@/components/templates/odoo/proof";
import { AiBand, DoneRightBand, FaqBand, FeaturesBand, LevelUpBand, type FaqItem } from "@/components/templates/odoo/story";
import Cta from "@/components/templates/odoo/cta";
import Footer from "@/components/templates/odoo/footer";

/*
 * The landing page, rebuilt to odoo.com's design: the flat white header, the
 * handwriting-weight hero, then a run of grey bands (sources grid, what the
 * desk does, the level-up cards, the workspace screenshots), a white AI band,
 * the arched "done right" band carrying the plan, social proof, the FAQ, and
 * the closing call to action above the aubergine footer.
 *
 * The skin lives in `.theme-odoo` (src/index.css) so none of it reaches the
 * signed-in workspace, and every section it composes is in
 * src/components/templates/odoo/.
 */

const FAQ: FaqItem[] = [
  {
    q: "Which competitors can it watch?",
    a: "Any rival with a website — a shopfront, a trade site or a brand catalogue. You add each one during setup and choose how often it is checked.",
  },
  {
    q: "How often does it scan?",
    a: "Per source: daily, weekly or monthly. Daily feeds catch price and stock moves fastest, while weekly and monthly sources are scanned in one batch and summarised.",
  },
  {
    q: "Do my customers see competitor intelligence?",
    a: "No. Competitor alerts stay internal to your desk. You pick what goes out to customers from new stock, deals, check-ins, review updates and the weekly report.",
  },
  {
    q: "Does it send the emails for me?",
    a: "Yes. Alerts go out from the mailbox you configure, with your own signature, and every send is logged so you can see what each customer received.",
  },
  {
    q: "I sell on a marketplace, not my own site.",
    a: "Tell the wizard where you sell. Your scores, traffic and competitor comparisons are tracked against whichever surface you actually trade on.",
  },
];

export function LandingPage() {
  return (
    <div className="theme-odoo w-full overflow-x-clip bg-white text-[var(--od-body)]">
      <Header />
      <main>
        <Hero />

        {/* the grey run — odoo.com keeps these bands contiguous */}
        <SourcesBand />
        <FeaturesBand />
        <LevelUpBand />
        <ScreensBand />

        <AiBand />
        <DoneRightBand />

        {/* white again for the proof and the close */}
        <ArrowBand />
        <UsersBand />
        <TestimonialBand />
        <FaqBand items={FAQ} />
        <Cta />
      </main>
      <Footer />
    </div>
  );
}
