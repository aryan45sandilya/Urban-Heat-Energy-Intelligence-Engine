"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import {
  BarChart3,
  BookOpen,
  FlaskConical,
  Map,
  Sliders,
  Thermometer,
} from "lucide-react";

import { cn } from "@/lib/cn";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Intelligence", icon: BarChart3 },
  { href: "/predict",   label: "Predict",      icon: Thermometer },
  { href: "/simulate",  label: "Simulate",     icon: Sliders },
  { href: "/map",       label: "Hotspots",     icon: Map },
  { href: "/lab",       label: "Model Lab",    icon: FlaskConical },
  { href: "/method",    label: "Method",       icon: BookOpen },
] as const;

export function GlassDock() {
  const pathname = usePathname();
  const [hovered, setHovered] = useState<number | null>(null);
  const [direction, setDirection] = useState(0);

  const onEnter = (i: number) => {
    if (hovered !== null && i !== hovered) setDirection(i > hovered ? 1 : -1);
    setHovered(i);
  };

  return (
    <nav
      aria-label="Primary"
      className="fixed left-1/2 z-40 -translate-x-1/2"
      style={{ top: "calc(57px + 0.5rem)" }}
    >
      <div
        className="relative flex items-center gap-1 px-3 py-2"
        style={{
          background:
            "color-mix(in srgb, var(--background) 82%, transparent)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
        }}
        onMouseLeave={() => { setHovered(null); setDirection(0); }}
      >
        {NAV_ITEMS.map((item, i) => {
          const active =
            pathname === item.href ||
            pathname?.startsWith(`${item.href}/`);
          const isHovered = hovered === i;
          const Icon = item.icon;

          return (
            <div
              key={item.href}
              className="relative"
              onMouseEnter={() => onEnter(i)}
            >
              {/* Tooltip */}
              <AnimatePresence>
                {isHovered && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.9 }}
                    transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                    className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2"
                    style={{ zIndex: 60 }}
                  >
                    <div
                      className="overflow-hidden px-2.5 py-1"
                      style={{
                        background: "var(--surface-elevated)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                        boxShadow: "var(--shadow)",
                      }}
                    >
                      <AnimatePresence mode="popLayout" custom={direction}>
                        <motion.span
                          key={item.label}
                          custom={direction}
                          initial={{ x: direction > 0 ? 14 : -14, opacity: 0 }}
                          animate={{ x: 0, opacity: 1 }}
                          exit={{ x: direction > 0 ? -14 : 14, opacity: 0 }}
                          transition={{ duration: 0.18, ease: "easeOut" }}
                          className="label block whitespace-nowrap text-[10px]"
                          style={{ color: "var(--foreground)" }}
                        >
                          {item.label}
                        </motion.span>
                      </AnimatePresence>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Icon button */}
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                className="relative flex flex-col items-center justify-center gap-1 p-2.5"
                style={{ borderRadius: "var(--radius)" }}
              >
                <motion.span
                  animate={{
                    scale: isHovered ? 1.18 : 1,
                    y: isHovered ? -2 : 0,
                  }}
                  whileTap={{ scale: 0.9 }}
                  transition={{ type: "spring", stiffness: 380, damping: 24 }}
                  className="flex items-center justify-center"
                >
                  <Icon
                    size={20}
                    strokeWidth={active ? 2 : 1.5}
                    style={{
                      color: active
                        ? "var(--primary)"
                        : isHovered
                          ? "var(--foreground)"
                          : "var(--foreground-muted)",
                      transition: "color 120ms",
                    }}
                  />
                </motion.span>

                {/* Active indicator dot */}
                <AnimatePresence>
                  {active && (
                    <motion.span
                      layoutId="dock-active-dot"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 480, damping: 36 }}
                      className="absolute bottom-1 left-1/2 h-[3px] w-[3px] -translate-x-1/2"
                      style={{
                        background: "var(--primary)",
                        borderRadius: "1px",
                      }}
                    />
                  )}
                </AnimatePresence>
              </Link>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
