import { announce, getState, newId, rememberCleared, setState, type Note } from './store'

// The status page's to-dos: written there, or by Claude with the add_note tool, and checked off in
// either place. Claude's brief and standup read them as what's planned and what got done.

const ISSUE = /^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,6}$/

/** An issue id as Linear writes it (ABC-123), or undefined. */
export function issueId(text: unknown) {
  return typeof text === 'string' && ISSUE.test(text.trim()) ? text.trim().toUpperCase() : undefined
}

export function addNote(text: string, options: { by?: Note['by']; issue?: string; session?: string; project?: string } = {}) {
  const note: Note = {
    id: newId(),
    text: text.trim().slice(0, 500),
    created: Date.now(),
    by: options.by ?? 'you',
    issue: issueId(options.issue),
    session: options.session,
    project: options.project,
  }
  setState(s => ({ notes: [note, ...s.notes] }))
  return note
}

// Checking one off answers its reminder.
export function setNoteDone(id: string, done: boolean) {
  const note = getState().notes.find(n => n.id === id)
  const due = note?.due ?? note?.remind
  if (done && note && !note.done && due) rememberCleared({ ref: `note:${id}`, title: note.text, due, how: 'done' })
  setState(s => ({ notes: s.notes.map(n => (n.id === id ? { ...n, done: done ? Date.now() : undefined, due: done ? undefined : n.due } : n)) }))
}

export function updateNote(id: string, patch: Partial<Note>) {
  setState(s => ({ notes: s.notes.map(n => (n.id === id ? { ...n, ...patch } : n)) }))
}

export function editNote(id: string, text: string) {
  const trimmed = text.trim()
  if (!trimmed) return removeNote(id)
  setState(s => ({ notes: s.notes.map(n => (n.id === id ? { ...n, text: trimmed.slice(0, 500) } : n)) }))
}

/** Takes a to-do away without a notice, for undoing its addition. */
export function dropNote(id: string) {
  setState(s => ({ notes: s.notes.filter(n => n.id !== id) }))
}

export function removeNote(id: string, by: Note['by'] = 'you') {
  const index = getState().notes.findIndex(n => n.id === id)
  const note = getState().notes[index]
  if (!note) return
  setState(s => ({ notes: s.notes.filter(n => n.id !== id) }))
  announce(`${by === 'claude' ? 'Claude removed' : 'Removed'} the to-do “${short(note.text)}”`, () => {
    setState(s => ({ notes: s.notes.some(n => n.id === id) ? s.notes : [...s.notes.slice(0, index), note, ...s.notes.slice(index)] }))
  })
}

export const short = (text: string, max = 40) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
