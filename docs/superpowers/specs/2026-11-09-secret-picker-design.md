# Secret picker

Date: 2026-11-09 · Status: design approved, spec under review

## Why

Support and dev work often needs Claude to use an API key or token. Today the user pastes it into a
.txt file on the Desktop and points Claude at it: the secret sits unencrypted on disk indefinitely,
and nothing stops it ending up in a transcript.

Own Term should keep the user's tokens encrypted, and let Claude in a session *ask* for one. The user
decides which token, if any, that session gets. Claude never chooses, lists or fetches tokens from
the store itself.

## Goals

- Tokens are stored encrypted, not as plain files the user manages.
- Claude can only request a token; the user picks it in Own Term. Claude cannot name, list or browse
  the store.
- No token value ever travels in an `own-term` tool result, hook response or anything the window
  sends Claude.
- A granted token is usable in commands for the rest of that session, then removed.

## Non-goals (stated plainly in the UI copy and docs)

- Hiding a token after a command prints it. Claude Code's hooks can't change Bash output before
  Claude reads it, so a granted token that a command echoes is in the transcript. Claude is told
  never to print it; that is guidance, not enforcement.
- Protecting against processes running as the user reading a session's grant file while it exists.

## Design

### Store — `electron/secrets.cjs` (main process)

- One file in the user data folder, `secrets.json`: `{ name → base64(safeStorage.encryptString(value)) }`
  plus `createdAt`/`updatedAt` per entry. `safeStorage` is backed by the macOS Keychain.
- Only main decrypts. The window receives names and dates, never values.
- If `safeStorage.isEncryptionAvailable()` is false, the store refuses to save and the picker says so.
- Names: 1–64 characters of letters, digits, `-` and `_`, unique, case-insensitive. They double as
  file names, so this also rules out paths.
- IPC (window ↔ main): `secrets:list` (names, dates, which open sessions hold each),
  `secrets:add` (name, value), `secrets:replace` (name, value), `secrets:rename`, `secrets:delete`,
  `secrets:revoke` (session, name). Values only ever flow window → main, from the picker or Settings.

### The tool — `request_secret` in `electron/tools.cjs`

- Input: `why` (string, required, shown to the user). No name or id argument exists.
- Description and server instructions tell Claude: call it only when the task needs a credential;
  it returns a file path; use it as `$(cat <path>)` inside a command; never print, echo, log or copy
  the value elsewhere; it can't choose which token it gets.
- Timeout: about 5 minutes (like `wait_for`, the main process waits longer than the usual 15 s).
- Results:
  - granted: `Granted "<name>" for this session at <path>. Use it as $(cat <path>) inside a command. Never print it.`
  - declined / timed out / session closed: `The user declined.` (no distinction, so it reveals nothing)
- Called as `today` (no session): refused with a message, since there is no session to grant to.
- One request open per session at a time; a second call while one is showing is refused.

### The picker (window, on the calling session's pane)

- A sheet over the pane: Claude's `why`, the saved names as a list (most recently granted first),
  **Paste new…** (a password field plus a name field, saved to the store then granted), **Grant**
  and **Cancel**. Return grants the selection; Escape cancels.
- The session shows as needing the user (sidebar, Dock badge, notification) while the picker is open,
  like a question from Claude. Opening the notification shows the pane with the picker.
- Only the user's click or key press grants. `own-term` tools being pre-allowed changes nothing,
  because the tool only opens the picker.
- Copy names it plainly as a token, uses tokens from `src/styles.css` for every color, and works in
  both appearances.

### The grant

- Main writes the decrypted value to `<user data>/session-secrets/<session id>/<name>`, folder mode
  0700, file mode 0600, no trailing newline (so `$(cat …)` is exact).
- Lasts the session. Asking again opens the picker again; the result never says what the session
  already holds.
- Removed when: the session closes (main deletes its folder), the user revokes it in Settings, the
  user deletes or replaces the token (replace rewrites any granted files), and every grant is wiped
  when Own Term quits and again at launch (crash recovery). Shells restart with the app, so no
  grant has to outlive it; a resumed Claude asks again.

### Settings → Secrets

- A list of names with created date and the open sessions holding each. Actions: Add, Rename,
  Replace value, Delete (confirms), Revoke per session. Values are never displayed or copyable.

## Testing

Drive the dev app with `scripts/cdp.mjs` as `docs/development.md` describes, with invented token
names and values only:

- Call `request_secret` from a dev session; grant a saved token; the result holds the path and no
  value; the file has mode 0600, the folder 0700, and contains exactly the value.
- Paste new: token saved encrypted (the store file holds no plain value), then granted.
- Cancel, Escape, timeout and closing the session mid-request all return `The user declined.`
- A second request while the picker is open is refused.
- Close the session: its folder is gone. Kill the app with a grant present, relaunch: folder gone.
- Revoke, delete and replace from Settings update the files as described.
- Screenshot the picker and Settings in light and dark.
- `npm run typecheck`.

## Docs to update

- `docs/architecture.md`: the store, the tool in the tools table, the grant folder's lifecycle.
