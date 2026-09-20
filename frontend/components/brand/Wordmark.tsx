/**
 * The UHEI mark: a five-bar thermal column beside the wordmark. The bars use the
 * product's thermal ramp, so the logo is literally the legend for every map and
 * chart in the application.
 */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-6 items-end gap-[2px]" aria-hidden>
        {[3, 4, 5, 6].map((stop, i) => (
          <span
            key={stop}
            className="w-[3px]"
            style={{
              height: `${8 + i * 4}px`,
              background: `var(--heat-${stop})`,
            }}
          />
        ))}
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-[family-name:var(--font-display)] text-[15px] font-extrabold tracking-[-0.03em]">
          UHEI
        </span>
        {!compact && (
          <span className="label mt-[3px] hidden text-[8.5px] tracking-[0.16em] sm:block">
            Urban Heat Intelligence
          </span>
        )}
      </span>
    </span>
  );
}
