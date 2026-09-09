import React from 'react';

interface ChronosLogoProps {
  /** Font size of the wordmark in px; the stopwatch scales with it. */
  size?: number;
  className?: string;
}

/**
 * CHRONOS wordmark with the first "O" replaced by a stopwatch whose hand sweeps
 * continuously. The hand is a plain SVG rotation animation (no JS timer), so it
 * costs nothing and keeps ticking regardless of React re-renders.
 */
export const ChronosLogo: React.FC<ChronosLogoProps> = ({ size = 28, className = '' }) => {
  const dial = size * 1.02;
  const r = 42; // dial radius within the 100x100 viewBox

  return (
    <span
      className={`inline-flex items-baseline gap-[0.06em] font-headline uppercase leading-none select-none ${className}`}
      style={{ fontSize: size }}
      aria-label="Chronos"
    >
      <span className="text-white tracking-tight">CHR</span>

      <svg
        viewBox="0 0 100 100"
        width={dial}
        height={dial}
        className="translate-y-[0.09em]"
        role="img"
        aria-hidden="true"
      >
        {/* crown + side button, so the O reads as a stopwatch rather than a ring */}
        <rect x="43" y="1" width="14" height="10" rx="2" fill="#c8ff00" />
        <rect x="70" y="12" width="9" height="7" rx="2" fill="#c8ff00" transform="rotate(38 74 15)" />

        <circle cx="50" cy="56" r={r} fill="#0b0c0e" stroke="#c8ff00" strokeWidth="8" />

        {/* minute ticks at the quarters */}
        {[0, 90, 180, 270].map((deg) => (
          <rect
            key={deg}
            x="48.5" y="18" width="3" height="8" rx="1.5" fill="#c8ff00" opacity="0.85"
            transform={`rotate(${deg} 50 56)`}
          />
        ))}

        {/* sweeping hand - one revolution per 2s, forever */}
        <g>
          <rect x="48.4" y="26" width="3.2" height="32" rx="1.6" fill="#ffffff" />
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 50 56"
            to="360 50 56"
            dur="2s"
            repeatCount="indefinite"
          />
        </g>
        <circle cx="50" cy="56" r="4.5" fill="#c8ff00" />
      </svg>

      <span className="text-white tracking-tight">NOS</span>
    </span>
  );
};
