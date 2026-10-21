// Releases what's on GitHub's master: npm run ship [patch|minor|major] starts the Release workflow
// (.github/workflows/release.yml), which builds, signs and publishes a version, and follows it to the
// end. Pushing doesn't release; this does (docs/releasing.md).
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { APP_PATHS } from './app-paths.mjs'

const ROOT = path.join(import.meta.dirname, '..')
const REPO = 'manilsson/own-term'
const bump = process.argv[2] ?? 'patch'

const sh = (cmd, args, opts = {}) => (execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts }) ?? '').trim()
const fail = text => {
  console.error(`\n✗ ${text}`)
  process.exit(1)
}

if (!['patch', 'minor', 'major'].includes(bump)) fail('Say patch, minor or major.')
sh('git', ['fetch', '-q', 'origin', 'master', '--tags'])
// GitHub builds its own master, so a commit that's only here wouldn't be in the release.
if (sh('git', ['branch', '--show-current']) === 'master' && sh('git', ['rev-list', '--count', 'origin/master..HEAD']) !== '0') {
  fail('Some commits here aren\'t on GitHub yet; push them first, or they won\'t be in the release.')
}
const last = sh('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*', 'origin/master'])
const changes = sh('git', ['log', '--format=- %s', `${last}..origin/master`, '--', ...APP_PATHS])
  .split('\n').filter(line => line && !/^- Release v/.test(line))
if (!changes.length) fail(`Nothing in the app has changed since ${last}.`)
console.log(`Shipping a ${bump} release with what changed since ${last}:\n${changes.join('\n')}\n`)

sh('gh', ['workflow', 'run', 'release.yml', '--repo', REPO, '--ref', 'master', '-f', `bump=${bump}`])
// The run takes a moment to be listed after it's started.
let run = ''
for (let tries = 0; !run && tries < 15; tries++) {
  execFileSync('sleep', ['2'])
  run = sh('gh', ['run', 'list', '--repo', REPO, '--workflow', 'release.yml', '--event', 'workflow_dispatch', '--limit', '1',
    '--json', 'databaseId,status', '--jq', '.[] | select(.status != "completed") | .databaseId'])
}
if (!run) fail(`The release started, but its run didn't show up; see https://github.com/${REPO}/actions`)
console.log(`Following https://github.com/${REPO}/actions/runs/${run}`)
try {
  execFileSync('gh', ['run', 'watch', run, '--repo', REPO, '--exit-status', '--interval', '10'], { stdio: 'inherit' })
} catch {
  fail(`The release failed; see https://github.com/${REPO}/actions/runs/${run}`)
}
console.log('\n✓ Released. Installed copies update within four hours, or at their next launch.')
