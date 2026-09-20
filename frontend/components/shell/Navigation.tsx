"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Menu, Moon, Sun, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { useTheme } from "./ThemeProvider";
import { Wordmark } from "../brand/Wordmark";
import { GlassDock } from "./GlassDock";

/** Mobile-only route list — desktop nav is handled by GlassDock. */
const ROUTES = [
  { href: "/dashboard", label: "Intelligence", index: "01" },
  { href: "/predict", label: "Predict", index: "02" },
  { href: "/simulate", label: "Simulate", index: "03" },
  { href: "/map", label: "Hotspots", index: "04" },
  { href: "/lab", label: "Model Lab", index: "05" },
  { href: "/method", label: "Method", index: "06" },
] as const;

export function Navigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { resolved, cycle } = useTheme();

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[80]
                   focus:bg-[var(--surface-elevated)] focus:px-3 focus:py-2 focus:text-sm
                   focus:ring-1 focus:ring-[var(--primary)]"
      >
        Skip to content
      </a>

      <header
        className="fixed inset-x-0 top-0 z-50 border-b border-[var(--border)]
                   bg-[color-mix(in_srgb,var(--background)_92%,transparent)]
                   backdrop-blur-[2px]"
      >
        <div
          className="mx-auto flex h-14 items-center justify-between gap-4 px-[var(--gutter)] lg:h-15"
          style={{ maxWidth: "var(--page-max)" }}
        >
          <Link href="/" className="shrink-0" aria-label="UHEI home">
            <Wordmark />
          </Link>

          {/* Desktop nav lives in the GlassDock (bottom-center floating dock) */}
          <div className="hidden lg:block" />

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={cycle}
              aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} theme`}
              className="flex h-9 w-9 items-center justify-center border border-transparent
                         text-[var(--foreground-muted)] transition-colors
                         hover:border-[var(--border)] hover:text-[var(--foreground)]"
            >
              {resolved === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              className="flex h-9 w-9 items-center justify-center border border-[var(--border)]
                         text-[var(--foreground)] lg:hidden"
            >
              {open ? <X size={16} /> : <Menu size={16} />}
            </button>
          </div>
        </div>
      </header>

      {/* Floating glass dock — desktop only */}
      <div className="hidden lg:block">
        <GlassDock />
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-40 bg-[var(--background)] lg:hidden"
          >
            <div className="survey-grid absolute inset-0" aria-hidden />
            <motion.nav
              aria-label="Primary"
              initial={{ y: -12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.04, duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="relative flex h-full flex-col justify-center px-[var(--gutter)]"
            >
              {ROUTES.map((route, i) => {
                const active = pathname === route.href;
                return (
                  <motion.div
                    key={route.href}
                    initial={{ y: 10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.05 + i * 0.035, duration: 0.28 }}
                  >
                    <Link
                      href={route.href}
                      // Closing here rather than in an effect on `pathname`:
                      // the tap is the reason the sheet closes, so that is where
                      // the state change belongs.
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-baseline gap-4 border-b border-[var(--border)] py-4",
                        active ? "text-[var(--primary)]" : "text-[var(--foreground)]",
                      )}
                    >
                      <span className="data text-[11px] text-[var(--foreground-faint)]">
                        {route.index}
                      </span>
                      <span className="font-[family-name:var(--font-display)] text-[clamp(1.6rem,7vw,2.2rem)] font-bold tracking-tight">
                        {route.label}
                      </span>
                    </Link>
                  </motion.div>
                );
              })}
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
