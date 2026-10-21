import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { getState } from './store'
import { focus } from './terminals'
import { useEditor } from './editor'

type View = Awaited<ReturnType<Window['deck']['fileView']>>
type Row = { kind: 'hunk' | 'add' | 'del' | 'same'; old?: number; new?: number; text: string }

// A file of tens of thousands of lines would take seconds to lay out, and nobody reads it here.
const MAX_LINES = 5000

/** A unified diff as rows with their old and new line numbers; the file headers are left out. */
function diffRows(diff: string): Row[] {
  const rows: Row[] = []
  let old = 0
  let next = 0
  let inHunk = false
  for (const line of diff.split('\n')) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)/)
    if (hunk) {
      old = Number(hunk[1])
      next = Number(hunk[2])
      inHunk = true
      rows.push({ kind: 'hunk', text: hunk[3] })
    } else if (!inHunk) continue
    else if (line.startsWith('+')) rows.push({ kind: 'add', new: next++, text: line.slice(1) })
    else if (line.startsWith('-')) rows.push({ kind: 'del', old: old++, text: line.slice(1) })
    else if (line.startsWith(' ')) rows.push({ kind: 'same', old: old++, new: next++, text: line.slice(1) })
  }
  return rows
}

const NOTES = {
  deleted: 'This file has been deleted.',
  'not a file': 'This isn’t a file.',
  'too large': 'This file is too large to show here.',
  binary: 'This is a binary file, which can’t be shown as text.',
}

function bytes(size: number) {
  if (size < 1024) return `${size} bytes`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/** An image, fitted to the space and on a checkerboard so transparency shows, with its pixel size. */
function Picture({ src, label }: { src: string; label?: string }) {
  const [size, setSize] = useState<string>()
  return (
    <figure className="viewer-picture">
      <div className="viewer-checker">
        <img src={src} alt="" onLoad={e => setSize(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)} />
      </div>
      <figcaption>{[label, size].filter(Boolean).join(' · ')}</figcaption>
    </figure>
  )
}

/** A file's changes since the last commit, or the whole file, over the window; Esc closes it. */
export function FileViewer({ file, root, demo, onClose }: {
  file: string
  root?: string
  /** A demo session's invented contents, shown instead of reading the file, which doesn't exist. */
  demo?: View
  onClose: () => void
}) {
  const [view, setView] = useState<View>()
  const [tab, setTab] = useState<'changes' | 'file'>()
  const dialog = useRef<HTMLDivElement>(null)
  const editor = useEditor()
  useEffect(() => {
    let current = true
    if (demo !== undefined) setView(demo)
    else window.deck.fileView(file).then(v => current && setView(v ?? null))
    return () => {
      current = false
    }
  }, [file, demo])
  useEffect(() => dialog.current?.focus(), [])

  const rows = useMemo(() => (view?.diff ? diffRows(view.diff) : []), [view])
  // A last line break ends the last line; it doesn't start an empty one.
  const lines = useMemo(() => view?.text?.replace(/\n$/, '').split('\n') ?? [], [view])
  const added = rows.filter(r => r.kind === 'add').length
  const removed = rows.filter(r => r.kind === 'del').length
  const showing = tab ?? (view?.diff ? 'changes' : 'file')
  const isImage = !!(view?.image || view?.before)

  const relative = root && file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file.replace(window.deck.homeDir, '~')
  const name = relative.split('/').pop()
  const folder = relative.split('/').slice(0, -1).join('/')

  // Typing goes back to the session the viewer was opened over.
  const close = () => {
    onClose()
    const { active } = getState()
    if (active) focus(active)
  }

  return createPortal(
    <div className="viewer-backdrop" onMouseDown={e => e.target === e.currentTarget && close()}>
      <div
        className="viewer"
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-label={name}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            close()
          }
        }}
      >
        <header className="viewer-head">
          <div className="viewer-title">
            <span className="viewer-name">{name}</span>
            {folder && <span className="viewer-folder">{folder}</span>}
          </div>
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={showing === 'changes'} disabled={!view?.diff} onClick={() => setTab('changes')}>
              Changes
              {view?.diff && !isImage && (
                <span className="viewer-counts">
                  {added > 0 && <span className="added">+{added}</span>}
                  {removed > 0 && <span className="removed">−{removed}</span>}
                </span>
              )}
            </button>
            <button role="tab" aria-selected={showing === 'file'} disabled={!view?.text && !view?.image} onClick={() => setTab('file')}>File</button>
          </div>
          <button className="push-button" disabled={demo !== undefined} onClick={() => window.deck.openFile(file)}>
            {/* An image other than SVG opens in its own app (editors.cjs, DOCUMENTS), not the editor. */}
            {isImage && !/\.svg$/i.test(file) ? 'Open' : `Open in ${editor.name}`}
          </button>
          <button className="viewer-close" title="Close (Esc)" onClick={close}><X size={14} strokeWidth={2.2} /></button>
        </header>
        {/* Keyed by tab, so switching starts at the top rather than where the other tab was scrolled to. */}
        <div className="viewer-body" key={showing}>
          {view === undefined && <p className="viewer-note">Loading…</p>}
          {view === null && <p className="viewer-note">This file can’t be read.</p>}
          {view && showing === 'changes' && isImage && (
            <div className="viewer-compare">
              {view.before ? <Picture src={view.before} label="Before" /> : <p className="viewer-note">New since the last commit.</p>}
              {view.image ? <Picture src={view.image} label="After" /> : <p className="viewer-note">Deleted since the last commit.</p>}
            </div>
          )}
          {view && showing === 'changes' && !isImage && rows.length === 0 && (
            <p className="viewer-note">This binary file has changed since the last commit.</p>
          )}
          {view && showing === 'changes' && !isImage && rows.length > 0 && (
            <div className="viewer-lines diff">
              {rows.map((row, i) => (
                row.kind === 'hunk'
                  ? <div key={i} className="viewer-hunk">{row.text || '···'}</div>
                  : (
                      <div key={i} className={`viewer-line ${row.kind}`}>
                        <span className="viewer-number">{row.old ?? ''}</span>
                        <span className="viewer-number">{row.new ?? ''}</span>
                        <span className="viewer-sign">{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}</span>
                        <span className="viewer-text">{row.text}</span>
                      </div>
                    )
              ))}
            </div>
          )}
          {view && showing === 'file' && (
            view.image
              ? <div className="viewer-single"><Picture src={view.image} label={view.size ? bytes(view.size) : undefined} /></div>
              : view.text === null
              ? (
                  <p className="viewer-note">
                    {view.note ? NOTES[view.note] : 'This file can’t be read.'}
                    {view.note === 'binary' && view.size !== null && ` It’s ${bytes(view.size)}.`}
                  </p>
                )
              : (
                  <div className="viewer-lines">
                    {lines.slice(0, MAX_LINES).map((line, i) => (
                      <div key={i} className="viewer-line">
                        <span className="viewer-number">{i + 1}</span>
                        <span className="viewer-text">{line}</span>
                      </div>
                    ))}
                    {lines.length > MAX_LINES && (
                      <p className="viewer-note">The first {MAX_LINES.toLocaleString()} of {lines.length.toLocaleString()} lines. Open it in {editor.name} for the rest.</p>
                    )}
                  </div>
                )
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
