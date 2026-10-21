# Design

Own Term should feel like an app Apple shipped: a dark, quiet window where the terminals are the
content and everything else steps back. The brand sheet, `brand.html` in this folder, shows the icon,
lockups, colors and type on one page; it is generated, so change the sources below and rerun
`npm run brand` rather than editing it. The marketing page follows the same tokens and icon, in its
own light, Apple-style treatment: `docs/development.md` → "Marketing site".

## Principles

- **Floating cards.** The sidebar and every pane are rounded cards with an 8px gap around them, on a
  slightly darker window. No bars run edge to edge except the toolbar, which is part of the window.
- **The system decides.** Selection, buttons and links use the Mac's accent color; menus,
  confirmations and the folder picker are native; light and dark follow System Settings unless the
  user picks one under View → Appearance.
- **Status is the only loud thing.** Color in the chrome means something: orange needs an answer,
  the accent means your turn, green is running, red failed. Everything else is a gray.
- **Amber is the brand, not the UI.** The amber cursor lives in the icon and the prompt glyph only.
- **A steady sidebar.** Needs You and Working are always the two tiles at the top, gray when there's
  nothing to show, so the list never jumps as sessions start and stop.
- **Calm rows.** A row shows its name in full and its status underneath. Shortcut hints and extra
  badges stay out of the sidebar; the palette and the menus teach the shortcuts.
- **Change only by double-click.** Names turn into a field on double-click, never a single click.

## Tokens

Every color is a custom property in `src/styles.css`, set on `:root` for dark and again under
`@media (prefers-color-scheme: light)`. Use the token, never the value.

| Token | Dark | Light | Used for |
| --- | --- | --- | --- |
| `--base` | `#0b0e13` | `#e9ebef` | The window, around and between the cards |
| `--content` | `#10131a` | `#ffffff` | Pane cards, and the terminals' own background |
| `--sidebar` | `#161a22` | `#f6f7f9` | The sidebar card |
| `--raised` | `#1c212b` | `#ffffff` | Sheets, the palette, the find bar |
| `--glass` | translucent `--raised` | translucent white | Notification banners, over a blur |
| `--page`, `--card` | `--content` / 4% lighter | off-white / white | The Today page and its cards |
| `--label` / `--secondary` / `--tertiary` | white at 88% / cool gray 56% / 32% | black 85% / 64% / 34% | Text by importance |
| `--fill`, `--hover`, `--selection` | white at 7% / 5% / 8% | black at 5% / 4% / 7% | Fields, hover, quiet selection |
| `--box`, `--field` | white at 2.5% / 4.5% | black at 2.5% / white | In sheets: option boxes; fields, chips and buttons |
| `--separator`, `--edge`, `--strong-edge` | hairlines | hairlines | Dividers, card edges, popover edges |
| `--accent` | the Mac's accent | the Mac's accent | Selection, focus, links, "your turn" |
| `--on-accent` | white | white | Text and icons on an accent fill |
| `--orange`, `--green`, `--red` | system colors | darker, so they read as text on white | Needs input, running and lines added, failed and lines removed |

These are the Default theme's values. The terminals take `--content` as their background.

### Themes

A theme (View → Theme, or "Theme:" in ⌘P) is defined in `src/themes.ts`. It has a dark variant and a
light one, and View → Appearance still picks between them. Each variant gives the surfaces (`base`,
`sidebar`, `content`, `raised`), `label`, `accent`, `onAccent`, the three status colors, and the
terminal palette. `themes.ts` sets those as the tokens above on `:root`, and derives `--glass`,
`--secondary` and `--tertiary` from them. The hairlines, fills and shadows stay the appearance's own.
Default sets nothing, so it is exactly the values in `styles.css`, with the Mac's accent.

A new theme's colors have to pass two checks: `onAccent` on the accent darkened by 18% (the selected
row) reaches 4:1, and the status colors reach 3:1 as text on `sidebar`. A pastel accent needs a dark
`onAccent`. The main process paints the window in the theme's `base` before the page loads, so a
theme change sends both bases to it.

**Group colors** are the macOS Finder tag colors (`GROUP_COLORS` in `src/store.ts`): Red, Orange,
Yellow, Green, Mint, Teal, Blue, Indigo, Purple, Pink, Gray. A group's color shows as its folder in
the sidebar, as a dot before each of its sessions' names in pane headers, and before its name in the
toolbar.

## Type

- Interface: the system font (SF Pro) at 13px; 11px for captions and section titles; semibold for
  names in pane headers and the toolbar.
- Terminals: SF Mono 13px, line height 1.15. Taller lines break the box-drawing characters Claude
  Code draws its input and dialogs with.
- Writing: sentence case, short declarative sentences; "Own Term", two words, always.

## Layout

| Part | Size |
| --- | --- |
| Toolbar | 52px, traffic lights at its left, breadcrumb centered on the window |
| Card gap | 8px to the window edges and between cards |
| Card corners | 14px (sidebar, panes, palette); 9px rows; 7px pills |
| Pane header | 44px, shaded 8% in its group's color: group chip (when groups mix), name, branch; status pill and ⋯ on the right |
| Footers | 44px "New Session" in the sidebar; 48px session count and folder under the panes |
| Sidebar | 220–420px, resizable, hidden with ⌃⌘S |

## Components

- **Sidebar top**: the search field, then Needs You and Working as two tiles, as Reminders shows its
  smart lists: an icon in a circle, the count large on the right, the name under them. Working's tile takes the accent wash while its sessions are on screen.
- **Today tile**: a third smart tile under Needs You and Working, across both columns: the date in its
  circle (filled with the accent while something waits on the page), a count of what's waiting, and
  "Today" with the first two of them beside it. Always opens the page, even with nothing waiting.
- **Today page**: a pane-sized card over the panes, laid out like Apple's grouped lists: cards on
  `--card` over the page's `--page` (lifted cards in dark; white on off-white in light). The date in
  gray caps over a 32px large title; Today and Week as a segmented control. Claude's brief and standup
  sit on an accent gradient with a soft glow (it drifts while Claude writes): a 20px headline, then
  numbered focus cards, then "Where things stand" and "Watch out". Below, count tiles as Reminders
  draws its smart lists (a filled circle, rounded numerals), and cards headed by a filled icon square as
  in System Settings (orange needs you, accent reviews, red or green pull requests, purple Linear,
  gray to-dos). Rows are split by hairlines that start at the text; their buttons appear on hover over
  the time they fade, and chips say what a line is about.
- **Session row**: status icon, name on its own line, then "Status · branch" with "+added −removed"
  held whole at the right edge. The focused session is washed 22% in the accent, not filled; the rest
  of a ⌘-pick gets the quiet selection. End Session floats over the right edge on hover, fading out
  the text under it instead of reflowing it.
- **Group row**: disclosure, folder in the group's color, name in semibold, count; on hover a + for a
  new session in the group takes the count's place. Collapsed, it stands in for its sessions: the
  accent wash while one of them has focus, as Finder selects a folded folder, and the quiet selection
  while any is on screen.
- **Status icon** (`StatusIcon.tsx`): spinner while working, orange "!" when it needs input, accent
  dot when it's your turn, an accent alarm clock when a reminder is due, green dot when a shell is
  running a command, otherwise a sparkle for Claude or a terminal for a plain shell.
- **Group chip** in pane headers, when the panes on screen come from more than one group: the group's
  name on an 18% wash of its color, the text mixed 70% toward the label color so every group color
  reads in both appearances. It shortens after the branch and before the title.
- **Later rows** (sidebar, above Groups): an accent alarm clock, the session's name with when at the
  right, in the accent, and the note under them; a check on hover clears the reminder. A session with one waiting carries a
  small clock after its name in its own row.
- **Status pill** in pane headers: the same states in words, tinted with their color.
- **Notification banner** (`Toasts.tsx`): app icon with a status badge, name, branch, two lines of
  Claude's last message; fades after 12 seconds unless hovered or being replied in. A finished turn or
  a due reminder adds a "Reply to Claude" field; a reminder adds Snooze 1 Hour and Open.
- **Menu bar icon**: the mark drawn with a thin line, like the system's own icons, as a template image
  macOS colors for the menu bar. The cursor blinks at a terminal's rate while Claude works; a number
  beside it counts the sessions needing you. Nothing else: no color, no badges.
- **Menu bar panel** (`Panel.tsx`): on the popover material, 360px wide. Sections in the sidebar's
  caption style; rows with the sidebar's status icon, the name, group and time on the right in
  tertiary, and what Claude is doing underneath. A finished turn or a due reminder has a reply field.
- **New session sheet** (⌘T): the folder first, as a card with its name in bold, its parent path and
  branch, and recent folders as chips under it. The options are rows in a rounded box, as in System
  Settings: groups as chips in their colors, and switches rather than checkboxes. The button says
  what it will start ("Start Claude" or "Open Shell").
- **Sheets' fields**: the label above the field, which takes the sheet's full width at 34px tall. Fields,
  chips and buttons sit on `--field` with a hairline edge; a picked chip or choice is an accent wash
  with an accent edge, never a solid fill.
- **Reminder sheet**: a note, then the choices as a grid of tiles, each with the time it comes to, and
  Custom, which opens a date and time field. Changing an existing reminder starts on Custom.
- **Panel toggles** in the toolbar (sidebar, info panel): a window with its panel drawn in, filled
  while the panel shows. Hiding it slides the panel shut behind the window's edge, in step with the
  sidebar's own slide; no accent color.
- **Footer notice**: what just changed, with Undo when it can be undone; stays while pointed at.
- **Palette** (⌘P), **find bar** (⌘F), **new session sheet** (⌘T), **reminder sheet**: raised surfaces with the popover
  shadow. Lists highlight the current row with the accent, like Spotlight.

## Motion

Short and eased like macOS. Everything turns off with Reduce Motion.

| What | Duration | Easing |
| --- | --- | --- |
| Sidebar slides out and back | 260ms | `cubic-bezier(0.32, 0.72, 0, 1)` |
| Group folds in the sidebar | 220ms | same |
| Panes arriving on screen rise into place, 45ms apart | 340ms | `cubic-bezier(0.2, 0.8, 0.2, 1)` |
| One session replacing another settles in from half-seen, never from nothing | 140ms | ease-out |
| A pane whose size changed waits until its terminal has settled (up to 160ms), then fades or rises in | 140ms or 340ms | as above |
| Palette and find bar appear | 160ms | ease-out |
| Info panel switching sessions settles in from half-seen; a card arriving later rises | 140ms; 240ms | ease-out; `cubic-bezier(0.2, 0.8, 0.2, 1)` |
| A folded group's popover opening: grows out of its row from 97%, fading in; closing, back toward it | fade 180ms, grow 260ms; 140ms | `cubic-bezier(0.22, 1, 0.36, 1)`; ease-in |
| A folded group's popover moving to the next group: glides on a spring (`motion`), which keeps its speed when another row takes over mid-move; the lists cross, the new one coming into focus from blurred and 102% over the old one blurring away to 98.5% | spring settles in ~350ms; lists 420ms | stiffness 440, damping 42; `cubic-bezier(0.22, 1, 0.36, 1)` |
| Row highlight | 120ms | ease |

Terminals don't resize during the sidebar slide (`holdFit`); they fit once when it ends.

## Icon

An O that a cursor finishes: a white ring, open at the lower right, completed by an amber cursor
block, on a tile in the app's own night blue. `scripts/icon-art.mjs` draws it; `npm run icon` writes
`build/icon.svg`, `icon.png` and `icon.icns`.

- The cursor sits on the ring at 32° below 3 o'clock. Nearer 3 o'clock the mark reads as the letter
  C; lower down, the upright cursor needs a wider gap and the ring starts to read as a spinner.
- The ring opens only far enough to clear the cursor by a third of its stroke on each side.
- The tile follows Apple's 1024px grid: an 824px tile with 185px corners and the standard shadow, so
  it sits at the same size as other icons in the Dock.
- At 32px and below the ring thickens and the cursor grows, and the glow is dropped.
