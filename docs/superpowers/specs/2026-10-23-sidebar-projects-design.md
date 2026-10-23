# Projects in the sidebar

Date: 2026-10-23. Status: design approved in conversation; spec awaiting review.

## Why

Own Term already knows projects: names given to repositories (`src/projects.ts`), used only by the
Today page's tabs. The sidebar is one flat list of groups, and one project (Garba, seven groups) fills
most of it. Choosing a project should narrow the sidebar to that project's work, the same way it
narrows the Today page, without hiding anything that needs you.

## Decisions (made with the user)

1. **A switcher that filters**, not project headings: one project at a time, or All.
2. **One shared choice** for the sidebar and the Today page: `localStorage['deckterm.project']`, which
   the Today tabs already use. Picking on either changes both.
3. **What needs you stays global**: Needs You, Working, ⌘J, notifications and the Dock badge count every
   project. The switcher shows a dot for other projects with a session that needs you, and going to a
   session in another project switches to it.
4. **A group's project comes from its sessions**, with a remembered fallback for groups whose sessions
   don't say (empty, or outside any repository).
5. **The switcher is a menu button** at the top of the sidebar, not a tab strip.

## The switcher

- A row above Search: the project's name (or "All Projects") and a chevron. It opens a native menu
  (`window.deck.popupMenu`): All Projects, a separator, every project in `projects.list` order with a
  check on the chosen one and a dot (•) after a name when a session there needs you, a separator, and
  "Name Projects…", which opens Settings at Projects.
- While another project than the one shown has a session that needs you, the button carries the same
  waiting dot the folded group row uses (`.waiting-dot`).
- ⌃1…⌃9 choose the projects in order and ⌃0 All, as menu items in the View menu (so they show their
  shortcuts and work wherever focus is). Beyond nine projects, the menu is the way.
- Shown only when there are two or more projects, the Today tabs' rule (`chosenIn`); with fewer, or on
  the demo day, the sidebar is as it is today and the stored choice is ignored.
- The Today page's tabs stay; they and the switcher read and write the one choice.
- Colors from tokens in `src/styles.css`, both appearances.

## What is shown when a project is chosen

Placement extends `resolveProjects` so the sidebar and the Today page can't disagree:

- **Sessions**: `projects.session(id)` as now (folder's repository, or else the rest of its group). A
  session that this doesn't place uses its remembered `project` (below). A session in no project
  either way is shown in every project, so nothing disappears.
- **Groups**: a group is in each project any of its sessions is in, and is shown whole, layout and all,
  in each. A group whose sessions place it nowhere (empty, or none in a repository) uses its remembered
  `project`; with none, it's shown in every project.
- **Monitors**: in a group, with the group. Outside any group, shown in every project.
- **Order**: the existing order, filtered. Dragging sessions and groups works as now; a group dropped
  between two visible groups keeps its place relative to them.
- **Unchanged**: Search searches every session in every project. The smart tiles, ⌘J, notifications,
  the Dock badge and the menu bar count everything.
- **Collapse All / Expand All** acts on the visible groups only.

### Remembered project

New optional fields, saved with the rest of the state:

```ts
interface Group   { /* … */ project?: string }
interface Session { /* … */ project?: string }
```

- Set to the chosen project when the group or session is made while one is chosen (New Group, Save as
  Group, the new-session sheet, Welcome, `create_group`, `new_session`).
- On a group, updated to the project its sessions place it in whenever that is exactly one project, so a
  group emptied later stays where it was.
- Only a fallback: a session in a repository, or a group whose sessions say, is placed by that.
- A remembered name that no longer names a project (renamed in Settings) places nothing, so the item
  shows everywhere until its sessions place it again.

`resolveProjects` gains `group(id): string[]` (the projects a group is in; `[]` = everywhere) and
`session` takes the remembered field into account. The projects with a session that needs you are
computed in the sidebar from `needsSince` with `projects.session`.

## Going somewhere in another project

`openSession` and the group/pick views switch the chosen project (`chooseProject`) when what they show
isn't visible in the chosen one. That covers ⌘J (`nextNeedsYou`), a notification or toast, a search
result, the menu bar, the Working tile, `show_sessions` and a session Claude starts with `new_session`.
A pick spanning several projects switches to All. Switching never happens just because a session's
state changes.

## Making things while a project is chosen

- **⌘T / New Session** opens the sheet in the folder of the newest session in the chosen project (the
  last one in `sessions` that the project holds); with none, `lastCwd` as now.
- **New Group** and the other creators set the remembered `project` (above).
- **Auto-grouping** (`grouping.ts`, `describe`) offers Claude only groups in the session's project, plus
  groups shown everywhere, so a Garba session isn't filed with Cineora's.

## Claude's tools

- `list_sessions`: each group and session gets `project` (its name, or null when it's shown
  everywhere).
- `create_group` and `new_session` take an optional `project`, defaulting to the chosen one.
- Descriptions in `electron/tools.cjs` say that the sidebar shows one project at a time and that
  showing a session switches to its project.

## Docs

`docs/architecture.md`: the Projects paragraph gains the sidebar, the remembered fields and switching
on navigation; the file table's `projects.ts` line covers the sidebar too.

## Not in scope

Project headings in the sidebar; per-project group colors or icons; a project's own window layout;
hiding notifications of other projects.

## Checking it

Driven with `scripts/cdp.mjs` in the running app, screenshots in both appearances:

1. Choose Garba: only Garba's seven groups, and the session in no project, are listed; the Today page
   shows Garba's tab.
2. Choose Cinero on the Today page: the sidebar follows.
3. A session in another project needs you: the button and its menu line show the dot; ⌘J goes there
   and the sidebar switches.
4. Search for a Cinero session while Garba is chosen: it's found; opening it switches to Cinero.
5. New Group while Garba is chosen, then All, then Garba: the empty group is under Garba only.
6. ⌘T while Cinero is chosen: the sheet's folder is Cinero's repository.
7. ⌃0…⌃n switch; with one project, no switcher.

Anything made while testing (a group, a session) lives in the user's real app: say what was left and
ask before removing it. `npm run typecheck` before done.

## Revision, 2026-10-23: a project rail instead of the menu button

Approved in conversation after the first build of the switcher. Replaces "The switcher" above; placement,
remembering, following and creation are unchanged.

- **Rail**: a column left of the sidebar card, shown with the sidebar (hidden with it, ⌃⌘S) and only
  with two or more projects. An All tile first, then a tile per project in `projects.list` order. The
  chosen tile has a ring; hovering shows the name; an orange badge counts the project's sessions that
  need you. A gear at the bottom opens Settings → Projects. ⌃0…⌃9 follow the rail's order.
- **Sidebar title**: the chosen project's name (or All Projects) with ▾, above Search. Its menu, and a
  tile's context menu: Color ▸ (the group palette), Icon ▸ (Favicon when one was found, Initials,
  Choose Icon…), Name Projects….
- **A tile shows**, first that applies: the icon chosen from the session icon set (`sessionIcons.ts`), in
  the project's color; the repository's favicon; the project's initials on its color. A project
  defaults to the favicon when it has one.
- **Favicon**: main runs `git ls-files` in a clone of each of the project's repositories and picks
  `favicon.*`, `apple-touch-icon*.png` or `app/icon.*` (svg, png or ico), preferring svg, then the
  largest file; returned as a data URL (≤ 256 KB), cached per repository for the app's run.
- **Choose Icon…**: a popover beside the tile with a search field and a grid of the session icons.
- **Stored** in the status settings as `projectLooks: { [project name]: { color?: number; icon?: string } }`,
  `icon` a session icon name, `'favicon'` or `'initials'`. Renaming a project leaves its look behind.
- **Claude's tools**: `update_project` (`project`, `color` as the group colors' names, `icon`: a session
  icon name, `favicon`, `initials`, or null for the default), undone as one. `list_projects` adds each
  project's color, icon and whether it has a favicon.

**Later change:** the shortcuts are ⌃⌘0…⌃⌘9, like ⌃⌘T and ⌃⌘S: ⌃ with a digit is a control character in a terminal (⌃3 is Escape).
