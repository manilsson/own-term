import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { setState } from './store'
import { clearFind, endFind, find, onFindResults } from './terminals'

// ⌘F and ⌘G come from the app menu while the find bar is already open.
export const FIND_AGAIN = 'deckterm:find-again'
export const FIND_NEXT = 'deckterm:find-next'

/** Searches a pane's scrollback, floating over the pane's top right corner like Safari's find banner. */
export function FindBar({ id }: { id: string }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ index: number; count: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const queryRef = useRef(query)
  queryRef.current = query

  useEffect(() => {
    input.current?.focus()
    const subscription = onFindResults(id, e => setResults({ index: e.resultIndex, count: e.resultCount }))
    const again = () => input.current?.select()
    const next = () => find(id, queryRef.current, 'next')
    window.addEventListener(FIND_AGAIN, again)
    window.addEventListener(FIND_NEXT, next)
    return () => {
      subscription?.dispose()
      window.removeEventListener(FIND_AGAIN, again)
      window.removeEventListener(FIND_NEXT, next)
      // The bar comes back empty when its pane is shown again, so its highlights mustn't stay behind.
      clearFind(id)
    }
  }, [id])

  const close = () => {
    setState(() => ({ finding: null }))
    endFind(id)
  }

  return (
    <div className="find-bar" onMouseDown={e => e.stopPropagation()}>
      <Search size={13} strokeWidth={2} />
      <input
        ref={input}
        placeholder="Find"
        value={query}
        onChange={e => {
          setQuery(e.target.value)
          if (!e.target.value) setResults(null)
          find(id, e.target.value, 'type')
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') close()
          if (e.key === 'Enter') find(id, query, e.shiftKey ? 'previous' : 'next')
        }}
      />
      {query && results && (
        <span className="find-count">
          {results.count === 0 ? 'No results' : results.index < 0 ? `${results.count} results` : `${results.index + 1} of ${results.count}`}
        </span>
      )}
      <button className="find-button" title="Previous (⇧↩)" onClick={() => find(id, query, 'previous')}>
        <ChevronUp size={15} strokeWidth={2} />
      </button>
      <button className="find-button" title="Next (↩)" onClick={() => find(id, query, 'next')}>
        <ChevronDown size={15} strokeWidth={2} />
      </button>
      <button className="find-button" title="Done (esc)" onClick={close}>
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  )
}
