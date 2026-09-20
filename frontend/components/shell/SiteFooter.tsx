import Link from "next/link";

const SOURCES = [
  { label: "NOAA NCEI ISD-Lite", href: "https://www.ncei.noaa.gov/products/land-based-station/integrated-surface-database" },
  { label: "OpenStreetMap", href: "https://www.openstreetmap.org/copyright" },
  { label: "NYISO market data", href: "http://mis.nyiso.com/public/" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--background-deep)]">
      <div
        className="mx-auto grid gap-8 px-[var(--gutter)] py-10 sm:grid-cols-2 lg:grid-cols-4"
        style={{ maxWidth: "var(--page-max)" }}
      >
        <div className="lg:col-span-2">
          <p className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight">
            Urban Heat &amp; Energy Intelligence Engine
          </p>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--foreground-muted)]">
            A Random Forest system fitted to three years of hourly weather-station
            observations, OpenStreetMap urban morphology and NYISO metered load.
            Every figure shown in this interface is computed from that record.
          </p>
        </div>

        <div>
          <p className="label mb-3">Data sources</p>
          <ul className="space-y-1.5">
            {SOURCES.map((source) => (
              <li key={source.href}>
                <a
                  href={source.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm text-[var(--foreground-muted)] underline-offset-4
                             transition-colors hover:text-[var(--primary)] hover:underline"
                >
                  {source.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="label mb-3">Read the method</p>
          <ul className="space-y-1.5">
            <li>
              <Link href="/method" className="text-sm text-[var(--foreground-muted)] underline-offset-4 transition-colors hover:text-[var(--primary)] hover:underline">
                Methodology &amp; limitations
              </Link>
            </li>
            <li>
              <Link href="/lab" className="text-sm text-[var(--foreground-muted)] underline-offset-4 transition-colors hover:text-[var(--primary)] hover:underline">
                Model comparison
              </Link>
            </li>
            <li>
              <a
                href="http://127.0.0.1:8000/docs"
                target="_blank"
                rel="noreferrer noopener"
                className="text-sm text-[var(--foreground-muted)] underline-offset-4 transition-colors hover:text-[var(--primary)] hover:underline"
              >
                API reference
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-[var(--border)]">
        <div
          className="mx-auto flex flex-col gap-2 px-[var(--gutter)] py-4 text-[11px]
                     text-[var(--foreground-faint)] sm:flex-row sm:items-center sm:justify-between"
          style={{ maxWidth: "var(--page-max)" }}
        >
          <p className="data">
            Predictions are statistical associations learned from historical observations.
            They are not causal claims and not an official forecast.
          </p>
          <p className="data shrink-0">© OpenStreetMap contributors · NOAA · NYISO</p>
        </div>
      </div>
    </footer>
  );
}
