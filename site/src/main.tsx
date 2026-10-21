import { createRoot } from 'react-dom/client'
import Lenis from 'lenis'
import { App } from './App'
import 'lenis/dist/lenis.css'
import './site.css'

// Inertia scrolling, so the pinned Groups story and the reveals move with the wheel instead of in
// jumps. Anchor links ease too, honoring the page's scroll padding; off when motion is reduced.
new Lenis({ autoRaf: true, anchors: true })

createRoot(document.getElementById('root')!).render(<App />)
