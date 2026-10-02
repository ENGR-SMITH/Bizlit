import { Check } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const features = [
  "Competitor and traffic monitoring",
  "SEO and AI-answer (GEO) scores, weekly",
  "One ranked notifications desk",
  "Client messaging from your own mailbox",
  "Review scans with reply flags",
  "A buy list built from real price moves",
  "No pipelines or setup required",
];

export default function Pricing() {
  return (
    <motion.div
      className="mx-auto w-full max-w-7xl rounded-4xl bg-gradient-to-br from-[oklch(0.4431_0.0681_83.13)] via-[oklch(0.58_0.09_78)] to-[oklch(0.145_0_0)] px-6 pt-16 pb-8 md:px-12 md:py-20"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <div className="mx-auto max-w-4xl">
        <div className="mb-12 flex flex-col items-center text-center">
          <h2 className="text-3xl font-medium tracking-tight text-white sm:text-4xl">
            Run your desk with less overhead
          </h2>
          <p className="mt-4 text-sm text-white/70 sm:text-base">
            One subscription for every signal — competitor and visibility.
          </p>
        </div>

        <Card className="overflow-hidden rounded-2xl border-0 bg-background/85 p-0 shadow-xl">
          <div className="flex flex-col md:flex-row">
            <div className="flex flex-col border-b border-border/30 p-8 md:basis-2/5 md:border-r md:border-b-0 md:p-10">
              <h3 className="text-center text-4xl font-medium text-foreground">BIZLIT</h3>
              <p className="mt-1 text-center text-lg text-muted-foreground">
                For independent retailers
                <br />
                and small buying teams
              </p>

              <p className="mt-8 text-center text-xl font-medium text-foreground">
                $39 per user / month
              </p>

              <div className="mt-8 flex flex-col gap-3">
                <Button
                  className="w-full rounded-full"
                  nativeButton={false}
                  render={<a href="/sign-up" />}
                >
                  Start free
                </Button>
                <Button
                  variant="outline"
                  className="w-full rounded-full border-foreground/20 bg-transparent"
                  nativeButton={false}
                  render={<a href="/sign-in" />}
                >
                  Sign in
                </Button>
              </div>

              <p className="mt-8 text-center text-sm font-light text-muted-foreground">
                No credit card to start
                <br />
                Cancel whenever you like
              </p>
            </div>

            <div className="flex flex-col justify-between p-8 md:basis-3/5 md:p-10">
              <ul className="flex flex-col gap-3">
                {features.map((feature) => (
                  <li key={feature} className="flex items-center gap-3">
                    <Check className="h-4 w-4 text-foreground" strokeWidth={2} />
                    <span className="text-sm font-medium text-foreground">{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8 border-t border-border/30 pt-6">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Everything is stored in your own workspace, behind your own sign-in. Nothing is
                  shared between desks.
                </p>
                <div className="mt-4 flex flex-col items-center gap-6 md:flex-row md:gap-8">
                  {[
                    { src: "/logo/templates/axis/logoipsum-1.svg", alt: "Company logo" },
                    { src: "/logo/templates/axis/logoipsum-2.svg", alt: "Company logo" },
                    { src: "/logo/templates/axis/shopify-2.svg", alt: "Shopify" },
                  ].map((logo) => (
                    <img
                      key={logo.src}
                      src={logo.src}
                      alt={logo.alt}
                      width={80}
                      height={24}
                      className="h-6 w-auto opacity-80 md:h-7 lg:h-10 dark:invert"
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </motion.div>
  );
}
