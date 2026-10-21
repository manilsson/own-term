import { createRoot } from 'react-dom/client'
import Lenis from 'lenis'
import { ReleasesPage } from './releases'
import 'lenis/dist/lenis.css'
import './site.css'

new Lenis({ autoRaf: true, anchors: true })

createRoot(document.getElementById('root')!).render(<ReleasesPage />)
