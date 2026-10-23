import type { Note } from './store'

// The Today page for the demo day (demo-data.ts): Juniper's pull requests, Linear issues, to-dos, a
// week of prompts, and the brief and standup Claude would write about them. Everything is invented.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const ago = (ms: number) => Date.now() - ms

const pr = (repo: string, number: number, title: string, author: string, branch: string, more: Partial<StatusPr> = {}): StatusPr => ({
  id: `pr:juniper/${repo}#${number}`,
  repo: `juniper/${repo}`,
  number,
  title,
  url: `https://example.com/juniper/${repo}/pull/${number}`,
  author,
  created: ago(2 * DAY),
  updated: ago(3 * HOUR),
  draft: false,
  branch,
  additions: 120,
  deletions: 30,
  ...more,
})

// Linear's project, and the repository whose project on the rail the issue is listed in.
const issue = (n: number, title: string, state: StatusIssue['state'], priority: number, project: string, repo: string, more: Partial<StatusIssue> = {}): StatusIssue => ({
  id: `issue:JUN-${n}`,
  identifier: `JUN-${n}`,
  title,
  url: `https://example.com/juniper/issue/JUN-${n}`,
  priority,
  priorityLabel: ['No priority', 'Urgent', 'High', 'Medium', 'Low'][priority],
  state,
  team: 'JUN',
  project,
  cycle: { number: 14, current: true },
  due: null,
  branch: null,
  updated: ago(n * MINUTE),
  completed: null,
  description: '',
  links: [],
  prs: [],
  repo: `juniper/${repo}`,
  ...more,
})

const STARTED = { name: 'In Progress', type: 'started', color: '#f2c94c' }
const REVIEW = { name: 'In Review', type: 'started', color: '#4cb782' }
const TODO = { name: 'Todo', type: 'unstarted', color: '#a0a3ab' }
const DONE = { name: 'Done', type: 'completed', color: '#5e6ad2' }

export function demoData(): StatusData {
  return {
    at: Date.now(),
    github: {
      at: Date.now(),
      login: 'sam',
      mine: [
        pr('shop', 412, 'Make payment retries idempotent', 'sam', 'fix/idempotent-retry', { checks: 'passing', review: 'changes', conflicts: false, attention: 'fix', reason: 'Changes requested', issues: ['issue:JUN-138'] }),
        pr('ios', 58, 'Fix the crash on launch with an empty cart', 'sam', 'fix/launch-crash', { checks: 'passing', review: 'approved', conflicts: false, attention: 'ready', reason: 'Approved, ready to merge', updated: ago(40 * MINUTE) }),
        pr('shop', 418, 'Add Apple Pay to checkout', 'sam', 'feat/apple-pay', { checks: 'pending', review: 'none', conflicts: false, attention: 'waiting', reason: 'Checks running', issues: ['issue:JUN-142'], updated: ago(12 * MINUTE) }),
        pr('docs', 96, 'Rewrite the getting started guide', 'sam', 'docs/getting-started', { draft: true, checks: 'passing', review: 'none', conflicts: false, attention: 'draft', reason: 'Draft', updated: ago(5 * HOUR) }),
      ],
      review: [
        pr('shop', 409, 'Cache shipping rates per postcode', 'lena-k', 'feat/rate-cache', { waitingSince: ago(3 * DAY + 2 * HOUR) }),
        pr('shop', 419, 'Move the order export to a background job', 'tomasz', 'feat/export-job', { waitingSince: ago(26 * HOUR), rereview: true }),
        pr('ios', 57, 'Show saved carts while offline', 'ade-o', 'feat/offline-carts', { waitingSince: ago(5 * HOUR) }),
      ],
      merged: [
        pr('shop', 405, 'Show delivery dates on product pages', 'sam', 'feat/delivery-dates', { mergedAt: ago(DAY + 3 * HOUR), issues: ['issue:JUN-131'] }),
        pr('shop', 398, 'Retry failed webhooks with backoff', 'sam', 'fix/webhook-retry', { mergedAt: ago(3 * DAY + 5 * HOUR) }),
        pr('ios', 54, 'Sign in with Apple', 'sam', 'feat/apple-sign-in', { mergedAt: ago(4 * DAY + HOUR) }),
      ],
      reviewed: [
        pr('shop', 407, 'Show stock levels on the cart page', 'lena-k', 'feat/stock-levels', { reviewedAt: ago(2 * DAY), verdict: 'APPROVED' }),
        pr('docs', 94, 'Document the 4.2 webhooks', 'tomasz', 'docs/webhooks', { reviewedAt: ago(DAY + 6 * HOUR), verdict: 'CHANGES_REQUESTED' }),
      ],
    },
    linear: {
      at: Date.now(),
      user: { name: 'Sam', org: 'Juniper' },
      open: [
        issue(138, 'Customers charged twice when a payment retries', STARTED, 1, 'Checkout', 'shop', { prs: ['pr:juniper/shop#412'] }),
        issue(142, 'Apple Pay at checkout', STARTED, 2, 'Checkout', 'shop', { prs: ['pr:juniper/shop#418'], branch: 'feat/apple-pay' }),
        issue(151, 'Offline cart sync for the iOS app', REVIEW, 2, 'iOS app', 'ios', { branch: 'feat/offline-cart' }),
        issue(160, 'Load test checkout before the autumn sale', TODO, 2, 'Checkout', 'shop', { due: new Date(Date.now() + 6 * DAY).toISOString().slice(0, 10) }),
        issue(147, 'Help a store owner export Q3 orders', TODO, 3, 'Support', 'docs'),
        issue(155, 'Getting started guide for the 4.2 API', TODO, 4, 'Docs', 'docs'),
      ],
      done: [
        issue(131, 'Delivery dates on product pages', DONE, 3, 'Checkout', 'shop', { completed: ago(DAY + 3 * HOUR), prs: ['pr:juniper/shop#405'] }),
        issue(127, 'Webhooks give up after one failure', DONE, 2, 'Checkout', 'shop', { completed: ago(3 * DAY + 5 * HOUR) }),
      ],
    },
  }
}

/** On the hour, `hours` from when the day loads, so the Reminders page has a to-do today and later in the week. */
const onTheHour = (hours: number) => new Date(Date.now() + hours * HOUR).setMinutes(0, 0, 0)

export const DEMO_NOTES: Note[] = [
  { id: 'demo-note-1', text: 'Ask Lena whether the rate cache should expire at midnight', created: ago(2 * HOUR), by: 'you', project: 'Shop', remind: onTheHour(2) },
  { id: 'demo-note-2', text: 'Post the 4.2 release notes once it ships', created: ago(DAY), by: 'claude', session: 'demo-release-notes' },
  { id: 'demo-note-3', text: 'Split the load test into browse and pay', created: ago(3 * HOUR), by: 'claude', issue: 'JUN-160', project: 'Shop', remind: onTheHour(3 * 24) },
  { id: 'demo-note-4', text: 'Send the store owner the export steps', created: ago(2 * DAY), done: ago(5 * HOUR), by: 'you', issue: 'JUN-147', project: 'Docs' },
]

const BRIEFS: Record<string, Brief> = {
  '': {
    headline: 'Lena’s rate cache has waited three days for your review, and Apple Pay waits on the retry fix.',
    focus: [
      { title: 'Review the shipping-rate cache', why: 'Lena has waited three days, and the sale’s load test depends on it.', refs: ['pr:juniper/shop#409'] },
      { title: 'Answer the double-charge question', why: 'Claude is waiting on you, and the retry fix blocks Apple Pay.', refs: ['session:demo-double-charge', 'pr:juniper/shop#412'] },
      { title: 'Merge the launch crash fix', why: 'It’s approved and its checks pass.', refs: ['pr:juniper/ios#58'] },
    ],
    threads: [
      { name: 'Shop', summary: 'Apple Pay is in review with checks running. The retry fix needs changes before either ships.', refs: ['pr:juniper/shop#418', 'issue:JUN-138'] },
      { name: 'iOS app', summary: 'The crash fix is ready to merge; offline cart sync is in review.', refs: ['issue:JUN-151'] },
      { name: 'Docs', summary: 'The getting started guide is a draft, with the dev server running.', refs: ['pr:juniper/docs#96'] },
    ],
    risks: [{ text: 'The load test is due in six days and hasn’t started.', refs: ['issue:JUN-160'] }],
  },
  Shop: {
    headline: 'Apple Pay can go out once the retry fix lands, and Claude is waiting on you for it.',
    focus: [
      { title: 'Answer the double-charge question', why: 'Claude needs a yes to migrate, and the fix blocks Apple Pay.', refs: ['session:demo-double-charge', 'pr:juniper/shop#412'] },
      { title: 'Review the shipping-rate cache', why: 'Lena has waited three days.', refs: ['pr:juniper/shop#409'] },
    ],
    threads: [
      { name: 'Checkout', summary: 'Apple Pay is in review with checks running. The load test found the database pool too small.', refs: ['pr:juniper/shop#418', 'issue:JUN-160'] },
    ],
    risks: [],
  },
  'iOS app': {
    headline: 'The launch crash fix is approved and its checks pass, so 3.1 is down to offline cart sync.',
    focus: [
      { title: 'Merge the launch crash fix', why: 'It’s approved and its checks pass.', refs: ['pr:juniper/ios#58'] },
      { title: 'Review saved carts', why: 'Ade asked five hours ago, and it builds on offline sync.', refs: ['pr:juniper/ios#57'] },
    ],
    threads: [
      { name: 'Release 3.1', summary: 'Claude is writing tests for offline cart sync.', refs: ['issue:JUN-151'] },
    ],
    risks: [],
  },
  Docs: {
    headline: 'A store owner is waiting on how to export Q3, and Claude has three ways to reply.',
    focus: [
      { title: 'Pick a reply for the order export', why: 'Claude drafted it and is asking which way to go.', refs: ['session:demo-order-export'] },
      { title: 'Retake the guide’s screenshots', why: 'The rewrite is done apart from three images.', refs: ['pr:juniper/docs#96'] },
    ],
    threads: [
      { name: 'Guide rewrite', summary: 'Five steps to a store taking orders, with the dev server running.', refs: ['pr:juniper/docs#96'] },
    ],
    risks: [],
  },
}

/** The brief of everything and of each project, as written at 8:52. */
export const demoBriefs = () => Object.fromEntries(Object.entries(BRIEFS).map(([name, value]) => [name, { value, at: new Date().setHours(8, 52, 0, 0) }]))

const STANDUP: Standup = {
  summary: 'Delivery dates, webhook retries and Sign in with Apple shipped; Apple Pay and the retry fix are in review.',
  projects: [
    {
      name: 'Shop',
      summary: 'Delivery dates and webhook retries shipped; Apple Pay and the retry fix are in review.',
      done: [
        { text: 'Shipped delivery dates on product pages', refs: ['pr:juniper/shop#405', 'issue:JUN-131'] },
        { text: 'Webhooks now retry with backoff instead of giving up after one failure', refs: ['pr:juniper/shop#398'] },
        { text: 'Reviewed Lena’s stock levels', refs: ['pr:juniper/shop#407'] },
      ],
      doing: [
        { text: 'Apple Pay at checkout is up for review, card form kept as the fallback', refs: ['pr:juniper/shop#418'] },
        { text: 'Making payment retries idempotent, with changes requested', refs: ['pr:juniper/shop#412'] },
      ],
      next: [{ text: 'Load test checkout before the autumn sale', refs: ['issue:JUN-160'] }],
      blockers: [],
    },
    {
      name: 'iOS app',
      summary: 'Sign in with Apple went live.',
      done: [{ text: 'Sign in with Apple is live in the iOS app', refs: ['pr:juniper/ios#54'] }],
      doing: [],
      next: [],
      blockers: [],
    },
    {
      name: 'Docs',
      summary: 'Webhook docs reviewed and the getting started guide is being rewritten for 4.2.',
      done: [{ text: 'Reviewed Tomasz’s webhook docs', refs: ['pr:juniper/docs#94'] }],
      doing: [{ text: 'Rewriting the getting started guide for the 4.2 API', refs: ['pr:juniper/docs#96'] }],
      next: [{ text: 'Help a store owner export Q3 orders', refs: ['issue:JUN-147'] }],
      blockers: [],
    },
  ],
}

/** The standup of everything and, for each project, its own part of it. */
export const demoStandups = () => {
  const at = new Date().setHours(9, 4, 0, 0)
  return {
    '': { value: STANDUP, at },
    ...Object.fromEntries(STANDUP.projects.map(p => [p.name, { value: { summary: p.summary, projects: [p] }, at }])),
  }
}

// What was asked of Claude in each session over the week, a few prompts each, more on busy days.
const PROMPTS: [string, string[]][] = [
  ['demo-apple-pay', ['Add Apple Pay to checkout, with the card form as the fallback', 'Only show the button where Apple Pay is supported', 'Run the checkout tests', 'Open the PR']],
  ['demo-double-charge', ['Why are some customers charged twice when a payment retries?', 'Make the retry idempotent with the payment intent id', 'Add a test for two retries in a row']],
  ['demo-load-test', ['Write a load test for checkout at 500 orders a minute', 'Which step is slowest?', 'Try it with the rate cache on']],
  ['demo-offline-cart', ['Keep the cart in sync while the app is offline', 'Merge carts when two devices changed them']],
  ['demo-launch-crash', ['The app crashes on launch with an empty cart; find out why', 'Fix it and add a test']],
  ['demo-order-export', ['How can a store owner export a whole quarter of orders?', 'Draft the reply with the steps']],
  ['demo-getting-started', ['Rewrite the getting started guide for the 4.2 API', 'Shorten the install section']],
  ['demo-triage', ['Go through the checkout bugs from support and start a session per bug']],
]
const PER_DAY = [24, 31, 6, 2, 38, 29, 17]

export function demoJournal(): JournalEntry[] {
  const entries: JournalEntry[] = []
  PER_DAY.forEach((count, i) => {
    const day = new Date(Date.now() - (6 - i) * DAY).setHours(9, 10, 0, 0)
    for (let n = 0; n < count; n++) {
      const [session, prompts] = PROMPTS[(n * 3 + i) % PROMPTS.length]
      const t = day + n * 14 * MINUTE
      if (t > Date.now()) break
      entries.push({ t, kind: 'prompt', session, text: prompts[(n + i) % prompts.length] })
    }
  })
  return entries
}
