export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="PolyHedge"
    >
      <defs>
        <linearGradient id="hex-stroke" x1="2" y1="3.61" x2="26" y2="24.39" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#818cf8" />
        </linearGradient>
        <linearGradient id="trend-stroke" x1="5" y1="21" x2="23" y2="8" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#6ee7b7" />
        </linearGradient>
      </defs>

      {/* Flat-top hexagon — "poly" */}
      <polygon
        points="26,14 20,3.61 8,3.61 2,14 8,24.39 20,24.39"
        stroke="url(#hex-stroke)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Rising trend line — "hedge" */}
      <polyline
        points="6,20 10.5,16 15,13 22,9"
        stroke="url(#trend-stroke)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Terminal dot */}
      <circle cx="22" cy="9" r="1.8" fill="#34d399" />
    </svg>
  );
}
