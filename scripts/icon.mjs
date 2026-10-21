// Renders the Own Term icon into build/icon.svg, build/icon.png and build/icon.icns, and the site's copy.
// Runs under Electron (npm run icon), because Chromium draws the SVG's filters and keeps transparency.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { icon, menuBarIcon } from './icon-art.mjs'

const OUT = path.join(import.meta.dirname, '..', 'build')

/** Draws an SVG onto a canvas at `px` square and returns it as PNG bytes. */
async function rasterize(win, svg, px) {
  const dataUrl = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = ${JSON.stringify(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)}
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = ${px}
    canvas.getContext('2d').drawImage(img, 0, 0, ${px}, ${px})
    return canvas.toDataURL('image/png')
  })()`)
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

app.dock?.hide()
// Electron is only ready once the entry module has finished evaluating, so this can't be a top-level await.
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')

  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'icon.svg'), icon())
  fs.writeFileSync(path.join(OUT, 'icon.png'), await rasterize(win, icon(), 1024))
  // The marketing page's favicon and artwork.
  fs.copyFileSync(path.join(OUT, 'icon.png'), path.join(import.meta.dirname, '..', 'site', 'public', 'icon.png'))

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'own-term-icon-'))
  const iconset = path.join(work, 'icon.iconset')
  fs.mkdirSync(iconset)
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const px = size * scale
      const png = await rasterize(win, icon({ small: px <= 32 }), px)
      fs.writeFileSync(path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`), png)
    }
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(OUT, 'icon.icns')])
  fs.rmSync(work, { recursive: true })

  // The menu bar icon ships with the main process. "Template" in the name tells macOS to recolor it.
  const tray = path.join(import.meta.dirname, '..', 'electron', 'menubar')
  fs.mkdirSync(tray, { recursive: true })
  for (const [name, cursor] of [['iconTemplate', true], ['blinkTemplate', false]]) {
    fs.writeFileSync(path.join(tray, `${name}.png`), await rasterize(win, menuBarIcon({ cursor }), 18))
    fs.writeFileSync(path.join(tray, `${name}@2x.png`), await rasterize(win, menuBarIcon({ cursor }), 36))
  }
  console.log(`Wrote ${OUT}/icon.svg, icon.png and icon.icns, and the menu bar icon in electron/menubar`)
  app.quit()
})
