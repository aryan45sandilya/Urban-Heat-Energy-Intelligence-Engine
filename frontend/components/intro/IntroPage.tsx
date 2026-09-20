"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import {
  BarChart3, BookOpen, FlaskConical, Map, Sliders, Thermometer, ArrowUpRight,
} from "lucide-react";

import { useMeta } from "@/hooks/useApi";

// ── Thermal colour ramp (matches globals.css heat tokens) ─────────────────────

const COLOUR_STOPS: Array<[number, readonly [number, number, number]]> = [
  [0.00, [59,  130, 246]],
  [0.20, [122, 168, 212]],
  [0.40, [200, 185, 143]],
  [0.55, [245, 158,  11]],
  [0.70, [249, 115,  22]],
  [0.85, [225,  29,  72]],
  [1.00, [136,  19,  55]],
];

function thermalRgb(t: number): readonly [number, number, number] {
  const v = Math.min(1, Math.max(0, t));
  for (let i = 1; i < COLOUR_STOPS.length; i++) {
    const [t0, c0] = COLOUR_STOPS[i - 1];
    const [t1, c1] = COLOUR_STOPS[i];
    if (v <= t1) {
      const u = (v - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + u * (c1[0] - c0[0])),
        Math.round(c0[1] + u * (c1[1] - c0[1])),
        Math.round(c0[2] + u * (c1[2] - c0[2])),
      ];
    }
  }
  return COLOUR_STOPS[COLOUR_STOPS.length - 1][1];
}

// ── Nav destinations ──────────────────────────────────────────────────────────

const NAV = [
  { href: "/dashboard", label: "Intelligence", icon: BarChart3,    glow: "225,29,72",   desc: "Live heat analysis"    },
  { href: "/predict",   label: "Predict",      icon: Thermometer,  glow: "249,115,22",  desc: "Risk & load forecast"  },
  { href: "/simulate",  label: "Simulate",     icon: Sliders,      glow: "34,197,94",   desc: "What-if scenarios"     },
  { href: "/map",       label: "Hotspots",     icon: Map,          glow: "59,130,246",  desc: "Geospatial heat map"   },
  { href: "/lab",       label: "Model Lab",    icon: FlaskConical, glow: "225,29,72",   desc: "Diagnostics & SHAP"    },
  { href: "/method",    label: "Method",       icon: BookOpen,     glow: "113,113,122", desc: "Data & methodology"    },
] as const;

// ── Floating temperature readout ──────────────────────────────────────────────

interface FloatLabel {
  id: number;
  x: number;
  y: number;
  value: string;
  color: string;
}

const TEMP_VALUES  = ["+1.8°C", "+3.2°C", "+4.7°C", "+2.1°C", "+5.3°C", "+0.9°C", "+6.1°C", "+3.8°C", "+2.6°C"];
const TEMP_COLOURS = ["#e11d48", "#f97316", "#fbbf24", "#fb7185"];
let   _labelId     = 0;

function makeLabel(): FloatLabel {
  return {
    id:    ++_labelId,
    x:     12 + Math.random() * 76,
    y:     20 + Math.random() * 55,
    value: TEMP_VALUES [Math.floor(Math.random() * TEMP_VALUES.length)],
    color: TEMP_COLOURS[Math.floor(Math.random() * TEMP_COLOURS.length)],
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function IntroPage() {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const rafRef      = useRef<number>(0);
  const heatRef     = useRef<Float32Array | null>(null);
  const tRef        = useRef(0);
  const lastTsRef   = useRef(0);

  const [labels, setLabels] = useState<FloatLabel[]>([]);
  const [ready,  setReady ] = useState(false);

  const { data: meta } = useMeta();
  const stations = meta?.network?.stations ?? 167;
  const heatRows = meta?.tasks?.heat?.rows;
  const rowsLabel = heatRows
    ? heatRows >= 1_000_000
      ? `${(heatRows / 1_000_000).toFixed(1)}M`
      : heatRows.toLocaleString()
    : "4.6M";

  // ── Canvas heat-map animation ───────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const COLS = 60;
    const ROWS = 34;
    const heat = new Float32Array(COLS * ROWS);
    heatRef.current = heat;

    // Initialise with urban heat-island pattern (hot centre, cool periphery)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const nx = (c / COLS - 0.5) * 2;
        const ny = (r / ROWS - 0.5) * 2;
        const d  = Math.sqrt(nx * nx + ny * ny);
        const base  = Math.exp(-d * d * 0.78) * 0.72 + 0.04;
        const noise = (Math.sin(c * 0.8) * Math.cos(r * 1.1)
                     + Math.sin(c * 1.5 + r * 0.5)) * 0.12;
        heat[r * COLS + c] = Math.min(1, Math.max(0, base + noise));
      }
    }

    function resize() {
      if (!canvas) return;
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function frame(ts: number) {
      const dt = Math.min((ts - lastTsRef.current) / 1000, 0.05);
      lastTsRef.current = ts;
      tRef.current     += dt;
      const t = tRef.current;

      const next = new Float32Array(heat.length);
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const idx = r * COLS + c;
          const curr = heat[idx];
          const n = heat[Math.max(0, r - 1) * COLS + c];
          const s = heat[Math.min(ROWS - 1, r + 1) * COLS + c];
          const w = heat[r * COLS + Math.max(0, c - 1)];
          const e = heat[r * COLS + Math.min(COLS - 1, c + 1)];
          const nx = (c / COLS - 0.5) * 2;
          const ny = (r / ROWS - 0.5) * 2;
          const d  = Math.sqrt(nx * nx + ny * ny);
          const target =
            Math.exp(-d * d * 0.78) * 0.68 + 0.04
            + Math.sin(t * 0.70 + d * 2.5) * 0.055
            + Math.sin(t * 0.35 + c * 0.28) * Math.cos(t * 0.28 + r * 0.22) * 0.04;
          next[idx] = Math.min(1, Math.max(0,
            curr * 0.94 + (n + s + w + e) * 0.015 + target * 0.03,
          ));
        }
      }
      heat.set(next);

      if (!canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cw = canvas.width  / COLS;
      const ch = canvas.height / ROWS;

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const v = heat[r * COLS + c];
          const [rr, gg, bb] = thermalRgb(v);
          ctx.fillStyle = `rgba(${rr},${gg},${bb},${0.07 + v * 0.24})`;
          ctx.fillRect(c * cw, r * ch, cw, ch);
        }
      }

      // City grid lines
      ctx.strokeStyle = "rgba(255,255,255,0.028)";
      ctx.lineWidth   = 0.5;
      for (let c = 0; c <= COLS; c++) {
        ctx.beginPath(); ctx.moveTo(c * cw, 0); ctx.lineTo(c * cw, canvas.height); ctx.stroke();
      }
      for (let r = 0; r <= ROWS; r++) {
        ctx.beginPath(); ctx.moveTo(0, r * ch); ctx.lineTo(canvas.width, r * ch); ctx.stroke();
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, []);

  // ── Spawn floating readouts ─────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setLabels(prev => {
        const alive = prev.filter(l => now - l.id < 3500);
        return alive.length < 7 ? [...alive, { ...makeLabel(), id: now + Math.random() }] : alive;
      });
    }, 1100);
    return () => clearInterval(interval);
  }, []);

  // Brief delay so CSS-transition intro plays on mount
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="relative flex min-h-[calc(100dvh-57px)] lg:min-h-[calc(100dvh-61px)] flex-col overflow-hidden"
      style={{ background: "#050506" }}
    >
      {/* ── Animated heat-map canvas ── */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      />

      {/* ── Radial vignette — darkens edges, lets centre breathe ── */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background: [
            "radial-gradient(ellipse 80% 65% at 50% 42%,",
            "  transparent 0%,",
            "  rgba(5,5,6,0.52) 52%,",
            "  rgba(5,5,6,0.88) 100%)",
          ].join(""),
        }}
      />

      {/* ── Floating Δ-temperature readouts ── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <AnimatePresence>
          {labels.map(l => (
            <motion.span
              key={l.id}
              className="readout absolute select-none text-[11px] font-semibold"
              style={{ left: `${l.x}%`, top: `${l.y}%`, color: l.color, opacity: 0 }}
              animate={{ opacity: [0, 0.75, 0.75, 0], y: [0, -36] }}
              transition={{ duration: 3.4, times: [0, 0.1, 0.72, 1], ease: "easeOut" }}
            >
              {l.value}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>

      {/* ── Main content ── */}
      <div className="relative flex flex-1 flex-col items-center justify-between gap-10 px-5 py-10 lg:gap-0 lg:px-12 lg:py-14">

        {/* ── Hero ── */}
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">

          {/* Live stats badge */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={ready ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.75, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <span
              className="data inline-flex items-center gap-2 rounded-full px-3.5 py-1.5
                         text-[10.5px] tracking-widest text-white/40 backdrop-blur-sm"
              style={{
                background:   "rgba(255,255,255,0.04)",
                border:       "1px solid rgba(255,255,255,0.09)",
              }}
            >
              <span
                className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#e11d48]"
                style={{ animation: "uhei-sweep 2s ease-in-out infinite" }}
                aria-hidden="true"
              />
              LIVE · {stations}&nbsp;STATIONS · NE&nbsp;US · {rowsLabel}&nbsp;ROWS
            </span>
          </motion.div>

          {/* Main headline */}
          <div style={{ overflow: "hidden" }}>
            <motion.h1
              className="font-[family-name:var(--font-display)] text-white"
              style={{
                fontSize:      "clamp(2.8rem, 9vw, 6.8rem)",
                lineHeight:    0.94,
                letterSpacing: "-0.033em",
                fontWeight:    800,
              }}
              initial={{ opacity: 0, y: "105%" }}
              animate={ready ? { opacity: 1, y: "0%" } : undefined}
              transition={{ duration: 0.9, delay: 0.38, ease: [0.16, 1, 0.3, 1] }}
            >
              URBAN&nbsp;HEAT
              <br />
              <span style={{ color: "#e11d48" }}>&amp;&nbsp;ENERGY</span>
              <br />
              INTELLIGENCE
            </motion.h1>
          </div>

          {/* Animated rule */}
          <motion.div
            className="h-px bg-white/18 origin-center"
            style={{ width: "3.5rem" }}
            initial={{ scaleX: 0 }}
            animate={ready ? { scaleX: 1 } : undefined}
            transition={{ duration: 0.65, delay: 1.0, ease: [0.16, 1, 0.3, 1] }}
          />

          {/* Subtitle */}
          <motion.p
            className="max-w-sm text-[1.05rem] leading-[1.55] text-white/38 lg:max-w-md lg:text-lg"
            initial={{ opacity: 0, y: 12 }}
            animate={ready ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.7, delay: 1.12, ease: [0.16, 1, 0.3, 1] }}
          >
            Predict urban heat risk.
            Forecast energy demand.
            <br className="hidden lg:block" />
            Understand why. Explore what happens next.
          </motion.p>

          {/* Year range badge */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={ready ? { opacity: 1 } : undefined}
            transition={{ duration: 0.6, delay: 1.35 }}
            className="data text-[11px] tracking-widest text-white/22"
          >
            {meta?.study_period_years?.length
              ? `${meta.study_period_years[0]}–${meta.study_period_years[meta.study_period_years.length - 1]}`
              : "2022–2026"
            } · NOAA ISD-LITE · NYISO · OSM
          </motion.div>
        </div>

        {/* ── Navigation cards ── */}
        <motion.nav
          aria-label="Main navigation"
          className="grid w-full max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
          initial={{ opacity: 0, y: 28 }}
          animate={ready ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.85, delay: 1.5, ease: [0.16, 1, 0.3, 1] }}
        >
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavCard key={item.href} item={item} Icon={Icon} />
            );
          })}
        </motion.nav>

      </div>
    </div>
  );
}

// ── Nav card sub-component ────────────────────────────────────────────────────

interface NavCardProps {
  item: typeof NAV[number];
  Icon: React.ElementType;
}

function NavCard({ item, Icon }: NavCardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <Link
      href={item.href}
      className="group relative flex flex-col gap-3 overflow-hidden rounded-lg p-4
                 transition-colors duration-250"
      style={{
        background:   hovered ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.032)",
        border:       `1px solid ${hovered ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)"}`,
        backdropFilter: "blur(6px)",
        transition:   "background 220ms, border-color 220ms",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Colour glow on hover */}
      <div
        className="pointer-events-none absolute -inset-px rounded-lg"
        style={{
          background: `radial-gradient(circle at 50% 0%, rgba(${item.glow},0.18) 0%, transparent 68%)`,
          opacity:    hovered ? 1 : 0,
          transition: "opacity 220ms",
        }}
        aria-hidden="true"
      />

      {/* Icon row */}
      <div className="relative flex items-center justify-between">
        <motion.div
          animate={{ scale: hovered ? 1.12 : 1, y: hovered ? -1 : 0 }}
          transition={{ type: "spring", stiffness: 360, damping: 26 }}
        >
          <Icon size={18} style={{ color: `rgb(${item.glow})`, opacity: hovered ? 1 : 0.8 }} />
        </motion.div>
        <motion.div
          animate={{ opacity: hovered ? 1 : 0, x: hovered ? 0 : -4 }}
          transition={{ duration: 0.18 }}
        >
          <ArrowUpRight size={12} style={{ color: "rgba(255,255,255,0.4)" }} />
        </motion.div>
      </div>

      {/* Text */}
      <div className="relative">
        <div
          className="font-[family-name:var(--font-display)] text-sm font-bold"
          style={{ color: hovered ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.7)", transition: "color 180ms" }}
        >
          {item.label}
        </div>
        <div
          className="data mt-0.5 text-[11px]"
          style={{ color: hovered ? "rgba(255,255,255,0.38)" : "rgba(255,255,255,0.25)", transition: "color 180ms" }}
        >
          {item.desc}
        </div>
      </div>
    </Link>
  );
}
