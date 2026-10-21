import { useEffect, useState } from 'react'
import { AlarmClock, Check } from 'lucide-react'
import appIcon from '../build/icon.png'
import { groupAccent, useStore, type Toast } from './store'
import { answerPermission, claudeRunning, dismissToast, openToast, promptClaude } from './claude'
import { refNote, snooze } from './reminders'

const VISIBLE_MS = 12_000

export function Toasts() {
  const toasts = useStore(s => s.toasts)
  return (
    <div className="toasts">
      {toasts.slice(0, 3).map((toast, i) => <Banner key={toast.sessionId} toast={toast} latest={i === 0} />)}
    </div>
  )
}

/** A notification in the style of a macOS banner: app icon, title, subtitle, a couple of lines of body. */
function Banner({ toast, latest }: { toast: Toast; latest: boolean }) {
  const id = toast.sessionId
  const name = useStore(s => s.sessions.find(x => x.id === id)?.name ?? (refNote(id) ? 'Reminder' : ''))
  const branch = useStore(s => s.git[id]?.branch)
  const tag = useStore(s => groupAccent(s, id))
  const [hovered, setHovered] = useState(false)
  const [replying, setReplying] = useState(false)
  // A finished turn or a due reminder can be answered from here, if Claude is still there to read it.
  const canReply = (toast.status === 'done' || toast.status === 'reminder') && claudeRunning(id)

  useEffect(() => {
    // A permission waits for an answer, so its banner does too; so does a reply being written.
    if (toast.sticky || toast.permission || hovered || replying) return
    const timer = setTimeout(() => dismissToast(id), VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [toast, hovered, replying, id])

  return (
    <div className="banner" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onClick={() => openToast(id)}>
      <div className="banner-icon">
        <img src={appIcon} alt="" />
        <span className={`banner-badge ${toast.status}`}>
          {toast.status === 'done' ? <Check size={10} strokeWidth={3.5} /> : toast.status === 'reminder' ? <AlarmClock size={10} strokeWidth={3} /> : '!'}
        </span>
      </div>
      <div className="banner-body">
        <div className="banner-head">
          <span className="banner-title">{name}</span>
          <span className="banner-time">{latest ? '⇧⌘G' : 'now'}</span>
        </div>
        {branch && (
          <div className="banner-subtitle">
            {tag && <span className="tag-dot" style={{ background: tag }} />}
            {branch}
          </div>
        )}
        <div className="banner-text">{toast.text ?? (toast.status === 'done' ? 'Finished, your turn.' : toast.status === 'reminder' ? 'Reminder to come back to this.' : 'Needs your input.')}</div>
        {toast.permission && (
          <div className="permission-actions" onClick={e => e.stopPropagation()}>
            <button onClick={() => answerPermission(id, false)}>Deny</button>
            <button className="default" onClick={() => answerPermission(id, true)}>Allow</button>
          </div>
        )}
        {canReply && <ReplyField id={id} onWriting={setReplying} />}
        {toast.status === 'reminder' && (
          <div className="permission-actions" onClick={e => e.stopPropagation()}>
            <button onClick={() => snooze(id)}>Snooze 1 Hour</button>
            <button className="default" onClick={() => openToast(id)}>Open</button>
          </div>
        )}
      </div>
      <button
        className="banner-close"
        title="Dismiss"
        onClick={e => {
          e.stopPropagation()
          dismissToast(id)
        }}
      >
        ×
      </button>
    </div>
  )
}

/** Answers Claude from the banner: the text goes to the session as if typed there, and the banner goes. */
function ReplyField({ id, onWriting }: { id: string; onWriting: (writing: boolean) => void }) {
  const [text, setText] = useState('')
  const [why, setWhy] = useState('')
  const [sending, setSending] = useState(false)
  const send = async () => {
    // A second Return while the first is on its way would find the text in Claude's prompt and refuse.
    if (sending) return
    setSending(true)
    const result = await promptClaude(id, text)
    setSending(false)
    if (!result.sent) return setWhy(result.why)
    onWriting(false)
    dismissToast(id)
  }
  return (
    <div className="banner-reply" onClick={e => e.stopPropagation()}>
      <input
        className="text-field"
        placeholder="Reply to Claude"
        value={text}
        onFocus={() => onWriting(true)}
        onBlur={() => !text.trim() && onWriting(false)}
        onChange={e => {
          setText(e.target.value)
          setWhy('')
        }}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) send()
          if (e.key === 'Escape') e.currentTarget.blur()
        }}
      />
      {why && <div className="banner-reply-why">{why}</div>}
    </div>
  )
}
