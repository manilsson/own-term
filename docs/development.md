# Development

## Running

```sh
npm install            # also rebuilds node-pty for Electron's Node
npm run install-hooks  # once: adds the Claude Code hooks (backs up settings.json first)
npm run dev
```

`npm run dev` starts Vite on port 5199 and Electron pointed at it, with the Chrome debugger on port
9333. Renderer changes hot-reload. Changes to `electron/` need `npm run dev` restarted, and so do
changes to `workspace.ts` or `terminals.ts` in practice: their module state (the dockview API, the
terminal map) doesn't survive hot reload, so reload the window (⌘R) after editing them. `themes.ts`
reloads the window by itself when it changes. Shells keep
running across a window reload; main replays their output.

The development build keeps its data in `~/Library/Application Support/deckterm-dev`, apart from an
installed copy's `deckterm`, so both can run at once. Packaging and releases: `docs/releasing.md`.

## Driving the app

Check a change by using it. `scripts/cdp.mjs` evaluates an expression in the window and prints the
result, so you can click, read the DOM and inspect state from a terminal:

```sh
node scripts/cdp.mjs "document.querySelectorAll('.session-row').length"
node scripts/cdp.mjs "[...document.querySelectorAll('.group-row')].find(r => r.textContent.includes('Website')).click()"
node scripts/cdp.mjs "JSON.parse(localStorage.getItem('deckterm.state')).sessions.map(s => s.name)"
node scripts/cdp.mjs "dock.panels.map(p => p.id)"   # the dockview API, exposed in development
node scripts/cdp.mjs "[...terms.values()].map(e => e.term.buffer.active.viewportY)"   # each session's terminal entry, likewise
node scripts/cdp.mjs --panel "document.body.innerText"   # the menu bar's panel, once it has been opened
```

The terminal draws on a canvas, so its text isn't in the DOM; read it from `terms` instead.

A window that's covered, even by another app on another display, reports `document.visibilityState`
as `hidden` and gets no animation frames, so it doesn't draw, fit or animate, and anything measured
then is meaningless. Check it first. To make it visible without keeping focus away from what you're
doing, bring it forward and hand focus back: the dev window stays in front of the windows it covered.

```sh
osascript -e 'tell application "System Events" to set frontmost of process "Electron" to true' -e 'delay 0.4' -e 'tell application "Own Term" to activate'
```

To call the app's own code, import the module it loaded. After a hot reload Vite serves that module
at `/src/x.ts?t=…` until the dev server restarts, and a plain `import('/src/workspace.ts')` gets a
second, separate copy that isn't connected to the window, so calls into it do nothing:

```js
const own = name => import(performance.getEntriesByType('resource').map(r => r.name).find(n => new URL(n).pathname === `/src/${name}.ts`))
own('workspace').then(w => w.openSession(id))
```

- **Menu shortcuts** (⌘F, ⌘P, ⌘T…) are native menu accelerators, which synthetic key events don't
  reach. Send real keystrokes: `osascript -e 'tell application "System Events" to keystroke "p" using command down'`
  after bringing the app forward. Check where focus is first, or the keys land in a terminal.
- **The menu bar icon** doesn't take synthetic clicks. Press it through accessibility:
  `osascript -e 'tell application "System Events" to tell process "Electron" to click menu bar item 1 of menu bar 2'`.
  The panel hides as soon as anything else takes focus; its page can still be driven with `--panel`.
- **Typing into a shell**: `window.deck.write(sessionId, 'ls\r')` writes straight to its pty.
- **Hook events** without spending a Claude turn: post one the way the hook does, e.g.
  `UserPromptSubmit` with a `prompt` and a made-up `session_id`. Post `SessionEnd` afterwards, or
  the session will try to `claude --resume` that made-up id on the next start. The dev build's port
  and token are only in its shells' environment: start a throwaway one with
  `window.deck.start({ id: 'probe', cwd: window.deck.homeDir, cols: 80, rows: 24 })`, have it
  `echo $DECKTERM_PORT $DECKTERM_TOKEN` into a file, then `window.deck.kill('probe')`.
- **Claude's tools** (`own-term`, `docs/architecture.md` → "Claude's tools"): in a dev session's shell,
  `claude -p --model haiku "…"` gets them through the zsh integration's `claude`, which puts its flags
  first, so look for it as `claude --mcp-config=… -p`. To call one without a model, post JSON-RPC
  with that shell's port and token from outside it, as for hook events:
  `curl -s -X POST -H "X-Deckterm-Token: $TOKEN" --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_sessions","arguments":{}}}' http://127.0.0.1:$PORT/mcp/<session>`.
  The session in the URL is the caller, and its shell has to be running.
- **Stopping the dev build** right after changing state can lose the change: `localStorage` reaches
  disk a moment later. Wait half a second before stopping it.
- **Restarting the dev build**: wait for the old Electron to exit before `npm run dev` again. It takes
  a few seconds to quit its Chromes, and a new one started meanwhile can't get the debugger's port
  (`bind() failed: Address already in use`) and isn't reachable by `cdp.mjs`.
- **Controlled inputs** in React ignore a plain `.value =`; set it through the `HTMLInputElement`
  prototype's value setter and dispatch an `input` event.

### Measuring smoothness

Frame timing only shows that the main thread was busy; flicker is a frame that shows the wrong
thing. Measure both:

- **Script time**: a `PerformanceObserver` for `long-animation-frame` names the scripts behind each
  slow frame (read it with `takeRecords()` before disconnecting). For more detail, profile the call
  over the debugger with `Profiler.start` and `Profiler.stop`.
- **What's painted**: record the window at 60 fps (`screencapture -v -V 2 -R x,y,w,h out.mov`),
  split it into frames with `ffmpeg -i out.mov -vf fps=60 f%03d.png`, and look at the frames
  around the change. A per-frame log from `requestAnimationFrame` helps, but note those callbacks
  run before layout and the `ResizeObserver` fits, so they see each frame's state before the
  terminals were fitted, not what was painted.
- **Real programs**: demo sessions replay their transcript on any resize, so test rendering with a
  real shell, or a real Claude session for its redraws.

### Screenshots

Capture the window, not the screen, and look at the result: measure what you changed rather than
judging it by eye.

```sh
osascript -e 'tell application "System Events" to set frontmost of process "Electron" to true'; sleep 1
id=$(swift -e 'import CoreGraphics; let l = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as! [[String:Any]]; for w in l where (w["kCGWindowName"] as? String) == "Own Term" { print(w["kCGWindowNumber"]!); break }')
screencapture -o -l "$id" shot.png
```

A window that was covered may not have repainted yet: a capture right after a change can show the
previous frame. Wait a second or two after bringing it forward, and capture again if it looks stale.
A capture by window id (`screencapture -l`) can hand back the window's last frame even then; changing
the window's size by a point and back, as `site-shots.mjs` does, makes it draw a fresh one.
Screenshots in the repo root are ignored by git.

### Demo day

View → Load Demo Day replaces every session and group with a scripted working day (`demo-data.ts`)
at Juniper, an invented online shop: four groups (Checkout, iOS app, Support, Docs site), ten
sessions in every status, a reminder on one of them (due tomorrow at 9:00, set when the day loads) and two to-dos with times,
a session whose transcript set the Checkout group up through Claude's `own-term` tools, and a sticky
notification. The Apple Pay session has a browser, a headless
Chrome on the shop's checkout page (`electron/demo/checkout.html`, served by `demo-site.cjs` on the
first free port from 3000, as a dev server would be); it opens again whenever the day is loaded or the
app starts with the day in it, and needs Chrome installed. The marketing site's screenshots come from it.
While only demo sessions are open, the Today page shows the day's own invented pull requests, Linear
issues, to-dos, week and Claude's brief and standup (`demo-status.ts`), and greets Sam, so no real data
reaches a screenshot. Sessions saved by an older version of the demo are dropped at startup. Demo sessions play back transcripts
instead of running shells, redraw them when their width or the appearance changes, and are skipped by
git polling, naming and grouping. Everything in them is invented; keep it that way. Loading it stops
the user's real shells, so ask first.

## Terminal size log

A session that comes back laid out at the wrong width (narrow, or scrambled into the last column) is
traced in `~/Library/Logs/Own Term/terminal-sizes.log` (`terminal-sizes-dev.log` for the development
build; `electron/sizelog.cjs`), one JSON line per event, about 1 MB kept. It has the window's bounds,
every size the renderer fitted and why (the pane's width, what xterm proposed, whether the window was
visible, the view, the Today page), each shell start and resize, the narrowing waits, and each new
width Claude drew its input box's rule at beside the size its shell had. A rule wider or narrower than
the shell's columns is the moment Claude drew for the wrong size; the lines before it say why.

## Marketing site

`site/` is the one-page marketing site at https://own-term.vercel.app, a separate Vite app with
Motion for animation. It shares the app's tokens and icon but none of its code.

| File | What it holds |
| --- | --- |
| `src/hero.tsx` | The nav bar and the hero: a card where the icon's mark draws itself and sessions orbit it, asking for you in turn |
| `src/highlights.tsx` | The "Get the highlights" carousel of screenshots |
| `src/stories.tsx` | Groups (scroll-pinned); status, in the sidebar and away from the app (the menu bar, its panel and banners, all driven by one loop); Claude's tools (prompts typed into a transcript, the sidebar it fills in, and the four things it does lit beside the window as each is acted out) |
| `src/monitor-story.tsx` | Monitors: the `save_monitor` spec Claude writes beside the page Own Term draws from it, where errors spike past the rule's limit, the rule's lines light in the spec, the notification arrives and the rule wakes Claude |
| `src/statement.tsx` | A line set large on a dark card (the browser band's glow) that closes a story, its words lighting up as it scrolls through; the monitors band ends with one |
| `src/info-story.tsx` | The info panel rebuilt in HTML and kept live (numbers tick, a test run finishes, a file and a commit land, checks pass), beside a tour that moves it to each card; titles fold their cards, and a changed file, a command or a scratchpad note opens in the viewer |
| `src/browser-story.tsx` | The browser story on a band that stays dark (`.dark` carries the dark tokens): a pane rebuilt in HTML where Claude drives the shop's checkout in a loop, and the window can be dragged, filled, closed, sent to Chrome, or clicked in |
| `releases.html`, `src/releases.tsx` | The release page at /releases: every version from `RELEASE_NOTES.md`, read at build time, with commits about the site, docs and reviews left out, the rest sorted into New, Improved and Fixed by their first word, and a picture for the big ones (`HIGHLIGHTS`). Deploy the site after a release to show it |
| `src/more.tsx` | Themes with a light and dark switch, the "And more" cards, shortcuts, closing and the footer |
| `src/mock.tsx` | HTML rebuilds of the app's sidebar rows (with the session's icon), smart tiles, group rails, status icons and banner, which animate (the menu bar panel's rebuild is in `stories.tsx`) |
| `src/art.tsx` | Original drawings: the closing ring and the feature-card art |
| `src/site.css` | Everything visual; light tokens on `:root`, the dark band's tokens on `.dark` |

The visuals:

- **Screenshots** in `site/public/shots/`, a light and a dark one of each view (`<view>-light.webp`,
  `<view>-dark.webp`), from the demo day with the window at 1440×900 points. `node scripts/site-shots.mjs
  [view…]` retakes them with the dev build running: it lays each view out from a fresh demo day, brings
  the window forward, captures it and writes the WebP. Retake them when the app's look changes. The
  page shows the pair that matches its appearance (`Screenshot` in `ui.tsx`). The `today` and `week`
  shots are the Today page on each tab, and `reminders` the Reminders page. The `info` and `viewer`
  shots have the info panel open, the second with `page.tsx` in the file viewer (its contents are in
  `demo-info.ts`). The Themes section's shots are `theme-<id>` (Default reuses `checkout`), and its swatches copy each theme's pane and
  accent colors from `src/themes.ts`, so a new or changed theme needs both. The script captures the
  window, so the app running it needs Screen Recording (System Settings › Privacy & Security).
- **Rebuilt parts** in `src/mock.tsx` and `stories.tsx` copy the app's markup and styles, so a
  visible change in the app's sidebar, banner or menu bar panel needs the same change there. The
  menu bar icon's path is the one `scripts/icon-art.mjs` draws.
- **Art** in `src/art.tsx` is drawn for this page. Apple's own imagery is copyrighted; don't use it.
  The hero's mark and the closing ring use the icon's exact geometry from `scripts/icon-art.mjs`.
- **The icon** in `site/public/icon.png` is written by `npm run icon`; don't edit it by hand.

The page is light by default, after Apple's product pages: white and `#f5f5f7` bands, `#1d1d1f` ink,
the `#0071e3` link blue. In dark mode, which follows the system or the switch in the bar, it takes the
app's dark tokens on a black ground (`data-theme` on `<html>` and `useTheme` in `ui.tsx`; `index.html`
applies a remembered choice before the page draws). The Themes section has its own Light and Dark
switch for its screenshot. The rebuilt parts use the app's own tokens.

The page tells its stories at full size (groups, status wherever you are, Claude's tools, monitors,
the info panel, the browser) and themes; everything else is a card in "And more" or a Highlights tile. A new feature joins one of
those rather than getting a section of its own, so the page doesn't grow a block per feature.

Neighbouring stories take different shapes, so the page doesn't read as one template repeated:
heading beside the demo on either side, centered over it, a band, or a statement between. A story's
points belong in its demo (lit as they happen, or as the code that drives it) rather than in a row
of cards under it.

Copy follows the app's voice: short declarative sentences, specific rather than slogans, and nothing
the app doesn't do yet. Calls to action download the newest dmg.

### Deploying it

`npm run site:deploy` builds the page and uploads `site/dist` to the Vercel project `own-term` (in
the `markus-personal` account) as a production deploy; it's live at https://own-term.vercel.app a few
seconds later. From a Mac it needs the Vercel CLI logged in (`vercel whoami`). The Vercel project isn't
connected to the GitHub repo; GitHub Actions deploys instead (`.github/workflows/site.yml`, with a
`VERCEL_TOKEN` secret): on a push to `master` that changes `site/`, `RELEASE_NOTES.md` or the deploy
script, and after every release (`docs/releasing.md` → "From GitHub Actions"). The upload is the
built files only, so Vercel never installs the app's dependencies.

`scripts/deploy-site.mjs` deploys a copy of the files from outside the repo. Run from inside it, the
CLI attaches the last commit, and Vercel blocks the deploy ("the commit author doesn't have
permission") because the commit's author email isn't a member of the Vercel project. With
`VERCEL_TOKEN` set, as in Actions, it skips the CLI and uploads through Vercel's API: the token is
scoped to the project, and the CLI refuses a token with no user behind it.

## Traps

- **One copy at a time.** A second launch only focuses the first window. Two copies on one profile
  can't share its storage, and running them side by side is the likely way saved state was lost
  once, so don't defeat the lock (for example with a second `npx electron .`) while one is running.
- **Testing hooks by hand.** A `curl` typed into a session's own shell returns to the prompt, which
  reads as "Claude exited". Read `DECKTERM_PORT` and `DECKTERM_TOKEN` from the session once and post
  from outside it.
- **Killing the dev build** (a signal rather than ⌘Q) while Claude runs in a session can let that
  Claude's `SessionEnd` reach it before it's gone, which forgets the conversation: the session opens a
  shell next time instead of resuming. Quit it normally when that matters.

- **Hard-coded colors** break light mode. Use the tokens; `npm run brand` reads them for the sheet.
- **Regexes run on every line of terminal output.** The link pattern once backtracked
  catastrophically on a long word and froze the renderer for 30 seconds. Keep them linear.
- **xterm decorations**: add classes with `classList.add`. Setting `className` wipes xterm's own.
  Decorations are one cell big unless CSS stretches them (`.input-area`, `.command-separator`).
- **Upgrading xterm.js.** `smooth.ts`, and `drawNow` and `wake` in `terminals.ts`, reach into xterm's
  viewport, render service and render debouncer by their private names, so `@xterm/xterm` is pinned
  to an exact version, with `@xterm/addon-webgl` at the release made for it. After an upgrade, check
  that a slow trackpad scroll still glides, that dragging a selection lands on the row under the
  pointer, and that a pane being opened or resized never shows empty or at its old size.
- **`window.confirm`** blocks the renderer and the debugger with it. Use `window.deck.confirm`.
- **Laying out a view** activates each new pane in turn. `workspace.ts` ignores active-pane changes
  while `applying`, or every pane in a group would count as seen and lose its "your turn".
- **State written back.** Stopping a shell sets its status, which saves the whole in-memory state.
  To edit `localStorage` by hand, stop shells first, then write and reload in the same step.
- **Electron ES modules** can't `await app.whenReady()` at the top level: ready only fires once the
  entry module has finished evaluating. See `scripts/icon.mjs`.
- **Quick Look** (`qlmanage`) renders SVG on white. The icon is rasterized in Electron for that reason.
- **Claude's environment**: starting the app from inside Claude Code would pass on its session
  variables; `shellEnv()` in main strips them, and `TERM_PROGRAM` is overwritten so the user's
  `.zshrc` doesn't think it's in Warp.
