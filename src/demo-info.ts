// What the info panel shows for each demo session, since there's no folder, git or transcript behind
// them. Invented like the rest of the demo day (demo-data.ts), and each file list adds up to the
// counts its sidebar row shows.

import type { Command } from './commands'

export interface PanelData {
  git: GitDetails | null
  claude: ClaudeInfo | null
  pr: PullRequestInfo
  ports: { port: number; command: string; launchedBy?: string | null }[]
  commands: Command[]
}

const home = window.deck.homeDir
const juniper = `${home}/Code/juniper`
const tree = (name: string) => `${juniper}/.claude/worktrees/${name}`
const ios = `${home}/Code/juniper-ios`
const docs = `${home}/Code/juniper-docs`
const MIN = 60_000

type File = [GitDetails['files'][number]['kind'], string, number?, number?]
type Commit = [string, number, string?]

interface Demo {
  root: string
  branch: string
  upstream: string | null
  ahead?: number
  behind?: number
  files?: File[]
  /** Subject, minutes ago, author (the session's own commits are by Sam). */
  commits: Commit[]
  pr?: PullRequestInfo['pr']
  claude?: {
    model: 'opus' | 'sonnet'
    startedMinutes: number
    /** Context at the first and last request, the number of requests, and where it compacted. */
    context: [number, number, number, number?]
    /** Each finished turn, in seconds. */
    turns: number[]
    edited: string[]
  }
  /** Port, the program listening, and the command Claude ran that started it. */
  ports?: [number, string, string?][]
  /** Commands Claude ran: description, command, minutes ago, how it ended, what it printed. */
  commands?: [string, string, number, 'running' | 'background' | 'done' | number, string][]
}

const JUNIPER_MAIN: Commit[] = [
  ['Show delivery estimates in the cart', 95, 'Priya'],
  ['Release 4.1.2', 180, 'Jonas'],
  ['Fix rounding in tax totals', 26 * 60, 'Priya'],
  ['Cache product images at the edge', 28 * 60, 'Jonas'],
  ['Move checkout to the app router', 3 * 24 * 60, 'Ana'],
]
const IOS_MAIN: Commit[] = [
  ['Release 2.8 to TestFlight', 140, 'Ana'],
  ['Show order tracking on the lock screen', 22 * 60, 'Ana'],
  ['Update to the iOS 26 SDK', 2 * 24 * 60, 'Jonas'],
]
const DOCS_MAIN: Commit[] = [
  ['Document webhooks for refunds', 70, 'Priya'],
  ['Add a page on tax settings', 20 * 60, 'Jonas'],
  ['Fix broken links in the API reference', 2 * 24 * 60, 'Priya'],
]

const NEXT_LOG = [
  '\x1b[1m▲ Next.js 16.1\x1b[0m',
  '- Local:        http://localhost:3000',
  '\x1b[32m✓\x1b[0m Ready in 1.2s',
  '\x1b[2m○ Compiling /checkout ...\x1b[0m',
  '\x1b[32m✓\x1b[0m Compiled /checkout in 840ms',
  ' GET /checkout 200 in 912ms',
  ' POST /checkout/actions 200 in 148ms',
  ' GET /api/wallets 200 in 22ms',
  ' GET /checkout 200 in 61ms',
].join('\n')

const K6_LOG = [
  '     scenarios: (100.00%) 1 scenario, 1200 max VUs, 10m30s max duration',
  '',
  '     \x1b[32m✓\x1b[0m cart responds',
  '     \x1b[32m✓\x1b[0m payment intent created',
  '     \x1b[31m✗\x1b[0m order confirmed within 2s',
  '      ↳  98% — ✓ 101,186 / ✗ 2,034',
  '',
  '     http_req_duration..........: avg=184ms p(95)=1.42s',
  '     http_reqs..................: 412880  686/s',
].join('\n')

const DEMOS: Record<string, Demo> = {
  'apple-pay': {
    root: tree('apple-pay'),
    branch: 'feat/apple-pay',
    upstream: 'origin/feat/apple-pay',
    ahead: 1,
    files: [
      ['modified', 'src/lib/payments/wallets.ts', 84],
      ['modified', 'src/app/checkout/actions.ts', 62],
      ['modified', 'src/lib/payments/request.ts', 38, 9],
      ['modified', 'src/app/checkout/checkout.css', 21, 8],
      ['modified', 'src/app/checkout/page.tsx', 7, 1],
      ['new', 'src/components/checkout/ApplePayButton.tsx'],
      ['new', 'tests/checkout/apple-pay.spec.ts'],
      ['new', 'public/.well-known/apple-developer-merchantid-domain-association'],
    ],
    commits: [['Check for Apple Pay before showing the button', 12, 'Sam'], ...JUNIPER_MAIN],
    pr: { number: 482, title: 'Add Apple Pay to checkout', url: '', state: 'DRAFT', review: null, checks: { passed: 3, failed: 0, pending: 1 } },
    claude: {
      model: 'opus',
      startedMinutes: 41,
      context: [21_000, 96_000, 38],
      turns: [48, 212, 95, 386],
      edited: ['src/app/checkout/page.tsx', 'src/components/checkout/ApplePayButton.tsx', 'src/lib/payments/wallets.ts', 'src/app/checkout/actions.ts'],
    },
    ports: [[3000, 'node', 'npm run dev']],
    commands: [
      ['Start the checkout dev server', 'npm run dev', 38, 'background', NEXT_LOG],
      ['Type check', 'npx tsc --noEmit', 9, 2, "src/lib/payments/wallets.ts(41,7): error TS2322: Type 'string | undefined' is not assignable to type 'string'.\n\nFound 1 error in src/lib/payments/wallets.ts:41"],
      ['Type check', 'npx tsc --noEmit', 6, 'done', ''],
      ['Ask the dev server which wallets it offers', 'curl -s localhost:3000/api/wallets | jq', 4, 'done', '[\n  "apple_pay",\n  "card"\n]'],
      ['Run the checkout tests', 'npx vitest run tests/checkout', 2, 'running', ''],
    ],
  },
  'load-test': {
    root: tree('checkout-load'),
    branch: 'perf/checkout-load',
    upstream: null,
    files: [
      ['modified', 'load/checkout.js', 31, 2],
      ['modified', 'src/server/db.ts', 7],
      ['new', 'load/results/checkout-2026-10-11.json'],
    ],
    commits: JUNIPER_MAIN,
    claude: { model: 'opus', startedMinutes: 74, context: [19_000, 58_000, 24], turns: [602, 141, 88], edited: ['load/checkout.js', 'src/server/db.ts'] },
    commands: [
      ['Run the load test at three times peak traffic', 'k6 run load/checkout.js --vus 1200 --duration 10m', 31, 'done', K6_LOG],
      ['Look at the slowest database queries', "psql $STAGING_DB -c 'select query, mean_exec_time from pg_stat_statements order by 2 desc limit 5'", 18, 'done', ''],
    ],
  },
  'double-charge': {
    root: tree('idempotent-retry'),
    branch: 'fix/idempotent-retry',
    upstream: 'origin/fix/idempotent-retry',
    behind: 2,
    files: [
      ['modified', 'src/server/payments/intents.ts', 41, 11],
      ['modified', 'prisma/schema.prisma', 16],
      ['new', 'prisma/migrations/20261011_payment_attempts/migration.sql'],
    ],
    commits: [['Log the attempt with every payment intent', 50, 'Sam'], ...JUNIPER_MAIN],
    claude: {
      model: 'opus',
      startedMinutes: 132,
      context: [24_000, 88_000, 62, 44],
      turns: [74, 318, 125, 540, 97, 260, 133],
      edited: ['prisma/schema.prisma', 'src/server/payments/intents.ts'],
    },
  },
  'offline-cart': {
    root: ios,
    branch: 'feat/offline-cart',
    upstream: 'origin/feat/offline-cart',
    ahead: 2,
    files: [
      ['modified', 'Sources/Cart/CartView.swift', 68],
      ['modified', 'Sources/Cart/CartAPI.swift', 58, 20],
      ['modified', 'Sources/Cart/CartStore.swift', 14, 3],
      ['modified', 'Sources/App/JuniperApp.swift', 6],
      ['new', 'Sources/Cart/PendingChanges.swift'],
      ['new', 'Tests/CartTests/OfflineSyncTests.swift'],
    ],
    commits: [['Replay queued cart changes in order', 18, 'Sam'], ['Queue cart changes on disk', 47, 'Sam'], ...IOS_MAIN],
    pr: { number: 127, title: 'Keep the cart working offline', url: '', state: 'OPEN', review: 'CHANGES_REQUESTED', checks: { passed: 5, failed: 1, pending: 0 } },
    claude: {
      model: 'sonnet',
      startedMinutes: 96,
      context: [17_000, 132_000, 51],
      turns: [66, 154, 402, 88, 230],
      edited: ['Sources/Cart/CartStore.swift', 'Sources/Cart/PendingChanges.swift', 'Sources/Cart/CartAPI.swift', 'Sources/Cart/CartView.swift'],
    },
  },
  'launch-crash': {
    root: ios,
    branch: 'fix/launch-crash',
    upstream: 'origin/fix/launch-crash',
    files: [
      ['modified', 'Tests/AuthTests/KeychainStoreTests.swift', 8, 2],
      ['modified', 'Sources/Auth/KeychainStore.swift', 4, 2],
    ],
    commits: [['Treat a missing keychain token as signed out', 9, 'Sam'], ...IOS_MAIN],
    pr: { number: 131, title: 'Fix the crash on launch with an empty keychain', url: '', state: 'OPEN', review: 'APPROVED', checks: { passed: 6, failed: 0, pending: 0 } },
    claude: { model: 'opus', startedMinutes: 33, context: [18_000, 44_000, 18], turns: [131, 207], edited: ['Sources/Auth/KeychainStore.swift', 'Tests/AuthTests/KeychainStoreTests.swift'] },
  },
  'order-export': {
    root: docs,
    branch: 'main',
    upstream: 'origin/main',
    commits: DOCS_MAIN,
    claude: { model: 'sonnet', startedMinutes: 19, context: [16_000, 31_000, 9], turns: [], edited: [] },
  },
  'getting-started': {
    root: docs,
    branch: 'docs/getting-started',
    upstream: 'origin/docs/getting-started',
    files: [['modified', 'src/content/docs/getting-started.mdx', 64, 51]],
    commits: [['Cut the guide to five steps', 6, 'Sam'], ...DOCS_MAIN],
    pr: { number: 58, title: 'Rewrite the getting started guide', url: '', state: 'OPEN', review: 'REVIEW_REQUIRED', checks: { passed: 2, failed: 0, pending: 0 } },
    claude: { model: 'sonnet', startedMinutes: 58, context: [15_000, 77_000, 30], turns: [92, 141, 131], edited: ['src/content/docs/getting-started.mdx'] },
  },
  'docs-server': { root: docs, branch: 'main', upstream: 'origin/main', commits: DOCS_MAIN, ports: [[4321, 'node']] },
  triage: {
    root: juniper,
    branch: 'main',
    upstream: 'origin/main',
    commits: JUNIPER_MAIN,
    claude: { model: 'opus', startedMinutes: 41, context: [9_000, 14_000, 3], turns: [19], edited: [] },
  },
  'release-notes': {
    root: juniper,
    branch: 'main',
    upstream: 'origin/main',
    commits: JUNIPER_MAIN,
    claude: { model: 'opus', startedMinutes: 12, context: [22_000, 52_000, 14], turns: [184], edited: [] },
  },
}

const WORKTREES: GitDetails['worktrees'] = [
  { path: juniper, branch: 'main', current: false },
  { path: tree('apple-pay'), branch: 'feat/apple-pay', current: false },
  { path: tree('checkout-load'), branch: 'perf/checkout-load', current: false },
  { path: tree('idempotent-retry'), branch: 'fix/idempotent-retry', current: false },
]

const SKILLS = ['frontend-design', 'testing', 'db-migrations', 'release-notes', 'code-review', 'security-review', 'pdf', 'xlsx', 'screenshot']

/** A context curve from `from` to `to`, rising with small wobbles, dropping where it compacted. */
function contextSeries([from, to, count, compactAt]: [number, number, number, number?], startedMinutes: number) {
  const start = Date.now() - startedMinutes * MIN
  const peak = compactAt ? 172_000 : to
  let seed = from + to
  const wobble = () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280 - 0.5
  }
  return Array.from({ length: count }, (_, i) => {
    const after = compactAt !== undefined && i >= compactAt
    const t = after ? (i - compactAt) / Math.max(1, count - 1 - compactAt) : i / Math.max(1, (compactAt ?? count) - 1)
    const low = after ? 34_000 : from
    const high = after ? to : peak
    const tokens = Math.round(low + (high - low) * t ** 0.85 + wobble() * 2_400)
    return { time: start + (i / count) * startedMinutes * MIN, tokens: Math.max(8_000, tokens) }
  })
}

/** A stable, made-up short commit hash. */
function hash(text: string) {
  let h = 0x811c9dc5
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0').slice(0, 7)
}

export function demoInfo(key: string): PanelData | null {
  const demo = DEMOS[key]
  if (!demo) return null
  const files = (demo.files ?? []).map(([kind, name, added = 0, removed = 0]) => ({
    path: `${demo.root}/${name}`, name, kind, added, removed,
  }))
  const ahead = demo.ahead ?? 0
  const git: GitDetails = {
    root: demo.root,
    branch: demo.branch,
    head: null,
    upstream: demo.upstream,
    ahead,
    behind: demo.behind ?? 0,
    files,
    moreFiles: 0,
    commits: demo.commits.map(([subject, minutes, author = 'Sam'], i) => ({
      hash: hash(subject),
      subject,
      author,
      time: Date.now() - minutes * MIN,
      pushed: !!demo.upstream && i >= ahead,
    })),
    stashes: key === 'triage' ? 1 : 0,
    worktrees: demo.root === juniper || demo.root.startsWith(`${juniper}/`) ? WORKTREES.map(w => ({ ...w, current: w.path === demo.root })) : [{ path: demo.root, branch: demo.branch, current: true }],
  }
  const c = demo.claude
  const claude: ClaudeInfo | null = c
    ? (() => {
        const series = contextSeries(c.context, c.startedMinutes)
        let at = Date.now() - c.startedMinutes * MIN
        return {
          model: c.model === 'opus' ? { id: 'claude-opus-5-5', name: 'Opus 5.5' } : { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5' },
          context: series.at(-1)!.tokens,
          compactions: c.context[3] === undefined ? 0 : 1,
          prompts: c.turns.length + 1,
          started: Date.now() - c.startedMinutes * MIN,
          edited: c.edited.map(name => `${demo.root}/${name}`),
          instructions: [{ path: `${demo.root}/CLAUDE.md`, type: 'Project' }, { path: `${home}/.claude/CLAUDE.md`, type: 'User' }],
          skills: SKILLS,
          series,
          turns: c.turns.map(seconds => {
            at += seconds * 1000 + 3 * MIN
            return { time: at, ms: seconds * 1000 }
          }),
        }
      })()
    : null
  return {
    git,
    claude,
    pr: { available: true, pr: demo.pr ?? null },
    ports: (demo.ports ?? []).map(([port, command, launchedBy]) => ({ port, command, launchedBy })),
    commands: (demo.commands ?? []).map(([description, command, minutes, ended, output], i) => {
      const started = Date.now() - minutes * MIN
      return {
        id: `${key}-${i}`, description, command, started, output,
        background: ended === 'background',
        ...(ended === 'running' || ended === 'background'
          ? { status: 'running' as const }
          : ended === 'done'
          ? { status: 'done' as const, exitCode: 0, ended: started + 9000 }
          : { status: 'failed' as const, exitCode: ended, ended: started + 9000 }),
      }
    }),
  }
}

type FileView = NonNullable<Awaited<ReturnType<Window['deck']['fileView']>>>

const PAGE = `import { redirect } from 'next/navigation'
import { getCart } from '@/lib/cart'
import { createPaymentIntent } from '@/lib/payments/request'
import { ApplePayButton } from '@/components/checkout/ApplePayButton'
import { CardForm } from '@/components/checkout/CardForm'
import { OrderSummary } from '@/components/checkout/OrderSummary'

export default async function CheckoutPage() {
  const cart = await getCart()
  if (cart.items.length === 0) redirect('/cart')

  // One intent serves the card form and Apple Pay, so paying twice can't charge twice.
  const intent = await createPaymentIntent(cart)

  return (
    <main className="checkout">
      <h1>Checkout</h1>
      <OrderSummary cart={cart} />
      <ApplePayButton
        intent={intent}
        onPaid={order => redirect(\`/orders/\${order.id}\`)}
      />
      <p className="checkout-or">or pay by card</p>
      <CardForm intent={intent} />
    </main>
  )
}
`

const PAGE_DIFF = `diff --git a/src/app/checkout/page.tsx b/src/app/checkout/page.tsx
--- a/src/app/checkout/page.tsx
+++ b/src/app/checkout/page.tsx
@@ -1,5 +1,6 @@
 import { redirect } from 'next/navigation'
 import { getCart } from '@/lib/cart'
 import { createPaymentIntent } from '@/lib/payments/request'
+import { ApplePayButton } from '@/components/checkout/ApplePayButton'
 import { CardForm } from '@/components/checkout/CardForm'
 import { OrderSummary } from '@/components/checkout/OrderSummary'
@@ -8,16 +9,22 @@ export default async function CheckoutPage() {
   const cart = await getCart()
   if (cart.items.length === 0) redirect('/cart')
 
-  // The card form confirms this intent.
+  // One intent serves the card form and Apple Pay, so paying twice can't charge twice.
   const intent = await createPaymentIntent(cart)
 
   return (
     <main className="checkout">
       <h1>Checkout</h1>
       <OrderSummary cart={cart} />
+      <ApplePayButton
+        intent={intent}
+        onPaid={order => redirect(\`/orders/\${order.id}\`)}
+      />
+      <p className="checkout-or">or pay by card</p>
       <CardForm intent={intent} />
     </main>
   )
 }
`

const BUTTON = `'use client'

import { useEffect, useState } from 'react'
import { canPayWithWallet, payWithWallet } from '@/lib/payments/wallets'
import type { Order, PaymentIntent } from '@/lib/payments/types'

/** Apple Pay, shown only where the browser and device support it; the card form stays below. */
export function ApplePayButton({ intent, onPaid }: { intent: PaymentIntent; onPaid: (order: Order) => void }) {
  const [supported, setSupported] = useState(false)
  const [paying, setPaying] = useState(false)

  useEffect(() => {
    canPayWithWallet('apple-pay').then(setSupported)
  }, [])

  if (!supported) return null

  return (
    <button
      className="apple-pay-button"
      disabled={paying}
      aria-label="Pay with Apple Pay"
      onClick={async () => {
        setPaying(true)
        try {
          onPaid(await payWithWallet('apple-pay', intent))
        } finally {
          setPaying(false)
        }
      }}
    />
  )
}
`

// What the viewer shows for the demo's files; the rest have no contents to show.
const DEMO_FILES: Record<string, FileView> = {
  [`${tree('apple-pay')}/src/app/checkout/page.tsx`]: { diff: PAGE_DIFF, tracked: true, text: PAGE, note: null, image: null, before: null, size: PAGE.length },
  [`${tree('apple-pay')}/src/components/checkout/ApplePayButton.tsx`]: { diff: null, tracked: false, text: BUTTON, note: null, image: null, before: null, size: BUTTON.length },
}

export const demoFile = (path: string): FileView | null => DEMO_FILES[path] ?? null
