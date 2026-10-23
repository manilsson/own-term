# Projects in the Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Choosing a project (in a new sidebar switcher or on the Today page's tabs) narrows the sidebar
to that project's groups and sessions, while everything that needs you stays global.

**Architecture:** Placement stays in one function, `resolveProjects` in `src/projects.ts`, extended with a
remembered `project` on groups and sessions and a `group(id)` lookup. A hook stamps and refreshes the
remembered field, the sidebar filters through one `useSidebarScope()`, and `show()` in `workspace.ts`
switches the chosen project when it shows something outside it.

**Tech Stack:** Electron, React, TypeScript, dockview, Vite. No unit-test runner: checks run in the
live dev window through `scripts/cdp.mjs` (`docs/development.md` → "Driving the app").

**Spec:** `docs/superpowers/specs/2026-10-23-sidebar-projects-design.md`

## Global Constraints

- One stored choice: `localStorage['deckterm.project']` via `chooseProject` / `chosenIn` in `projects.ts`.
- The switcher shows only with two or more projects (`projects.list.length > 1`), never on the demo day.
- Needs You, Working, ⌘J, notifications, Dock badge, menu bar and Search are never filtered.
- Colors only from tokens in `src/styles.css`, defined for light and dark.
- Comments say why, two lines or fewer; match the surrounding style (see `projects.ts`).
- Product name in user-facing text: "Own Term". Menu copy: "All Projects", "Project 1"…"Project 9",
  "Name Projects…".
- Shortcuts: ⌃0 All Projects, ⌃1…⌃9 the projects in `projects.list` order.
- Test data is invented (e.g. repos `acme/api`, `acme/web`, `kite/app`; groups "Billing", "Docs").
- Commit only when the user asks (CLAUDE.md): tasks end at a checkpoint, not a commit.
- Anything created in the user's real app while checking is reported and only removed when they say so.
- `npm run typecheck` passes at the end of every task.

## Review Focus

1. Reloading the window: before main has answered which repository each folder is in, nothing is placed,
   so the filtered list can show everything and then snap shut. Expected: no visible reshuffle (Task 3
   holds the filtered list until every session folder's repository is known).
2. The chosen project is renamed or vanishes in Settings → Projects. Expected: the app falls back to All
   (`chosenIn` already does) and nothing stays hidden (Task 1 check 5).
3. A session or group needing you sits in a hidden project while you drag sessions between visible
   groups. Expected: dropping keeps the hidden ones' order untouched (Task 3 check 4).
4. ⌃1…⌃9 pressed inside a terminal. Expected: the native accelerator takes it, the shell gets nothing
   (Task 4 check 3).
5. A pick (⌘-click) spanning two projects, or `show_sessions` with sessions from two. Expected: the
   choice switches to All rather than hiding half the panes' rows (Task 4 check 2).

---

### Task 1: Placement — remembered project and groups

**Files:**
- Modify: `src/store.ts` (`Group`, `Session` interfaces)
- Modify: `src/projects.ts` (`Projects`, `resolveProjects`, new exports)

**Interfaces:**
- Produces:
  - `Group.project?: string`, `Session.project?: string` (doc comment: "The project it was made in or last
    placed in; only a fallback for when its repository, or its group's, doesn't say.")
  - `Projects.group(id: string): string[]` — the projects a group is in; `[]` means shown everywhere.
  - `Projects.session(id)` — now: repository → its group's repositories when one project → the session's
    own `project` → its group's `project`. A remembered name counts only if it's in `list`.
  - The chosen project outside React stays `selectedProject()`; no new getter.
  - `useSidebarScope(): { project?: ProjectDef; projects: Projects; session(x: Session): boolean; group(g: Group): boolean; ready: boolean }`
    — `session` is true when no project is chosen, when the session's project is the chosen one, or when it
    has none; `group` likewise with `projects.group(g.id)` (`[]` → true). `ready` is false while any
    non-demo session's `cwd` is missing from `useRepos()`.

- [ ] **Step 1: Write the checks** (run in the dev window; `own` as in `docs/development.md`)

```js
const p = await own('projects')
const S = (id, cwd, groupId, extra = {}) => ({ id, name: id, cwd, groupId, runClaude: true, ...extra })
const state = {
  groups: [{ id: 'g1', name: 'Billing', collapsed: false, color: 0 }, { id: 'g2', name: 'Docs', collapsed: false, color: 1, project: 'Kite' }, { id: 'g3', name: 'Empty', collapsed: false, color: 2 }],
  sessions: [S('a', '/x/api', 'g1'), S('b', '/x/web', 'g1'), S('c', '/x/notes', 'g2'), S('d', '/x/kite', null), S('e', '/tmp', null, { project: 'Acme' }), S('f', '/tmp', null)],
}
const repoAt = { '/x/api': 'acme/api', '/x/web': 'acme/web', '/x/notes': null, '/x/kite': 'kite/app', '/tmp': null }
const r = p.resolveProjects(state, repoAt, { 'acme/api': 'Acme', 'acme/web': 'Acme', 'kite/app': 'Kite' }, null, null)
;[
  JSON.stringify(r.group('g1')) === '["Acme"]',          // 1 placed by its sessions
  JSON.stringify(r.group('g2')) === '["Kite"]',          // 2 no repo: its remembered project
  JSON.stringify(r.group('g3')) === '[]',                // 3 empty, nothing remembered: everywhere
  r.session('c') === 'Kite' && r.session('e') === 'Acme' && r.session('f') === undefined, // 4 fallbacks
  JSON.stringify(p.resolveProjects({ ...state, groups: state.groups.map(g => ({ ...g, project: g.id === 'g2' ? 'Gone' : g.project })) }, repoAt, { 'acme/api': 'Acme', 'acme/web': 'Acme', 'kite/app': 'Kite' }, null, null).group('g2')) === '[]', // 5 unknown name places nothing
]
```

Expected now: fails (`r.group is not a function`).

- [ ] **Step 2: Add the fields and extend `resolveProjects`**; `none` gets `group: () => []`. Groups with
  sessions from two projects return both names, in `list` order.

- [ ] **Step 3: Add `useSidebarScope()`** next to `useScope`, built from `useProjects`, `useChosen` and
  `useRepos`.

- [ ] **Step 4: Run the checks** — all five `true`; `npm run typecheck` passes; the Today page's tabs
  look as before (screenshot).

- [ ] **Step 5: Checkpoint** — no commit (commit only when asked).

---

### Task 2: Remembering projects

**Files:**
- Modify: `src/projects.ts` (new hook)
- Modify: `src/App.tsx` (call it once)

**Interfaces:**
- Consumes: `useProjects`, `selectedProject`, `updateGroup`, `updateSession`.
- Produces: `useRememberProjects(): void`, called once in `App`.
  - Ids present at its first run are "seen"; a group or session first seen later, without `project`, gets
    `selectedProject()?.name` (skipped when none is chosen). One hook covers every creation site (sheet,
    Welcome, tools, Save as Group, auto-grouping, menus).
  - For each group whose sessions all resolve (`projects.session`) to exactly one project that differs
    from `g.project`, `updateGroup(g.id, { project })`. Never clears it.
  - Does nothing on the demo day (`projects.list` empty).

- [ ] **Step 1: Write the checks**

```js
const store = await own('store'), p = await own('projects')
p.chooseProject(p.currentProjects().list[0].name)
const id = store.addGroup()
await new Promise(r => setTimeout(r, 50))
store.getState().groups.find(g => g.id === id).project === p.currentProjects().list[0].name // → true
```

Then, with All chosen, check a group whose sessions are in one repository gets that project:
`store.getState().groups.filter(g => !g.project).length` drops to the count of groups with no repository
sessions. Expected now: `undefined` / unchanged.

- [ ] **Step 2: Implement the hook** with a `useEffect` on `[groups, sessions, projects]` and a `useRef`
  holding the seen ids.

- [ ] **Step 3: Run the checks** — `true`; then remove the test group (`removeGroup(id)`), which the
  check itself made, and say so.

- [ ] **Step 4: Checkpoint** — typecheck; no commit.

---

### Task 3: The switcher and the filtered sidebar

**Files:**
- Create: `src/ProjectSwitcher.tsx`
- Modify: `src/Sidebar.tsx` (filter groups, ungrouped sessions, ungrouped monitors stay; render switcher)
- Modify: `src/store.ts` (`toggleAllGroups(ids?: string[])`)
- Modify: `src/SettingsSheet.tsx` (`section?: 'projects'` prop scrolls `#settings-projects` into view)
- Modify: `src/App.tsx` (pass `onNameProjects` to `Sidebar`, open Settings with `section: 'projects'`)
- Modify: `src/styles.css` (`.project-switcher` row)

**Interfaces:**
- Consumes: `useSidebarScope`, `chooseProject`, `useProjects`, `window.deck.popupMenu`.
- Produces: `ProjectSwitcher({ onNameProjects }: { onNameProjects: () => void })`; `Sidebar` gains prop
  `onNameProjects: () => void`.
  - Row: `{project?.name ?? 'All Projects'}` + `ChevronDown` (lucide, 12px) + `.waiting-dot` when a
    session in a project other than the chosen one has `needsSince` (computed with `projects.session`).
  - Menu items: `{ id: '', label: 'All Projects', checked }`, separator, each project
    `{ id: name, label: name + (waiting ? '  •' : ''), checked }`, separator,
    `{ id: 'name-projects', label: 'Name Projects…' }`. Read the `MenuItem` type in `src/global.d.ts` for
    the exact separator shape.
  - Renders `null` unless `projects.list.length > 1`.
- Sidebar: groups filtered by `scope.group`, ungrouped sessions by `scope.session`; while `!scope.ready`
  and a project is chosen, the Groups and Sessions sections render nothing (Review Focus 1). Collapse/
  Expand All passes the visible group ids, and `anyOpen` looks at those only. Search, tiles and Monitors
  unchanged.

- [ ] **Step 1: Write the checks**

```js
const p = await own('projects'), names = p.currentProjects().list.map(x => x.name)
p.chooseProject(names[0])
await new Promise(r => setTimeout(r, 100))
const shown = [...document.querySelectorAll('.group-row .row-title, .group-row input')].map(e => e.value ?? e.textContent)
// 1: every shown group is in names[0] or everywhere; compare against currentProjects().group(...)
// 2: document.querySelector('.project-switcher').textContent includes names[0]
// 3: p.chooseProject(''); the group count equals getState().groups.length
```

4: With a project chosen, drag a session onto another visible group (or call `moveSession` as a drop
does) and check the hidden groups' sessions keep their relative order in `getState().sessions`.
Expected now: no `.project-switcher`; all groups shown.

- [ ] **Step 2: Build `ProjectSwitcher`**, styled after `.search-field` row height; text color
  `--text-secondary`-style tokens that exist in `styles.css` (look them up; don't invent).
- [ ] **Step 3: Filter `Sidebar`** as in Interfaces; extend `toggleAllGroups`.
- [ ] **Step 4: "Name Projects…"**: `id="settings-projects"` on the Projects `<section>`/heading and
  `scrollIntoView({ block: 'start' })` on mount when `section === 'projects'`.
- [ ] **Step 5: Run the checks** and drive it: click the switcher (the native menu can't be clicked by
  cdp; call `chooseProject` for the filter and press the row once through `osascript` to see the menu),
  pick on the Today tabs and see the sidebar follow. Screenshots in light and dark
  (View → Appearance). Reload the window with a project chosen and watch for a reshuffle.
- [ ] **Step 6: Checkpoint** — typecheck; no commit.

---

### Task 4: Following what's shown, and ⌃0…⌃9

**Files:**
- Modify: `src/projects.ts` (`followView`)
- Modify: `src/workspace.ts` (`show`)
- Modify: `electron/main.cjs` (`buildMenu`, View menu)
- Modify: `src/App.tsx` (menu action `project`)
- Modify: `src/App.tsx` palette list near line 371 if View items are mirrored there (they are listed as
  `[label, action, shortcut]`; add "All Projects" only).

**Interfaces:**
- Produces: `followView(ids: string[]): void` in `projects.ts` — for the session ids among `ids` (pane ids
  of monitors are skipped), when a project is chosen and any of them isn't shown in it (same rule as
  `useSidebarScope().session`, outside React via `currentProjects()`), choose the one project they all
  share, or `''` when they span several.
- `show(view)` calls `followView(ids)` after computing `ids`, before laying out.
- Main menu, View, after "Today": separator, `{ label: 'All Projects', accelerator: 'Ctrl+0', click: menu('project', -1) }`,
  then `Project 1…9` with `Ctrl+1…9` sending `menu('project', i)`. App: `-1` → `chooseProject('')`,
  otherwise `currentProjects().list[i]` when it exists.

- [ ] **Step 1: Write the checks**

```js
const p = await own('projects'), w = await own('workspace'), s = (await own('store')).getState()
const list = p.currentProjects().list, other = s.sessions.find(x => p.currentProjects().session(x.id) === list[1].name)
p.chooseProject(list[0].name); w.openSession(other.id)
p.selectedProject()?.name === list[1].name                                       // 1 → true
```

2: `w.show({ kind: 'pick', ids: [sessionOfList0, sessionOfList1] })` → `p.selectedProject() === undefined`.
3: Bring the app forward, focus a terminal, `osascript … keystroke "2" using control down` → the chosen
project is `list[1]`, and `terms` shows no new input in that terminal.
4: ⌘J with a waiting session in another project switches to it (if none waits, skip and say so).
Expected now: 1 false.

- [ ] **Step 2: Implement `followView`** and the call in `show`.
- [ ] **Step 3: Add the menu items and the App action.** Restart `npm run dev` for main's change.
- [ ] **Step 4: Run the checks.**
- [ ] **Step 5: Checkpoint** — typecheck; no commit.

---

### Task 5: Making things in the chosen project

**Files:**
- Modify: `src/projects.ts` (`projectFolder`)
- Modify: `src/NewSessionSheet.tsx` (default folder)
- Modify: `src/grouping.ts` (`describe`)

**Interfaces:**
- Produces: `projectFolder(): string | undefined` — the `cwd` of the last session in `getState().sessions`
  (creation order) that the chosen project holds (`currentProjects().session(id) === name`); undefined
  when no project is chosen or it holds none.
- `NewSessionSheet`: `useState(initialCwd ?? projectFolder() ?? lastCwd)`.
- `describe` in `grouping.ts` lists only groups whose `currentProjects().group(id)` is `[]` or includes
  the new session's project (`currentProjects().session(session.id)`); with no project for the session,
  all groups as now.

- [ ] **Step 1: Write the checks** — with a project chosen, `(await own('projects')).projectFolder()`
  equals the cwd of the last session of that project; open the sheet (⌘T through `osascript`) and read
  its folder field from the DOM; Escape closes it without creating anything.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run the checks;** for `describe` (not exported), read the change against the check's
  intent — Claude's call is not worth spending to test.
- [ ] **Step 4: Checkpoint** — typecheck; no commit.

---

### Task 6: Claude's tools and the docs

**Files:**
- Modify: `src/tools.ts` (`listSessions`, `create_group`, `newSession`)
- Modify: `electron/tools.cjs` (schemas, descriptions, server instructions lines 20–36)
- Modify: `docs/architecture.md` (Projects paragraph ~line 475, file table line 41, tools table)

**Interfaces:**
- `list_sessions`: each group gets `projects: string[]` (`[]` → shown in every project; a list rather
  than the spec's single name because a mixed group is in several); each session `project: string | null`.
- `create_group` and `new_session` accept `project?: string`, which must be a name in
  `currentProjects().list` (otherwise `ToolError('No project “X”; list_projects shows them.')`); sets the
  new item's `project`. Without it, Task 2's hook applies the chosen one.
- Descriptions: the sidebar shows one project at a time (or All); `show_sessions` and `new_session`
  switch to the project of what they show.

- [ ] **Step 1: Write the checks** — after a dev restart, from a Claude session in Own Term call
  `list_sessions` and see `project` fields; call `create_group` with `project: "<an existing name>"` and
  an unknown name (expect the error). Report the created group and ask before deleting it.
- [ ] **Step 2: Implement** and update the docs.
- [ ] **Step 3: Run the checks.**
- [ ] **Step 4: Checkpoint** — typecheck; no commit.

---

### Task 7: The whole thing, driven

- [ ] Run the spec's "Checking it" list, 1–7, in the dev app, light and dark, with screenshots.
- [ ] `npm run typecheck`.
- [ ] Report what was left behind in the real app (groups, sessions, the chosen project) and ask before
  removing it. Ask whether to commit.

---

## Revision: project rail (spec "Revision, 2026-10-23")

Task 3's `ProjectSwitcher` menu button is replaced. Order from here: Task 4 rest (⌃0…⌃9), Task 8, Task 9,
then Tasks 5, 6 (plus `update_project`), 7.

### Task 8: Project looks and favicons

**Files:** `electron/status.cjs` (DEFAULTS, publicSettings, save validation, `status:favicons` handler),
`electron/preload.cjs`, `src/global.d.ts` (`StatusSettings.projectLooks`, `deck.projectFavicons`),
`src/projects.ts` (`useProjectLook`, `projectColor`, `useFavicons`).

**Interfaces:**
- `StatusSettings.projectLooks: Record<string, { color?: number; icon?: string }>`; saved through
  `saveStatusSettings({ projectLooks })`, validated in main: color an integer index into the 11 group
  colors, icon a string ≤ 40 chars, names ≤ 40 chars, at most 200.
- `window.deck.projectFavicons(repos: string[]): Promise<Record<string, string | null>>` — repo → data URL.
  Main finds the clone among known folders the way Review with Claude does.
- `projectLook(name, index, looks, favicons): { color: string; icon: { kind: 'lucide'; name: string } | { kind: 'favicon'; url: string } | { kind: 'initials'; text: string } }`
  — default color `GROUP_COLORS[index % 11]`; initials: first letters of the first two words, else the
  first two letters.

- [ ] Check (cdp): `window.deck.projectFavicons(['manilsson/own-term'])` returns a data URL; saving
  `projectLooks: { X: { color: 99 } }` drops the color; `projectLook` returns initials "GW" for
  "Garba Website", "OT" for "Own Term", "CI" for "Cinero".
- [ ] Implement; checks pass; typecheck.

### Task 9: The rail, the title and the icon picker

**Files:** delete `src/ProjectSwitcher.tsx`; create `src/ProjectRail.tsx` (`ProjectRail`, `ProjectTitle`,
`projectMenu`), `src/IconPicker.tsx`; modify `src/App.tsx` (rail left of the sidebar), `src/Sidebar.tsx`
(title instead of switcher), `src/styles.css`.

- [ ] Check (cdp): `.project-rail .project-tile` count = projects + 1; clicking a tile chooses it and the
  title reads its name; the badge of a project equals its sessions in `needsSince`; hiding the sidebar
  hides the rail; no rail with fewer than two projects.
- [ ] Implement; screenshots light and dark; menus through osascript; typecheck.
