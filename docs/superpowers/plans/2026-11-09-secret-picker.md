# Secret Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude in an Own Term session can ask for a token; the user picks one from an encrypted store in a picker on the pane, and Claude gets only a file path to use it from.

**Architecture:** The main process owns the store (`electron/secrets.cjs`, `safeStorage`-sealed) and the per-session grant files. The `own-term` MCP tool `request_secret` is intercepted in `electron/tools.cjs`: it asks the window for a *name* (the picker), then main writes the grant and replies with the path. Values only flow window → main (when the user pastes one); nothing sends a value or the list of names to Claude.

**Tech Stack:** Electron (`safeStorage`, `ipcMain`), Node `fs` and `node:test`, React in the renderer, `scripts/cdp.mjs` for driving.

**Spec:** `docs/superpowers/specs/2026-11-09-secret-picker-design.md`

## Global Constraints

- Names: `/^[A-Za-z0-9_-]{1,64}$/`, unique case-insensitively.
- Store file: `<userData>/secrets.json`, mode 0600, shape `{ [name]: { sealed: base64, createdAt: ms, updatedAt: ms } }`.
- Grants: `<userData>/session-secrets/<session id>/<name>`, folders 0700, files 0600, value written with no trailing newline.
- Granted result text, exactly: `Granted "<name>" for this session at <path>. Use it as $(cat <path>) inside a command. Never print it.`
- Every non-grant outcome returns exactly: `The user declined.`
- Picker waits 300 s; main waits 310 s for the window (`answerWithin`).
- If `safeStorage.isEncryptionAvailable()` is false, saving is refused with: `Your Mac's Keychain isn't available, so Own Term can't store tokens.`
- Colors from `src/styles.css` tokens only. Product name "Own Term" in user-facing text. Comments: why, ≤ 2 lines.
- Test content uses invented names and values (`demo-api-key`, `sk_test_0000`), never real ones.
- Don't commit unless the user asks (CLAUDE.md overrides the commit steps below: stage nothing, just note the step done).

## Review Focus

1. **A value leaking into Claude's channel**: any path where a value reaches `handleMcp`'s reply, `tools:result` or a log. Expected: never. Pinned in Task 2's test (result text never contains the value).
2. **Second request while the picker is open** for the same session. Expected: refused at once with `A request is already open in this session.`, the first picker unaffected. Pinned in Task 2.
3. **Session closed (or Undo-reopened) while the picker is open.** Expected: `The user declined.`, picker gone; a reopened session holds no grants. Pinned in Task 3 (drive step).
4. **Name collisions on Paste new**: `Demo-Key` when `demo-key` exists. Expected: the picker's error `A token called “demo-key” already exists.`, nothing overwritten. Pinned in Task 1.
5. **Corrupt or unreadable `secrets.json`, or a decrypt failure** (Keychain changed). Expected: `list()` returns what it can; `grant` of an unreadable one throws `That token can't be read; replace it in Settings.`, surfaced as `The user declined.` to Claude and as an error in the picker. Pinned in Task 1.

---

### Task 1: The store and grants (`electron/secrets.cjs`)

**Files:**
- Create: `electron/secrets.cjs`
- Create: `electron/secrets.test.cjs`

**Interfaces:**
- Produces: `createSecrets({ dir: string, seal: { available(): boolean, encrypt(s: string): Buffer, decrypt(b: Buffer): string } })` returning:
  - `list(): { name, createdAt, updatedAt, holders: string[] }[]` (holders = session ids with a grant file)
  - `add(name, value): void`, `replace(name, value): void` (also rewrites existing grant files), `rename(from, to): void` (renames grant files), `remove(name): void` (deletes grant files)
  - `grant(sessionId, name): string` (absolute path), `revoke(sessionId, name): void`, `endSession(sessionId): void`, `clearGrants(): void`
  - Errors are `Error` with user-facing messages (constraints above, plus `No token called “<name>”.`, `Names use letters, digits, - and _ (up to 64).`, `A token called “<existing>” already exists.`).
- `sessionId` must match `/^[\w-]{1,64}$/` or `grant` throws (it becomes a folder name).

- [ ] **Step 1: Write the failing tests** in `electron/secrets.test.cjs` with `node:test`, a temp dir per test (`fs.mkdtempSync`), and a fake seal (`encrypt: s => Buffer.from([...s].reverse().join(''))`, its inverse, `available: () => true`):
  - `add then list shows name and no value`: `JSON.stringify(list())` does not contain `sk_test_0000`; `secrets.json` on disk does not contain it either; file mode `0o600`.
  - `names are validated and unique case-insensitively`: `add('a b', …)` and `add('Demo-Key', …)` after `add('demo-key', …)` throw the messages above.
  - `grant writes 0600 file in 0700 folder with exact value`: `fs.readFileSync(path, 'utf8') === 'sk_test_0000'`, modes checked, path is under `<dir>/session-secrets/s1/`.
  - `grant rejects a bad session id` (`'../x'`).
  - `replace rewrites granted files`, `rename moves granted files`, `remove deletes granted files`, `list().holders` reflects grants.
  - `revoke, endSession and clearGrants delete files`.
  - `unavailable keychain refuses add` (seal.available false).
  - `corrupt store`: write `{` to `secrets.json` → `list()` returns `[]`; a decrypt that throws → `grant` throws `That token can't be read; replace it in Settings.`

- [ ] **Step 2: Run, expect failure:** `node --test electron/secrets.test.cjs` → fails with `Cannot find module './secrets.cjs'`.

- [ ] **Step 3: Implement `createSecrets`** in `electron/secrets.cjs`. Read `secrets.json` on each call (small file, no cache to go stale); write it atomically (`writeFileSync` to `.tmp` with mode 0600, then `renameSync`). Grant files written with `{ mode: 0o600 }` after `mkdirSync(…, { recursive: true, mode: 0o700 })`. No Electron import: main passes `safeStorage` in as the seal.

- [ ] **Step 4: Run, expect pass:** `node --test electron/secrets.test.cjs` → all pass.

- [ ] **Step 5: Commit step** (only if the user asked): `Add an encrypted token store with per-session grants`.

---

### Task 2: `request_secret` in the MCP server and main

**Files:**
- Modify: `electron/tools.cjs` (tool definition in `TOOLS`, an intercept in `handleMcp`, `answerWithin`, `INSTRUCTIONS`)
- Modify: `electron/main.cjs` (create the store, pass it to `handleMcp`, IPC, session end, launch/quit wipe)
- Modify: `electron/preload.cjs`, `src/global.d.ts` (`window.deck.secrets`)
- Create: `electron/tools.test.cjs`

**Interfaces:**
- Consumes: Task 1's `createSecrets`.
- Produces:
  - `handleMcp(sessionId, message, ask, findTranscript, secrets)`: new last parameter.
  - Window contract: `ask(sessionId, 'request_secret', { why })` resolves `{ picked?: string }` (name only).
  - `window.deck.secrets`: `list(): Promise<SecretEntry[]>`, `add(name, value)`, `replace(name, value)`, `rename(from, to)`, `remove(name)`, `revoke(sessionId, name)`, each `Promise<{ error?: string }>` (list returns the array). `SecretEntry = { name: string; createdAt: number; updatedAt: number; holders: string[] }` in `global.d.ts`.
  - IPC channels `secrets:list|add|replace|rename|remove|revoke` (`ipcMain.handle`).

- [ ] **Step 1: Write failing tests** in `electron/tools.test.cjs` calling `handleMcp` with a fake `ask` and a Task 1 store in a temp dir (fake seal). `require('./tools.cjs')` pulls in `./mcp.cjs`; if that needs Electron, stub `browserMcpInstalled` via `require.cache` before requiring.
  - `tools/list includes request_secret with only a why argument` (`inputSchema.properties` keys equal `['why']`, required `['why']`).
  - `granted`: fake ask returns `{ picked: 'demo-api-key' }` → text equals the exact granted string with the real path; text does not contain the value; file exists.
  - `declined`: ask returns `{}`, ask rejects, or picks an unknown/unreadable name → text `The user declined.` each time, `isError` false.
  - `today is refused`: sessionId `today` → `request_secret needs a session; the Today page has none.`, ask never called.
  - `one at a time`: two concurrent calls for `s1` (first ask held open) → second returns `A request is already open in this session.`; a call for `s2` still reaches ask.
  - `answerWithin('request_secret') === 310000`.

- [ ] **Step 2: Run, expect failure:** `node --test electron/tools.test.cjs` → request_secret missing.

- [ ] **Step 3: Implement in `electron/tools.cjs`**:
  - Tool: `name: 'request_secret'`, `why` described as "What the token is for, in a sentence the user reads before choosing.", description: "Asks the user for a token or key this task needs. They pick which one in Own Term, or decline; you can't choose or list them. Returns a file path holding it: use it only as $(cat <path>) inside a command, and never print, echo, log or copy it anywhere else. Ask only when the task needs a credential."
  - Append to `INSTRUCTIONS` one sentence: "When a task needs a token or key, ask for it with request_secret instead of asking the user to paste it."
  - In `handleMcp`, before the generic `ask`, handle `request_secret`: refuse `TODAY`; keep a module `Set` of open session ids; `ask` → if `picked` is a string, `secrets.grant(sessionId, picked)` in a try; any failure → declined. `why` trimmed and cut to 300 characters.
  - `answerWithin`: `request_secret` → `310000`.

- [ ] **Step 4: Implement in `electron/main.cjs`**: `const secrets = createSecrets({ dir: app.getPath('userData'), seal: { available: () => safeStorage.isEncryptionAvailable(), encrypt: s => safeStorage.encryptString(s), decrypt: b => safeStorage.decryptString(b) } })`; pass it as `handleMcp`'s last argument; `secrets.clearGrants()` in `whenReady` before shells start and in `will-quit` (on its final pass); `secrets.endSession(id)` in the `pty:kill` handler; six `ipcMain.handle('secrets:…')` wrapping calls in try/catch → `{ error: e.message }`. `secrets:list` returns `secrets.list()`. Expose them in `preload.cjs` and type them in `global.d.ts`.

- [ ] **Step 5: Run, expect pass:** `node --test electron/*.test.cjs` and `npm run typecheck`.

- [ ] **Step 6: Commit step** (only if asked): `Let Claude request a token through own-term`.

---

### Task 3: The picker on the pane

**Files:**
- Create: `src/secrets.ts` (open requests, per session)
- Create: `src/SecretPicker.tsx`
- Modify: `src/tools.ts` (`case 'request_secret'`), `src/App.tsx` (render in `pane-frame`), `src/styles.css` (`.secret-picker` styles from existing tokens and `.sheet` patterns)

**Interfaces:**
- Consumes: `window.deck.secrets` (Task 2); `needsYou`, `setStatus`, `subscribe`, `getState` from `./claude` and `./store`.
- Produces:
  - `requestSecret(sessionId: string, why: string): Promise<{ picked?: string }>`: shows the picker, calls `needsYou(sessionId, 'input', \`Claude asks for a token: ${why}\`)`, resolves `{}` after 300 s, or when the session leaves `getState().sessions`; on any outcome, if the status is still `input`, `setStatus(sessionId, 'working')` (Claude is mid-turn, waiting on the tool).
  - `useSecretRequest(sessionId): { why: string } | undefined`, `answerSecret(sessionId, picked?: string)`.
  - `run()` in `tools.ts` returns the `{ picked }` object for this tool as-is (cast at the call site; `ToolResult` stays for the others).

- [ ] **Step 1: Implement `src/secrets.ts`** with a `Map` and listeners, read by `useSyncExternalStore`.

- [ ] **Step 2: Implement `SecretPicker`** (`{ id }`): over the pane like `FindBar`/the floating browser. Header "Claude asks for a token", Claude's `why` as quoted detail, the list from `window.deck.secrets.list()` sorted by `updatedAt` desc as selectable rows, **Paste new…** opening a name field and a `type="password"` value field (`autoComplete="off"`, `spellCheck={false}`), buttons Cancel and Grant (default). Return grants, Escape cancels. Paste new calls `secrets.add` and shows its `error` inline; on success grants that name. An empty store opens straight into Paste new. Focus the picker when shown; the terminal must not receive keystrokes typed into it.

- [ ] **Step 3: Wire it**: `tools.ts` case calls `requestSecret(caller, String(args.why ?? ''))`; `App.tsx` renders `<SecretPicker id={params.sessionId} />` when `useSecretRequest` returns a request.

- [ ] **Step 4: Typecheck:** `npm run typecheck` → no errors.

- [ ] **Step 5: Drive it** in the dev app (`npm run dev`, then `node scripts/cdp.mjs`), per `docs/development.md` → "Driving the app". To call the tool without Claude, POST JSON-RPC to the hook server's `/mcp/<session id>` with the dev token (find both through `cdp.mjs`, as the docs describe), in the background while you drive the picker:
  - empty store → Paste new `demo-api-key` / `sk_test_0000` → response is the granted text; `stat -f %Lp` on the file prints `600`, folder `700`; `cat` prints the value exactly.
  - second call → list shows `demo-api-key`; Return grants it.
  - Cancel, Escape, and a 300 s wait (temporarily shorten in a local edit, revert after) → `The user declined.`
  - second request while open → refused; first picker still works.
  - close the session with the picker open → `The user declined.`; folder gone. Undo → reopened session has no folder.
  - sidebar shows the session as needing you while the picker is open, and back to working after.
  - screenshot the picker in light and dark.

- [ ] **Step 6: Commit step** (only if asked): `Show a token picker when Claude asks for one`.

---

### Task 4: Settings → Tokens, and docs

**Files:**
- Create: `src/SecretsSettings.tsx`
- Modify: `src/SettingsSheet.tsx` (render `<SecretsSettings />` after `ClaudeSettings`), `src/styles.css`, `docs/architecture.md`

**Interfaces:**
- Consumes: `window.deck.secrets` (Task 2), session names from `useStore`.

- [ ] **Step 1: Implement `SecretsSettings`**: a `settings-section` titled "Tokens for Claude", detail "Claude can ask for one with request_secret; you pick which. Values are encrypted with your Mac's Keychain and never shown." Each row: name (inline rename via existing `Editable` if it fits), created date, holders as session names each with Revoke, buttons Replace… (password field) and Delete (`window.deck.confirm`, which the docs require over `window.confirm`). Add… at the bottom. Refresh the list after every action and when the sheet opens.

- [ ] **Step 2: Typecheck:** `npm run typecheck`.

- [ ] **Step 3: Drive it:** with `demo-api-key` granted to a dev session: rename → the grant file is renamed; Replace → the grant file holds the new value; Revoke → file gone; Delete → entry and files gone. Screenshot light and dark.

- [ ] **Step 4: Docs:** in `docs/architecture.md`, add `request_secret` to the tools table ("Opens a picker on the caller's pane; the user picks a token or declines; replies with a grant file's path, never a value"), `electron/secrets.cjs` to the file table, and a short "Tokens" section: the store, the grant folder's lifecycle (session end, revoke, quit and launch), and the limit that a printed token is in the transcript.

- [ ] **Step 5: Report what was left behind** in the dev app's data (tokens, sessions) and ask before removing it.

- [ ] **Step 6: Commit step** (only if asked): `Manage tokens for Claude in Settings`.
