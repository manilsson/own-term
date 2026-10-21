// The menu bar icon and its panel: what every session is doing, seen from any app. The main
// window's renderer sends a summary of its sessions; the panel is a second page that shows it.
const { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, screen } = require('electron')
const path = require('node:path')

const WIDTH = 360
const MAX_HEIGHT = 560
// A terminal cursor's blink rate.
const BLINK_MS = 530

let tray = null
let panel = null
let blink = null
let summary = { sessions: [], working: 0, needsYou: 0 }
let options

// `settings` reads and `save` merges settings.json, `mainWindow` gives the app's window, and
// `loadPage(win, query)` loads the renderer with a query string.
function setupMenuBar(opts) {
  options = opts
  if (enabled()) createTray()

  ipcMain.on('menubar:summary', (_e, next) => {
    summary = next
    render()
    panel?.webContents.send('menubar', summary)
  })
  ipcMain.on('menubar:get', e => (e.returnValue = { summary, pinned: pinned() }))
  ipcMain.on('menubar:open', (_e, id) => openApp(id))
  ipcMain.on('menubar:answer', (_e, id, allow) => {
    options.mainWindow()?.webContents.send('menubar-action', { type: 'answer', id, allow: !!allow })
  })
  ipcMain.on('menubar:reply', (_e, id, text) => {
    options.mainWindow()?.webContents.send('menubar-action', { type: 'reply', id, text: String(text) })
  })
  ipcMain.on('menubar:pin', (_e, pin) => setPinned(!!pin))
  ipcMain.on('menubar:height', (_e, height) => {
    if (!panel || !(height > 0)) return
    const [width] = panel.getSize()
    panel.setSize(width, Math.min(Math.ceil(height), MAX_HEIGHT))
  })
}

/** Brings the window forward, at a session when given one. */
function openApp(id) {
  if (!pinned()) panel?.hide()
  const win = options.mainWindow()
  if (!win) return
  win.show()
  win.focus()
  if (id) win.webContents.send('menubar-action', { type: 'open', id })
}

const enabled = () => options.settings().menuBar !== false
const pinned = () => !!options.settings().menuBarPanel?.pinned

/** View → Show in Menu Bar. */
function setMenuBarEnabled(on) {
  options.save({ menuBar: on })
  if (on) createTray()
  else {
    stopBlink()
    tray?.destroy()
    tray = null
    panel?.hide()
  }
}

function createTray() {
  if (tray) return
  tray = new Tray(icon('iconTemplate'))
  tray.on('click', togglePanel)
  tray.on('right-click', () => {
    tray.popUpContextMenu(Menu.buildFromTemplate([
      { label: 'Open Own Term', click: () => openApp() },
      { label: 'Hide Menu Bar Icon', click: () => setMenuBarEnabled(false) },
      { type: 'separator' },
      { label: 'Quit Own Term', role: 'quit' },
    ]))
  })
  render()
}

const icons = {}
function icon(name) {
  return (icons[name] ??= nativeImage.createFromPath(path.join(__dirname, 'menubar', `${name}.png`)))
}

/** The icon's cursor blinks while anything is working; a count beside it says how many sessions need you. */
function render() {
  if (!tray) return
  tray.setTitle(summary.needsYou ? String(summary.needsYou) : '', { fontType: 'monospacedDigit' })
  const parts = [summary.working && `${summary.working} working`, summary.needsYou && `${summary.needsYou} need${summary.needsYou === 1 ? 's' : ''} you`]
  tray.setToolTip(['Own Term', ...parts.filter(Boolean)].join(' · '))
  if (summary.working && !blink) {
    let on = true
    blink = setInterval(() => tray?.setImage(icon((on = !on) ? 'iconTemplate' : 'blinkTemplate')), BLINK_MS)
  } else if (!summary.working) stopBlink()
}

function stopBlink() {
  clearInterval(blink)
  blink = null
  tray?.setImage(icon('iconTemplate'))
}

function createPanel() {
  panel = new BrowserWindow({
    width: WIDTH,
    height: 160,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    transparent: true,
    vibrancy: 'popover',
    visualEffectState: 'active',
    // A macOS panel floats over full-screen apps, on every desktop. setVisibleOnAllWorkspaces did that by
    // turning the whole app into one without a Dock icon, which lost the Dock icon's running dot.
    type: 'panel',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true },
  })
  panel.setAlwaysOnTop(true, 'floating')
  panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  panel.webContents.on('will-navigate', (event, url) => url !== panel.webContents.getURL() && event.preventDefault())
  panel.on('blur', () => {
    if (!pinned()) panel.hide()
  })
  panel.on('moved', () => {
    if (pinned()) options.save({ menuBarPanel: { pinned: true, position: panel.getPosition() } })
  })
  panel.on('closed', () => (panel = null))
  options.loadPage(panel, 'panel')
}

function togglePanel() {
  if (panel?.isVisible()) return panel.hide()
  if (!panel) createPanel()
  place()
  const show = () => {
    panel.show()
    panel.focus()
  }
  if (panel.webContents.isLoading()) panel.webContents.once('did-finish-load', show)
  else show()
}

/** Under the icon, or where it was left when pinned. */
function place() {
  const saved = options.settings().menuBarPanel?.position
  panel.setMovable(pinned())
  const onScreen = ([x, y]) => screen.getAllDisplays().some(({ workArea: a }) => x >= a.x && y >= a.y && x < a.x + a.width && y < a.y + a.height)
  // A display that was unplugged takes a saved position with it.
  if (pinned() && saved && onScreen(saved)) {
    return panel.setPosition(saved[0], saved[1])
  }
  const bounds = tray?.getBounds()
  if (!bounds) return
  const area = screen.getDisplayMatching(bounds).workArea
  const x = Math.round(Math.min(Math.max(bounds.x + bounds.width / 2 - WIDTH / 2, area.x + 8), area.x + area.width - WIDTH - 8))
  panel.setPosition(x, area.y + 6)
}

/** A pinned panel stays up when you click elsewhere and can be dragged anywhere. */
function setPinned(pin) {
  options.save({ menuBarPanel: { ...options.settings().menuBarPanel, pinned: pin } })
  panel?.setMovable(pin)
  panel?.webContents.send('menubar-pinned', pin)
  if (pin) panel?.focus()
}

/** The theme changed in the main window; the panel picks it up by loading again. */
function reloadMenuBarPanel() {
  panel?.webContents.reload()
}

app.on('before-quit', () => panel?.destroy())

module.exports = { setupMenuBar, setMenuBarEnabled, menuBarEnabled: () => enabled(), reloadMenuBarPanel }
