// Writes docs/design/brand.html, Own Term's one-page design and brand sheet (npm run brand). The icon
// comes from icon-art.mjs and the colors from src/styles.css, so the sheet can't drift from the app.
import fs from 'node:fs'
import path from 'node:path'
import { DEFS, glyph, icon } from './icon-art.mjs'

const ROOT = path.join(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'docs', 'design', 'brand.html')

/** The custom properties of the first CSS block that `selector` opens, as name → value. */
function tokens(css, selector) {
  const start = css.indexOf(selector)
  const body = css.slice(css.indexOf('{', start + selector.length) + 1, css.indexOf('}', start))
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
}
const css = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8')
const dark = tokens(css, ':root')
const light = tokens(css, '@media (prefers-color-scheme: light) {\n  :root')

const sized = (svg, px) => svg.replace('width="1024" height="1024"', `width="${px}" height="${px}"`)
const appIcon = (px, small = px <= 32) => sized(icon({ small }), px)
const mark = (px, { ink, small = px <= 32 } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="80 80 864 864" width="${px}" height="${px}" aria-hidden="true">${DEFS}${glyph({ small, ink, glow: false })}</svg>`

const sizes = [
  [128, '128 · Dock'],
  [64, '64'],
  [32, '32 · Finder'],
  [16, '16 · Lists'],
]
const sizeRow = dark => `
  <div class="sizes ${dark ? 'dark' : ''}">
    ${sizes.map(([px, label]) => `<figure>${appIcon(px)}<figcaption>${label}</figcaption></figure>`).join('')}
  </div>`

const surfaces = [
  ['Base', 'base', 'The window, around and between the cards.'],
  ['Content', 'content', 'Pane cards and the terminals in them.'],
  ['Sidebar', 'sidebar', 'The sidebar card.'],
  ['Raised', 'raised', 'Sheets, the palette and the find bar.'],
]
const signals = [
  ['System accent', dark.accent, 'Selection, buttons, links and “your turn”. Follows the Mac’s accent setting.'],
  ['Cursor', '#ffb340', 'The icon and the prompt glyph only. Never UI chrome.'],
  ['Orange', dark.orange, 'Needs input.'],
  ['Green', dark.green, 'Running, and lines added.'],
  ['Red', dark.red, 'Exited, failed, and lines removed.'],
]

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Own Term · design and brand</title>
<style>
  :root { --ink: #1d1d1f; --muted: #6e6e73; --rule: #e5e5ea; --night: ${dark.base}; --paper: #f5f5f7; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: var(--ink); font: 13px/1.45 -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  .page { width: 1440px; margin: 0 auto; padding: 72px 0 96px; display: flex; flex-direction: column; gap: 72px; }
  header { display: flex; align-items: center; justify-content: space-between; }
  .title { display: flex; align-items: center; gap: 18px; }
  .title h1 { margin: 0; font: 700 40px/1 -apple-system, 'SF Pro Display', system-ui, sans-serif; letter-spacing: -0.03em; }
  .title p, .meta { margin: 6px 0 0; color: var(--muted); }
  .meta { font-size: 12px; margin: 0; }
  h2 { margin: 0 0 20px; display: flex; align-items: baseline; gap: 14px; font: 700 24px/1 -apple-system, 'SF Pro Display', system-ui, sans-serif; letter-spacing: -0.02em; }
  h2 span { font: 400 13px -apple-system, system-ui, sans-serif; letter-spacing: 0; color: var(--muted); }
  .panel { border: 1px solid var(--rule); border-radius: 14px; overflow: hidden; }
  .label { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  .dark .label { color: #98989d; }
  .note { font-size: 12px; color: var(--muted); line-height: 1.5; }
  .dark .note { color: #98989d; }

  .icon-row { display: grid; grid-template-columns: 520px 1fr; gap: 40px; }
  .master { position: relative; height: 520px; display: grid; place-items: center; background: #fff; }
  .master .grid { position: absolute; inset: 28px; width: 464px; height: 464px; pointer-events: none; }
  .master > svg:not(.grid) { width: 464px; height: 464px; }
  .size-table { display: flex; flex-direction: column; }
  .sizes { flex: 1; display: flex; align-items: flex-end; gap: 48px; padding: 40px 48px; background: var(--paper); color: var(--muted); font-size: 12px; }
  .sizes.dark { background: var(--night); color: #98989d; }
  .sizes figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .sizes figcaption { font-variant-numeric: tabular-nums; }

  .construction { display: grid; grid-template-columns: repeat(3, 1fr); }
  .construction > div { padding: 36px 40px; display: flex; flex-direction: column; gap: 18px; }
  .construction > div + div { border-left: 1px solid var(--rule); }
  .construction .dark { background: var(--night); color: var(--paper); }
  .construction .art { height: 200px; display: grid; place-items: center; }

  .brand { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 380px auto auto; }
  .brand > div { padding: 56px 64px; display: flex; flex-direction: column; justify-content: space-between; gap: 32px; }
  .brand .dark { background: var(--night); color: var(--paper); }
  .brand .light { background: var(--paper); border-left: 1px solid var(--rule); }
  .brand .swatches, .brand .type { background: #fff; border-top: 1px solid var(--rule); justify-content: flex-start; }

  .lockup { display: flex; align-items: center; gap: 26px; font: 700 64px/1 -apple-system, 'SF Pro Display', system-ui, sans-serif; letter-spacing: -0.03em; }
  .small-forms { display: flex; align-items: center; gap: 40px; }
  .small-forms > div { display: flex; align-items: center; gap: 10px; }
  .menu-form { font-size: 15px; font-weight: 600; }
  .prompt-form { font: 15px 'SF Mono', Menlo, ui-monospace, monospace; }
  .prompt-form b { font-weight: 700; }
  .prompt-form i { display: inline-block; width: 9px; height: 17px; border-radius: 2px; background: #ffb340; }
  .small-forms small { font: 400 12px -apple-system, system-ui, sans-serif; color: var(--muted); }

  .swatch-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 28px 20px; }
  .swatch-grid.signals { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .chip.split { display: flex; overflow: hidden; }
  .chip.split span { flex: 1; }
  .brand .swatches, .brand .type { grid-column: 1 / -1; }
  .swatch-grid div { display: flex; flex-direction: column; gap: 8px; }
  .chip { display: block; height: 64px; border-radius: 12px; border: 1px solid rgba(0, 0, 0, 0.08); }
  .swatch-grid b { font-size: 13px; }
  .swatch-grid code { font: 12px 'SF Mono', Menlo, ui-monospace, monospace; color: var(--muted); }
  .type-rows { display: flex; flex-direction: column; gap: 18px; }
  .type-rows > div { display: grid; grid-template-columns: 400px 1fr; gap: 24px; align-items: baseline; }
  .display { font: 700 34px/1.1 -apple-system, 'SF Pro Display', system-ui, sans-serif; letter-spacing: -0.02em; }
  .text { font-size: 17px; }
  .mono { font: 15px/1.15 'SF Mono', Menlo, ui-monospace, monospace; }
  .voice { margin-top: auto; padding-top: 18px; border-top: 1px solid var(--rule); }
</style>
</head>
<body>
<div class="page">
  <header>
    <div class="title">
      ${appIcon(72)}
      <div><h1>Own Term</h1><p>Design and brand sheet · macOS</p></div>
    </div>
    <p class="meta">Generated by npm run brand</p>
  </header>

  <section>
    <h2>App icon <span>1024 master on Apple’s icon grid, and the sizes macOS shows it at</span></h2>
    <div class="icon-row">
      <div class="panel master">

        ${sized(icon(), 464)}
        <svg class="grid" viewBox="0 0 1024 1024" aria-hidden="true">
          <rect x="100" y="100" width="824" height="824" rx="185" fill="none" stroke="#0a84ff" stroke-opacity=".35" stroke-dasharray="6 8" stroke-width="2"/>
          <line x1="512" y1="0" x2="512" y2="1024" stroke="#0a84ff" stroke-opacity=".18" stroke-width="2"/>
          <line x1="0" y1="512" x2="1024" y2="512" stroke="#0a84ff" stroke-opacity=".18" stroke-width="2"/>
        </svg>
      </div>
      <div class="panel size-table">${sizeRow(false)}${sizeRow(true)}</div>
    </div>
  </section>

  <section>
    <h2>Mark <span>An O that the cursor finishes</span></h2>
    <div class="panel construction">
      <div>
        <div class="label">Construction</div>
        <div class="art">${mark(180, { ink: '#1d1d1f' })}</div>
        <p class="note">The cursor sits on the ring at 32° below 3 o’clock. The ring opens only far enough to clear it by a third of the stroke on each side, so it reads as one O rather than a spinner or a C.</p>
      </div>
      <div class="dark">
        <div class="label">Monochrome on dark</div>
        <div class="art">${mark(180, { ink: '#f5f5f7' })}</div>
        <p class="note">The ring takes the text color of whatever it sits on. The cursor stays amber in every form.</p>
      </div>
      <div>
        <div class="label">Small sizes</div>
        <div class="art" style="display:flex;gap:28px;align-items:center;justify-content:center">${mark(48, { ink: '#1d1d1f', small: false })}${mark(32, { ink: '#1d1d1f' })}${mark(16, { ink: '#1d1d1f' })}</div>
        <p class="note">At 32px and below the ring thickens and the cursor grows, so the mark keeps its shape at Finder and list sizes.</p>
      </div>
    </div>
  </section>

  <section>
    <h2>Brand <span>Lockups, color and type</span></h2>
    <div class="panel brand">
      <div class="dark">
        <div class="label">Primary lockup · dark</div>
        <div class="lockup">${appIcon(96)}Own Term</div>
        <p class="note">Clearance around the lockup is one cursor height on every side. The amber lives in the icon and the prompt glyph; the app itself uses the system accent color, like every Apple app. The dark ground is the app’s own window color.</p>
      </div>
      <div class="light">
        <div class="label">Primary lockup · light, and small forms</div>
        <div class="lockup">${appIcon(96)}Own Term</div>
        <div class="small-forms">
          <div class="menu-form">${mark(20, { ink: '#1d1d1f' })} Own Term <small>About window, menus</small></div>
          <div class="prompt-form"><b>O</b><i></i> <small>prompt glyph</small></div>
        </div>
      </div>
      <div class="swatches">
        <div class="label">Color · surfaces, dark and light</div>
        <div class="swatch-grid">
          ${surfaces.map(([name, token, use]) => `<div><span class="chip split"><span style="background:${dark[token]}"></span><span style="background:${light[token]}"></span></span><b>${name} <code>--${token}</code></b><code>${dark[token]} · ${light[token]}</code><span class="note">${use}</span></div>`).join('')}
        </div>
        <div class="swatch-grid signals">
          ${signals.map(([name, hex, use]) => `<div><span class="chip" style="background:${hex}"></span><b>${name}</b><code>${hex}</code><span class="note">${use}</span></div>`).join('')}
        </div>
      </div>
      <div class="type">
        <div class="label">Type</div>
        <div class="type-rows">
          <div><span class="display">SF Pro Display Bold</span><span class="note">Wordmark, window titles, headlines. Tracking −2 to −3%.</span></div>
          <div><span class="text">SF Pro Text · <b>Semibold</b> for labels</span><span class="note">Sidebar, lists, toolbar and dialogs. 13pt body, 11pt captions.</span></div>
          <div><span class="mono">SF Mono · <b>Bold</b> for tool names</span><span class="note">Terminal panes, 13pt. Line height stays at 1.15 so box-drawing characters join up. Ligatures off.</span></div>
        </div>
        <p class="note voice">Voice: short declarative sentences, lowercase in the terminal, sentence case in the UI. The product name is two words, Own Term, never OwnTerm or ownterm.</p>
      </div>
    </div>
  </section>
</div>
</body>
</html>
`
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, html)
console.log(`Wrote ${OUT}`)
