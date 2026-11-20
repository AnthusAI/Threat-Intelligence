export function BrandWebMark({ size = 22, accessibleLabel }: { size?: number; accessibleLabel?: string }) {
  return (
    <svg
      aria-hidden={accessibleLabel ? undefined : true}
      aria-label={accessibleLabel}
      className="brand-web-mark"
      height={size}
      role={accessibleLabel ? "img" : undefined}
      viewBox="0 0 20 20"
      width={size}
    >
      <g className="f-none s-line" strokeWidth="1">
        <polygon points="18,10 15.66,15.66 10,18 4.34,15.66 2,10 4.34,4.34 10,2 15.66,4.34" />
        <polygon points="14,10 12.83,12.83 10,14 7.17,12.83 6,10 7.17,7.17 10,6 12.83,7.17" />
        <path d="M2 10H18M10 2V18M4.34 4.34L15.66 15.66M15.66 4.34L4.34 15.66" />
      </g>
      <circle className="f-signal" cx="15.66" cy="15.66" r="2.4" />
    </svg>
  );
}
