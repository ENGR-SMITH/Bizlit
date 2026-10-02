import type { ReactNode } from "react";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Hero({ preview }: { preview?: ReactNode }) {
  return (
    <motion.div
      className="flex flex-col items-center justify-center gap-16 py-2 lg:pt-8"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <section className="flex w-full max-w-7xl flex-col items-center justify-between gap-6 lg:max-w-6xl lg:flex-row">
        <p className="text-center text-3xl tracking-tighter max-md:font-medium md:text-5xl lg:max-w-lg lg:text-left lg:text-6xl xl:max-w-2xl xl:text-7xl">
          Know what your competitors did{" "}
          <span className="text-primary">before your customers do</span>
        </p>
        <section className="flex flex-col gap-8">
          <p className="max-w-xl text-center text-base leading-relaxed text-muted-foreground md:text-xl lg:max-w-md lg:text-left">
            BIZLIT scans the rivals you sell against and your own search visibility, then
            tells you what changed and what to do about it.
          </p>
          <div className="flex flex-row gap-2">
            <Button
              className="rounded-full max-lg:hidden"
              size="lg"
              nativeButton={false}
              render={<a href="/sign-up" />}
            >
              Start free <ArrowRight size={15} />
            </Button>
            <Button
              className="rounded-full max-lg:w-full"
              size="lg"
              variant="outline"
              nativeButton={false}
              render={<a href="/sign-in" />}
            >
              I already have an account
            </Button>
          </div>
          <p className="text-center text-xs text-muted-foreground lg:text-left">
            No card to start · One setup wizard · Works alongside your existing tools
          </p>
        </section>
      </section>

      {preview ? <div className="relative w-full">{preview}</div> : null}
    </motion.div>
  );
}
