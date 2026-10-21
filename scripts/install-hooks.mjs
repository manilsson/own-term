// Adds Own Term's Claude Code hooks to ~/.claude/settings.json (npm run install-hooks). The app's
// welcome screen does the same; both use electron/hooks.cjs.
import { createRequire } from 'node:module'

const { installHooks } = createRequire(import.meta.url)('../electron/hooks.cjs')
console.log(`Own Term's hooks installed in ${installHooks()}`)
