import { motion } from "motion/react";

const features = [
  {
    title: "Every competitor change, ranked",
    description:
      "New SKUs, price moves, restocks and promotions captured from the rivals you track.",
  },
  {
    title: "The playbook behind each move",
    description:
      "Traffic, keyword gaps, live ad campaigns and review sentiment, tracked per competitor.",
  },
  {
    title: "Your own scores, weekly",
    description:
      "SEO and AI-answer visibility scored against the terms your buyers actually search.",
  },
  {
    title: "Alerts that need a decision",
    description:
      "Only the price, stock, ad and review changes worth acting on reach your desk.",
  },
];

export default function Feature() {
  return (
    <motion.section
      className="relative mx-auto max-w-7xl px-4"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <div className="mb-12 text-center max-lg:hidden lg:mb-16">
        <h2 className="text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          Built for the desk you actually run
        </h2>
        <p className="mt-4 text-sm text-muted-foreground sm:text-lg">
          Competitor and client monitoring in one place — not six browser tabs
        </p>
      </div>

      <div className="hidden lg:grid lg:grid-cols-[1fr_2.5fr_1fr] lg:items-center lg:gap-12">
        <section className="flex flex-col gap-32 pb-24">
          {features.slice(0, 2).map((feature) => (
            <div key={feature.title} className="max-w-[240px]">
              <h3 className="mb-2 text-lg font-medium text-foreground">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </div>
          ))}
        </section>

        <section className="relative flex justify-center">
          <img
            src="/images/templates/axis/feature.webp"
            alt="The BIZLIT workspace showing competitor changes"
            width={720}
            height={480}
            className="h-auto w-full rounded-2xl max-md:hidden dark:hidden"
          />
          <img
            src="/images/templates/axis/feature-dark.webp"
            alt="The BIZLIT workspace showing competitor changes"
            width={720}
            height={480}
            className="hidden h-auto w-full rounded-2xl max-md:hidden dark:block"
          />
        </section>

        <section className="flex flex-col gap-32 pt-32">
          {features.slice(2).map((feature) => (
            <div key={feature.title} className="max-w-xl">
              <h3 className="mb-2 text-lg font-medium text-foreground">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </div>
          ))}
        </section>
      </div>

      <div className="flex flex-col gap-8 lg:hidden">
        <section className="relative flex justify-center">
          <img
            src="/images/templates/axis/feature-mobile.webp"
            alt="The BIZLIT workspace on mobile"
            width={320}
            height={560}
            className="h-auto w-full rounded-2xl dark:hidden"
          />
          <img
            src="/images/templates/axis/feature-dark-mobile.webp"
            alt="The BIZLIT workspace on mobile"
            width={320}
            height={560}
            className="hidden h-auto w-full rounded-2xl dark:block"
          />
        </section>

        <section className="flex flex-col gap-4">
          <p className="text-center text-2xl text-foreground">Built for the desk you actually run</p>
          <p className="text-center text-muted-foreground">
            Competitor and client monitoring in one place — not six browser tabs
          </p>

          <div className="flex flex-col">
            {features.map((feature) => (
              <div key={feature.title} className="py-6">
                <h3 className="mb-2 text-lg font-medium text-foreground">{feature.title}</h3>
                <p className="leading-relaxed text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </motion.section>
  );
}
