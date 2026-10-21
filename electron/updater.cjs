// Keeps a packaged Own Term current from its public GitHub releases (docs/releasing.md). Squirrel.Mac
// does the work: it reads the manifest, downloads the zip of a newer version in the background, and
// swaps the app when it next quits. It only installs a build signed like the running one.
const { app, autoUpdater, dialog } = require('electron')

// The manifest attached to the newest release; GitHub redirects this name to it.
const FEED = 'https://github.com/manilsson/own-term-releases/releases/latest/download/RELEASES.json'
const EVERY_FOUR_HOURS = 4 * 60 * 60 * 1000

/** idle, checking, downloading, ready (with the new version) or error; mirrored to the renderer. */
let state = { status: 'idle' }
let announce = () => {}
// Set by a check from the menu, so its outcome is reported even when there's nothing new.
let asked = false

// Squirrel refuses a check while one is running or a download is under way ("The command is disabled
// and cannot be executed"), so none is started then.
const busy = () => state.status === 'checking' || state.status === 'downloading'

function set(next) {
  state = next
  announce(state)
}

function report(message, detail) {
  if (!asked) return
  asked = false
  dialog.showMessageBox({ message, detail })
}

function startUpdater(send) {
  announce = send
  if (!app.isPackaged) return
  autoUpdater.setFeedURL({ url: FEED, serverType: 'json' })
  autoUpdater.on('checking-for-update', () => set({ status: 'checking' }))
  autoUpdater.on('update-available', () => {
    set({ status: 'downloading' })
    report('A new version of Own Term is downloading.', 'You can restart to install it when it’s ready.')
  })
  autoUpdater.on('update-not-available', () => {
    set({ status: 'idle' })
    report('Own Term is up to date.', `Version ${app.getVersion()} is the newest.`)
  })
  // The release name is "Own Term v1.2.3".
  autoUpdater.on('update-downloaded', (_event, _notes, name) => set({ status: 'ready', version: String(name ?? '').replace(/^.* v/, '') }))
  autoUpdater.on('error', error => {
    set({ status: 'error' })
    report('Own Term couldn’t check for updates.', error.message)
  })
  autoUpdater.checkForUpdates()
  setInterval(() => state.status !== 'ready' && !busy() && autoUpdater.checkForUpdates(), EVERY_FOUR_HOURS)
}

/** Check for Updates… in the app menu. */
function checkForUpdates() {
  if (!app.isPackaged) {
    dialog.showMessageBox({ message: 'Updates only run in the packaged app.', detail: 'This is a development build.' })
    return
  }
  if (state.status === 'ready') {
    dialog.showMessageBox({ message: `Version ${state.version} is ready.`, detail: 'Restart Own Term to install it.' })
    return
  }
  if (state.status === 'downloading') {
    dialog.showMessageBox({ message: 'A new version of Own Term is downloading.', detail: 'You can restart to install it when it’s ready.' })
    return
  }
  // A check already running answers this one too.
  asked = true
  if (!busy()) autoUpdater.checkForUpdates()
}

module.exports = { startUpdater, checkForUpdates, updateState: () => state, installUpdate: () => autoUpdater.quitAndInstall() }
