import { useEffect, useRef, useState } from 'react'
import { setState, useStore } from './store'
import { editNote } from './notes'
import { cancelNoteReminder, cancelReminder, presets, refNote, reminderNote, setNoteReminder, setReminder, useNow } from './reminders'

// datetime-local reads and writes the local time without a zone.
const toField = (at: number) => {
  const d = new Date(at - new Date(at).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

/** "22:55" today, "Wed 9:00" on another day: what a choice comes to, under its name. */
function landsAt(at: number, now: number) {
  const time = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (new Date(at).toDateString() === new Date(now).toDateString()) return time
  return `${new Date(at).toLocaleDateString([], { weekday: 'short' })} ${time}`
}

/** A reminder with a note or an exact time, for the session in `reminding`, or a time for a to-do in it. */
export function ReminderSheet() {
  const id = useStore(s => s.reminding)
  const session = useStore(s => s.sessions.find(x => x.id === s.reminding))
  const todo = useStore(s => s.reminding && refNote(s.reminding))
  const now = useNow()
  // A to-do's text is its note, so editing one here edits the to-do.
  const [note, setNote] = useState((todo ? todo.text : reminderNote(session)) ?? '')
  const current = todo ? todo.remind : session?.remind?.at
  // A preset is worked out when the reminder is set, so one left open a while still means "from now".
  const [choice, setChoice] = useState(current ? 'custom' : '1h')
  const [when, setWhen] = useState(() => toField(current ?? presets()[1].at()))
  const noteRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => noteRef.current?.focus(), [])
  if (!id || !(session || todo)) return null

  const close = () => setState(() => ({ reminding: null }))
  const preset = presets().find(p => p.id === choice)
  const at = preset ? preset.at() : new Date(when).getTime()
  const valid = Number.isFinite(at) && at > Date.now()

  return (
    <div className="sheet-backdrop" onMouseDown={e => e.target === e.currentTarget && close()}>
      <form
        className="sheet reminder-sheet"
        onSubmit={e => {
          e.preventDefault()
          if (!valid) return
          if (todo) {
            if (note.trim() && note.trim() !== todo.text) editNote(todo.id, note)
            setNoteReminder(todo.id, at)
          } else setReminder(id, at, note)
          close()
        }}
        onKeyDown={e => e.key === 'Escape' && close()}
      >
        <h2>Remind Me</h2>
        <p className="sheet-detail">{todo ? 'Get reminded of this to-do.' : `Come back to “${session!.name}”.`}</p>

        <label className="field">
          <span className="field-label">Note</span>
          {/* Wraps so a long note reads whole; Return still saves, as it did in the single-line field. */}
          <textarea
            ref={noteRef}
            className="text-field note-field"
            rows={1}
            placeholder={todo ? 'The to-do' : 'What to do when you’re back (optional)'}
            value={note}
            onChange={e => setNote(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
          />
        </label>

        <div className="field">
          <span className="field-label">When</span>
          <div className="when-grid">
            {presets().map(p => (
              <button key={p.id} type="button" className={`when-option ${choice === p.id ? 'on' : ''}`} onClick={() => setChoice(p.id)}>
                {p.short}
                <small>{landsAt(p.at(), now)}</small>
              </button>
            ))}
            <button
              type="button"
              className={`when-option ${choice === 'custom' ? 'on' : ''}`}
              onClick={() => {
                if (preset) setWhen(toField(preset.at()))
                setChoice('custom')
              }}
            >
              Custom
              <small>{choice === 'custom' && valid ? landsAt(at, now) : 'Pick a time'}</small>
            </button>
          </div>
          {choice === 'custom' && (
            <>
              {/* Picking Custom moves to the field; on opening, the note's focus comes after and wins. */}
              <input
                autoFocus
                className="text-field when-field"
                type="datetime-local"
                value={when}
                onChange={e => setWhen(e.target.value)}
              />
              {!valid && <small className="field-note">Pick a time that hasn’t passed.</small>}
            </>
          )}
        </div>

        <div className="sheet-buttons">
          {current && (
            <button
              type="button"
              className="push-button sheet-button-start"
              onClick={() => {
                if (todo) cancelNoteReminder(todo.id)
                else cancelReminder(id)
                close()
              }}
            >
              Cancel Reminder
            </button>
          )}
          <button type="button" className="push-button" onClick={close}>Cancel</button>
          <button type="submit" className="push-button default" disabled={!valid}>Remind Me</button>
        </div>
      </form>
    </div>
  )
}
