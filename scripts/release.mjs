// Publishes a new version of Own Term: npm run release [patch|minor|major] (docs/releasing.md).
// Bumps the version, writes its release notes from the commits since the last one, builds and signs
// the app, publishes it as a GitHub release of manilsson/own-term-releases, then commits, tags and pushes.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { APP_PATHS } from './app-paths.mjs'

const ROOT = path.join(import.meta.dirname, '..')
const REPO = 'manilsson/own-term-releases'
const LATEST = `https://github.com/${REPO}/releases/latest/download`
const IDENTITY = 'Own Term Self-Signed'
const bump = process.argv[2] ?? 'patch'

// Output that goes straight to the terminal (stdio: 'inherit') comes back as null.
const sh = (cmd, args, opts = {}) => (execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts }) ?? '').trim()
const step = text => console.log(`\n▸ ${text}`)
const fail = text => {
  console.error(`\n✗ ${text}`)
  process.exit(1)
}

// Checks first, so nothing is half-done when one is missing.
if (!['patch', 'minor', 'major'].includes(bump)) fail('Say patch, minor or major.')
if (sh('git', ['status', '--porcelain'])) fail('Commit or stash your changes first; a release is built from a commit.')
if (sh('git', ['branch', '--show-current']) !== 'master') fail('Release from master.')
sh('git', ['fetch', '-q'])
if (sh('git', ['rev-list', '--count', 'HEAD..@{u}']) !== '0') fail('master is behind origin; pull first.')
if (!sh('security', ['find-identity', '-p', 'codesigning']).includes(`"${IDENTITY}"`)) fail(`The signing certificate "${IDENTITY}" isn't in the keychain.`)
try {
  sh('gh', ['repo', 'view', REPO, '--json', 'name'])
} catch {
  fail(`gh can't reach ${REPO}; run gh auth login.`)
}

const current = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const [major, minor, patch] = current.split('.').map(Number)
const version = bump === 'major' ? `${major + 1}.0.0` : bump === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`
const tag = `v${version}`
step(`Releasing ${version} (was ${current})`)

// Release notes: the subjects of the commits since the last release that changed the app, newest first.
// Site, docs and script work says nothing about it.
const lastTag = (() => {
  try {
    return sh('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*'], { stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
})()
const subjects = sh('git', ['log', '--format=%s', ...(lastTag ? [`${lastTag}..HEAD`] : []), '--', ...APP_PATHS])
  .split('\n')
  .filter(s => s && !/^Release v/.test(s))
const notes = subjects.map(s => `- ${s}`).join('\n')
const notesFile = path.join(ROOT, 'RELEASE_NOTES.md')
const allNotes = fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8') : '# Release notes\n'
fs.writeFileSync(notesFile, allNotes.replace(/^(# Release notes\n)/, `$1\n## ${version}\n\n${new Date().toISOString().slice(0, 10)}\n\n${notes}\n`))
sh('npm', ['version', version, '--no-git-tag-version'])

const undo = () => sh('git', ['checkout', '--', 'package.json', 'package-lock.json', 'RELEASE_NOTES.md'])
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'own-term-release-'))
let created = false
try {
  step('Building and signing')
  sh('npm', ['run', 'build'], { stdio: 'inherit' })
  sh('npx', ['electron-forge', 'make', '--arch', 'arm64'], { stdio: 'inherit', env: { ...process.env, OWN_TERM_SIGN_IDENTITY: IDENTITY } })
  sh('codesign', ['--verify', '--deep', '--strict', path.join(ROOT, 'out', 'Own Term-darwin-arm64', 'Own Term.app')])

  // GitHub turns spaces in asset names into dots, so the files are named without them.
  const zipDir = path.join(ROOT, 'out', 'make', 'zip', 'darwin', 'arm64')
  const zipName = `Own-Term-darwin-arm64-${version}.zip`
  fs.copyFileSync(path.join(zipDir, fs.readdirSync(zipDir).find(f => f.endsWith(`-${version}.zip`))), path.join(staging, zipName))
  const dmg = fs.readdirSync(path.join(ROOT, 'out', 'make')).find(f => f.endsWith('.dmg'))
  fs.copyFileSync(path.join(ROOT, 'out', 'make', dmg), path.join(staging, 'Own-Term.dmg'))

  // The manifest Squirrel.Mac reads: every version, the newest marked current, each with its zip.
  const previous = await fetch(`${LATEST}/RELEASES.json`).then(r => (r.ok ? r.json() : { releases: [] })).catch(() => ({ releases: [] }))
  const manifest = {
    currentRelease: version,
    releases: [
      ...previous.releases.filter(r => r.version !== version),
      {
        version,
        updateTo: {
          name: `Own Term v${version}`,
          version,
          pub_date: new Date().toISOString(),
          url: `https://github.com/${REPO}/releases/download/${tag}/${zipName}`,
          notes,
        },
      },
    ],
  }
  fs.writeFileSync(path.join(staging, 'RELEASES.json'), JSON.stringify(manifest, null, 2))

  step('Publishing')
  // A draft first, so "latest" only moves once every file is up.
  sh('gh', ['release', 'create', tag, '--repo', REPO, '--draft', '--title', `Own Term ${version}`, '--notes', notes,
    ...['RELEASES.json', zipName, 'Own-Term.dmg'].map(f => path.join(staging, f))], { stdio: ['ignore', 'pipe', 'inherit'] })
  created = true
  sh('gh', ['release', 'edit', tag, '--repo', REPO, '--draft=false', '--latest'], { stdio: ['ignore', 'pipe', 'inherit'] })

  step('Checking what was published')
  // GitHub takes a few seconds to point "latest" at a release it has just published.
  let published
  for (let tries = 0; tries < 24 && published?.currentRelease !== version; tries++) {
    if (tries) await new Promise(resolve => setTimeout(resolve, 5000))
    // While "latest" moves, a request can fail outright rather than return the old manifest; try again.
    published = await fetch(`${LATEST}/RELEASES.json`, { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : undefined))
      .catch(() => undefined)
  }
  if (published?.currentRelease !== version) throw new Error('The latest release\'s manifest still doesn\'t name this version after two minutes.')
  const download = await fetch(manifest.releases.at(-1).updateTo.url, { method: 'HEAD' })
  if (!download.ok) throw new Error(`The update zip isn't reachable: ${download.status}`)
} catch (error) {
  undo()
  const cleanup = created ? `\nThe GitHub release exists; remove it before trying again: gh release delete ${tag} --repo ${REPO} --cleanup-tag` : ''
  fail(`${error.message}\nThe version bump was undone.${cleanup}`)
} finally {
  fs.rmSync(staging, { recursive: true, force: true })
}

// The built app would otherwise sit in out/, where Spotlight and Launchpad list it as a second Own Term.
fs.rmSync(path.join(ROOT, 'out'), { recursive: true, force: true })

step('Committing and tagging')
sh('git', ['add', 'package.json', 'package-lock.json', 'RELEASE_NOTES.md'])
sh('git', ['commit', '-q', '-m', `Release ${tag}`])
// master may have moved on during the build; the release commit goes on top of it, so the push lands.
sh('git', ['pull', '-q', '--rebase'])
sh('git', ['tag', tag])
// By name: --follow-tags only pushes annotated tags, and without the tag on GitHub, Actions can't
// find the last release and writes the whole history into the notes.
sh('git', ['push', '-q', 'origin', 'master', tag])
console.log(`\n✓ Own Term ${version} is out.\n  Download: ${LATEST}/Own-Term.dmg\n  Installed copies update within four hours, or at their next launch.`)
