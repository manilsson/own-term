// The editors a file or folder can be opened in (Own Term → Open Files With). Each opens at the line
// through its command-line tool, from PATH or the copy inside the app; failing that, without the line.
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const at = (file, line, column) => (line ? `${file}:${line}${column ? `:${column}` : ''}` : file)

const EDITORS = [
  { id: 'cursor', name: 'Cursor', app: 'Cursor', cli: 'cursor', bundled: 'Contents/Resources/app/bin/cursor', args: (f, l, c) => ['-g', at(f, l, c)] },
  { id: 'vscode', name: 'VS Code', app: 'Visual Studio Code', cli: 'code', bundled: 'Contents/Resources/app/bin/code', args: (f, l, c) => ['-g', at(f, l, c)] },
  { id: 'windsurf', name: 'Windsurf', app: 'Windsurf', cli: 'windsurf', bundled: 'Contents/Resources/app/bin/windsurf', args: (f, l, c) => ['-g', at(f, l, c)] },
  { id: 'zed', name: 'Zed', app: 'Zed', cli: 'zed', bundled: 'Contents/MacOS/cli', args: (f, l, c) => [at(f, l, c)] },
  { id: 'sublime', name: 'Sublime Text', app: 'Sublime Text', cli: 'subl', bundled: 'Contents/SharedSupport/bin/subl', args: (f, l, c) => [at(f, l, c)] },
  { id: 'bbedit', name: 'BBEdit', app: 'BBEdit', cli: 'bbedit', args: (f, l) => [...(l ? [`+${l}`] : []), f] },
  { id: 'xcode', name: 'Xcode', app: 'Xcode', cli: 'xed', args: (f, l) => [...(l ? ['-l', String(l)] : []), f] },
  ...[
    ['rider', 'Rider', ['Rider'], 'rider'],
    ['idea', 'IntelliJ IDEA', ['IntelliJ IDEA', 'IntelliJ IDEA Ultimate', 'IntelliJ IDEA CE'], 'idea'],
    ['webstorm', 'WebStorm', ['WebStorm'], 'webstorm'],
    ['pycharm', 'PyCharm', ['PyCharm', 'PyCharm Professional Edition', 'PyCharm CE'], 'pycharm'],
    ['goland', 'GoLand', ['GoLand'], 'goland'],
    ['phpstorm', 'PhpStorm', ['PhpStorm'], 'phpstorm'],
    ['rubymine', 'RubyMine', ['RubyMine'], 'rubymine'],
    ['clion', 'CLion', ['CLion'], 'clion'],
  ].map(([id, name, app, cli]) => ({
    id, name, app, cli,
    bundled: `Contents/MacOS/${cli}`,
    args: (f, l, c) => [...(l ? ['--line', String(l)] : []), ...(l && c ? ['--column', String(c)] : []), f],
  })),
]
const TEXT = { id: 'text', name: 'Default Text Editor' }

// JetBrains Toolbox keeps its IDEs' commands here, and only sometimes puts the folder on PATH.
const TOOLBOX_SCRIPTS = path.join(os.homedir(), 'Library', 'Application Support', 'JetBrains', 'Toolbox', 'scripts')

function onPath(command) {
  return [...(process.env.PATH ?? '').split(':'), TOOLBOX_SCRIPTS].find(dir => dir && fs.existsSync(path.join(dir, command)))
}

/** The app, under any of its names, in /Applications or ~/Applications (where Toolbox installs). */
function appPath(names) {
  const dirs = ['/Applications', path.join(os.homedir(), 'Applications')]
  for (const name of [names].flat()) {
    const found = dirs.map(dir => path.join(dir, `${name}.app`)).find(p => fs.existsSync(p))
    if (found) return found
  }
  return null
}

/** The editor's command: on PATH, else the copy its app ships with. */
function command(editor) {
  const dir = onPath(editor.cli)
  if (dir) return path.join(dir, editor.cli)
  const app = editor.bundled && appPath(editor.app)
  return app && fs.existsSync(path.join(app, editor.bundled)) ? path.join(app, editor.bundled) : null
}

// Looked up once, when first needed; by then main has the PATH from the login shell.
let installed = null
function available() {
  installed ??= EDITORS.filter(e => onPath(e.cli) || appPath(e.app))
  return installed
}

/** The chosen editor if it's still installed, else the first one found, else the default text editor. */
function editorFor(chosen) {
  return available().find(e => e.id === chosen) ?? (chosen === TEXT.id ? TEXT : available()[0] ?? TEXT)
}

// Files no code editor is for, so they open in their own app (Preview, Word...). A list of safe kinds
// rather than "anything binary": a .pkg or .command opened that way would install or run.
const DOCUMENTS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'ico', 'icns', 'psd',
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'aif', 'aiff', 'mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pages', 'numbers', 'key', 'odt', 'ods', 'odp', 'rtf', 'epub',
])
const isDocument = file => DOCUMENTS.has(path.extname(file).slice(1).toLowerCase())

/** Opens a file at a line, or a folder, in `editor`. Never in the item's own default app, outside
    DOCUMENTS: for a .command file, a .pkg or a folder that's an .app bundle, that would run it. */
async function openIn(editor, file, line, column, { run, shell }) {
  const isDir = fs.statSync(file, { throwIfNoEntry: false })?.isDirectory()
  if (!isDir && isDocument(file) && !(await shell.openPath(file))) return
  const fallback = () => (isDir ? shell.showItemInFolder(file) : run('open', ['-t', file]).catch(() => {}))
  if (editor.id === TEXT.id) return fallback()
  try {
    const cli = command(editor)
    if (!cli) throw new Error('no command')
    await run(cli, editor.args(file, line, column))
  } catch {
    const app = appPath(editor.app)
    if (app) await run('open', ['-a', app, file]).catch(fallback)
    else fallback()
  }
}

module.exports = { available, editorFor, openIn, TEXT }
