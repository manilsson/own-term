import { announce, getState, GROUP_COLORS, setState, type Snippet } from './store'
import { focus, sendInput } from './terminals'

export const snippetColor = (snippet: Pick<Snippet, 'color'>) =>
  snippet.color === undefined ? undefined : GROUP_COLORS[snippet.color]?.color

/** Types a saved prompt into a session without sending it, so it can be added to before Return. */
export function typeSnippet(id: string, text: string) {
  // Typed into a permission or question, it would answer it: a leading 1 picks "Yes".
  if (getState().status[id] === 'input') return announce('It’s waiting for an answer, so the prompt wasn’t typed')
  // Only text: an escape, tab or return would send keys of its own.
  const clean = text.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim()
  if (!clean) return
  // Sent as a paste, its line breaks stay in Claude's input instead of sending it.
  sendInput(id, clean.includes('\n') ? `\x1b[200~${clean}\x1b[201~` : clean)
  focus(id)
}

/** Adds a prompt, or changes the one with `id`; an icon or color given as null is taken off. */
export type SnippetFields = { label?: string; text?: string; icon?: string | null; color?: number | null }

export function saveSnippet(id: string | undefined, fields: SnippetFields): Snippet {
  const before = getState().snippets.find(s => s.id === id)
  const { icon, color, ...rest } = fields
  const next: Snippet = { ...(before ?? { id: crypto.randomUUID(), label: '', text: '' }), ...rest }
  if (icon !== undefined) next.icon = icon ?? undefined
  if (color !== undefined) next.color = color ?? undefined
  if (next.icon === undefined) delete next.icon
  if (next.color === undefined) delete next.color
  setState(s => ({ snippets: before ? s.snippets.map(x => (x.id === next.id ? next : x)) : [...s.snippets, next] }))
  return next
}

/** Undoes one save: drops a prompt it added, or puts back the one it changed, leaving later changes be. */
export function unsaveSnippet(id: string, before: Snippet | undefined) {
  setState(s => ({ snippets: before ? s.snippets.map(x => (x.id === id ? before : x)) : s.snippets.filter(x => x.id !== id) }))
}

export function removeSnippet(snippet: Snippet, by = '') {
  const index = getState().snippets.findIndex(s => s.id === snippet.id)
  setState(s => ({ snippets: s.snippets.filter(x => x.id !== snippet.id) }))
  announce(`${by ? `${by} deleted` : 'Deleted'} the prompt “${snippet.label}”`, () =>
    setState(s => (s.snippets.some(x => x.id === snippet.id) ? {} : { snippets: [...s.snippets.slice(0, index), snippet, ...s.snippets.slice(index)] })))
}
