// Publishes the built marketing page (site/dist) to the Vercel project own-term (npm run site:deploy).
// With VERCEL_TOKEN set, as in GitHub Actions, it uploads through Vercel's API: the token there is
// scoped to the project, and the CLI won't run on a token that has no user to load. Otherwise it uses
// the logged-in CLI.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dist = path.join(import.meta.dirname, '..', 'site', 'dist')
const PROJECT = 'own-term'
const TEAM = process.env.VERCEL_SCOPE ?? 'markus-personal'

if (process.env.VERCEL_TOKEN) await deployWithToken(process.env.VERCEL_TOKEN)
else deployWithCli()

function deployWithCli() {
  // A copy outside the repo: from inside it, the CLI attaches the last commit, and Vercel blocks a
  // deploy whose commit author isn't a member of the project.
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'own-term-site-'))
  fs.cpSync(dist, copy, { recursive: true })
  try {
    execFileSync('vercel', ['deploy', '--prod', '--yes', '--project', PROJECT], { cwd: copy, stdio: 'inherit' })
  } finally {
    fs.rmSync(copy, { recursive: true })
  }
}

async function deployWithToken(token) {
  const api = async (route, init = {}) => {
    const response = await fetch(`https://api.vercel.com${route}${route.includes('?') ? '&' : '?'}slug=${TEAM}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`${route}: ${body.error?.message ?? response.status}`)
    return body
  }

  // Each file is uploaded once by its hash; the deployment then names them.
  const files = []
  for (const file of fs.readdirSync(dist, { recursive: true })) {
    const full = path.join(dist, file)
    if (!fs.statSync(full).isFile()) continue
    const data = fs.readFileSync(full)
    const sha = createHash('sha1').update(data).digest('hex')
    await api('/v2/files', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-vercel-digest': sha }, body: data })
    files.push({ file: file.split(path.sep).join('/'), sha, size: data.length })
  }

  // Built already, so Vercel only serves the files.
  let deployment = await api('/v13/deployments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: PROJECT, project: PROJECT, target: 'production', files, projectSettings: { framework: null } }),
  })
  console.log(`Deploying ${files.length} files: https://${deployment.url}`)
  for (let tries = 0; !['READY', 'ERROR', 'CANCELED'].includes(deployment.readyState) && tries < 60; tries++) {
    await new Promise(resolve => setTimeout(resolve, 3000))
    deployment = await api(`/v13/deployments/${deployment.id}`)
  }
  if (deployment.readyState !== 'READY') throw new Error(`The deployment ended ${deployment.readyState}.`)
  console.log(`Live: https://${PROJECT}.vercel.app`)
}
