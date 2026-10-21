// The icon's mark: a ring an amber cursor finishes. The geometry is the icon's own
// (scripts/icon-art.mjs), on its 1024 canvas, cropped to the mark.
export const RING = 'M 608.1 783.5 A 288 288 0 1 1 798.1 479.4'
export const CURSOR = { x: 692.2, y: 562.6, width: 128, height: 204, rx: 30.7 }

export function Mark({ size, className }: { size: number; className?: string }) {
  return (
    <svg className={`mark ${className ?? ''}`} width={size} height={size} viewBox="160 160 704 704" aria-hidden="true">
      <defs>
        <linearGradient id="mark-cursor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffc35c" />
          <stop offset="1" stopColor="#ffa424" />
        </linearGradient>
        <filter id="mark-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="26" />
        </filter>
      </defs>
      <path className="mark-ring" d={RING} pathLength={1} fill="none" stroke="currentColor" strokeWidth="96" strokeLinecap="round" />
      <g className="mark-cursor">
        <rect {...CURSOR} fill="#ffa424" opacity=".45" filter="url(#mark-glow)" />
        <rect {...CURSOR} fill="url(#mark-cursor)" />
      </g>
    </svg>
  )
}
