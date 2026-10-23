# Release notes

## 0.1.63

2026-10-23

- Order the project rail by dragging its tiles

## 0.1.62

2026-10-23

- Group the sidebar by project, with a project rail

## 0.1.61

2026-10-19

- Group the Today page by project
- Offer each project's repository and smarter recents in New Session
- Retake the site's screenshots, and show the Reminders page on it

## 0.1.60

2026-10-17

- Give to-dos a time, for reminders that aren't about a session, and keep cleared reminders
- Close session Chromes an earlier Own Term left running
- Keep due reminders until they're done, and let Claude end its own session
- Move the group popover on a spring
- Cross the group popover's lists with a blur when it moves to another group
- Head the group popover with its group, and smooth how it opens, closes and switches

## 0.1.59

2026-10-16

- Open monitors as panes beside sessions, and let groups hold them
- Slide the group popover between folded groups instead of reopening it

## 0.1.58

2026-10-16

- Show a folded group's sessions on hover, and wrap the palette's arrow keys

## 0.1.57

2026-10-16

- Add a Reminders tile and page, and let sidebar sections fold

## 0.1.56

2026-10-16

- Tell Claude to key Seq events by their time, since seqcli prints no event id

## 0.1.55

2026-10-16

- Show what monitors saw while you were away, snooze their rules, and add checks and funnels

## 0.1.54

2026-10-16

- Share session browser logins, and sign in in a plain Chrome
- Stop repeat pings while GitHub recomputes mergeability

## 0.1.53

2026-10-15

- Add monitors: sidebar pages Own Term fills by running Claude's commands on a schedule

## 0.1.52

2026-10-15

- Give sessions icons, chosen by Claude from a set of Lucide icons

## 0.1.51

2026-10-15

- Open documents, images and media in their own app, not the editor

## 0.1.50

2026-10-15

- Know whose turn a pull request is, and ping when it becomes yours

## 0.1.49

2026-10-15

- Open the window where and as big as it was left

## 0.1.48

2026-10-15

- Log every terminal size and the width Claude draws at

## 0.1.47

2026-10-14

- Start a session's shell only once its terminal has a measured size

## 0.1.46

2026-10-14

- Keep a narrowing terminal's width until Claude has repainted

## 0.1.45

2026-10-14

- Ask Claude about your day from a field at the bottom of the Today page

## 0.1.44

2026-10-14

- Ask Claude about text selected in its session

## 0.1.43

2026-10-14

- Select a collapsed group while one of its sessions has focus
- Give the Today page Apple's grouped look

## 0.1.42

2026-10-14

- Fix a session's browser failing to start while an old Chrome holds its profile

## 0.1.41

2026-10-14

- Make Today a smart tile like Needs You and Working, and give the demo day a Today page

## 0.1.40

2026-10-14

- Keep the Today page's columns even, and list Linear issues in one column

## 0.1.39

2026-10-14

- Add a Today page: Claude's brief and standup, your pull requests and Linear issues

## 0.1.38

2026-10-14

- Fold the info panel's cards, and tie servers to the commands that started them

## 0.1.37

2026-10-14

- Show the commands Claude runs, and follow a background one's output

## 0.1.36

2026-10-14

- Show the conversation's scratchpad in the info panel
- Mark prompts, questions and finished turns beside each pane's scrollbar

## 0.1.35

2026-10-14

- Add Rosé Pine, Everforest, Flexoki and Indigo themes, and color the sidebar tiles with the theme

## 0.1.34

2026-10-13

- Type into the pinned input without being taken to the bottom

## 0.1.33

2026-10-13

- Line the pinned input up with the terminal's grid

## 0.1.32

2026-10-13

- Redesign the sidebar, and collapse or expand every group at once
- Show whether the sidebar and info panel are open in their toolbar icons
- Roomier New Session and Remind Me sheets, with recent folders that stay
- Ask for chrome-devtools to be reconnected instead of opening a Chrome outside Own Term
- Ship with npm run ship, a front for the release script, instead of on every push

## 0.1.31

2026-10-13

- Stop Check for Updates… failing while a new version is already downloading

## 0.1.30

2026-10-13

- Answer Claude from a banner, a notification or the menu bar, without switching to its session
- Reopen a closed session with ⇧⌘T or from the palette, its Claude conversation resuming
- Undo the last few changes with ⌘Z, yours or Claude's, and keep a notice on screen while you point at it
- Let Claude wait for another session's reply, and refuse to type over a draft you left there
- Needs You keeps finished turns and due reminders across a restart

## 0.1.29

2026-10-12

- Let Claude end a session and send a prompt to another
- Ignore hook events from a session whose shell was ended

## 0.1.28

2026-10-12

- Give Claude in a session tools to organize Own Term
- Remind me to come back to a session later
- Show submenus in right-click menus

## 0.1.27

2026-10-12

- Tint each pane's header with its group's color, and name the group when groups mix

## 0.1.26

2026-10-12

- Keep a session working while its background agents run
- Rename sidebar sessions and groups by double-click again
- Tell the site about session browsers
- Give the demo day's Apple Pay session a browser on the shop's checkout
- Fix the review's findings on session browsers
- Hide a session's browser window while its page is blank
- Fill the pane with the largest page-shaped window, not the pane's shape
- Shape a session's browser window like its page, and default the page to 1440x900
- Keep a session browser's page at its own size, shown scaled to fit the window
- Float a session's browser over its terminal, in a window of its own
- Sign in to sites once for every session's browser, and quit Chromes cleanly
- Move a session's browser out to a Chrome window and back
- Click, scroll and type in a session's live browser, and show it in a group's pane
- Show a session's headless browser live beside its terminal
- Give each session its own Chrome for chrome-devtools-mcp
- Resize terminals on screen in one step when the sidebar or info panel slides
- Zoom a pane by double-clicking its header, with panes side by side
- Document the traps in testing the dev build, and how to measure smoothness

## 0.1.25

2026-10-12

- Keep the Dock icon's running dot, and show Allow and Deny on permission requests

## 0.1.24

2026-10-12

- Show a view's panes once their terminals have settled, at their latest output

## 0.1.23

2026-10-12

- Make the site scroll and tell its stories better
- Open panes at their final size, drawn, and switch sessions without a blink

## 0.1.22

2026-10-12

- Smooth the info panel when switching sessions
- Keep panes drawn while they resize, and tell the shell once a resize settles
- Retry the release check when a request fails while latest moves

## 0.1.21

2026-10-12

- Add a Working row to the sidebar that opens every working session
- Show a pane's full name when there's room for it

## 0.1.20

2026-10-11

- Redesign the New Session sheet around the folder
- Show the menu bar on the marketing page, and fold its smaller stories into cards

## 0.1.19

2026-10-11

- Show what Claude is doing from the menu bar
- Answer Claude's permission requests from the banner and the notification
- Document the missing IPC channels, pinned.ts and editor.ts in the architecture

## 0.1.18

2026-10-11

- Lead the marketing page with "Run them all. Miss nothing."
- Show the info panel and file viewer on the marketing page
- Let the demo's files open in the file viewer

## 0.1.17

2026-10-11

- Preview images in the file viewer, and start each tab at the top

## 0.1.16

2026-10-11

- Show changed files in the app, and open them in the editor you choose
- Alert once: a banner in Own Term, a notification outside it
- Line up the info panel's header at the left, status icon at the right

## 0.1.15

2026-10-11

- Add an info panel beside a single session
- Hide the stray scrollbars, and mark the focused pane in a split
- Show the themes on the marketing page

## 0.1.14

2026-10-11

- Add color themes, each with a dark and a light side

## 0.1.13

2026-10-11

- Reorder groups by dragging them in the sidebar

## 0.1.12

2026-10-11

- Wait for the shells to exit before quitting

## 0.1.11

2026-10-11

- End a session from the sidebar, and mark sessions in a worktree
- Pick a new session's group in the New Session sheet
- Span the panes card across the whole feature grid
- Give the site a dark mode, with a switch and dark screenshots

## 0.1.10

2026-10-11

- Stop a hard swipe at the input instead of bouncing there

## 0.1.9

2026-10-11

- Focus the terminal of a session picked in the sidebar
- Keep the last line at the bottom when Claude's input shrinks back
- Show a group's color beside its sessions
- Fit the hero to a phone
- Keep the hero's orbit at the display's frame rate
- Offer the download on the site, with a new hero

## 0.1.8

2026-10-11

- Keep colors meant for a dark background readable in light mode

## 0.1.7

2026-10-11

- Go to the start or end of the line with Cmd+arrows, as in Warp
- Scroll terminals smoothly and draw them on the GPU

## 0.1.6

2026-10-11



## 0.1.5

2026-10-11

- Publish releases to a public GitHub repo instead of Vercel Blob
- Show Vercel's own error when a release upload fails
- Keep releases within Vercel Blob's 1 GB: one dmg, the last two update zips
- Show folders with their real capitalization after cd

## 0.1.4

2026-10-11

- Give the terminal's inset the card's color instead of xterm's black
- Run the input band and command lines across the whole pane

## 0.1.3

2026-10-11

- Delete the built app after a release, so macOS doesn't list a second Own Term
- Stop the workspace painting over the sidebar's shadow
- Welcome new users and draw the mark as the app opens

## 0.1.2

2026-10-11

- A test release, to check that 0.1.1 updates itself.

## 0.1.1

2026-10-11

- Let the release script run steps that print straight to the terminal
- Package Own Term as a signed Mac app that updates itself
- Keep the input in view while scrolled up, as Warp does
- Make the terminal scrollbar a thin macOS overlay, shown only with scrollback
- Fix what a third review found, and document how statuses work
- Fix what a second review of the fixes found
- Fix what a deep review found, after verifying each finding
- Ignore .DS_Store
- Deploy the marketing page from outside the repo, which Vercel doesn't block
- Draw the closing ring in plain ink, leaving the cursor the only color
- Document the marketing site, its deploy, and the Juniper demo day
- Add npm run site:deploy, which publishes the marketing page to Vercel
- Trim the marketing footer: no Built with column or sign-off
- Lead the marketing hero with the product, not a slogan
- Drop the footer's fine print, and give the organize section room above the gray band
- Give the marketing page its own art and an Apple-style footer
- Make the marketing page light, after Apple's product pages, with a new demo day
- Add a one-page marketing site for Own Term
- Match the icon and brand sheet to the app's colors, and document the app
- Add the Own Term icon, drawn from a script and shown in the Dock
- Keep the window's own background in step with the appearance
- Let Claude put new sessions in groups, and rename only on double-click
- Keep the palette's search field full height when the list is long
- Add find in pane, a command palette and light mode
- Animate the sidebar, group folders and arriving panes
- Draw the rename field's focus ring inside it, where the row can't clip it
- Let the window show through between the pane cards
- Lay deckterm out like the mockup: toolbar, pane headers with status, footers
- Float each pane as a rounded card on a darker window, like the sidebar
- Float the sidebar as a rounded glass card, like Notes and System Settings
- Make deckterm look and behave like a Mac app
- Fill panes from the bottom up, like Warp
- Calmer session rows, and demo sessions redraw at the pane's width
- In-app notifications for finished sessions, and a scripted demo day
- deckterm: a terminal for running many Claude Code sessions
