import { Verified } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

const testimonials = [
  {
    avatar: "/illustrations/avatar-1.svg",
    name: "Priya Nair",
    handle: "@priyabuyer",
    content: (
      <>
        A rival dropped a price 16% overnight and I saw it before the listing even
        refreshed. That one alert paid for the year.
      </>
    ),
    verified: true,
  },
  {
    avatar: "/illustrations/avatar-2.svg",
    name: "Daniel Okafor",
    handle: "@danielretail",
    content: (
      <>
        I used to open eleven competitor tabs every morning. Now it is one feed and
        a short list of things that need a decision.
      </>
    ),
  },
  {
    avatar: "/illustrations/avatar-3.svg",
    name: "Marta Kowalski",
    handle: "@martak_supply",
    content: (
      <>
        The competitor campaign alerts are the part I did not know I needed. We
        matched a promotion within a day of it going live.
      </>
    ),
  },
  {
    avatar: "/illustrations/avatar-1.svg",
    name: "Tom Whitfield",
    handle: "@tomwholesale",
    content: (
      <>
        Our SEO score was stuck at 61 and nobody could tell me why. The keyword gaps
        were the answer, written out plainly.
      </>
    ),
  },
  {
    avatar: "/illustrations/avatar-2.svg",
    name: "Anika Sharma",
    handle: "@anikasharma",
    content: (
      <>
        Stock warnings land before the lead time bites, so we stopped losing sales
        to our own reordering schedule.
      </>
    ),
    verified: true,
  },
  {
    avatar: "/illustrations/avatar-3.svg",
    name: "Ravi Menon",
    handle: "@ravimenon",
    content: (
      <>
        Messages go out from our own mailbox with our signature. Customers think we
        hired an analyst. We did not.
      </>
    ),
  },
];

export default function Testimonials() {
  return (
    <section className="mx-auto max-w-5xl px-4">
      <div className="mb-12 text-center">
        <h2 className="text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          From the people running the desk.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground">
          Retail teams using BIZLIT to catch competitor and visibility changes
          before they cost a sale.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {testimonials.map((t) => (
          <Card
            key={t.handle}
            className="gap-0 rounded-3xl border border-muted-foreground/20 bg-card p-0 shadow-none dark:border-0 dark:bg-muted-foreground/15"
          >
            <CardHeader className="flex-row items-center gap-3 space-y-0 pb-4">
              <img
                src={t.avatar}
                alt={t.name}
                width={40}
                height={40}
                className="h-10 w-10 rounded-full"
              />
              <div className="flex flex-col gap-0">
                <div className="flex items-center gap-1">
                  <span className="text-base font-medium text-foreground">{t.name}</span>
                  {t.verified ? <Verified fill="#1D9BF0" className="size-5 text-white" /> : null}
                </div>
                <span className="text-xs text-muted-foreground">{t.handle}</span>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="leading-relaxed font-medium text-foreground">{t.content}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-12 flex justify-center">
        <Button variant="outline" className="rounded-full px-6 text-sm font-medium">
          Read more stories
        </Button>
      </div>
    </section>
  );
}
