import { motion } from "motion/react";
import { ThemeToggle } from "./theme-switch";
import type { NavLink } from "./navbar";

const socialLinks = [
  { label: "X", href: "#", icon: "/icons/x.svg" },
  { label: "LinkedIn", href: "#", icon: "/icons/linkedin.svg" },
  { label: "Facebook", href: "#", icon: "/icons/facebook.svg" },
  { label: "Instagram", href: "#", icon: "/icons/instagram.svg" },
  { label: "TikTok", href: "#", icon: "/icons/tiktok.svg" },
];

export default function Footer({
  links,
  onJump,
}: {
  links: NavLink[];
  onJump: (id: string) => void;
}) {
  return (
    <motion.footer
      className="flex flex-col items-center justify-center gap-8"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <div className="flex items-center gap-2.5">
        <img
          src="/logo.png"
          alt="BIZLIT logo"
          className="h-9 w-9 shrink-0 rounded-xl object-cover"
        />
        <span className="text-sm font-medium tracking-tight">BIZLIT</span>
      </div>

      <p className="max-w-md text-center text-sm text-muted-foreground">
        A competitor and client monitoring workspace for retail teams — one desk instead of a
        dozen open tabs.
      </p>

      <ul className="grid grid-cols-2 items-center justify-center gap-2 md:grid-cols-4 md:gap-8">
        {links.map((link) => (
          <li key={link.id}>
            <button
              type="button"
              onClick={() => onJump(link.id)}
              className="cursor-pointer text-muted-foreground transition-all duration-300 hover:text-primary"
            >
              {link.label}
            </button>
          </li>
        ))}
      </ul>

      <section className="flex flex-row gap-4">
        {socialLinks.map((link) => (
          <a key={link.label} href={link.href} aria-label={link.label}>
            <img
              src={link.icon}
              alt=""
              width={24}
              height={24}
              className="w-7 invert lg:w-8 dark:invert-0"
            />
          </a>
        ))}
      </section>

      <ThemeToggle />

      <p className="text-muted-foreground">
        © {new Date().getFullYear()} BIZLIT. All rights reserved.
      </p>
    </motion.footer>
  );
}
