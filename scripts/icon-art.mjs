// The Own Term icon, an O that a cursor finishes, as SVG. scripts/icon.mjs renders it into the app's icon files.
const AMBER = { top: '#ffc35c', bottom: '#ffa424' }

const rad = d => (d * Math.PI) / 180

/**
 * The ring and cursor on a 1024 canvas. The cursor sits on the ring at `theta` degrees (clockwise
 * from 3 o'clock), and the ring's gap opens just far enough to clear it by `clear` on both sides.
 * Small sizes get a thicker ring and a bigger cursor so they still read at 16px.
 */
export function glyph({ small = false, ink = 'url(#ring)', glow = !small, cursorFill = 'url(#cursor)', line } = {}) {
  const theta = 32
  const R = 288
  // `line` is a menu bar weight: a thin ring, like the system's own icons, and a cursor to match.
  const S = line ?? (small ? 132 : 96)
  const [w, h] = line ? [line * 1.45, line * 2.6] : small ? [156, 230] : [128, 204]
  const clear = line ? line * 0.45 : small ? 38 : 34
  const c = 512
  const bx = c + R * Math.cos(rad(theta))
  const by = c + R * Math.sin(rad(theta))
  const box = { x0: bx - w / 2, x1: bx + w / 2, y0: by - h / 2, y1: by + h / 2 }
  const distance = (x, y) => Math.hypot(Math.max(box.x0 - x, 0, x - box.x1), Math.max(box.y0 - y, 0, y - box.y1))
  const at = a => [c + R * Math.cos(rad(a)), c + R * Math.sin(rad(a))]
  let phi = 1
  while (Math.min(distance(...at(theta - phi)), distance(...at(theta + phi))) - S / 2 < clear) phi += 0.25
  const point = a => at(a).map(n => n.toFixed(1)).join(' ')
  const cursor = `x="${box.x0.toFixed(1)}" y="${box.y0.toFixed(1)}" width="${w}" height="${h}" rx="${(w * 0.24).toFixed(1)}"`
  return [
    glow ? `<rect ${cursor} fill="${AMBER.bottom}" opacity=".45" filter="url(#glow)"/>` : '',
    `<path d="M ${point(theta + phi)} A ${R} ${R} 0 1 1 ${point(theta - phi)}" fill="none" stroke="${ink}" stroke-width="${S}" stroke-linecap="round"/>`,
    cursorFill ? `<rect ${cursor} fill="${cursorFill}"/>` : '',
  ].join('\n    ')
}

export const DEFS = `<defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c3342"/><stop offset="1" stop-color="#0e1118"/></linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e2e7f0"/></linearGradient>
    <linearGradient id="cursor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${AMBER.top}"/><stop offset="1" stop-color="${AMBER.bottom}"/></linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity=".28"/></filter>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>
  </defs>`

/** The app icon: the glyph on a tile in the app's own night blue, on Apple's 1024 grid (an 824px tile) with its shadow. */
export function icon({ small = false } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  ${DEFS}
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#tile)" filter="url(#shadow)"/>
  <rect x="103" y="103" width="818" height="818" rx="182" fill="none" stroke="url(#rim)" stroke-width="6"/>
  <g transform="translate(100 100) scale(${824 / 1024})">
    ${glyph({ small })}
  </g>
</svg>`
}

/**
 * The menu bar icon: the small mark in black, which macOS recolors for the menu bar as a template
 * image. Without its cursor it's the blink's other frame, shown while Claude works.
 */
export function menuBarIcon({ cursor = true } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="152 152 720 720" width="720" height="720">
  ${glyph({ line: 76, ink: '#000', glow: false, cursorFill: cursor ? '#000' : '' })}
</svg>`
}
