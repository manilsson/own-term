import { useEffect, useState } from 'react'
import { Mark } from './Mark'

const SEEN = 'deckterm.launched'

function shouldShow() {
  try {
    // Once per window: a reload (⌘R, or Vite in development) goes straight to the app.
    if (sessionStorage.getItem(SEEN)) return false
    sessionStorage.setItem(SEEN, '1')
  } catch {}
  return !matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The mark drawing itself as the window opens: the ring, then the cursor landing, then the app. */
export function Launch() {
  const [shown, setShown] = useState(shouldShow)
  useEffect(() => {
    if (!shown) return
    const timer = setTimeout(() => setShown(false), 1700)
    return () => clearTimeout(timer)
  }, [shown])
  if (!shown) return null
  return (
    <div className="launch" aria-hidden="true">
      <Mark size={132} className="launching" />
      <div className="launch-name">Own Term</div>
    </div>
  )
}
