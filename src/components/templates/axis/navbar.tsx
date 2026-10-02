import { Menu, X } from "lucide-react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-switch";

export type NavLink = { id: string; label: string };

export default function Navbar({ links }: { links: NavLink[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (latest) => {
    const previous = scrollY.getPrevious() ?? 0;

    setIsScrolled(latest > 50);

    if (latest > previous && latest > 150) {
      setIsHidden(true);
      setIsOpen(false);
    } else {
      setIsHidden(false);
    }
  });

  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "unset";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  function jump(id: string) {
    setIsOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <motion.div
      className="fixed top-0 right-0 left-0 z-50 mx-auto w-full max-w-6xl px-4 pt-4 max-md:my-2"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: isHidden ? 0 : 1, y: isHidden ? -20 : 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <motion.div
        className="relative mx-auto max-w-7xl"
        animate={{ scale: isScrolled ? 0.98 : 1 }}
        transition={{ duration: 0.2 }}
      >
        <div
          className={cn(
            "flex flex-row items-center justify-between gap-4 rounded-full border p-2 transition-colors duration-300",
            isScrolled
              ? "border-border bg-background/80 shadow-[0_4px_20px_-5px_rgba(0,0,0,0.1)] backdrop-blur-xl dark:border-muted-foreground/20"
              : "border-border bg-background dark:border-muted-foreground/20",
          )}
        >
          <a href="/" className="ml-2 flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt="BIZLIT logo"
              className="h-9 w-9 shrink-0 rounded-xl object-cover"
            />
            <span className="text-sm font-medium tracking-tight">BIZLIT</span>
          </a>

          <section className="hidden flex-row items-center gap-4 lg:flex">
            <div className="flex flex-row gap-8">
              {links.map((link) => (
                <button
                  key={link.id}
                  type="button"
                  onClick={() => jump(link.id)}
                  className="flex flex-row items-center gap-1 cursor-pointer font-medium transition-colors hover:text-muted-foreground"
                >
                  {link.label}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              className="cursor-pointer font-medium transition-colors hover:bg-transparent! hover:text-muted-foreground"
              nativeButton={false}
              render={<a href="/sign-in" />}
            >
              Sign in
            </Button>
            <ThemeToggle />
            <Button
              className="rounded-full"
              size="lg"
              nativeButton={false}
              render={<a href="/sign-up" />}
            >
              Start free
            </Button>
          </section>

          <section className="flex flex-row items-center gap-2 lg:hidden">
            <Button className="rounded-full" nativeButton={false} render={<a href="/sign-up" />}>
              Start free
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label={isOpen ? "Close menu" : "Open menu"}
              onClick={() => setIsOpen(!isOpen)}
            >
              <AnimatePresence mode="wait" initial={false}>
                {isOpen ? (
                  <motion.div
                    key="close"
                    initial={{ opacity: 0, rotate: -90 }}
                    animate={{ opacity: 1, rotate: 0 }}
                    exit={{ opacity: 0, rotate: 90 }}
                    transition={{ duration: 0.2 }}
                  >
                    <X className="h-5 w-5" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="menu"
                    initial={{ opacity: 0, rotate: 90 }}
                    animate={{ opacity: 1, rotate: 0 }}
                    exit={{ opacity: 0, rotate: -90 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Menu className="h-5 w-5" />
                  </motion.div>
                )}
              </AnimatePresence>
            </Button>
          </section>
        </div>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, y: -10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -10, height: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="absolute top-full right-0 left-0 z-50 mt-2 overflow-hidden lg:hidden"
            >
              <div className="flex flex-col gap-2 rounded-2xl border border-border bg-background/95 p-4 backdrop-blur-xl">
                {links.map((link, index) => (
                  <motion.div
                    key={link.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, delay: index * 0.05 }}
                  >
                    <button
                      type="button"
                      onClick={() => jump(link.id)}
                      className="flex w-full flex-row items-center justify-between rounded-lg px-4 py-3 text-left font-medium transition-colors hover:bg-muted"
                    >
                      {link.label}
                    </button>
                  </motion.div>
                ))}

                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2, delay: 0.2 }}
                  className="my-2 border-t border-border"
                />

                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: 0.25 }}
                  className="flex flex-row items-center justify-between gap-2"
                >
                  <Button
                    variant="ghost"
                    className="font-medium hover:bg-transparent hover:text-muted-foreground"
                    nativeButton={false}
                    render={<a href="/sign-in" />}
                  >
                    Sign in
                  </Button>
                  <ThemeToggle />
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
