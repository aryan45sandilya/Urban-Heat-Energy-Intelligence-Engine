"use client";

import { motion, useReducedMotion } from "motion/react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import { cn } from "@/lib/cn";

/* ── Page scaffolding ─────────────────────────────────────────────────────
   Blocks and rules, not a deck of rounded cards. A `Block` is a bordered
   region of the grid; a `Panel` is a filled surface used only where grouping
   genuinely helps comprehension.                                          */

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto px-[var(--gutter)]", className)} style={{ maxWidth: "var(--page-max)" }}>
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow, title, lede, aside,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  aside?: React.ReactNode;
}) {
  return (
    <header className="border-b border-[var(--border)] py-7 sm:py-9">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="label">{eyebrow}</p>
          <h1 className="mt-2.5 text-[clamp(1.75rem,4.2vw,2.75rem)]">{title}</h1>
          {lede && (
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--foreground-muted)]">
              {lede}
            </p>
          )}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
    </header>
  );
}

export function Block({
  children, className, as: Tag = "section",
}: {
  children: React.ReactNode;
  className?: string;
  as?: React.ElementType;
}) {
  return <Tag className={cn("min-w-0", className)}>{children}</Tag>;
}

export function BlockHeader({
  title, meta, action, className,
}: {
  title: string;
  meta?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 pb-3", className)}>
      <div className="min-w-0">
        <h2 className="label-strong truncate">{title}</h2>
        {meta && <p className="mt-1 text-[11px] text-[var(--foreground-faint)]">{meta}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Panel({
  children, className, padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        "border border-[var(--border)] bg-[var(--surface)]",
        padded && "p-4 sm:p-5",
        className,
      )}
      style={{ borderRadius: "var(--radius)" }}
    >
      {children}
    </div>
  );
}

/* ── Reveal ───────────────────────────────────────────────────────────────
   One shared entrance. Purposeful, short, and disabled under reduced motion. */
export function Reveal({
  children, delay = 0, className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.42, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* ── States ───────────────────────────────────────────────────────────────*/

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("relative overflow-hidden bg-[var(--surface-sunk)] sweep", className)}
      style={{ borderRadius: "var(--radius-sm)" }}
      aria-hidden
    />
  );
}

export function LoadingState({ label = "Loading", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <p className="label flex items-center gap-2">
        <Loader2 size={12} className="animate-spin" />
        {label}
      </p>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}

export function ErrorState({
  title = "Unable to load this view",
  message,
  onRetry,
  compact = false,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_7%,transparent)]",
        compact ? "p-3" : "p-5",
      )}
      style={{ borderRadius: "var(--radius)" }}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--danger)]" />
        <div className="min-w-0 flex-1">
          <p className="label-strong text-[var(--danger)]">{title}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--foreground-muted)]">{message}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1.5 border border-[var(--border-strong)]
                         px-2.5 py-1.5 text-[11px] font-medium transition-colors
                         hover:border-[var(--foreground)] hover:bg-[var(--surface-elevated)]"
              style={{ borderRadius: "var(--radius-sm)" }}
            >
              <RefreshCw size={11} />
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="hatch flex min-h-24 items-center justify-center border border-dashed border-[var(--border)] p-6">
      <p className="text-center text-sm text-[var(--foreground-muted)]">{message}</p>
    </div>
  );
}

/* ── Controls ─────────────────────────────────────────────────────────────*/

export function Button({
  children, variant = "primary", size = "md", className, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost";
  size?: "sm" | "md";
}) {
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium",
        "transition-[background-color,border-color,color,transform] duration-150",
        "disabled:cursor-not-allowed disabled:opacity-45 active:translate-y-px",
        size === "sm" ? "px-3 py-1.5 text-[12px]" : "px-4 py-2.5 text-[13px]",
        variant === "primary" &&
          "bg-[var(--primary)] text-white hover:bg-[var(--primary-deep)]",
        variant === "outline" &&
          "border border-[var(--border-strong)] bg-[var(--surface)] hover:border-[var(--foreground)] hover:bg-[var(--surface-elevated)]",
        variant === "ghost" &&
          "text-[var(--foreground-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--foreground)]",
        className,
      )}
      style={{ borderRadius: "var(--radius-sm)" }}
    >
      {children}
    </button>
  );
}

export function Badge({
  children, tone = "var(--foreground-muted)", className,
}: {
  children: React.ReactNode;
  tone?: string;
  className?: string;
}) {
  return (
    <span
      className={cn("label inline-flex items-center gap-1.5 border px-1.5 py-0.5 text-[9.5px]", className)}
      style={{
        color: tone,
        borderColor: `color-mix(in srgb, ${tone} 40%, transparent)`,
        background: `color-mix(in srgb, ${tone} 8%, transparent)`,
        borderRadius: "var(--radius-sm)",
      }}
    >
      {children}
    </span>
  );
}

export function Tabs<T extends string>({
  options, value, onChange, className,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("inline-flex border border-[var(--border)] bg-[var(--surface)]", className)}
      style={{ borderRadius: "var(--radius-sm)" }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "relative px-3 py-1.5 text-[11px] font-medium transition-colors",
              active ? "text-[var(--background)]" : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]",
            )}
          >
            {active && (
              <motion.span
                layoutId={`tab-${options.map((o) => o.value).join("-")}`}
                className="absolute inset-0 bg-[var(--foreground)]"
                style={{ borderRadius: "1px" }}
                transition={{ type: "spring", stiffness: 480, damping: 38 }}
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        role="button"
        aria-label={text}
        className="data flex h-[15px] w-[15px] cursor-help items-center justify-center
                   border border-[var(--border-strong)] text-[9px] leading-none
                   text-[var(--foreground-muted)]"
        style={{ borderRadius: "50%" }}
      >
        ?
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 w-56 -translate-x-1/2
                   border border-[var(--border-strong)] bg-[var(--surface-elevated)] p-2
                   text-[11px] leading-snug text-[var(--foreground)] opacity-0 shadow-[var(--shadow)]
                   transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
        style={{ borderRadius: "var(--radius-sm)" }}
      >
        {text}
      </span>
    </span>
  );
}
