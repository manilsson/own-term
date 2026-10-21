# Own Term (codebase: deckterm)

Own Term is a macOS terminal built for working with Claude Code. Sessions live in a sidebar, grouped
by the work they belong to; a group opens its sessions side by side, each in its own pane. Claude
Code's hooks tell the app when a session is working, needs an answer or has finished, so the sidebar,
the pane headers, the Dock badge and notifications show what needs you. It is an Electron app: a
Node main process that owns the shells, and a React renderer that draws everything with xterm.js
and dockview.

## Start here

- How it works, file by file, and how data moves: `docs/architecture.md`
- Running, driving and checking the app, and the traps: `docs/development.md`
- Design system (tokens, components, motion) and the icon: `docs/design/README.md`
- Brand sheet, generated: `docs/design/brand.html`
- Versions, packaging, signing and auto-update: `docs/releasing.md`

## Commands

- Run in development: `npm run dev` (Vite on :5199, Electron with the debugger on :9333)
- Type check — before done: `npm run typecheck`
- Evaluate JavaScript in the running window: `node scripts/cdp.mjs "<expression>"`
- Install the Claude Code hooks into `~/.claude/settings.json`: `npm run install-hooks`
- Rebuild the icon files after editing `scripts/icon-art.mjs`: `npm run icon`
- Rebuild the brand sheet after changing the icon or the color tokens: `npm run brand`
- Publish a new version of the app: `npm run ship [patch|minor|major]`, which releases GitHub's `master`
  through Actions; or `npm run release` from this Mac (`docs/releasing.md`). Pushing doesn't release
- Marketing page: `npm run site` (port 5200), `npm run site:build` (to `site/dist`), and
  `npm run site:deploy` to publish it to https://own-term.vercel.app (Vercel CLI, logged in; GitHub
  Actions also deploys it when it changes); see `docs/development.md` → "Marketing site"

## Rules

- Drive the app to check a change, the way a person would use it: click through it with
  `scripts/cdp.mjs`, take a screenshot, measure what you changed. A type check proves nothing about
  how it looks or behaves. `docs/development.md` → "Driving the app".
- Sessions, groups and settings you create while testing live in the user's real app. Say what you
  left behind and ask before removing it.
- Demo and test content is invented. No real names, customers or data in transcripts, fixtures,
  screenshots or commits.
- Terminal titles (the OSC 0 and 2 titles a program sets) are reserved for an idea the user has. Don't
  build on them without asking.
- Colors come from the tokens in `src/styles.css`, defined for both appearances. A hard-coded color
  is a bug in light mode. `docs/design/README.md` → "Tokens".
- Comments say why, in two lines or fewer: the non-obvious choice, never what the line does or what
  the code used to do. That story belongs in the commit message.
- Before writing code, check whether xterm.js, dockview, Electron or the browser already does it.
- Ship only when the user asks: `npm run ship` releases to everyone who has Own Term installed.
- Commit only when asked. The product name is two words, Own Term, in anything a user reads.
