# Releasing

Own Term ships as a signed macOS app that updates itself: Electron
Forge packages it, a public folder of files is the update "server", and Electron's built-in updater
(Squirrel.Mac) reads it. One command publishes a version, run by GitHub Actions with `npm run ship`
(see "From GitHub Actions"), or from this Mac:

```sh
npm run release          # 0.1.0 → 0.1.1
npm run release minor    # 0.1.1 → 0.2.0
npm run release major    # 0.2.0 → 1.0.0
```

`scripts/release.mjs` refuses to start unless the working tree is clean, on `master` and up to date,
the signing certificate is in the keychain, and `gh` can reach the releases repo. Then it:

1. bumps the version in `package.json`, and adds a section to `RELEASE_NOTES.md` listing the subjects
   of the commits since the last release that changed the app, site and docs work left out (edit them
   afterwards if you like; the release keeps what shipped, and the site's release page reads them);
2. builds the renderer and runs `electron-forge make` (config: `forge.config.cjs`), which packages
   the app, signs it, and makes the zip and the dmg;
3. writes the update manifest: the previous release's `RELEASES.json` plus this version, marked current;
4. creates a GitHub release `vX.Y.Z` in `manilsson/own-term-releases` as a draft with the three files,
   then publishes it, so "latest" moves only once every file is up;
5. reads the manifest back through the "latest" link and checks the new zip downloads;
6. deletes `out/` (macOS would list the built app as a second Own Term), commits, rebases that commit
   onto `master` in case it moved during the build, tags and pushes.

If anything fails before the commit, the version bump is undone; a release already created on GitHub
is named so it can be deleted.

## From GitHub Actions

Pushing to `master` doesn't release. To ship what's on GitHub's `master`:

```sh
npm run ship             # 0.1.31 → 0.1.32
npm run ship minor       # or major
```

`scripts/ship.mjs` refuses when commits here aren't pushed yet (GitHub builds its own `master`) or
when nothing in the app has changed since the last release, shows what's going out, starts
`.github/workflows/release.yml`, and follows the run to the end. Actions → Release → Run workflow
does the same from the browser. The workflow type-checks, imports the signing certificate into a
temporary keychain on a macOS runner and runs `npm run release`; one release runs at a time.

What counts as the app is `scripts/app-paths.mjs`: `src/`, `electron/`, `build/`, the Vite, Forge
and TypeScript configs, and `package.json` and its lock. The release notes list only commits that
touched those, since the last release's tag, so site and docs work stays out of them. The release
commit is rebased onto `master` before it's pushed, in case it moved during the build, and the tag is
pushed by name: without the tags on GitHub, a release can't find the last one.

`.github/workflows/site.yml` deploys the site when `site/`, `RELEASE_NOTES.md` or the deploy script
change on `master`, and after every release, whose own push doesn't trigger it.

macOS runners count ten times against a private repo's Actions minutes; a release takes two or three.

### Secrets, once

Set in the code repo (`gh secret set <name> --repo manilsson/own-term`):

| Secret | What |
| --- | --- |
| `OWN_TERM_CERT_P12` | The signing certificate with its private key, base64: Keychain Access → My Certificates → Own Term Self-Signed → File → Export Items… as a `.p12` with a password, then `base64 -i Own-Term.p12 \| gh secret set OWN_TERM_CERT_P12 --repo manilsson/own-term`. Delete the `.p12` afterwards |
| `OWN_TERM_CERT_PASSWORD` | That `.p12`'s password |
| `RELEASES_TOKEN` | A fine-grained token (github.com → Settings → Developer settings) for `manilsson/own-term-releases` only, with Contents read and write; the workflow's own token can't write to another repo |
| `VERCEL_TOKEN` | A token from vercel.com → Account Settings → Tokens, for the `markus-personal` team; one scoped to the project (`vcp_…`) is enough, since the deploy uses the API rather than the CLI |

## Where releases live

The public repo [manilsson/own-term-releases](https://github.com/manilsson/own-term-releases) holds
only releases; the code repo stays private. Every release carries:

```
RELEASES.json                          the manifest the updater reads: every version, newest current
Own-Term-darwin-arm64-<version>.zip    what the updater downloads
Own-Term.dmg                           for first installs
```

The app reads `https://github.com/manilsson/own-term-releases/releases/latest/download/RELEASES.json`,
which GitHub redirects to the newest release's copy; the newest dmg is always at
`…/releases/latest/download/Own-Term.dmg`. GitHub releases have no storage or download limits for
public repos. Asset names have no spaces, because GitHub turns spaces into dots.

Versions up to 0.1.4 were published to a Vercel Blob store instead, whose free plan locked uploads
after 1 GB; copies on those versions read their updates from there and need one manual download of a
newer version.

## Signing

Squirrel.Mac only installs an update signed like the running app, so every release is signed with the
same certificate: **Own Term Self-Signed**, a self-signed code-signing certificate in the login
keychain. The app's designated requirement is its bundle id (`se.mnilsson.ownterm`, fixed for good)
plus that certificate, which is what each update is checked against. It's a plain deep `codesign`
without the hardened runtime: library validation needs a Team ID, which a self-signed certificate
doesn't have.

Losing the certificate means installed copies can't update to builds signed with a new one; they'd
need a fresh download. Keep it (Keychain Access → My Certificates → Own Term Self-Signed) backed up.

Because it isn't Apple-issued and nothing is notarized, macOS refuses the first open of a downloaded
copy ("Apple could not verify…"): System Settings → Privacy & Security → Open Anyway, once. macOS 15
removed the right-click → Open way around it. Updates install without that warning. The marketing
page's download links point at the newest dmg and say the same. Moving to an Apple Developer ID later means one transition release signed with both
trust chains in mind; plan it then.

## How the app updates

`electron/updater.cjs`, only in a packaged build: it checks at launch and every four hours, downloads
a newer version in the background, and the toolbar shows **Restart to Update** when it's ready. That
asks first if a session is busy (Claude conversations resume after the restart). An update that has
downloaded installs at the next quit anyway. The app menu has **Check for Updates…**. Squirrel refuses
a check while another is running or a download is under way ("The command is disabled and cannot be
executed"), so none is started then: a manual check during a download says one is coming, and the
four-hourly check skips its turn.

The app needs to sit somewhere it can write to, such as `/Applications`, for Squirrel to swap it.

## Packaged versus development

- `npm run package` builds the app into `out/` without uploading; set
  `OWN_TERM_SIGN_IDENTITY="Own Term Self-Signed"` to sign it like a release.
- The packaged app keeps its data in `~/Library/Application Support/deckterm`, the development build
  in `deckterm-dev`, so the two can run side by side (each holds a lock on its own folder).
- Launched from Finder or the Dock, the packaged app reads PATH from the login shell, or it couldn't
  find `claude`, `git` or `cursor`.
- zsh can't read files inside the app archive, so the packaged app copies its integration files to
  `<data folder>/shell` at launch.
- Only `node-pty` is a runtime dependency; everything the renderer uses is bundled by Vite, so it's a
  dev dependency and stays out of the package.
