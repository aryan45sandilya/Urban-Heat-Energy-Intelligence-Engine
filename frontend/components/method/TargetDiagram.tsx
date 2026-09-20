"use client";

/**
 * How ΔT is constructed, drawn rather than described: an urban site, its three
 * rural references, the altitude correction that makes them comparable, and the
 * difference that becomes the target. Inline SVG so it inherits the palette and
 * reads correctly in both themes.
 */
export function TargetDiagram() {
  return (
    <figure>
      <figcaption className="label-strong mb-4">
        Constructing the target, one hour at a time
      </figcaption>

      <svg
        viewBox="0 0 640 300"
        className="w-full"
        role="img"
        aria-label="Diagram: a site's temperature minus the altitude-corrected mean of its three nearest rural reference stations gives the urban heat island intensity"
      >
        <defs>
          <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4"
                  markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--border-strong)" />
          </marker>
        </defs>

        {/* Rural references */}
        <g>
          <text x="14" y="24" className="label" fontSize="9"
                fill="var(--foreground-muted)" letterSpacing="1.2">
            RURAL REFERENCES
          </text>
          {[
            { y: 52, name: "Reference 1", temp: "21.4 °C", dist: "48 km", elev: "+65 m" },
            { y: 112, name: "Reference 2", temp: "20.9 °C", dist: "71 km", elev: "−20 m" },
            { y: 172, name: "Reference 3", temp: "21.8 °C", dist: "94 km", elev: "+110 m" },
          ].map((ref) => (
            <g key={ref.name}>
              <rect x="14" y={ref.y} width="150" height="44"
                    fill="var(--surface)" stroke="var(--border)" strokeWidth="1" />
              <circle cx="30" cy={ref.y + 16} r="4" fill="var(--accent)" />
              <text x="42" y={ref.y + 19} fontSize="11" fill="var(--foreground)">
                {ref.name}
              </text>
              <text x="42" y={ref.y + 34} fontSize="10"
                    fill="var(--foreground-muted)" fontFamily="var(--font-mono)">
                {ref.temp} · {ref.dist} · {ref.elev}
              </text>
            </g>
          ))}
        </g>

        {/* Lapse correction */}
        <line x1="164" y1="74" x2="214" y2="130" stroke="var(--border-strong)"
              strokeWidth="1" markerEnd="url(#arrow)" />
        <line x1="164" y1="134" x2="214" y2="136" stroke="var(--border-strong)"
              strokeWidth="1" markerEnd="url(#arrow)" />
        <line x1="164" y1="194" x2="214" y2="142" stroke="var(--border-strong)"
              strokeWidth="1" markerEnd="url(#arrow)" />

        <rect x="218" y="108" width="148" height="58"
              fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="1" />
        <text x="230" y="128" fontSize="11" fill="var(--foreground)" fontWeight="600">
          Altitude correction
        </text>
        <text x="230" y="144" fontSize="10" fill="var(--foreground-muted)"
              fontFamily="var(--font-mono)">
          − 6.5 °C per km
        </text>
        <text x="230" y="158" fontSize="9" fill="var(--foreground-faint)">
          then averaged
        </text>

        {/* Background */}
        <line x1="366" y1="137" x2="412" y2="137" stroke="var(--border-strong)"
              strokeWidth="1" markerEnd="url(#arrow)" />
        <rect x="416" y="112" width="120" height="50"
              fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1" />
        <text x="428" y="131" fontSize="10" fill="var(--foreground-muted)"
              fontFamily="var(--font-mono)" letterSpacing="0.8">
          T_ref
        </text>
        <text x="428" y="151" fontSize="16" fill="var(--foreground)"
              fontFamily="var(--font-mono)" fontWeight="600">
          21.1 °C
        </text>

        {/* Site */}
        <text x="14" y="248" className="label" fontSize="9"
              fill="var(--foreground-muted)" letterSpacing="1.2">
          SITE
        </text>
        <rect x="14" y="256" width="150" height="34"
              fill="var(--surface)" stroke="var(--border)" strokeWidth="1" />
        <rect x="14" y="256" width="3" height="34" fill="var(--primary)" />
        <text x="30" y="270" fontSize="11" fill="var(--foreground)">Urban station</text>
        <text x="30" y="284" fontSize="10" fill="var(--foreground-muted)"
              fontFamily="var(--font-mono)">
          23.6 °C observed
        </text>

        <line x1="164" y1="272" x2="412" y2="272" stroke="var(--border-strong)"
              strokeWidth="1" strokeDasharray="3 3" />
        <line x1="476" y1="162" x2="476" y2="252" stroke="var(--border-strong)" strokeWidth="1" />
        <line x1="412" y1="272" x2="476" y2="272" stroke="var(--border-strong)" strokeWidth="1" />

        {/* Result */}
        <rect x="416" y="196" width="210" height="56"
              fill="var(--primary-soft)" stroke="var(--primary)" strokeWidth="1.5" />
        <text x="430" y="216" fontSize="10" fill="var(--primary-deep)"
              fontFamily="var(--font-mono)" letterSpacing="0.8">
          ΔT = T_site − T_ref
        </text>
        <text x="430" y="242" fontSize="21" fill="var(--primary)"
              fontFamily="var(--font-mono)" fontWeight="600">
          +2.5 °C
        </text>

        <text x="416" y="46" fontSize="10" fill="var(--foreground-muted)">
          The model never sees the site&apos;s own
        </text>
        <text x="416" y="61" fontSize="10" fill="var(--foreground-muted)">
          temperature — only the background state
        </text>
        <text x="416" y="76" fontSize="10" fill="var(--foreground-muted)">
          and the site&apos;s measured urban fabric.
        </text>
      </svg>

      <p className="mt-4 text-[11.5px] leading-relaxed text-[var(--foreground-muted)]">
        Figures shown are illustrative of the arithmetic, not a specific record. References
        must be at least 15 km away, no more than 150 km away, within 300 m of the site&apos;s
        altitude, and must not sit on water — a lighthouse is governed by the sea, not by the
        countryside.
      </p>
    </figure>
  );
}
