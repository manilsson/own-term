# Architecture

Own Term is two processes. The **main process** (`electron/`, plain CommonJS) owns everything that
needs the operating system: the shells, git, Claude Code's hook events, files, menus and dialogs. The
**renderer** (`src/`, React and TypeScript, built by Vite) owns everything on screen. They talk only
through `window.deck`, which `electron/preload.cjs` exposes and `src/global.d.ts` types.

```
 Claude Code hooks ──HTTP──▶ ┌──────────────┐  IPC (window.deck)  ┌──────────────────────────┐
 zsh (node-pty) ◀──────────▶ │ main process │ ◀─────────────────▶ │ renderer                 │
 git, claude -p, Finder ◀──▶ └──────────────┘                     │ store · terminals · views│
                                                                  └──────────────────────────┘
```

## Map

| File | What it owns |
| --- | --- |
| `electron/main.cjs` | Shells, the hook server, git, Haiku calls for naming and grouping, menus, dialogs, appearance, the window |
| `electron/preload.cjs` | `window.deck`, the only door between the processes |
| `electron/shell/` | The zsh integration every session loads (see "Shell integration") |
| `electron/editors.cjs` | The editors files can open in (Own Term → Open Files With): which are installed, and how each opens a file at a line |
| `electron/info.cjs` | The info panel's data: git in detail, the branch's PR (gh), a conversation's transcript summary and scratchpad, the ports a session's shell listens on and which of Claude's commands started each, a background command's output |
| `electron/hooks.cjs` | Checks and installs Own Term's Claude Code hooks (welcome screen, `npm run install-hooks`) |
| `electron/status.cjs` | The Today page's data: the settings and encrypted Linear key, pull requests through `gh`, Linear issues, the journal and its backfill, and the brief and standup Claude writes (see "Today page") |
| `electron/browser.cjs` | A Chrome for each session that asks for one, in its own profile folder, started on first use (see "Session browsers") |
| `electron/mcp.cjs` | Wraps the user's chrome-devtools MCP server so that in an Own Term session it drives that session's Chrome |
| `electron/monitors.cjs` | Monitors: their specs and history on disk, checking a spec, running its commands on schedule in the login shell's environment, the rules and their notifications (see "Monitors") |
| `electron/tools.cjs` | Own Term's own MCP server (`own-term`), served at `/mcp/<session>` on the hook server and passed to `claude` only in Own Term's zsh; its tools are answered in the window by `src/tools.ts` |
| `electron/menubar.cjs` | The menu bar icon (its cursor blinks while Claude works; a count of sessions needing you) and its panel window (see "Menu bar") |
| `electron/updater.cjs` | Updates a packaged app from the release folder (`releasing.md`) |
| `forge.config.cjs` | Packaging and signing (`releasing.md`) |
| `src/store.ts` | All app state, its persistence, and the small functions that change it; `announce` puts a change in the footer and, with an undo, in the history ⌘Z works back through (`undoLast`) |
| `src/terminals.ts` | One xterm.js terminal per session, kept outside React (see "Terminals") |
| `src/workspace.ts` | The dockview panes: which sessions are on screen and how they're laid out |
| `src/claude.ts` | Turns hook events into statuses, notifications, the Needs You queue and session names |
| `src/grouping.ts` | Lets Claude put a new session in a group after its first prompt |
| `src/reminders.ts`, `ReminderSheet.tsx`, `RemindersPage.tsx` | Remind Me: a time and note on a session, the Reminders page the sidebar's tile opens, and moving it to Needs You when due |
| `src/tools.ts` | What Claude's `own-term` tools do: list and describe sessions, organize sessions and groups, reminders, starting sessions; each change gets a notice with Undo |
| `src/status.ts`, `StatusPage.tsx`, `SettingsSheet.tsx`, `notes.ts` | The Today page (⌃⌘T): its data and actions, the page, Settings (⌘,), and the to-dos |
| `src/projects.ts` | Projects: which project each session, group, pull request, issue, to-do and prompt is in, the one the sidebar and the Today page show, and how each looks on the rail (see "Today page") |
| `src/ProjectRail.tsx` | The project rail beside the sidebar (a tile per project, its needs-you badge), the sidebar's project title and a project's Color and Icon menu |
| `src/IconPicker.tsx` | A searchable grid of the session icons, for a project's icon |
| `src/TodayChat.tsx` | The Today page's chat, one for each tab: the field floating at its bottom (⌘L) and the conversation above it |
| `src/monitors.ts`, `MonitorPage.tsx`, `MonitorCharts.tsx` | The monitors as the window sees them (a summary of each, pushed by main), their sidebar menu and how values read; a monitor's page; its charts |
| `src/themes.ts` | The color themes: each one's surfaces, accent and terminal palette, in dark and light |
| `src/smooth.ts` | Pixel-smooth scrolling on top of xterm's row-by-row viewport (see "Terminals") |
| `src/pinned.ts` | A live copy of the input rows, shown at the bottom of a pane while it's scrolled up (see "Terminals") |
| `src/ask.ts` | An "Ask about this" button over text selected in a session where Claude runs, which quotes it into Claude's input |
| `src/git.ts` | Branch, change counts and whether it's a linked worktree, per session, polled |
| `src/links.ts` | Makes `path/file.ts:12` in terminal output open in your editor |
| `src/editor.ts` | The renderer's copy of the editor files open in, kept in step with main |
| `src/menubar.ts` | Sends the menu bar a summary of what each session is doing, and acts on what's clicked there |
| `src/Panel.tsx` | The menu bar's panel, a page of its own (`?panel`) |
| `src/browser.ts`, `BrowserView.tsx` | A session browser's state, frames and window placement, and its live view floating over the terminal |
| `src/menus.ts` | Native right-click menus for sessions and groups |
| `src/App.tsx` | The window: toolbar, sidebar slot, panes, footer, palette, every command |
| `src/Sidebar.tsx` | Groups (with a rail in the group's color) and sessions (a worktree mark, ✕ to end on hover), search, Needs You, drag to regroup sessions and reorder groups |
| `src/commands.ts`, `CommandViewer.tsx` | The shell commands Claude runs in each session, from its hooks (see "Commands"), and a command's output over the window, a background one's followed live |
| `src/Info.tsx` | The info panel (⌃⌘I) beside a single session, its cards: Claude, what's running (Claude's commands, with the ports each started, and servers the shell started), changes, the branch with its pull request, Claude's scratchpad, worktrees. A card's title folds it to a one-line summary, the same in every session (`localStorage['deckterm.infoFolded']`, Worktrees folded at first), and long lists show their first few. Each poll's last answer is kept, so a session you come back to shows at once |
| `src/FileViewer.tsx` | A file's changes since the last commit, or its text, over the window; opened from the info panel |
| `src/Charts.tsx` | The info panel's two charts: context per request and time per turn |
| `src/Palette.tsx`, `FindBar.tsx`, `NewSessionSheet.tsx`, `Toasts.tsx` | ⌘P, ⌘F, ⌘T and the notification banners |
| `src/StatusIcon.tsx`, `Editable.tsx` | A session's status icon; a name you rename by double-clicking |
| `src/sessionIcons.ts`, `electron/session-icons.json` | The Lucide icons Claude can give a session (`set_session_icon`): the names the tool offers, and the component drawn for each |
| `src/Welcome.tsx`, `Launch.tsx`, `Mark.tsx` | The first-run welcome screen, the launch animation, and the icon's mark they share |
| `src/demo.ts`, `demo-data.ts`, `demo-info.ts`, `demo-status.ts` | A scripted working day (View → Load Demo Day) for demos and screenshots, with what the info panel shows for each session and the Today page's pull requests, issues, to-dos, week, brief and standup |
| `electron/demo-site.cjs`, `demo/checkout.html` | The demo day's shop, one checkout page served locally for the Apple Pay session's browser |
| `scripts/` | `install-hooks.mjs`, `release.mjs` (`releasing.md`), the icon and brand-sheet generators, `cdp.mjs` for driving the app, `site-shots.mjs` and `deploy-site.mjs` for the marketing site |
| `site/` | The marketing page, a separate Vite app sharing no code with the app (`development.md` → "Marketing site") |

## State

`src/store.ts` holds one immutable `State` object. `setState` replaces it, saves the durable part and
notifies subscribers; components read it with `useStore(selector)`. A selector must return something
stable (a primitive or an object from the state) or the component re-renders forever: derive arrays
with `useMemo`, not inside the selector.

What survives a restart, and where:

| Data | Where |
| --- | --- |
| Groups, sessions, last folder, current view, auto-grouping on/off | `localStorage['deckterm.state']` |
| Each group's pane layout | `localStorage['deckterm.groupLayouts']` |
| Sidebar width and hidden | `localStorage['deckterm.sidebar']` |
| The info panel's folded cards | `localStorage['deckterm.infoFolded']` |
| Appearance (system, light or dark), theme and its window colors, the editor files open in | `settings.json` in Electron's user data folder (main process) |
| The window's place and size, and whether it's maximized, so Claude resumes at the width it'll have | `settings.json` → `window` |
| Statuses, the Needs You queue, the live Claude conversations, the commands Claude ran | `sessionStorage`: kept across a window reload, not a restart |
| Finished turns and due reminders, with when and what they said | `localStorage['deckterm.waiting']`, so Needs You still has them after a restart |
| Sessions ended in the last week (at most 20), for Reopen Closed Session (⇧⌘T) and the palette | `localStorage['deckterm.closed']` |
| To-dos, checked-off ones for a month | `localStorage['deckterm.notes']` |
| Reminders marked done or cancelled, for a month | `localStorage['deckterm.clearedReminders']` |
| The Today page's tab, and the folder each Linear team's issues were last started in | `localStorage['deckterm.statusTab']`, `['deckterm.issueFolders']` |
| The Today page's settings, the Linear key encrypted with `safeStorage` | `settings.json` → `status` |
| Prompts and replies, 90 days | `journal/<day>.jsonl` in the user data folder; `<day>.backfill.jsonl` from transcripts |
| Monitors: their specs, history and rule states, and what was allowed and paused | `monitors/` in the user data folder (see "Monitors") |
| The last brief and standup | `status/brief.json`, `status/standup.json` in the user data folder; a project's own `status/brief-<hash>.json` and `standup-<hash>.json` |

Everything else (statuses, git info, notifications, the focused pane) is rebuilt at runtime. The
`localStorage` lives in the user data folder too: `deckterm` for the installed app and `deckterm-dev`
in development, set in `main.cjs`. Changing those names loses every session.

### Sessions and groups

A `Session` is a folder plus what runs there: a shell, Claude (`runClaude` on first start), or the
Claude conversation it had (`claudeSessionId`, resumed with `claude --resume` after a restart). A
`Group` is a named, colored set of sessions. `autoName` on either means Claude still names it.

### Views

The workspace shows a `View`:

- `session` — one session, full size. Clicking a session in the sidebar.
- `group` — a group's sessions side by side, in the layout last used for that group.
- `pick` — any sessions and monitors side by side, from ⌘-click or ⌘D; "Save as Group" turns it into a group. The
  sidebar's Working row makes one of every session Claude is working in (`working: true`, which keeps
  that row selected).

A pane is a session's terminal or a monitor's page: a monitor's pane id is `monitor:<id>`
(`monitorPane`, `paneMonitor` in `store.ts`), and a group's monitors are in its `monitors`, one group
each at most. ⌘-click, dragging the row onto a pane and "Show Beside" add a monitor as they add a
session; with a monitor's page open, what's added goes beside it, and the page becomes a pane. A
monitor alone in a pane is a `pick`, since `session` is one session's view, with the info panel. A
monitor in a group is listed under it and no longer under Monitors, as a grouped session leaves Sessions.

`workspace.ts` → `show(view)` saves the outgoing group's layout, clears dockview and lays out the new
view: the saved layout if its sessions still match, otherwise equal columns (two rows past three).
Panes can't be dragged; sessions are dropped in from the sidebar instead. Closing a pane turns the
view into a pick of what's left.

A pane's header is shaded faintly in its group's color: `PaneActions` sets `--group-tint` on the
dockview group, which wraps the header. When the panes on screen come from more than one group, each
header names its group in a chip in that color, its text mixed toward the label color so yellow and
mint stay readable in light mode. In a narrow pane the branch gives way first, then the chip, then the
title; a header that overflowed would get dockview's scrollbar, which lifts the title out of line.

## Terminals

A terminal outlives the pane that shows it. `terminals.ts` keeps one xterm.js `Terminal` per session
in a module-level map; a pane `attach`es the terminal's element when it mounts and `detach`es it when
it unmounts, so switching views never restarts or redraws a shell. Attaching happens in a layout
effect and draws at once (`wake`, `drawNow`): xterm pauses a terminal off screen, resizes included,
and would only resume a frame or two after it's back, showing it blank or at its old size. An
attached terminal is scrolled to its latest output.

- **Settling before showing.** A pane whose size changes would show xterm's rewrap of the old screen
  (Claude's full-width borders broken into extra rows), then Claude's repaint half done: it erases
  the screen before redrawing, in chunks a millisecond apart, without synchronized output. So
  `workspace.ts` → `enter` hides every pane of a new view until `settled` says its terminal shows
  the final picture: fitted after layout, its program told that size (at once, while hidden) and
  answered, output quiet for 24 ms, at most 160 ms. A pane whose size didn't change is ready in the
  same frame, from the after-layout fit, so switching between single sessions shows no gap.

- **Starting.** `ensureRunning` asks main to spawn the session's shell, or gets back the last 512 KB of
  output if it's already running. That replay is what keeps a renderer reload from blanking anything.
  A new shell waits for a measured size: until xterm has measured a cell the terminal is 80×24, and
  Claude would print the conversation it resumes that wide, for good in the scrollback.
- **Fitting.** A `ResizeObserver` per pane fits the terminal. A resize clears the GPU canvas and xterm
  would only redraw it a frame later, so `drawNow` redraws at once; without it a pane being resized
  shows empty. The shell hears a single new size at once, since until then xterm shows Claude's screen
  rewrapped and scrambled; in a run of changes, a drag, it hears once the run settles (`tellShell`),
  since Claude redraws its whole screen for every size it's told. `holdFit` pauses fitting while the
  sidebar or the info panel slides; a view change shows or hides the info panel without a slide, so
  the new panes fit their final size at once. When a slide ends, the panes on screen are resized in
  one step (`resizeWhole`): the program is told the size first while the terminal keeps its old
  picture, its repaint is held back until its output goes quiet, then the terminal is resized and
  the repaint applied with drawing paused, so it goes from the old picture straight to the new.
- **Narrowing.** Claude places each word at a column, so output laid out for a wider terminal, parsed
  at a narrower one, piles every word past the edge into the last column, for good in the scrollback.
  A terminal getting narrower tells the program first and keeps its width until the program has
  answered (`narrowLater`). For Claude that's its repaint, which starts by clearing lines: resuming a
  long conversation, it prints all of it for the old width first, which can take a second or more.
- **Bottom-up fill.** `alignBottom` keeps the last line with text at the bottom of the pane, like
  Warp: when Claude's input shrinks back (after a file list, say), the empty rows under it are
  scrolled out of sight, and while there's less than a screenful the screen is shifted down
  instead. Someone who has scrolled up is left where they are until they scroll down or type.
- **Smooth scrolling.** xterm draws whole rows, so on its own a trackpad scroll moves in row-high
  jumps. `smooth.ts` shifts the screen by the part of a row in between, one device pixel at a time;
  the row leaving at the top is clipped, and the pinned input covers the gap at the bottom.
- **Pinned input.** Claude's input box is part of the terminal's text, so scrolling up would take it
  off screen. `pinned.ts` draws a copy of the bottom rows over the pane while it's scrolled up, as
  Warp keeps its input in place; clicking it or typing scrolls back down.
- **GPU drawing.** A terminal on screen draws with the WebGL add-on, which keeps fast scrolling at
  the display's frame rate. Creating one compiles shaders and redraws every glyph, the biggest cost
  of opening a pane, so the five terminals shown last keep theirs (`keepGpus`); the rest release
  theirs, since there are only about 16 WebGL contexts. A lost context falls back to xterm's DOM
  renderer.
- **Keys.** Shift+Enter sends ESC+CR, which Claude reads as a newline. Option+arrows and
  Option+Backspace move and delete by word; Cmd+arrows go to the start or end of the line and
  Cmd+Backspace deletes it, as in Warp. Other Cmd shortcuts go to the menu.
- **Find.** The search add-on, with match colors per appearance.
- **Theme.** The theme's ANSI palette for the current appearance (`themes.ts`); a change of either
  recolors every terminal. A minimum contrast of 3 darkens colors meant for a dark background, such
  as Claude Code's default theme's, so they stay readable in light mode.

## Shell integration

Every session runs the user's `$SHELL` with `ZDOTDIR=electron/shell`. Those files load the user's own
`~/.zshenv`, `~/.zprofile` and `~/.zshrc` first (resetting `ZDOTDIR` and `HISTFILE` to `$HOME` before
`.zshrc`), then add:

- **OSC 133** marks: `A` where a prompt starts, `C` when a command starts, `D;<exit code>` after its
  output. The renderer draws the input band from `A`, a separator line from `D` (red when the command
  failed), and moves a plain shell between `idle` and `running` on `C` and `A`.
- **OSC 7** with the current folder, so a session reopens where it was and its git info follows `cd`.
- A two-line prompt, only if the user hasn't set their own.
- A `claude` function that adds `--mcp-config="$DECKTERM_MCP_CONFIG" --allowedTools=mcp__own-term`,
  so Claude started there, and only there, gets Own Term's tools (see "Claude's tools"). Sessions
  Own Term starts itself run `claude` through the same interactive zsh, so they get it too.

Main also sets `TERM_PROGRAM=deckterm` and removes Claude Code's own environment variables, which
would otherwise leak in when the app is started from inside a Claude session.

## Claude Code hooks

`npm run install-hooks` adds one hook command to nine events in `~/.claude/settings.json` (and backs
the file up once, without Own Term's hooks). When Own Term's hooks are there but out of date (an older
version limited `PreToolUse` to `AskUserQuestion`), the app replaces its own entries at launch. In an Own Term shell it posts the hook's JSON to a
server main runs on `127.0.0.1` (random port, checked token, both passed to the shell as
`DECKTERM_PORT` and `DECKTERM_TOKEN`), at `/hook/$DECKTERM_SESSION`. In any other terminal
`DECKTERM_PORT` is unset and the hook does nothing.

Main reduces each event to `{ event, claudeSessionId, source, fromSubagent, prompt, notificationType,
toolName, summary, activity, agents, reply, command }`. `claudeSessionId` is dropped unless it looks like an id, because it ends up in a
`claude --resume` shell command. `summary` is the question or permission text, or the start of
Claude's last message read from the transcript. `activity` is a starting tool in a few words
("Editing store.ts", a command's description), kept per session in `activity` for the menu bar.
`agents` is how many background agents a `Stop` leaves running (its `background_tasks`, shells and
Monitor watches left out), and `reply` is a `Stop`'s whole `last_assistant_message`, for `wait_for`:
when `Stop` fires the transcript doesn't have the reply yet, so `summary` prefers it too.
`command` is what the info panel's Commands card needs (next section).

Events from a session whose shell Own Term has ended are dropped. A Claude killed with its session
reports its own end a moment later, which would make a session reopened since (Undo, ⇧⌘T) forget
the conversation it should resume.

### Commands

`commands.ts` keeps the last 40 shell commands Claude ran in each session, from its Bash tool: a
`PreToolUse` starts one, `PostToolUse` ends it with its output (16 KB of each stream), and
`PostToolUseFailure` with its exit code. A command run in the background, or moved there after its
timeout, gets a task id from `PostToolUse` instead and runs on. Claude Code writes its output to
`tasks/<id>.output` in a conversation's folder in `/tmp/claude-<uid>` (not always the conversation that
ran it), which `info:task-output` finds and reads from an offset; the viewer polls it. It ends with the
`<task-notification>` prompt that tells Claude, which has its exit code. A `Stop` lists the background
shells still running, so one missing there is counted as ended even if that prompt never came, and a
foreground command not finished by then was denied or interrupted. `SessionEnd` or the shell exiting
ends them all. Claude runs each command in a shell of its own as `eval '<command>'`, so `info:ports`
walks up from a listening process to the nearest such shell to say which command started it.

### Which events count

Every process in a session inherits its hook settings, so a `claude -p` that Claude, a hook or a
script runs there posts to the same session under its own id. `claude.ts` keeps the conversation
that is live in each session (`live`, kept across a window reload) and ignores events from any other,
unless a `SessionStart` from `/clear`, `/resume` or a compaction replaces it. `SessionEnd`, or the
shell's prompt coming back (OSC 133 `A`), ends the live conversation. Subagent events are ignored
except a permission request, which blocks the turn just the same.

### Statuses

| Signal | Status | Also |
| --- | --- | --- |
| `SessionStart` | idle | a conversation resumed with `done` or `reminder` keeps it |
| `UserPromptSubmit` | working | names the session; may put it in a group. A `<task-notification>` prompt (a background agent reporting back) only keeps it working |
| `PermissionRequest`, `PreToolUse` for `AskUserQuestion`, `Notification` of a permission prompt | input | banner, notification |
| Enter or a digit typed while `input` | working | the question or approval was answered |
| Esc or Ctrl+C typed while `working` or `input` | idle | an interrupt, after which no `Stop` comes |
| `PostToolUse` after such an interrupt | working | the turn wasn't over after all |
| `Notification` `idle_prompt` while `working` | idle | a turn that ended without a `Stop`, such as a denied permission |
| `Stop` | done | banner, notification, git refresh. With background agents still running it stays working, "Waiting for 2 agents", until the turn their reports start ends |
| A reminder coming due (`reminders.ts`) | reminder | banner, notification, Snooze 1 Hour. A session working, waiting for input, running a command or exited keeps its status and is only told |
| `SessionEnd`, or the shell's prompt returning | idle | `SessionEnd` also forgets `claudeSessionId`, so a restart opens the shell |
| OSC 133 `C` / `A` in a shell | running / idle | |
| The shell exiting | exited | |

No hook marks a permission being answered or a turn being interrupted, which is why keystrokes do.
`input`, `done` and `reminder` are "needs you": they fill the Needs You row, the Dock badge and ⌘J's order
(longest waiting first). A `done` session you're looking at, in a focused window, drops back to
`idle`; a turn that finishes while you watch doesn't notify at all. Otherwise it's announced once: by a
banner while Own Term is the focused window, by a macOS notification while it isn't (or by the banner
if the notification fails). A finished turn or a due reminder, with Claude still running, gets a reply field on both: the
text goes to the session as if typed there (`promptClaude` in `claude.ts`, which the send_prompt tool
uses too, refusing over an unsent draft). A tool permission gets Allow and Deny on both, and its banner stays until
answered: they type `1` or Esc into the session, as you would. A question (`AskUserQuestion`) or a
plan to approve (`ExitPlanMode`) has other choices, so it's answered in the session. Statuses and the Needs You queue
are kept in `sessionStorage`, so they survive a window reload; across a restart only finished turns
and due reminders are kept, since a question or a turn in progress ended with its Claude. Closing the window
asks first while any session is `working`, `input` or `running`.

## Menu bar

The menu bar icon is there so you can see what Claude is doing from any app. It's the mark as a
template image (`electron/menubar/`, drawn by `npm run icon`), and its cursor blinks while any
session is working. A count beside it says how many sessions need you. Clicking it opens the panel:
the sessions that need you, are working or are running, each with what it's doing or asking and for
how long, and Allow and Deny for a permission. Clicking a row goes to the session. A finished turn or a due reminder has a field to reply to Claude in it. The pin keeps the
panel on top, where it can be dragged and stays over full-screen apps, which hide the menu bar. View →
Show in Menu Bar turns it all off.

The panel is the renderer loaded with `?panel` in a second window, on the system's popover
material. It's a macOS panel (`type: 'panel'`), which floats over full-screen apps without making
the app active; `setVisibleOnAllWorkspaces` would turn the whole app into one without a Dock icon
to do that, and the Dock icon lost its running dot. It loads none of the app's state: `src/menubar.ts` in the main window sends main a summary
whenever it changes, main passes it to the panel, and clicks travel back the same way.

## Session browsers

chrome-devtools-mcp launches one Chrome on one profile folder, and Chrome allows one browser per
folder, so two sessions using it collide. Own Term gives each session its own Chrome instead, and the
agent drives it with the same chrome-devtools-mcp, through its usual `chrome-devtools` entry.

- **The wrapper** (`mcp.cjs`, App menu → Session Browsers → Give Each Session Its Own Chrome) turns
  the user-scope entry in `~/.claude.json` into `sh -c <wrapper> own-term <the configured command>`,
  changed through `claude mcp` since Claude Code rewrites that file constantly, and backs the file up
  once to `~/.claude.json.before-own-term`. In an Own Term shell the wrapper asks the hook server for
  the session's door (`GET /browser/<session>`, with the token) and adds `--browserUrl` to the
  command; anywhere else, or when Own Term doesn't answer, the command runs as configured.
- **The door** (`browser.cjs`) is a port of the session's own. chrome-devtools-mcp asks it for
  `/json/version` on its first browser tool call, and the door starts the session's Chrome
  (`--remote-debugging-port=0`, its port read from `DevToolsActivePort`) and answers with Chrome's
  own address, after which the two talk directly. A port per session, since chrome-devtools-mcp drops
  any path from the address it's given. Sessions that never use the browser start no Chrome.
- **The Chrome** runs headless and shows in Own Term, or as an ordinary window for a session moved out
  by its bar's window button (the pane's globe brings it back). Its profile is `<user data>/browsers/<session>`: kept across restarts, so
  logins last, and deleted with its Chrome when the session ends. Every Chrome is quit through
  DevTools (`Browser.close`), which writes its cookies to disk; a signal would lose the logins made
  since its last save. Quitting Own Term waits for them.
- **Logins** are shared: every session's Chrome is given the logins as it starts, and its cookies
  are read every 3 seconds, a change copied to the other running Chromes (`takeLogins`, by each
  cookie's last value there, so a sign-out spreads too). They're kept in `browsers/logins`, encrypted
  with `safeStorage`, so the cookies that last only a session (many sites' logins) survive restarts.
  The demo day's browser is left out.
- **Signing in** happens in a plain Chrome: one with a DevTools port tells pages it's automated
  (`navigator.webdriver`, windowed too), and Google refuses sign-ins there. Sign In in Chrome on the
  live view's bar (or App menu → Session Browsers → Sign In to Sites) gives the profile
  `browsers/_base` the logins through a headless Chrome, its pages closed so none are restored, then
  opens the session's page in a plain Chrome on it with `--restore-last-session`, which keeps session
  cookies. Done Signing In, or ⌘Q, quits it; a headless Chrome restoring that session reads its cookies
  into the logins and the session's page goes on to the last tab's address.
- **The live view** (`BrowserView.tsx`) floats over the session's terminal in its pane, as a window
  you move by its bar, resize from any edge, expand to fill the pane, or close; the terminal never
  resizes for it. It's shaped like the page, as a picture-in-picture video is: its height follows its
  width (CSS `aspect-ratio`), so none of it is empty, resizing keeps the shape, and when the agent
  emulates a phone it keeps its height and narrows. Filling the pane, it's the largest page-shaped
  window that fits, at the top. Its place is kept per session as shares of the pane (`browser.ts`), so it holds as
  the pane changes size; a browser that starts anew opens its window again. It's a stream, not an
  embedded browser. Own Term keeps a DevTools connection of its own to a headless
  Chrome, beside chrome-devtools-mcp's: it follows the page the agent works in (the one it opened or
  navigated last) and while the view is on screen streams it with `Page.startScreencast`: a JPEG per
  change, no bigger than the view, the next only once the renderer has drawn the last. The page keeps
  the size the agent works with (Chrome's 1440×900 window, or what the agent emulates) and the view
  shows it scaled to fit: sized to the view, a small window gave the agent a mobile layout, and
  resizing it changed the page under the agent mid-task.
  Your mouse, scrolling, keys and ⌘V on the view, mapped to the page's own coordinates (a scroll
  scaled so the page follows your fingers), go to the page as `Input.dispatchMouseEvent`,
  `dispatchKeyEvent` and `insertText`. ⌘ shortcuts stay the app's, and copying from the page isn't
  possible: headless Chrome's clipboard is its own. Chrome reports a page's address changing but not
  its title, so the title is asked for after a navigation, after input and while frames come in.
- **Showing it**: the globe in a pane's header, there once the session has a browser, closes or
  reopens its window; closing it leaves the Chrome running, so an agent mid-task isn't cut off. A
  blank page hides the window and the globe: chrome-devtools-mcp won't close a browser's last page,
  so an agent asked to close the browser opens a blank one. The next real page brings both back,
  unless you closed the window yourself.
- **Moving it out**: the window's Chrome button restarts the session's Chrome as a window on the same
  profile, at the page it was on; the globe then brings it back the same way. The choice holds for
  that session. chrome-devtools-mcp reconnects through the door on its next call, and tells the agent
  that page ids changed.

## Claude naming and grouping

Main runs `claude -p --model haiku --tools ''` with no session saved, the instructions first and the
user's text fenced in `<task>` tags with an order not to act on it.

- **Session names** come from the first prompt of each Claude conversation, until someone renames
  the session. Bare slash commands are skipped.
- **Group names** come from the group's session names, two seconds after they change.
- **Auto-grouping** (`grouping.ts`) runs once per session, after the first prompt of a session in no
  group. Haiku gets the prompt and folder, the groups with their sessions and folders, and the other
  ungrouped sessions, and answers with JSON: an existing group, a new group with some of those
  ungrouped sessions, or nothing. The footer says what moved, with Undo; the palette turns it off.
  The New Session sheet starts a session in no group, so it's sorted, unless it was opened from a
  group's + or menu, or someone picks a group in it.

## Reminders

A reminder is `remind: { at, note }` on a session, so it's saved and comes back with a reopened
session. Remind Me in a session's menus and the palette sets one: in 30 minutes, 1 or 3 hours,
tomorrow or next Monday at 9:00, or a time and note in `ReminderSheet.tsx`. The sidebar's Reminders tile
counts them and opens the Reminders page (`page: 'reminders'`), which lists the ones that came due,
then the rest by day, each with its whole note (the check clears one); a session's row carries a clock,
orange while one is due.

`reminders.ts` checks every 15 seconds, when the window gets focus (timers stop while the Mac sleeps)
and a moment after launch, so one due while Own Term was closed arrives once it's up, saying when it
was due. A due reminder moves from `remind` to `due: { at, note }`, sets the `reminder` status with its
note, and is announced like a finished turn, with a Snooze 1 Hour that keeps the note. The status clears
like a finished turn's, but `due` stays, saved with the session, until it's marked done, snoozed or set
again. One on the session you're looking at still shows its banner, since it says why you set it.
Reminders only fire while Own Term runs.

A reminder that isn't about a session is a to-do with a time: `remind` (ms) on the note, set from the
clock on its row on the Today page or by `add_note` with a time. When due it becomes `due`, and only
notifies, since there's no session to put in Needs You; banners and notifications name it `note:<id>`,
and opening one goes to the Today page. Checking the to-do off answers it.

A reminder marked done (a to-do checked off) or cancelled goes into `cleared`, kept a month in
`localStorage['deckterm.clearedReminders']`, which the Reminders page lists under Cleared, with
Remind Again while its session or to-do is still there.

## Claude's tools

Own Term serves an MCP server of its own, `own-term`, for Claude running in one of its sessions.
`electron/tools.cjs` defines the tools, their descriptions and the server's instructions, and answers
JSON-RPC over HTTP at `/mcp/<session>` on the hook server (same port and token). At launch main writes
`own-term-mcp.json` to the user data folder, an `http` server whose URL and header Claude Code fills
in from `${DECKTERM_PORT}`, `${DECKTERM_SESSION}` and `${DECKTERM_TOKEN}`; the zsh integration's
`claude` passes it with `--mcp-config=` and allows every `own-term` tool. Installed for every terminal
instead, the server would show as failed wherever those variables are unset.

The sidebar's state lives in the window, so main asks it (`tools:call`, answered by `src/tools.ts` as
`tools:result`) and waits 15 seconds, or `wait_for`'s timeout plus a margin. The tools:

| Tool | Does |
| --- | --- |
| `list_sessions`, `describe_session` | Every session and group (with its monitors) with status, folder, branch, reminder and what it last did, the caller marked `you`; one session's latest prompts and Claude's last reply, from its transcript |
| `rename_session`, `move_session`, `create_group`, `update_group`, `delete_group`, `organize` | Change the sidebar; `create_group` and `organize` take monitors too; `organize` rearranges many sessions in one step, undone as one |
| `remind`, `cancel_reminder` | `in_minutes` or `at` (local time) and a note; cancelling also clears one that came due |
| `new_session`, `show_sessions`, `close_session` | Start a session in a folder (Claude with an optional first prompt, a shell, or a new worktree), put sessions and monitors on screen, end one (not a busy one without `force`; the caller's own a moment after the reply, so Undo resumes a conversation that has it) |
| `review_pr`, `start_issue` | What the Today page's Review with Claude and Start do, through the same functions (`reviewWithClaude`, `startIssueIn` in `status.ts`); an issue starts in the folder given or where its team last started |
| `send_prompt`, `wait_for` | Type a prompt into Claude in another session and send it; wait for that session's turn to end and get its reply |
| `add_note`, `list_notes`, `complete_note`, `remove_note` | The Today page's to-dos; a note is tied to the calling session unless told otherwise, can name a Linear issue, and with a time is a reminder (`remind` and `cancel_reminder` take `todo` to change it) |
| `get_status` | What the Today page knows: the brief, sessions needing the user, reminders, pull requests, issues and to-dos |
| `list_projects`, `set_projects`, `update_project` | The projects, each with its repositories, where its name comes from, and its color, icon and whether it has a favicon; name repositories (alike names merge them, null resets) or set a project's color and icon, each undone as one. `create_group` and `new_session` take a `project` |
| `save_monitor`, `list_monitors`, `get_monitor`, `pause_monitor`, `remove_monitor`, `move_monitor` | Monitors (see "Monitors"); `save_monitor` and `move_monitor` put one in a group; `get_monitor` with `run: true` runs the allowed commands first, and lists problems such as a panel naming a field the rows don't have |

Sessions and groups are named by id or exact name, and `session` defaults to the caller. Every input
is checked before anything changes, and what Claude changes counts as done by hand: the automatic
naming and grouping leave it alone. Each change shows a notice, with Undo where it can be undone.
`send_prompt` goes through `promptClaude` (`claude.ts`), as a reply from a banner does: Claude has to
be running there (`live`), not waiting on a question, and with nothing typed in its prompt, which
`claudeDraft` (`terminals.ts`) reads off the screen, skipping the placeholder Claude draws dim. The
text is stripped of control characters and sent as a paste, so line breaks survive, then Return.
The instructions tell Claude to use the tools only when asked.
The Today page's chat calls in as `today`, which is no session: the hook server lets that caller through,
the server gives it instructions of its own, and a tool that would default to the caller asks it to
name a session instead (`add_note` ties the to-do to none).

## Today page

The Today page (the sidebar's Today tile, ⌃⌘T) answers "what do I look at and pick up" and "what did I
do this week". It's a `page` in the store, drawn over the dock: the panes stay laid out and running
behind it, hidden, so leaving it shows them at once. Showing any session or group leaves it
(`closePage` in `workspace.ts`).

- **Sources** (`status.cjs`, `status:collect`): `gh api graphql` in one call for your open pull
  requests (checks, reviews, conflicts, and what each needs: `fix`, `reply`, `ready`, `waiting`,
  `draft`), requests for your review (since when, and whether it changed after your last review), and
  what you merged and reviewed in the last week; Linear's GraphQL API, with the key from Settings, for your
  started and unstarted issues and those completed in the last week. Each is cached two minutes, and
  `status.ts` collects every five minutes so the tile's counts stay current. Issues and pull requests
  are tied by Linear's GitHub links, its branch name, or the issue's id in a PR's title or branch; a
  pull request or issue shows the session on its branch.
- **Whose turn** (`minePr`, `changedSinceReview`): one of yours needs you (`reply`) when a reviewer
  acted after you did: your last push, comment or re-request against their reviews, comments and
  unresolved threads they spoke last in, outdated threads and bots left out. Changes requested and
  answered by a push is "Waiting for re-review". One you reviewed that got commits, or replies in your
  threads, since your review joins the review requests as "Updated", since GitHub drops you from the
  reviewers once you review and the search for requests misses it.
- **Pings**: main asks GitHub every three minutes, whether the window is open or not, and notifies
  when a pull request starts needing you or something newer happens on it (`ping`): yours to fix,
  answer or merge, a review requested, one you reviewed updated. What was pinged is kept in
  `status/pinged.json`, so a restart neither repeats nor drops one; the very first check only records.
  More than three at once come as one notification that opens the Today page. Settings → GitHub turns
  them off.
- **Projects** (`projects.ts`): a project is a name given to repositories. A repository is named in
  Settings → Projects (`status.projects`, repository → name; alike names make one project), or else
  after the sidebar group holding all its sessions when that group has no other repository's, or else
  its own name. Sessions are placed by their folder's repository (main says which, `status:repos`,
  through a removed worktree too), or, outside one, with the rest of their group; pull requests by
  repository; issues by their pull requests' repository, or their team's usual one (`link`); to-dos by
  session, issue or the tab they were added on; prompts by session or folder. Tabs under the title
  choose one (`localStorage['deckterm.project']`), and every card on both tabs keeps to it. With one
  project or on the demo day there are no tabs.
- **Projects in the sidebar**: the same choice narrows the sidebar. The project rail (`ProjectRail.tsx`)
  beside it has a tile per project, Slack's workspaces, and ⌃⌘0…⌃⌘9 choose too (View menu). A group is in
  the projects its sessions are in; a group or session that no repository places keeps the project it
  was made in (`project` on it, set by `useRememberProjects`, and a group's kept up to date from its
  sessions), and one in no project is listed in every project. Showing something the sidebar doesn't
  list (`show` in `workspace.ts` calls `followView`) switches to its project, or to all of them; Needs
  You, ⌘J, notifications, search and the Dock badge never filter. A tile shows the icon chosen for the
  project, else its repository's favicon (`status:favicons`: `git ls-files` in a clone for a favicon,
  apple-touch-icon or icon, svg first), else its initials, on the project's color; both are stored by
  project name in the status settings (`projectLooks`). New sessions start in the chosen project's
  newest folder, and auto-grouping only offers its groups.
- **The journal**: `claude.ts` records each prompt and finished turn (`record` in `status.ts`), and
  main appends them to the day's file. Days before it began are read once from Claude Code's
  transcripts: typed prompts from interactive sessions in the last 14 days, named by the conversation's
  title or its first prompt.
- **Claude's brief and standup** (`status:write`): `facts` writes everything above as text with an
  id for each item (`pr:owner/repo#12`, `issue:ABC-1`, `session:<id>`, `note:<id>`), plus your
  instructions from Settings, and `claude -p` answers in a fixed JSON shape (`--json-schema`), with its
  own short system prompt and no tools, skills or MCP servers, so a call costs little beyond the facts.
  Claude names items only by id; the page turns ids into chips from its own data, so no link or count
  is Claude's. The brief is written on the first visit of a day and by Refresh; the standup on request.
  A project has its own of both, written from only its facts (the snapshot carries `project`, and
  main keeps its pull requests, issues and prompts): its brief the first time its Today tab is shown
  each day, its standup likewise on the Week. Everything's standup is split by the projects it's given.
- **Actions**: Review with Claude finds a clone of the PR's repository among known folders, checks the
  PR out detached in `.claude/worktrees/review-<n>` and starts Claude with the review prompt from
  Settings. Start on an issue asks which folder, makes a worktree on Linear's branch name (`git:worktree`
  takes a branch) and gives Claude the issue as its first prompt.
- **The chat** (`chat:ask`, `TodayChat.tsx`): each tab has one per project, given only that project's facts. A question typed at the bottom goes to
  `claude -p` with the brief's model, `stream-json` output and partial messages, so the answer is
  drawn as it's written, and each tool it uses shows as a line. The first question of a conversation
  carries `facts('chat')`: a week of the log, reviews and the brief on the page, or on the Week tab
  `facts('week')`, which adds the standup and keeps only prompts so the log reaches the week's start; each later one
  resumes it with `--resume` and says only the time and the question, unless the facts are over 15
  minutes old, when it carries them again, fresh. It has no built-in tools, only
  `own-term`'s, reached through the shells' MCP config with `DECKTERM_SESSION=today` (see "Claude's
  tools"). It runs in the status folder's `chat`, so Claude Code files its conversations under a project of
  their own in `~/.claude/projects`, apart from the user's. A session it starts opens behind the page.
  Claude names items as `[id]` inside its text, which the page turns into the same chips as the
  brief's. A conversation lasts the day (`localStorage['deckterm.todayChat']` and `['deckterm.weekChat']`, with `:<project>` for a project's),
  and ✎ starts another.
  Hidden while summaries are off and on the demo day.

## Monitors

A monitor is a page in the sidebar's Monitors section, below the groups, that Own Term fills by
running shell commands on a schedule. Claude makes one with `save_monitor`, when asked to keep an eye
on something (a database, logs, an endpoint) instead of polling it in its own turns. Claude writes a
spec and never code: main runs the commands, keeps their history and checks the rules, and the page
draws from that alone, so the same data always draws the same page and fires the same rules.

- **The spec** (`check` in `monitors.cjs`): `sources`, each a command with a schedule (`every`, or `at`
  times of day; either kept to `days`, and `every` to `hours`, by `nextRun`), a `format` (number,
  json, ndjson, csv, tsv or lines) that turns its output into rows of fields, and optionally `timeout`,
  `keep` and a row `key`; an optional `expires`, after which the monitor stops itself; optional `marks`,
  moments (a release) drawn on every time chart; `panels` (stat, line, area, bar, table, log, status,
  checks, funnel), each drawing one source; and `rules`. Every mistake, unknown fields included, comes back to Claude at once, by its path.
  The descriptions of `save_monitor`'s input in `tools.cjs` are all Claude knows of the format.
- **History**: each run is one point, its time and the first row's numbers, kept for `keep` (24
  hours unless the spec says otherwise). A command that prints one row builds a series over time; one that prints a table is drawn
  from its latest rows (a chart with `x`). A failed run keeps the last good rows on the page, faded.
- **Running**: `zsh -c` in the monitor's folder, with the environment of the user's interactive login
  shell (read once every 15 minutes with `-ilc`), in a process group of its own, which a timeout ends.
  A source never overlaps itself. Sources start a few seconds apart at launch. Each run gets
  `OWN_TERM_SINCE` (when the last good run started, its `cursor`) and `OWN_TERM_NOW`, so a command
  counting events in that window misses nothing and counts nothing twice, even after a failed run.
  An `at` time missed while the app was closed runs once when it opens.
- **Allow**: nothing runs until the user presses Allow on the page. What's allowed is a hash of each
  command, its folder and the prompts its rules would send Claude (`state.json`, kept apart from the
  specs Claude writes), so a changed command or prompt asks again and one changed back, as by an Undo,
  doesn't. A source's history is kept by its command and folder alone.
- **Rules**: a comparison on a field (of the first row, or over all rows with `agg`), `failing`, or
  `new_rows`, by `key`, whose first run only learns what's there. With `by`, each group of rows is
  tested on its own and the groups firing are named; one joining notifies again. With `change`, the
  rule tests how far its value moved since the run before or over a time, from a series of its own
  values. A rule fires after `for` runs in a row and notifies when it starts firing (an alert also
  when it stops), at most once in 15 minutes, saying what its `say` template makes of the matching
  rows. A rule the user snoozes (for an hour, until the morning, or until it clears; from its chip or
  the notification) is still checked and drawn, but doesn't notify, wake Claude or count toward the
  monitor's state; the snoozes are kept with what was allowed, in `state.json`. A rule with a `prompt` also wakes Claude (`fire`): main sends `monitor:wake`, and `claude.ts`
  types the prompt, the message and the matching rows, fenced as data, into the session that saved
  the monitor, through `promptClaude`. A `done` rule stops the monitor when it fires (`finish`), as
  expiring does; resuming starts it again.
  Its state is kept by what it tests, so reordering rules doesn't swap their states.
- **Events**: rules firing and clearing, new rows, a command failing and working again, and finishing
  are kept for a week (`log`). The page opens with what happened since it was last left (`lookedAt`,
  set when the page is left), a rule flapping within the hour as one line, and shades the stretches a
  rule fired on the charts of its fields; `get_monitor` gives them to Claude as `happened`. New rows count
  on the sidebar row until the page is looked at. Alerts count on the Dock's badge.
- **Charts** (`MonitorCharts.tsx`): a series over time breaks where runs are missing (gaps over three
  times the usual spacing) instead of bridging them, and one with more points than fit is thinned to
  a point every few pixels, drawn as its average inside a band of its range. Ticks fall on round
  numbers and round local times, with midnight marked.
- **The window** gets a summary of every monitor whenever one changes (`monitors`), enough for the
  sidebar; a page fetches its monitor in full whenever its `rev` changes. `page` in the store is
  `{ monitor: id }` while one is shown, drawn over the dock the way the Today page is. Removing one
  keeps it in main's memory, so Undo brings back its history too. Hidden on the demo day.

Files, in `monitors/` in the user data folder: `<id>.json` the spec, `<id>.data.json` its history and
rule states (written within five seconds of a run), `state.json` what was allowed and paused.

## Undo and closed sessions

`announce` (`store.ts`) puts a change in the footer; one that can be undone also goes into a history
of the last ten, which ⌘Z works back through outside a text field (in a terminal too; the Edit menu's
Undo sends `undo`, and a text field gets `execCommand('undo')`). A notice under the pointer stays. A
tool's undo restores only what that change altered, compared just before and just after it, so later
changes, yours or Claude's, survive it.

Ending a session (`endSessionNow` in `menus.ts`, for the menus, the ✕ and `close_session`) records it
in `closed`, a week of them at most twenty, saved in `localStorage`. Session → Reopen Closed Session
(⇧⌘T), a palette entry per session, and the ending's Undo put it back where it was; its Claude
conversation resumes when it's opened.

## Main process services

| Channel | What it does |
| --- | --- |
| `pty:start` · `write` · `resize` · `kill` | The shells (`node-pty`), with the replay buffer |
| `git:info`, `git:worktree` | Branch and change counts; a new worktree in `<repo>/.claude/worktrees/<name>` on `<first name>/<name>`, branched without tracking from the remote's default branch |
| `name:suggest`, `group:suggest` | The Haiku calls above |
| `info:git`, `info:pr`, `info:claude`, `info:ports`, `info:file`, `info:task-output` | The info panel (`info.cjs`): git in detail, the branch's PR, a conversation's transcript summary, the ports a session's processes listen on, a file's diff or text for the file viewer, and a background command's output |
| `files:resolve`, `files:open`, `files:reveal` | Link targets that exist; open in the chosen editor (`editors.cjs`), else the default text editor; show in Finder |
| `menu:popup`, `dialog:confirm`, `dialog:folder` | Native menus, alerts and the folder picker |
| `setup:status`, `setup:install-hooks` | Whether the hooks are installed, and installing them, for the welcome screen (`hooks.cjs`) |
| `update:state`, `update:install` | The updater's state (pushed as `update` events) and Restart to Update (`updater.cjs`) |
| `app:accent`, `app:appearance`, `app:badge`, `app:focus` | System accent color, appearance setting, Dock badge, bringing the window forward |
| `app:theme`, `app:set-theme`, `app:editors`, `app:set-editor` | The saved theme (main paints the window in its base) and the editor files open in, both in `settings.json` |
| `app:notify`, `app:unnotify` | macOS notifications, one per session, with buttons and a reply field; clicks, buttons and replies come back as `notification` events |
| `menubar:summary`, `menubar:get`, `menubar:open`, `menubar:answer`, `menubar:reply`, `menubar:pin`, `menubar:height` | The menu bar: the window's summary in, the panel's clicks, answers and replies out (as `menubar-action` events), pinning, and the panel's height |
| `GET /browser/<session>` (hook server) | The session's door port, for the wrapped chrome-devtools MCP server |
| `POST /mcp/<session>` (hook server), `tools:call`, `tools:result` | Own Term's MCP server (`tools.cjs`), whose tool calls the window answers (`src/tools.ts`) |
| `browser:watch`, `browser:frame-drawn`, `browser:states`, `browser:input` | The live view: its size (or that it's gone), each frame drawn, every session's browser for a window just loaded, and your input on it; frames and state come back as `browser-frame` and `browser-state` |
| `app:busy`, `app:home`, `app:user` | The sessions still busy, named in the warnings before quitting or updating; the home folder; the person's name, for the Today page |
| `monitors:*`, `monitor:show` | Monitors (`monitors.cjs`): the list and one in full, saving, allowing, pausing, running, removing and restoring; a monitor's notification clicked |
| `status:*`, `journal:add` | The Today page (`status.cjs`): settings and the Linear key, collecting, the journal, the brief and standup, clones of a repository and a pull request's worktree, folders' repositories and the folders the new-session sheet offers |

The app menu sends its commands to the renderer as `menu` events; `App.tsx` → `runAction` handles
those and the palette's commands in one place, so a new command is added once and shows up in both.
