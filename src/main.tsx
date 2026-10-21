import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import 'dockview-react/dist/styles/dockview.css'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
// The menu bar's panel is this page with ?panel. Importing the app would start its state and hooks.
if (new URLSearchParams(location.search).has('panel')) {
  document.documentElement.classList.add('panel-page')
  import('./Panel').then(({ Panel }) => root.render(<Panel />))
} else import('./App').then(({ App }) => root.render(<App />))
