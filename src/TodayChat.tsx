import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, ChevronDown, Sparkle, Sparkles, Square, SquarePen } from 'lucide-react'
import { useStore } from './store'
import { RefChip } from './StatusPage'
import { ask, isDemo, newChat, stopAsking, useChat, useStatus, type ChatMessage, type ChatScope } from './status'

// The Today page's chat: a field floating at the bottom of the page, and the conversation above it,
// one for each tab and project, about only what's in the project.
// Claude answers from the page's facts (status.cjs → chat:ask) and can use Own Term's tools.

const wordsFor = (scope: ChatScope, project?: string) => scope === 'today'
  ? {
    label: project ? `Ask about ${project} today` : 'Ask about today',
    placeholder: project ? `Ask about ${project} today…` : 'Ask about your day…',
    suggestions: ['What should I pick up first?', 'What’s waiting on me?', 'What did I get done yesterday?'],
  }
  : {
    label: project ? `Ask about ${project} this week` : 'Ask about this week',
    placeholder: project ? `Ask about ${project} this week…` : 'Ask about your week…',
    suggestions: ['What did I ship this week?', 'Where did my time go?', 'What’s still open from this week?'],
  }

export function TodayChat({ scope, project = '' }: { scope: ChatScope; project?: string }) {
  const chat = useChat(scope, project)
  const words = useMemo(() => wordsFor(scope, project), [scope, project])
  const ai = useStatus(s => s.settings?.ai ?? true)
  const demo = useStore(isDemo)
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const log = useRef<HTMLDivElement>(null)
  const asking = chat.asking !== undefined
  const shown = open && chat.messages.length > 0

  // The newest answer stays in view while it's written, unless you've scrolled up to read.
  const pinned = useRef(true)
  useLayoutEffect(() => {
    const el = log.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [chat, shown])

  useLayoutEffect(() => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [text])

  useEffect(() => {
    // ⌘L, as in a browser's address bar, from anywhere on the page.
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'l' && !document.querySelector('.sheet-backdrop, .palette')) {
        e.preventDefault()
        field.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!ai || demo) return null

  const send = (question = text) => {
    if (!question.trim() || asking) return
    ask(scope, question)
    setText('')
    setOpen(true)
    pinned.current = true
  }

  return (
    <div className={`today-chat ${shown ? 'open' : ''}`}>
      {shown && (
        <div className="chat-panel">
          <header className="chat-head">
            <span className="chat-label"><Sparkles size={12} strokeWidth={2} />{words.label}</span>
            <button className="chat-head-button" title="New conversation" onClick={() => { newChat(scope, project); field.current?.focus() }}>
              <SquarePen size={13} strokeWidth={2} />
            </button>
            <button className="chat-head-button" title="Hide (Esc)" onClick={() => setOpen(false)}>
              <ChevronDown size={15} strokeWidth={2} />
            </button>
          </header>
          <div
            className="chat-log"
            ref={log}
            onScroll={e => {
              const el = e.currentTarget
              pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
            }}
          >
            {chat.messages.map((m, i) => <Message key={i} message={m} writing={asking && i === chat.messages.length - 1} />)}
          </div>
        </div>
      )}
      <form className="chat-field" onSubmit={e => { e.preventDefault(); send() }}>
        <Sparkle size={14} strokeWidth={2.2} className="chat-field-mark" />
        <textarea
          ref={field}
          rows={1}
          value={text}
          placeholder={chat.messages.length ? 'Ask a follow-up…' : words.placeholder}
          onChange={e => setText(e.target.value)}
          onFocus={() => chat.messages.length && setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
            if (e.key === 'Escape') {
              if (shown) setOpen(false)
              else field.current?.blur()
            }
          }}
        />
        {asking ? (
          <button type="button" className="chat-send stop" title="Stop" onClick={() => stopAsking(scope, project)}><Square size={10} strokeWidth={0} fill="currentColor" /></button>
        ) : (
          <button type="submit" className="chat-send" title="Ask (Return)" disabled={!text.trim()}><ArrowUp size={15} strokeWidth={2.4} /></button>
        )}
      </form>
      {!text && chat.messages.length === 0 && (
        <div className="chat-suggestions">
          {words.suggestions.map(s => <button key={s} className="chat-suggestion" onClick={() => send(s)}>{s}</button>)}
        </div>
      )}
    </div>
  )
}

const TOOL_WORDS: Record<string, string> = {
  list_sessions: 'Looked at your sessions',
  describe_session: 'Read a session',
  rename_session: 'Renamed a session',
  move_session: 'Moved a session',
  create_group: 'Made a group',
  update_group: 'Changed a group',
  delete_group: 'Removed a group',
  organize: 'Reorganized the sidebar',
  remind: 'Set a reminder',
  cancel_reminder: 'Cancelled a reminder',
  new_session: 'Started a session',
  review_pr: 'Started a review',
  start_issue: 'Started an issue',
  close_session: 'Ended a session',
  send_prompt: 'Sent a prompt',
  wait_for: 'Waited for a session',
  add_note: 'Added a to-do',
  list_notes: 'Read your to-dos',
  complete_note: 'Checked off a to-do',
  remove_note: 'Removed a to-do',
  get_status: 'Checked your status',
  list_projects: 'Read your projects',
  set_projects: 'Changed your projects',
  show_sessions: 'Opened sessions',
}

function Message({ message, writing }: { message: ChatMessage; writing: boolean }) {
  if (message.from === 'you') {
    return <div className="chat-message you">{message.parts.map(p => ('text' in p ? p.text : '')).join('')}</div>
  }
  return (
    <div className="chat-message claude">
      {message.parts.map((p, i) => 'tool' in p
        ? <div key={i} className="chat-tool"><Sparkle size={10} strokeWidth={2.4} />{TOOL_WORDS[p.tool.replace(/^mcp__own-term__/, '')] ?? p.tool.replace(/^mcp__[^_]+__/, '').replaceAll('_', ' ')}</div>
        : <Rich key={i} text={p.text} writing={writing && i === message.parts.length - 1} />)}
      {writing && message.parts.length === 0 && <div className="chat-thinking"><span /><span /><span /></div>}
      {message.error && <p className="chat-error">{message.error}</p>}
    </div>
  )
}

/** Claude's plain text: paragraphs and "- " lists, with **bold**, `code` and [ids] as chips. */
function Rich({ text, writing }: { text: string; writing: boolean }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const items = list.items.map((item, i) => <li key={i}><Inline text={item} /></li>)
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>)
    list = null
  }
  // An id still being written would show as raw text until its bracket closes.
  for (const line of (writing ? text.replace(/\[[a-z]*(:[^\]\s]*)?$/, '') : text).split('\n')) {
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    const item = bullet ?? numbered
    if (item) {
      if (list && list.ordered !== !!numbered) flush()
      list ??= { ordered: !!numbered, items: [] }
      list.items.push(item[1])
      continue
    }
    flush()
    // Headings Claude writes anyway read as a bold line.
    const heading = line.match(/^#+\s+(.*)$/)
    if (heading) blocks.push(<p key={blocks.length}><strong>{heading[1]}</strong></p>)
    else if (line.trim()) blocks.push(<p key={blocks.length}><Inline text={line} /></p>)
  }
  flush()
  return <>{blocks}</>
}

const INLINE = /\[((?:pr|issue|session|note):[^\]\s]+)\]|\*\*([^*]+)\*\*|`([^`]+)`/g

function Inline({ text }: { text: string }) {
  const out: ReactNode[] = []
  let at = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) out.push(text.slice(at, m.index))
    if (m[1]) out.push(<RefChip key={m.index} refId={m[1]} />)
    else if (m[2]) out.push(<strong key={m.index}>{m[2]}</strong>)
    else out.push(<code key={m.index}>{m[3]}</code>)
    at = m.index + m[0].length
  }
  if (at < text.length) out.push(text.slice(at))
  return <>{out.map((x, i) => <Fragment key={i}>{x}</Fragment>)}</>
}
