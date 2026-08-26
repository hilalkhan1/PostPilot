/**
 * The mark, inlined.
 *
 * It has to be inline rather than an <img src="/logo-mark.svg"> because the ink
 * strokes are `currentColor` — an external SVG cannot inherit the page's colour,
 * so it would render black on the dark theme. public/logo-mark.svg is the same
 * artwork, kept for uploads and anywhere outside React.
 */
export function LogoMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="PostPilot"
    >
      <g transform="rotate(-15 24 24)">
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity=".92"
        >
          <path d="M19.4 21.4C24.8 18 29.2 15.6 32.8 14.2" />
          <path d="M20 24h12.8" />
          <path d="M19.4 26.6C24.8 30 29.2 32.4 32.8 33.8" />
        </g>
        <g fill="currentColor">
          <circle cx="36.4" cy="12.9" r="3.2" />
          <circle cx="36.4" cy="24" r="3.2" />
          <circle cx="36.4" cy="35.1" r="3.2" />
        </g>
        <rect
          x="6"
          y="17.8"
          width="12.4"
          height="12.4"
          rx="3.7"
          fill="var(--accent)"
        />
      </g>
    </svg>
  );
}

/** Mark plus wordmark. The lockup lives in markup so the type can use a webfont. */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={size} />
      <span
        className="font-bold tracking-tight"
        style={{ fontSize: size * 0.78 }}
      >
        PostPilot
      </span>
    </span>
  );
}
