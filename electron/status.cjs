// The status page's data (src/StatusPage.tsx): a journal of what was asked of Claude in each session,
// your pull requests and reviews from GitHub, your Linear issues, and the brief and standup Claude
// writes from all of it. Main owns it: it needs gh, the network, the disk and the Linear key.
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const readline = require('node:readline')
const crypto = require('node:crypto')
const { execFile, spawn } = require('node:child_process')
const { Notification, shell } = require('electron')

const DAY = 24 * 60 * 60 * 1000
const GH_TTL = 2 * 60 * 1000
// How often GitHub is asked in the background, for the pings.
const PING_EVERY = 3 * 60 * 1000
// More at once than this come as one notification, which opens the Today page.
const PINGS_AT_ONCE = 3
const LINEAR_TTL = 2 * 60 * 1000
const JOURNAL_KEEP = 90 * DAY
const BACKFILL_DAYS = 14

const DEFAULTS = { ai: true, model: 'sonnet', instructions: '', reviewPrompt: '', prScope: 'all', mutedRepos: [], linearTeams: [], pings: true, projects: {} }
const MODELS = ['sonnet', 'opus', 'haiku']

const clip = (text, max) => (typeof text === 'string' ? (text.length > max ? `${text.slice(0, max)}…` : text) : undefined)
const oneLine = (text, max) => clip(typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : undefined, max)
const pad = n => String(n).padStart(2, '0')
// Pasted text is the material for a prompt, not what was asked.
const cleanPrompt = text => (typeof text === 'string' ? text.replace(/<pasted_content[^>]*>[\s\S]*?(<\/pasted_content>|$)/g, '[pasted text] ').trim() : '')
const dayKey = t => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

module.exports = function status({ app, ipcMain, safeStorage, run, readSettings, saveSettings, shellEnv, ownTools, showToday }) {
  const dataDir = path.join(app.getPath('userData'), 'status')
  const journalDir = path.join(app.getPath('userData'), 'journal')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(journalDir, { recursive: true })

  // ── Settings ──────────────────────────────────────────────────────────────────────────────────

  const stored = () => ({ ...DEFAULTS, ...readSettings().status })
  const store = patch => saveSettings({ status: { ...readSettings().status, ...patch } })

  // Encrypted with the login Keychain's key; settings.json only ever holds the ciphertext.
  function linearKey() {
    const sealed = stored().linearKey
    if (!sealed || !safeStorage.isEncryptionAvailable()) return null
    try {
      return safeStorage.decryptString(Buffer.from(sealed, 'base64'))
    } catch {
      return null
    }
  }

  function publicSettings() {
    const s = stored()
    return {
      ai: s.ai !== false,
      model: MODELS.includes(s.model) ? s.model : 'sonnet',
      instructions: s.instructions ?? '',
      reviewPrompt: s.reviewPrompt ?? '',
      prScope: s.prScope === 'sessions' ? 'sessions' : 'all',
      mutedRepos: Array.isArray(s.mutedRepos) ? s.mutedRepos : [],
      pings: s.pings !== false,
      projects: s.projects && typeof s.projects === 'object' ? s.projects : {},
      linear: s.linearKey && s.linearUser
        ? { connected: true, user: s.linearUser, teams: s.linearTeamList ?? [], selected: s.linearTeams ?? [] }
        : { connected: false },
      github: githubUser,
    }
  }

  ipcMain.handle('status:settings', () => publicSettings())

  ipcMain.handle('status:save-settings', (_e, patch) => {
    const next = {}
    if (typeof patch?.ai === 'boolean') next.ai = patch.ai
    if (MODELS.includes(patch?.model)) next.model = patch.model
    if (typeof patch?.instructions === 'string') next.instructions = patch.instructions.slice(0, 2000)
    if (typeof patch?.reviewPrompt === 'string') next.reviewPrompt = patch.reviewPrompt.slice(0, 1000)
    if (patch?.prScope === 'all' || patch?.prScope === 'sessions') next.prScope = patch.prScope
    if (typeof patch?.pings === 'boolean') next.pings = patch.pings
    if (Array.isArray(patch?.mutedRepos)) next.mutedRepos = patch.mutedRepos.filter(r => typeof r === 'string').slice(0, 100)
    if (patch?.projects && typeof patch.projects === 'object') {
      next.projects = Object.fromEntries(Object.entries(patch.projects)
        .filter(([repo, name]) => typeof name === 'string' && name.trim()).slice(0, 200).map(([repo, name]) => [repo, oneLine(name, 40)]))
    }
    if (Array.isArray(patch?.linearTeams)) next.linearTeams = patch.linearTeams.filter(t => typeof t === 'string').slice(0, 50)
    store(next)
    // What's shown and what Claude reads both change with these.
    githubCache = null
    linearCache = null
    return publicSettings()
  })

  ipcMain.handle('status:linear-connect', async (_e, key) => {
    key = typeof key === 'string' ? key.trim() : ''
    if (!key) return { error: 'Paste a personal API key.' }
    if (!safeStorage.isEncryptionAvailable()) return { error: 'macOS won’t let Own Term encrypt the key right now, so it isn’t saved.' }
    try {
      const data = await linearQuery(key, `{ viewer { name displayName organization { name urlKey } } teams(first: 100) { nodes { id key name } } }`)
      const user = { name: data.viewer.name || data.viewer.displayName, org: data.viewer.organization?.name, urlKey: data.viewer.organization?.urlKey }
      store({
        linearKey: safeStorage.encryptString(key).toString('base64'),
        linearUser: user,
        linearTeamList: data.teams.nodes.map(t => ({ id: t.id, key: t.key, name: t.name })),
      })
      linearCache = null
      return { settings: publicSettings() }
    } catch (error) {
      return { error: /401|authentication|not authenticated/i.test(error.message) ? 'Linear didn’t accept that key.' : error.message }
    }
  })

  ipcMain.handle('status:linear-disconnect', () => {
    store({ linearKey: undefined, linearUser: undefined, linearTeamList: undefined, linearTeams: [] })
    linearCache = null
    return publicSettings()
  })

  // ── GitHub, through gh ────────────────────────────────────────────────────────────────────────

  let githubUser = null
  let githubCache = null
  const repos = new Map()

  /** owner/name of a folder's GitHub remote, or null. */
  function repoOf(folder) {
    // The question is kept, not just the answer: a week's journal asks about one folder thousands of times at once.
    if (!repos.has(folder)) {
      repos.set(folder, run('git', ['-C', folder, 'remote', 'get-url', 'origin'], { timeout: 5000 }).catch(() => '')
        .then(url => url.match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i)?.[1] ?? null))
    }
    return repos.get(folder)
  }

  /** The repository a folder is in, also for a worktree Own Term made that's since been removed. */
  const repoAt = folder => (typeof folder === 'string' && folder ? repoOf(folder.replace(/\/\.claude\/worktrees\/.*$/, '')) : Promise.resolve(null))

  const PR_FIELDS = 'number title url createdAt updatedAt isDraft headRefName additions deletions author { login } repository { nameWithOwner }'
  // __typename tells people from bots: a review bot's comments aren't anyone waiting on you.
  const PERSON = 'author { __typename login }'
  const GH_QUERY = `query($mine: String!, $review: String!, $merged: String!, $reviewed: String!) {
    viewer { login name }
    mine: search(query: $mine, type: ISSUE, first: 40) { nodes { ... on PullRequest { ${PR_FIELDS} mergeable reviewDecision
      commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }
      latestReviews(first: 20) { nodes { state submittedAt ${PERSON} } }
      reviewThreads(last: 50) { nodes { isResolved isOutdated comments(last: 1) { nodes { createdAt ${PERSON} } } } }
      comments(last: 10) { nodes { createdAt ${PERSON} } }
      timelineItems(last: 1, itemTypes: [REVIEW_REQUESTED_EVENT]) { nodes { ... on ReviewRequestedEvent { createdAt } } } } } }
    review: search(query: $review, type: ISSUE, first: 40) { nodes { ... on PullRequest { ${PR_FIELDS}
      latestReviews(first: 20) { nodes { state submittedAt author { login } } }
      timelineItems(last: 1, itemTypes: [REVIEW_REQUESTED_EVENT]) { nodes { ... on ReviewRequestedEvent { createdAt } } } } } }
    merged: search(query: $merged, type: ISSUE, first: 50) { nodes { ... on PullRequest { ${PR_FIELDS} mergedAt } } }
    reviewed: search(query: $reviewed, type: ISSUE, first: 50) { nodes { ... on PullRequest { ${PR_FIELDS} state
      commits(last: 30) { nodes { commit { authoredDate } } }
      latestReviews(first: 20) { nodes { state submittedAt ${PERSON} } }
      reviewThreads(last: 50) { nodes { isResolved started: comments(first: 1) { nodes { ${PERSON} } } latest: comments(last: 1) { nodes { createdAt ${PERSON} } } } } } } }
  }`

  const time = text => Date.parse(text ?? '') || 0
  const isPerson = author => author?.__typename === 'User'
  const names = list => [...new Set(list)].slice(0, 2).join(' and ')

  function basePr(n) {
    return {
      id: `pr:${n.repository.nameWithOwner}#${n.number}`,
      repo: n.repository.nameWithOwner,
      number: n.number,
      title: n.title,
      url: n.url,
      author: n.author?.login ?? null,
      created: Date.parse(n.createdAt),
      updated: Date.parse(n.updatedAt),
      draft: !!n.isDraft,
      branch: n.headRefName,
      additions: n.additions ?? 0,
      deletions: n.deletions ?? 0,
    }
  }

  /**
   * One of your pull requests, with what it needs: `fix` (red), `reply` to reviewers, `ready` to merge,
   * `waiting` on others, or `draft`. Whose turn it is comes from who acted last: your push, comment or
   * re-request, against their reviews, comments and unanswered threads.
   */
  function minePr(n, login, prev) {
    const pr = basePr(n)
    const head = n.commits?.nodes?.[0]?.commit
    const rollup = head?.statusCheckRollup?.state
    pr.checks = rollup === 'SUCCESS' ? 'passing' : rollup === 'FAILURE' || rollup === 'ERROR' ? 'failing' : rollup ? 'pending' : null
    const reviews = (n.latestReviews?.nodes ?? []).filter(r => isPerson(r.author) && r.author.login !== login)
    // Without required reviews GitHub gives no decision, so the latest reviews decide.
    pr.review = n.reviewDecision === 'CHANGES_REQUESTED' || (!n.reviewDecision && reviews.some(r => r.state === 'CHANGES_REQUESTED')) ? 'changes'
      : n.reviewDecision === 'APPROVED' || (!n.reviewDecision && reviews.some(r => r.state === 'APPROVED')) ? 'approved'
      : reviews.some(r => r.state === 'COMMENTED') ? 'commented' : 'none'
    // GitHub says UNKNOWN while it recomputes, often after the base branch moves; that isn't "no conflicts".
    pr.mergeUnknown = n.mergeable === 'UNKNOWN'
    pr.conflicts = pr.mergeUnknown ? !!prev?.conflicts : n.mergeable === 'CONFLICTING'

    const threads = (n.reviewThreads?.nodes ?? []).map(t => ({ ...t, last: t.comments?.nodes?.[0] })).filter(t => t.last)
    const comments = n.comments?.nodes ?? []
    const yours = Math.max(
      time(head?.committedDate),
      time(n.timelineItems?.nodes?.[0]?.createdAt),
      ...comments.filter(c => c.author?.login === login).map(c => time(c.createdAt)),
      ...threads.filter(t => t.last.author?.login === login).map(t => time(t.last.createdAt)),
    )
    const theirs = item => isPerson(item.author) && item.author.login !== login
    // An outdated thread is on code that has changed since, usually the answer to it.
    const unanswered = threads.filter(t => !t.isResolved && !t.isOutdated && theirs(t.last))
    const newReviews = reviews.filter(r => r.state !== 'APPROVED' && time(r.submittedAt) > yours)
    const newComments = comments.filter(c => theirs(c) && time(c.createdAt) > yours)
    const changesNew = newReviews.some(r => r.state === 'CHANGES_REQUESTED')
    // When it last became your turn, so a ping goes out once per change.
    pr.turnAt = Math.max(0, ...unanswered.map(t => time(t.last.createdAt)), ...newReviews.map(r => time(r.submittedAt)), ...newComments.map(c => time(c.createdAt)))

    const fix = [
      pr.checks === 'failing' && 'Checks failing',
      pr.conflicts && 'Merge conflicts',
      pr.review === 'changes' && (changesNew || !yours) && 'Changes requested',
    ].filter(Boolean)
    const reply = unanswered.length ? `${unanswered.length} comment${unanswered.length === 1 ? '' : 's'} to answer`
      : newReviews.length ? `Reviewed by ${names(newReviews.map(r => r.author.login))}`
      : newComments.length ? `New comment from ${names(newComments.map(c => c.author.login))}`
      : null
    if (pr.draft) [pr.attention, pr.reason] = ['draft', fix[0] ?? 'Draft']
    else if (fix.length) [pr.attention, pr.reason] = ['fix', [...fix, reply].filter(Boolean).join(' · ')]
    else if (reply) [pr.attention, pr.reason] = ['reply', reply]
    else if (pr.review === 'approved' && pr.checks !== 'pending') [pr.attention, pr.reason] = ['ready', 'Approved, ready to merge']
    else [pr.attention, pr.reason] = ['waiting', pr.checks === 'pending' ? 'Checks running' : pr.review === 'changes' ? 'Waiting for re-review' : 'Waiting for review']
    if (pr.attention === 'fix' && pr.checks === 'failing') pr.turnAt = Math.max(pr.turnAt, time(head?.committedDate))
    // Approved again after more work pings again.
    if (pr.attention === 'ready') pr.turnAt = Math.max(0, ...reviews.filter(r => r.state === 'APPROVED').map(r => time(r.submittedAt)))
    return pr
  }

  /**
   * One you reviewed that has changed since without asking you again: new commits, or replies in the
   * threads you started. GitHub drops you from the reviewers once you review, so the search for review
   * requests misses these.
   */
  function changedSinceReview(n, login) {
    if (n.state !== 'OPEN') return null
    const threads = (n.reviewThreads?.nodes ?? []).filter(t => t.started?.nodes?.[0]?.author?.login === login && t.latest?.nodes?.[0])
    const reviewedAt = Math.max(
      0,
      ...(n.latestReviews?.nodes ?? []).filter(r => r.author?.login === login).map(r => time(r.submittedAt)),
      ...threads.map(t => t.latest.nodes[0]).filter(c => c.author?.login === login).map(c => time(c.createdAt)),
    )
    if (!reviewedAt) return null
    // Authored, not committed: a rebase on main rewrites every commit's date but adds nothing to review.
    const commits = (n.commits?.nodes ?? []).map(c => time(c.commit?.authoredDate)).filter(t => t > reviewedAt)
    const replies = threads.filter(t => !t.isResolved).map(t => t.latest.nodes[0])
      .filter(c => isPerson(c.author) && c.author.login !== login && time(c.createdAt) > reviewedAt)
    if (!commits.length && !replies.length) return null
    const pr = basePr(n)
    pr.waitingSince = Math.max(...commits, ...replies.map(c => time(c.createdAt)))
    pr.rereview = true
    pr.requested = false
    pr.change = [
      commits.length && `${commits.length} new commit${commits.length === 1 ? '' : 's'}`,
      replies.length && `${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}`,
    ].filter(Boolean).join(', ')
    return pr
  }

  function reviewPr(n, login) {
    const pr = basePr(n)
    const asked = Date.parse(n.timelineItems?.nodes?.[0]?.createdAt ?? '') || pr.created
    const mine = (n.latestReviews?.nodes ?? []).filter(r => r.author?.login === login).map(r => Date.parse(r.submittedAt))
    pr.waitingSince = asked
    // Reviewed before and asked again since: it has changed after your review.
    pr.rereview = mine.length > 0 && Math.max(...mine) < asked
    return pr
  }

  async function github(folders, force) {
    if (!force && githubCache && Date.now() - githubCache.at < GH_TTL) return githubCache
    const since = dayKey(Date.now() - 7 * DAY)
    let data
    try {
      const out = await run('gh', [
        'api', 'graphql',
        '-f', `query=${GH_QUERY}`,
        '-f', 'mine=is:open is:pr author:@me archived:false',
        '-f', 'review=is:open is:pr review-requested:@me archived:false',
        '-f', `merged=is:pr author:@me is:merged merged:>=${since}`,
        '-f', `reviewed=is:pr reviewed-by:@me -author:@me updated:>=${since}`,
      ], { timeout: 30000, maxBuffer: 32 * 1024 * 1024 })
      data = JSON.parse(out).data
    } catch (error) {
      const missing = /ENOENT|not found/i.test(error.message)
      const loggedOut = /auth login|not logged|authentication/i.test(error.message)
      githubUser = { error: missing ? 'missing' : loggedOut ? 'logged-out' : 'failed' }
      githubCache = { at: Date.now(), error: missing ? 'Install the GitHub CLI (gh) to see pull requests.' : loggedOut ? 'Run gh auth login to see pull requests.' : `GitHub didn’t answer: ${oneLine(error.message, 200)}` }
      return githubCache
    }
    const login = data.viewer.login
    githubUser = { login, name: data.viewer.name }
    const settings = publicSettings()
    const muted = new Set(settings.mutedRepos.map(r => r.toLowerCase()))
    const scope = settings.prScope === 'sessions' ? new Set((await Promise.all(folders.map(repoOf))).filter(Boolean).map(r => r.toLowerCase())) : null
    const keep = pr => !muted.has(pr.repo.toLowerCase()) && (!scope || scope.has(pr.repo.toLowerCase()))
    const nodes = list => (list?.nodes ?? []).filter(n => n?.number)
    const reviewed = nodes(data.reviewed).map(n => {
      const pr = basePr(n)
      const mine = (n.latestReviews?.nodes ?? []).filter(r => r.author?.login === login)
      pr.reviewedAt = Math.max(0, ...mine.map(r => Date.parse(r.submittedAt)))
      pr.verdict = mine.at(-1)?.state ?? null
      return pr
    })
    const requested = nodes(data.review).map(n => reviewPr(n, login)).filter(keep)
    const changed = nodes(data.reviewed).map(n => changedSinceReview(n, login)).filter(pr => pr && keep(pr) && !requested.some(r => r.id === pr.id))
    githubCache = {
      at: Date.now(),
      login,
      mine: nodes(data.mine).map(n => minePr(n, login, githubCache?.mine?.find(p => p.number === n.number && p.repo === n.repository.nameWithOwner))).filter(keep),
      review: [...requested, ...changed].sort((a, b) => a.waitingSince - b.waitingSince),
      merged: nodes(data.merged).map(n => ({ ...basePr(n), mergedAt: Date.parse(n.mergedAt) })).filter(keep).sort((a, b) => b.mergedAt - a.mergedAt),
      reviewed: reviewed.filter(pr => keep(pr) && pr.reviewedAt >= Date.now() - 7 * DAY).sort((a, b) => b.reviewedAt - a.reviewedAt),
    }
    ping(githubCache)
    return githubCache
  }

  // ── Pings ─────────────────────────────────────────────────────────────────────────────────────

  // What each pull request was last pinged for, kept across launches so a restart neither repeats a
  // ping nor drops one that came in while the app was closed.
  const PINGED_FILE = path.join(app.getPath('userData'), 'status', 'pinged.json')
  // Kept this long after a pull request last needed you, so one that drops out of a search for a
  // while (a hidden repository shown again, a slow search) doesn't ping a second time.
  const PINGED_KEEP = 30 * DAY
  let pinged
  const notifications = new Set()

  function loadPinged() {
    if (pinged !== undefined) return pinged
    try {
      pinged = new Map(Object.entries(JSON.parse(fs.readFileSync(PINGED_FILE, 'utf8'))))
    } catch {
      pinged = null
    }
    return pinged
  }

  /** What needs you now, one entry per pull request, with when it last changed. */
  function pingsFor(gh) {
    const out = []
    for (const pr of gh.mine) {
      // Its attention may be a guess until GitHub knows about conflicts; its last ping stands meanwhile.
      if (pr.mergeUnknown) continue
      if (pr.attention === 'fix' || pr.attention === 'reply' || pr.attention === 'ready') out.push({ pr, kind: pr.attention, at: pr.turnAt ?? 0, body: pr.reason })
    }
    for (const pr of gh.review) {
      const body = pr.requested === false ? `${pr.change} since your review, from ${pr.author}`
        : pr.rereview ? `${pr.author} asked you to review again` : `${pr.author} asked for your review`
      out.push({ pr, kind: 'review', at: pr.waitingSince ?? 0, body })
    }
    return out
  }

  // A pull request pings when it starts needing you, or when something newer happens on it.
  function ping(gh) {
    const now = pingsFor(gh)
    const before = loadPinged()
    const fresh = before ? now.filter(p => {
      const last = before.get(p.pr.id)
      return !last || last.kind !== p.kind || p.at > last.at
    }) : []
    const seen = Date.now()
    pinged = new Map([...(before ?? [])].filter(([, entry]) => seen - (entry.seen ?? 0) < PINGED_KEEP))
    for (const p of now) pinged.set(p.pr.id, { kind: p.kind, at: Math.max(p.at, before?.get(p.pr.id)?.at ?? 0), seen })
    try {
      fs.mkdirSync(path.dirname(PINGED_FILE), { recursive: true })
      fs.writeFileSync(PINGED_FILE, JSON.stringify(Object.fromEntries(pinged)))
    } catch {}
    // The first time, what's already waiting is on the Today page; pings are for what comes after.
    if (!before || !fresh.length || !publicSettings().pings || !Notification.isSupported()) return
    if (fresh.length > PINGS_AT_ONCE) {
      return show({ title: `${fresh.length} pull requests need you`, body: fresh.map(p => `#${p.pr.number}`).join(', ') }, showToday)
    }
    for (const p of fresh) {
      show({ title: p.pr.title, subtitle: `${p.pr.repo.split('/')[1]} #${p.pr.number}`, body: p.body }, () => shell.openExternal(p.pr.url))
    }
  }

  function show(options, onClick) {
    const notification = new Notification(options)
    // Kept, or it could be collected before its click arrives.
    notifications.add(notification)
    const done = () => notifications.delete(notification)
    notification.on('click', () => {
      done()
      onClick()
    })
    notification.on('close', done)
    notification.show()
  }

  // The folders the page last asked about, for the "repositories you have sessions in" scope.
  let lastFolders = null
  setInterval(() => lastFolders && github(lastFolders).catch(() => {}), PING_EVERY)

  // ── Linear ────────────────────────────────────────────────────────────────────────────────────

  let linearCache = null

  async function linearQuery(key, query, variables) {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: key },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20000),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body.errors?.length) throw new Error(body.errors?.[0]?.message ?? `Linear answered ${response.status}`)
    return body.data
  }

  const ISSUE_FIELDS = `id identifier title url priority priorityLabel updatedAt createdAt completedAt dueDate branchName description
    state { name type color } team { id key name } project { name } cycle { number startsAt endsAt }
    attachments(first: 10) { nodes { url } }`

  function issue(n) {
    const now = Date.now()
    const cycle = n.cycle ? { number: n.cycle.number, current: Date.parse(n.cycle.startsAt) <= now && now <= Date.parse(n.cycle.endsAt) } : null
    return {
      id: `issue:${n.identifier}`,
      identifier: n.identifier,
      title: n.title,
      url: n.url,
      priority: n.priority ?? 0,
      priorityLabel: n.priorityLabel,
      state: { name: n.state?.name, type: n.state?.type, color: n.state?.color },
      team: n.team?.key,
      project: n.project?.name ?? null,
      cycle,
      due: n.dueDate ?? null,
      branch: n.branchName ?? null,
      updated: Date.parse(n.updatedAt),
      completed: n.completedAt ? Date.parse(n.completedAt) : null,
      description: clip(n.description ?? '', 4000),
      links: (n.attachments?.nodes ?? []).map(a => a.url),
    }
  }

  async function linear(force) {
    const key = linearKey()
    if (!key) return null
    if (!force && linearCache && Date.now() - linearCache.at < LINEAR_TTL) return linearCache
    const teams = stored().linearTeams ?? []
    const team = teams.length ? ', team: { id: { in: $teams } }' : ''
    const query = `query${teams.length ? '($teams: [ID!])' : ''} {
      viewer {
        open: assignedIssues(first: 80, orderBy: updatedAt, filter: { state: { type: { in: ["started", "unstarted"] } }${team} }) { nodes { ${ISSUE_FIELDS} } }
        done: assignedIssues(first: 50, orderBy: updatedAt, filter: { completedAt: { gte: "-P7D" }${team} }) { nodes { ${ISSUE_FIELDS} } }
      }
    }`
    try {
      const data = await linearQuery(key, query, teams.length ? { teams } : undefined)
      linearCache = {
        at: Date.now(),
        user: stored().linearUser,
        open: data.viewer.open.nodes.map(issue),
        done: data.viewer.done.nodes.map(issue).filter(i => i.completed).sort((a, b) => b.completed - a.completed),
      }
    } catch (error) {
      linearCache = { at: Date.now(), error: /401|authentic/i.test(error.message) ? 'Linear no longer accepts the key; connect it again in Settings.' : `Linear didn’t answer: ${oneLine(error.message, 200)}` }
    }
    return linearCache
  }

  /** Ties issues and pull requests together: Linear's GitHub links, its branch name, or the issue's id in a PR's title or branch. */
  function link(gh, lin) {
    if (!gh?.mine || !lin?.open) return
    const prs = [...gh.mine, ...gh.merged, ...gh.review]
    for (const pr of prs) pr.issues = []
    for (const i of [...lin.open, ...lin.done]) {
      const id = i.identifier.toLowerCase()
      const mentions = text => typeof text === 'string' && new RegExp(`(^|[^a-z0-9])${id}([^0-9]|$)`, 'i').test(text)
      i.prs = prs.filter(pr => i.links.includes(pr.url) || (i.branch && pr.branch === i.branch) || mentions(pr.title) || mentions(pr.branch))
        .map(pr => {
          if (!pr.issues.includes(i.id)) pr.issues.push(i.id)
          return pr.id
        })
      i.prs = [...new Set(i.prs)]
      i.repo = prs.find(pr => pr.id === i.prs[0])?.repo ?? null
    }
    // An issue without a pull request yet belongs where its team's others go.
    const byTeam = new Map()
    for (const i of [...lin.open, ...lin.done]) if (i.repo) byTeam.set(i.team, [...(byTeam.get(i.team) ?? []), i.repo])
    for (const i of [...lin.open, ...lin.done]) {
      const repos = byTeam.get(i.team)
      if (!i.repo && repos) i.repo = repos.sort((a, b) => repos.filter(r => r === b).length - repos.filter(r => r === a).length)[0]
    }
  }

  ipcMain.handle('status:collect', async (_e, { folders = [], force = false } = {}) => {
    lastFolders = folders
    const [gh, lin] = await Promise.all([github(folders, force), linear(force)])
    link(gh, lin)
    return { github: gh, linear: lin, at: Date.now() }
  })

  ipcMain.handle('status:repo-folders', async (_e, repo, folders) => {
    const found = []
    for (const folder of folders) if ((await repoOf(folder))?.toLowerCase() === String(repo).toLowerCase()) found.push(folder)
    return found
  })

  /** A worktree's main checkout, so its repository is offered rather than each worktree; null when gone. */
  async function checkoutOf(folder) {
    if (!fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory()) return null
    const common = await run('git', ['-C', folder, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { timeout: 5000 }).catch(() => '')
    const root = common.trim().replace(/\/\.git\/?$/, '')
    return root && root !== common.trim() ? root : folder
  }

  // Folders to offer for a new session: each folder's checkout, if it's still there, and a clone of
  // each repository, from those folders or, failing them, beside them under the repository's own name.
  ipcMain.handle('status:folders', async (_e, folders, wanted) => {
    const roots = {}
    for (const folder of folders) {
      const root = await checkoutOf(folder)
      if (root) roots[folder] = { root, repo: await repoOf(root) }
    }
    const parents = [...new Set(Object.values(roots).map(r => path.dirname(r.root)))]
    const clones = {}
    for (const repo of wanted) {
      const known = Object.values(roots).find(r => r.repo?.toLowerCase() === repo.toLowerCase())
      if (known) {
        clones[repo] = known.root
        continue
      }
      for (const parent of parents) {
        const guess = path.join(parent, repo.split('/')[1] ?? repo)
        if ((await checkoutOf(guess)) === guess && (await repoOf(guess))?.toLowerCase() === repo.toLowerCase()) {
          clones[repo] = guess
          break
        }
      }
    }
    return { roots, clones }
  })

  ipcMain.handle('status:repos', async (_e, folders) => Object.fromEntries(await Promise.all(folders.map(async f => [f, await repoAt(f)]))))

  // ── Journal ───────────────────────────────────────────────────────────────────────────────────

  const startFile = path.join(journalDir, '.start')
  const journalStart = () => {
    try {
      return Number(fs.readFileSync(startFile, 'utf8')) || null
    } catch {
      return null
    }
  }

  ipcMain.on('journal:add', (_e, entry) => {
    if (!entry || !['prompt', 'reply'].includes(entry.kind)) return
    const t = Date.now()
    const line = {
      t,
      kind: entry.kind,
      session: oneLine(entry.session, 40),
      name: oneLine(entry.name, 80),
      group: oneLine(entry.group, 60),
      folder: clip(entry.folder, 500),
      branch: oneLine(entry.branch, 200),
      claude: oneLine(entry.claude, 64),
      text: clip(entry.kind === 'prompt' ? cleanPrompt(entry.text) : typeof entry.text === 'string' ? entry.text.trim() : '', entry.kind === 'prompt' ? 1500 : 2000),
    }
    try {
      if (!fs.existsSync(startFile)) fs.writeFileSync(startFile, String(t))
      fs.appendFileSync(path.join(journalDir, `${dayKey(t)}.jsonl`), `${JSON.stringify(line)}\n`)
    } catch {}
  })

  async function readJournal(since) {
    const files = (await fsp.readdir(journalDir).catch(() => [])).filter(f => /^\d{4}-\d{2}-\d{2}(\.backfill)?\.jsonl$/.test(f))
    const first = dayKey(since)
    const entries = []
    for (const file of files) {
      if (file.slice(0, 10) < first) continue
      const text = await fsp.readFile(path.join(journalDir, file), 'utf8').catch(() => '')
      for (const line of text.split('\n')) {
        if (!line) continue
        try {
          const entry = JSON.parse(line)
          if (entry.t >= since) entries.push(entry)
        } catch {}
      }
    }
    return entries.sort((a, b) => a.t - b.t)
  }

  // Old days go; the journal is for briefs and standups, not an archive.
  for (const file of fs.readdirSync(journalDir)) {
    const day = Date.parse(file.slice(0, 10))
    if (day && Date.now() - day > JOURNAL_KEEP) fs.rmSync(path.join(journalDir, file), { force: true })
  }

  // Before the journal began, Claude Code's own transcripts are the only record: their prompts (not
  // replies, which are most of the 800 MB a busy week writes) are read once, from interactive sessions.
  let backfilling = null
  function backfill() {
    const marker = path.join(journalDir, '.backfilled')
    if (fs.existsSync(marker)) return Promise.resolve()
    backfilling ??= (async () => {
      const until = journalStart() ?? Date.now()
      const since = Date.now() - BACKFILL_DAYS * DAY
      const root = path.join(os.homedir(), '.claude', 'projects')
      const found = []
      for (const dir of await fsp.readdir(root).catch(() => [])) {
        for (const file of await fsp.readdir(path.join(root, dir)).catch(() => [])) {
          if (!file.endsWith('.jsonl')) continue
          const full = path.join(root, dir, file)
          const stat = await fsp.stat(full).catch(() => null)
          if (!stat || stat.mtimeMs < since) continue
          found.push(...await promptsIn(full, since, until))
        }
      }
      const byDay = new Map()
      for (const entry of found) byDay.set(dayKey(entry.t), [...(byDay.get(dayKey(entry.t)) ?? []), entry])
      for (const [day, entries] of byDay) {
        await fsp.writeFile(path.join(journalDir, `${day}.backfill.jsonl`), entries.sort((a, b) => a.t - b.t).map(e => JSON.stringify(e)).join('\n') + '\n')
      }
      await fsp.writeFile(marker, String(Date.now()))
    })().catch(() => {}).finally(() => (backfilling = null))
    return backfilling
  }

  async function promptsIn(file, since, until) {
    const entries = []
    const titles = {}
    const lines = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
    for await (const line of lines) {
      // Most lines are tool calls and their output; only titles and typed prompts are parsed.
      if (line.includes('"ai-title"') || line.includes('"custom-title"')) {
        try {
          const e = JSON.parse(line)
          if (e.customTitle) titles.custom = e.customTitle
          if (e.aiTitle) titles.ai = e.aiTitle
        } catch {}
        continue
      }
      if (!line.startsWith('{"') || !line.includes('"type":"user"') || line.includes('"tool_result"')) continue
      let e
      try {
        e = JSON.parse(line)
      } catch {
        continue
      }
      const content = e.message?.content
      if (e.type !== 'user' || e.isSidechain || e.isMeta || typeof content !== 'string' || content.startsWith('<')) continue
      if (e.entrypoint && e.entrypoint !== 'cli') continue
      const t = Date.parse(e.timestamp)
      if (!(t >= since && t < until)) continue
      const text = cleanPrompt(content)
      if (text) entries.push({ t, kind: 'prompt', claude: e.sessionId, folder: e.cwd, branch: e.gitBranch, text: clip(text, 1500), source: 'transcript' })
    }
    // Most conversations have no title; their first prompt says best what they were about.
    const name = titles.custom ?? titles.ai ?? oneLine(entries[0]?.text, 48)
    if (name) for (const entry of entries) entry.name = name
    return entries
  }

  /** The journal's entries since `days` ago, prompts and replies cut short, for the Week view. */
  ipcMain.handle('status:journal', async (_e, days = 7) => {
    await backfill()
    const since = new Date(Date.now() - (days - 1) * DAY).setHours(0, 0, 0, 0)
    return Promise.all((await readJournal(since)).map(async e => ({ ...e, text: clip(e.text, 280), repo: await repoAt(e.folder) })))
  })

  // ── Claude's brief and standup ────────────────────────────────────────────────────────────────

  const REF = 'Refer to items only by their ids exactly as given in square brackets (like pr:owner/repo#12, issue:ABC-123, session:ab12cd34, note:x1), and only in `refs`, never in the text.'
  const STYLE = 'Be concrete and short, in the user\'s own terms (their session names, issue and PR titles). No generic advice, no filler, no invented facts or numbers. Write in English unless the user\'s instructions ask for another language.'

  const BRIEF = {
    system: [
      'You write the brief at the top of the status page of Own Term, a macOS terminal where a developer runs Claude Code in many sessions at once.',
      'The user message lists what is true right now: their sessions and what each is doing, reminders, to-dos, their open pull requests, pull requests waiting for their review, their Linear issues, and a log of what they asked Claude recently.',
      'Tell them what to look at and pick up first, and where each line of work stands.',
      'Order by what unblocks others or has waited longest: a teammate waiting on a review, a PR with failing checks or requested changes, a session waiting for an answer, then planned work.',
      REF, STYLE,
    ].join(' '),
    schema: {
      type: 'object',
      properties: {
        headline: { type: 'string', description: 'One sentence, under 25 words: the state of things and the most important thing now.' },
        focus: {
          type: 'array', maxItems: 3, description: 'What to do first, in order.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Imperative, at most 8 words.' },
              why: { type: 'string', description: 'One short sentence.' },
              refs: { type: 'array', items: { type: 'string' } },
            },
            required: ['title', 'why', 'refs'],
          },
        },
        threads: {
          type: 'array', maxItems: 6, description: 'Each line of work (a project, group or issue) and where it stands.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'At most 4 words.' },
              summary: { type: 'string', description: 'One or two sentences: done, in progress, next.' },
              refs: { type: 'array', items: { type: 'string' } },
            },
            required: ['name', 'summary', 'refs'],
          },
        },
        risks: {
          type: 'array', maxItems: 4, description: 'Things going stale or at risk; empty when nothing is.',
          items: { type: 'object', properties: { text: { type: 'string' }, refs: { type: 'array', items: { type: 'string' } } }, required: ['text', 'refs'] },
        },
      },
      required: ['headline', 'focus', 'threads', 'risks'],
    },
    days: 2,
    entries: 160,
    textMax: 300,
  }

  const LINE = { type: 'object', properties: { text: { type: 'string', description: 'One line.' }, refs: { type: 'array', items: { type: 'string' } } }, required: ['text', 'refs'] }
  const STANDUP_SAYS = [
    'You write a developer\'s standup update for the last seven days, from the facts in the user message: what they asked Claude to do in each session (a log),',
    'pull requests they merged, opened and reviewed, Linear issues they completed and have in progress, and their to-dos.',
  ]
  const STANDUP_HOW = [
    'Merge the log into outcomes; a dozen prompts on one feature is one line. Done is past tense, about results. In progress says how far along. Next is what they plan, from to-dos, issues in the current cycle and unfinished work.',
    'Blockers only when something really waits on someone else.',
    REF, STYLE,
  ]
  const STANDUP = {
    system: [
      ...STANDUP_SAYS,
      'Group it by the user\'s projects, listed in the facts with their repositories, using their names exactly; most active first.',
      'Work in none of them goes in a project of its own, named for what it is. Never mix two projects in one line.',
      ...STANDUP_HOW,
    ].join(' '),
    schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One sentence about the week.' },
        projects: {
          type: 'array', maxItems: 8,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'The project as the user calls it, like a product or group name; at most 3 words, nothing in brackets.' },
              summary: { type: 'string', description: 'One sentence about this project\'s week.' },
              done: { type: 'array', maxItems: 6, items: LINE },
              doing: { type: 'array', maxItems: 5, items: LINE },
              next: { type: 'array', maxItems: 5, items: LINE },
              blockers: { type: 'array', maxItems: 3, items: LINE },
            },
            required: ['name', 'summary', 'done', 'doing', 'next', 'blockers'],
          },
        },
      },
      required: ['summary', 'projects'],
    },
    days: 7,
    entries: 450,
    textMax: 200,
  }

  // One project's standup has no projects inside it; it's stored in the same shape as the rest.
  const PROJECT_STANDUP = {
    ...STANDUP,
    system: [...STANDUP_SAYS, ...STANDUP_HOW].join(' '),
    schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One sentence about the project\'s week.' },
        done: { type: 'array', maxItems: 8, items: LINE },
        doing: { type: 'array', maxItems: 6, items: LINE },
        next: { type: 'array', maxItems: 6, items: LINE },
        blockers: { type: 'array', maxItems: 4, items: LINE },
      },
      required: ['summary', 'done', 'doing', 'next', 'blockers'],
    },
  }

  // The Today page's chat: questions about the same facts, answered as they're written, with Own
  // Term's tools for what the user asks it to change.
  const CHAT = {
    system: [
      'You answer questions on the Today page of Own Term, a macOS terminal where a developer runs Claude Code in many sessions at once.',
      'The first message lists what is true right now: their sessions and what each is doing, reminders, to-dos, their pull requests and reviews, their Linear issues, the brief on the page, and a log of what they asked Claude this week.',
      'Answer from those facts; when they don\'t say, say so rather than guess. You have no files or shell; you are not working in any repository.',
      'The own-term tools change their sidebar and Today page (to-dos, reminders, starting and showing sessions, sending a prompt to a session). Use them only when the user asks for that change, and say what you did.',
      'When you mention a session, pull request, issue or to-do, put its id in square brackets right after it, exactly as given (like [pr:owner/repo#12], [issue:ABC-123], [session:ab12cd34], [note:x1]); the page turns each into a link. Never write a URL for one.',
      'Write plain text for a narrow panel: short paragraphs and "- " lists, no headings or tables. Lead with the answer.',
      STYLE,
    ].join(' '),
    days: 7,
    entries: 300,
    textMax: 240,
  }

  // Asked from the Week tab: the same facts, with the standup, about the week rather than today.
  const WEEK_CHAT = {
    ...CHAT,
    system: `${CHAT.system} The user is asking from the Week view, about the last seven days: what got done, where the time went, what is still open. The standup written for the week is in the facts too.`,
    // A busy week is over a thousand prompts; without Claude's replies the log still reaches back to its start.
    promptsOnly: true,
    entries: 1000,
    textMax: 140,
  }

  const SPECS = { brief: BRIEF, standup: STANDUP, chat: CHAT, week: WEEK_CHAT }

  const when = t => new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const daysAgo = t => {
    const days = Math.floor((Date.now() - t) / DAY)
    return days < 1 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
  }
  const tilde = p => (typeof p === 'string' ? p.replace(os.homedir(), '~') : p)

  /** Everything Claude reads for a brief or standup, as plain text with each item's id; for one project, only what's in it. */
  async function facts(kind, snapshot) {
    const spec = SPECS[kind]
    const sessions = snapshot.sessions ?? []
    const project = snapshot.project
    const ours = repo => !project || (!!repo && project.repos.some(r => r.toLowerCase() === repo.toLowerCase()))
    let [gh, lin] = await Promise.all([github(sessions.map(s => s.folder), false), linear(false)])
    link(gh, lin)
    if (project && gh && !gh.error) gh = { ...gh, ...Object.fromEntries(['mine', 'review', 'merged', 'reviewed'].map(k => [k, gh[k].filter(pr => ours(pr.repo))])) }
    if (project && lin && !lin.error) lin = { ...lin, open: lin.open.filter(i => ours(i.repo)), done: lin.done.filter(i => ours(i.repo)) }
    await backfill()
    const out = [`Now: ${new Date().toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.`]
    if (snapshot.user) out.push(`The user is ${snapshot.user}.`)
    const instructions = stored().instructions?.trim()
    if (instructions) out.push(`The user's instructions for you:\n${instructions}`)
    if (project) out.push(`\nThis is about one of the user's projects, ${project.name} (${project.repos.join(', ') || 'no repository'}). Everything below is only what belongs to it; keep to it.`)
    else if (snapshot.projects?.length) out.push('\n## The user\'s projects', ...snapshot.projects.map(p => `- ${p.name}: ${p.repos.join(', ') || 'no repository'}`))
    const standup = kind === 'week' && cached('standup', project?.name)
    if (standup?.value) {
      const u = standup.value
      out.push(`\n## The standup on the Week view, written ${when(standup.at)}`, u.summary,
        ...u.projects.flatMap(p => [p.summary && `- ${p.name}: ${p.summary}`].filter(Boolean).concat(['done', 'doing', 'next', 'blockers'].flatMap(k => p[k].map(l => `- ${p.name ? `${p.name}, ` : ''}${k}: ${l.text} ${l.refs.map(r => `[${r}]`).join(' ')}`)))))
    }
    const brief = (kind === 'chat' || kind === 'week') && cached('brief', project?.name)
    if (brief?.value) {
      const b = brief.value
      out.push(`\n## The brief on the page, written ${when(brief.at)}`, b.headline,
        ...b.focus.map((f, i) => `${i + 1}. ${f.title}: ${f.why} ${f.refs.map(r => `[${r}]`).join(' ')}`),
        ...(b.threads ?? []).map(t => `- ${t.name}: ${t.summary}`),
        ...(b.risks ?? []).map(r => `- Risk: ${r.text}`))
    }

    out.push('\n## Sessions in Own Term')
    if (!sessions.length) out.push('None.')
    for (const s of sessions) {
      out.push(`[session:${s.id}] ${s.name}${s.group ? ` (group ${s.group})` : ''}: ${s.status}${s.since ? ` since ${when(s.since)}` : ''}; ${tilde(s.folder)}${s.branch ? `, branch ${s.branch}` : ''}${s.changes ? `, ${s.changes} uncommitted` : ''}${s.last ? `. Last: "${oneLine(s.last, 240)}"` : ''}`)
    }
    const due = sessions.filter(s => s.due)
    if (due.length) {
      out.push('\n## Reminders that came due and wait for the user')
      for (const s of due) out.push(`[session:${s.id}] due ${when(s.due.at)}${s.due.note ? `: ${s.due.note}` : ''}`)
    }
    const reminders = sessions.filter(s => s.remind)
    if (reminders.length) {
      out.push('\n## Reminders the user set')
      for (const s of reminders) out.push(`[session:${s.id}] due ${when(s.remind.at)}${s.remind.note ? `: ${s.remind.note}` : ''}`)
    }
    const notes = snapshot.notes ?? []
    out.push('\n## To-dos')
    if (!notes.length) out.push('None.')
    for (const n of notes) {
      out.push(`[note:${n.id}] ${n.done ? `(done ${when(n.done)}) ` : ''}${oneLine(n.text, 300)}${n.issue ? ` [issue:${n.issue}]` : ''}${n.session ? ` [session:${n.session}]` : ''}${n.due ? ` (reminder came due ${when(n.due)})` : n.remind ? ` (reminder ${when(n.remind)})` : ''} (added by ${n.by === 'claude' ? 'Claude' : 'the user'} ${daysAgo(n.created)})`)
    }

    if (gh?.error) out.push(`\n## GitHub\nUnavailable: ${gh.error}`)
    else if (gh) {
      const prLine = pr => `[${pr.id}] "${pr.title}" in ${pr.repo}`
      out.push('\n## The user\'s open pull requests')
      if (!gh.mine.length) out.push('None.')
      for (const pr of gh.mine) out.push(`${prLine(pr)}: ${pr.reason}; opened ${daysAgo(pr.created)}, updated ${daysAgo(pr.updated)}; branch ${pr.branch}${pr.issues?.length ? `; ${pr.issues.map(i => `[${i}]`).join(' ')}` : ''}`)
      out.push('\n## Pull requests waiting for the user\'s review')
      if (!gh.review.length) out.push('None.')
      for (const pr of gh.review) out.push(`${prLine(pr)} by ${pr.author}: waiting ${daysAgo(pr.waitingSince).replace(' ago', '')}${pr.requested === false ? `, ${pr.change} since their review (not asked again)` : pr.rereview ? ', changed since their last review' : ''}${pr.draft ? ', draft' : ''}`)
      out.push(`\n## Merged by the user in the last 7 days`)
      if (!gh.merged.length) out.push('None.')
      for (const pr of gh.merged) out.push(`${prLine(pr)}: merged ${when(pr.mergedAt)}${pr.issues?.length ? `; ${pr.issues.map(i => `[${i}]`).join(' ')}` : ''}`)
      if (kind !== 'brief') {
        out.push('\n## Reviewed by the user in the last 7 days')
        if (!gh.reviewed.length) out.push('None.')
        for (const pr of gh.reviewed) out.push(`${prLine(pr)} by ${pr.author}: ${pr.verdict?.toLowerCase().replace('_', ' ') ?? 'reviewed'} ${when(pr.reviewedAt)}`)
      }
    }

    if (lin?.error) out.push(`\n## Linear\nUnavailable: ${lin.error}`)
    else if (lin) {
      const issueLine = i => `[${i.id}] "${i.title}": ${i.state.name}; ${i.priorityLabel ?? 'no priority'}${i.cycle?.current ? '; in the current cycle' : ''}${i.due ? `; due ${i.due}` : ''}${i.project ? `; project ${i.project}` : ''}${i.prs?.length ? `; ${i.prs.map(p => `[${p}]`).join(' ')}` : ''}`
      out.push('\n## Linear issues assigned to the user')
      if (!lin.open.length) out.push('None.')
      for (const i of lin.open) out.push(issueLine(i))
      out.push('\n## Linear issues the user completed in the last 7 days')
      if (!lin.done.length) out.push('None.')
      for (const i of lin.done) out.push(`${issueLine(i)}; completed ${when(i.completed)}`)
    }

    // The log, newest kept when it's long; a backfilled prompt finds its session by its conversation.
    const since = new Date(Date.now() - (spec.days - 1) * DAY).setHours(0, 0, 0, 0)
    const byClaude = new Map(sessions.filter(s => s.claude).map(s => [s.claude, s]))
    let entries = (await readJournal(since)).filter(e => !spec.promptsOnly || e.kind === 'prompt')
    if (project) {
      const repos = await Promise.all(entries.map(e => repoAt(e.folder)))
      entries = entries.filter((e, i) => sessions.some(s => s.id === e.session) || byClaude.has(e.claude) || ours(repos[i]))
    }
    entries = entries.slice(-spec.entries)
    out.push(`\n## What the user asked Claude, and Claude's replies, since ${when(since)}`)
    if (!entries.length) out.push('Nothing logged.')
    let day = ''
    for (const e of entries) {
      const d = new Date(e.t).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
      if (d !== day) out.push(`### ${(day = d)}`)
      const session = sessions.find(s => s.id === e.session) ?? byClaude.get(e.claude)
      const who = session ? `[session:${session.id}] ${session.name}` : `${e.name ?? path.basename(e.folder ?? '') ?? 'a session'}${e.folder ? ` (${tilde(e.folder)})` : ''}`
      const time = new Date(e.t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      out.push(`${time} ${who}${e.group ? ` · ${e.group}` : ''}${e.branch ? ` · ${e.branch}` : ''} ${e.kind === 'prompt' ? 'asked' : 'Claude'}: "${oneLine(e.text, spec.textMax)}"`)
    }
    return out.join('\n')
  }

  function askClaude(system, input, schema, model) {
    return new Promise((resolve, reject) => {
      const child = execFile('claude', [
        '-p', '--model', model, '--no-session-persistence', '--tools', '', '--disable-slash-commands', '--strict-mcp-config',
        '--system-prompt', system, '--output-format', 'json', '--json-schema', JSON.stringify(schema),
      ], { cwd: os.tmpdir(), env: shellEnv(), timeout: 300000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        let out
        try {
          out = JSON.parse(stdout)
        } catch {
          return reject(new Error(oneLine(stderr || error?.message || 'Claude gave no answer.', 300)))
        }
        if (out.is_error || !out.structured_output) return reject(new Error(oneLine(out.result || 'Claude gave no answer.', 300)))
        resolve(out.structured_output)
      })
      child.stdin.end(input)
    })
  }

  // A project's own is kept beside the one about everything, under a name safe for any project name.
  const cacheFile = (kind, project) => path.join(dataDir, project ? `${kind}-${crypto.createHash('sha1').update(project).digest('hex').slice(0, 12)}.json` : `${kind}.json`)
  const cached = (kind, project) => {
    try {
      const result = JSON.parse(fs.readFileSync(cacheFile(kind, project), 'utf8'))
      // A standup written before they were split by project reads as one without a name.
      const u = kind === 'standup' && result.value
      if (u && !u.projects) result.value = { summary: u.summary, projects: [{ name: '', summary: '', done: u.done, doing: u.doing, next: u.next, blockers: u.blockers }] }
      return result
    } catch {
      return null
    }
  }

  ipcMain.handle('status:cached', (_e, project) => ({ brief: cached('brief', project), standup: cached('standup', project) }))

  // One at a time per kind and project: opening the page twice mustn't pay for two.
  const writing = new Map()
  ipcMain.handle('status:write', (_e, kind, snapshot = {}) => {
    if (kind !== 'brief' && kind !== 'standup') return { error: 'Unknown kind.' }
    if (!publicSettings().ai) return { error: 'Claude’s summaries are off in Settings.' }
    const project = snapshot.project?.name
    const key = `${kind}:${project ?? ''}`
    if (!writing.has(key)) {
      const spec = kind === 'brief' ? BRIEF : project ? PROJECT_STANDUP : STANDUP
      writing.set(key, (async () => {
        const input = await facts(kind, snapshot)
        let value = await askClaude(spec.system, input, spec.schema, publicSettings().model)
        if (kind === 'standup' && project) value = { summary: value.summary, projects: [{ name: project, ...value }] }
        const result = { value, at: Date.now() }
        await fsp.writeFile(cacheFile(kind, project), JSON.stringify(result))
        return result
      })().catch(error => ({ error: error.message })).finally(() => writing.delete(key)))
    }
    return writing.get(key)
  })

  // ── The chat ──────────────────────────────────────────────────────────────────────────────────

  // Claude Code files a conversation under its folder, so the chat's sit in a project of their own in
  // ~/.claude/projects, named after this one, rather than in one of the user's.
  const chatDir = path.join(dataDir, 'chat')
  fs.mkdirSync(chatDir, { recursive: true })
  const chats = new Map()

  /**
   * One question, answered by `claude -p` as it's written: `chat:event` carries the text, and each
   * tool Claude uses, as they come. The first question of a conversation carries the facts, and so
   * does a later one the window asks to `refresh`.
   */
  ipcMain.handle('chat:ask', async (e, requestId, scope, question, snapshot, resume, refresh) => {
    const kind = scope === 'week' ? 'week' : 'chat'
    if (!publicSettings().ai) return { error: 'Claude’s summaries are off in Settings.' }
    if (typeof question !== 'string' || !question.trim()) return { error: 'Nothing was asked.' }
    const emit = event => !e.sender.isDestroyed() && e.sender.send('chat:event', requestId, event)
    // Held from the start, so a Stop while the facts are gathered is kept rather than lost.
    chats.set(requestId, null)
    const now = `Now: ${new Date().toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.`
    const input = !resume
      ? `${await facts(kind, snapshot ?? {})}\n\n## The user asks\n${question.trim()}`
      : refresh
        ? `What is true now, in place of the facts given earlier:\n\n${await facts(kind, snapshot ?? {})}\n\n## The user asks\n${question.trim()}`
        : `${now}\n\n${question.trim()}`
    if (!chats.has(requestId)) return { claude: resume, stopped: true }
    const tools = ownTools()
    const child = spawn('claude', [
      '-p', '--model', publicSettings().model, '--tools', '', '--disable-slash-commands',
      '--strict-mcp-config', '--mcp-config', tools.config, '--allowedTools', 'mcp__own-term',
      '--system-prompt', SPECS[kind].system, '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      ...(typeof resume === 'string' && /^[\w-]+$/.test(resume) ? ['--resume', resume] : []),
    ], {
      cwd: chatDir,
      // The session is the Today page's, which the hook server knows from a shell's.
      env: { ...shellEnv(), DECKTERM_PORT: String(tools.port), DECKTERM_TOKEN: tools.token, DECKTERM_SESSION: tools.session },
    })
    chats.set(requestId, child)
    // A Claude that exits before reading it all (not signed in, say) mustn't take main down with EPIPE.
    child.stdin.on('error', () => {})
    child.stdin.end(input)
    let stderr = ''
    let result = null
    let claude = resume
    child.stderr.on('data', chunk => (stderr = (stderr + chunk).slice(-2000)))
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
    lines.on('line', line => {
      let m
      try {
        m = JSON.parse(line)
      } catch {
        return
      }
      if (m.session_id) claude = m.session_id
      if (m.type === 'result') result = m
      const ev = m.type === 'stream_event' && m.event
      if (!ev || m.parent_tool_use_id) return
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') emit({ type: 'text', text: ev.delta.text })
      if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') emit({ type: 'tool', name: ev.content_block.name })
    })
    // Longer than wait_for's longest wait, which a question may well ask for.
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, 35 * 60_000)
    const code = await new Promise(resolve => {
      child.on('close', resolve)
      child.on('error', error => {
        stderr = error.message
        resolve(-1)
      })
    })
    clearTimeout(timer)
    const stopped = !chats.has(requestId)
    chats.delete(requestId)
    if (stopped) return { claude, stopped: true }
    if (result && !result.is_error) return { claude }
    const why = timedOut ? 'Claude took over half an hour, so it was stopped.' : code === null ? 'Claude was stopped.' : `Claude stopped (${code}).`
    return { claude, error: oneLine(result?.result || stderr || why, 300) }
  })

  ipcMain.on('chat:stop', (_e, requestId) => {
    const child = chats.get(requestId)
    chats.delete(requestId)
    child?.kill()
  })

  // ── Worktrees for the page's actions ──────────────────────────────────────────────────────────

  /** A pull request checked out (detached) in its own worktree of a local clone, to review it there. */
  ipcMain.handle('status:review-worktree', async (_e, folder, number) => {
    if (!Number.isInteger(number) || number <= 0) throw new Error('No pull request number.')
    const commonDir = await run('git', ['-C', folder, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    const root = path.dirname(commonDir)
    const dir = path.join(root, '.claude', 'worktrees', `review-${number}`)
    // A named ref, since each worktree has its own FETCH_HEAD.
    const ref = `refs/remotes/origin/pr/${number}`
    await run('git', ['-C', root, 'fetch', 'origin', `+pull/${number}/head:${ref}`], { timeout: 120000 })
    if (fs.existsSync(dir)) await run('git', ['-C', dir, 'checkout', '--detach', ref])
    else await run('git', ['-C', root, 'worktree', 'add', '--detach', dir, ref])
    return dir
  })

  return { publicSettings }
}
