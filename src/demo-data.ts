import type { Group, Session, SessionState, View } from './store'

// A scripted working day for demos and screenshots. Demo sessions play back these transcripts
// instead of running a shell; everything in them is invented.

const ESC = '\x1b['
const style = (open: string) => (s: string) => `${ESC}${open}m${s}${ESC}0m`
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return `${n >> 16};${(n >> 8) & 255};${n & 255}`
}
const fg = (hex: string) => style(`38;2;${rgb(hex)}`)
const bg = (hex: string) => style(`48;2;${rgb(hex)}`)
const bold = style('1')

// Claude Code's dark and light colors; a transcript takes whichever matches deckterm's appearance
// when it's drawn.
const PALETTE = {
  dark: {
    claude: '#d97757', green: '#30d158', blue: '#409cff', yellow: '#ffd60a', muted: '#8e8e93', path: '#98989d',
    prompt: '#323234', added: '#1e3a2a', removed: '#45222a', chip: '#3a3a3c',
  },
  light: {
    claude: '#d97757', green: '#248a3d', blue: '#0b63d1', yellow: '#a05a00', muted: '#6e6e73', path: '#6e6e73',
    prompt: '#f0f0f2', added: '#dafbe1', removed: '#ffe4e6', chip: '#e5e5ea',
  },
}
type Tone = keyof typeof PALETTE.dark
const dark = matchMedia('(prefers-color-scheme: dark)')
const colorOf = (tone: Tone) => PALETTE[dark.matches ? 'dark' : 'light'][tone]
const ink = (tone: Tone) => (s: string) => fg(colorOf(tone))(s)
const shade = (tone: Tone) => (s: string) => bg(colorOf(tone))(s)
const claude = ink('claude')
const green = ink('green')
const blue = ink('blue')
const yellow = ink('yellow')
const muted = ink('muted')
const path = ink('path')

const fit = (text: string, width: number) => (text.length > width ? text.slice(0, Math.max(0, width - 1)) + '…' : text)

function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  return line ? [...lines, line] : lines
}

type Lines = string[]

/** Builds a Claude Code screen at a given width, one block at a time. */
class ClaudeScreen {
  lines: Lines = []
  private inputLine = -1
  constructor(private cols: number) {}

  private get width() {
    return this.cols - 1
  }

  header(cwd: string) {
    this.lines.push(
      `${claude(' ▐▛███▜▌')}   ${bold('Claude Code')} ${muted('v2.1.296')}`,
      `${claude('▝▜█████▛▘')}  Opus 5.5 · Claude Team`,
      `${claude('  ▘▘ ▝▝')}    ${muted(fit(cwd, this.width - 11))}`,
      '',
    )
    return this
  }

  prompt(text: string) {
    wrap(text, this.width - 2).forEach((line, i) =>
      this.lines.push(shade('prompt')(`${i === 0 ? '❯ ' : '  '}${line}`.padEnd(this.width))),
    )
    this.lines.push('')
    return this
  }

  say(text: string) {
    wrap(text, this.width - 2).forEach((line, i) => this.lines.push(`${i === 0 ? '⏺ ' : '  '}${line}`))
    this.lines.push('')
    return this
  }

  tool(name: string, arg: string, result?: string, running = false) {
    const call = fit(`${name}(${arg})`, this.width - 2)
    const open = call.indexOf('(')
    this.lines.push(`${running ? '⏺' : green('⏺')} ${bold(call.slice(0, open))}${call.slice(open)}`)
    if (result) this.lines.push(`  ⎿  ${muted(fit(result, this.width - 5))}`)
    this.lines.push('')
    return this
  }

  edit(file: string, added: number, removed: number, rows: [number, '+' | '-' | ' ', string][]) {
    this.tool('Update', file, `Updated with ${added} additions and ${removed} removals`)
    this.lines.pop()
    for (const [num, sign, code] of rows) {
      const text = fit(`${sign} ${code}`, this.width - 10).padEnd(this.width - 10)
      const body = sign === '+' ? shade('added')(text) : sign === '-' ? shade('removed')(text) : text
      this.lines.push(`     ${muted(String(num).padStart(4))} ${body}`)
    }
    this.lines.push('')
    return this
  }

  table(rows: string[][]) {
    const widths = rows[0].map((_, c) => Math.max(...rows.map(r => r[c].length)))
    rows.forEach((row, i) => {
      const line = fit(row.map((cell, c) => (c === 0 ? cell.padEnd(widths[c]) : cell.padStart(widths[c]))).join('   '), this.width - 2)
      this.lines.push(`  ${i === 0 ? bold(line) : line}`)
    })
    this.lines.push('')
    return this
  }

  bullets(items: [string, string][]) {
    for (const [lead, rest] of items) {
      wrap(`${lead} ${rest}`, this.width - 4).forEach((line, i) => {
        const shown = i === 0 ? bold(line.slice(0, lead.length)) + line.slice(lead.length) : line
        this.lines.push(`  ${i === 0 ? '- ' : '  '}${shown}`)
      })
    }
    this.lines.push('')
    return this
  }

  spinner(verb: string, meta: string) {
    this.lines.push(fit(`✻ ${verb}… (${meta} · esc to interrupt)`, this.width).replace(/^(✻ [^(]+)/, s => claude(s)), '')
    return this
  }

  worked(time: string) {
    this.lines.push(muted(`✻ Worked for ${time}`), '')
    return this
  }

  input() {
    this.inputLine = this.lines.length + 1
    this.lines.push(
      muted('─'.repeat(this.width)),
      '❯ ',
      muted('─'.repeat(this.width)),
      `  ${yellow('⏵⏵ auto mode on')}${muted(fit(' (shift+tab to cycle)', this.width - 18))}`,
    )
    return this
  }

  permission(title: string, command: string, why: string, rule: string) {
    const inner = this.width - 4
    const row = (text = '', paint = (s: string) => s) => this.lines.push(`${claude('│')} ${paint(fit(text, inner).padEnd(inner))} ${claude('│')}`)
    this.lines.push(claude(`╭${'─'.repeat(this.width - 2)}╮`))
    row(title, bold)
    row()
    wrap(command, inner - 2).forEach(line => row(`  ${line}`))
    wrap(why, inner - 2).forEach(line => row(`  ${line}`, muted))
    row()
    row('Do you want to proceed?')
    row('❯ 1. Yes', blue)
    wrap(`2. Yes, and don't ask again for ${rule}`, inner - 2).forEach((line, i) => row(`${i ? '     ' : '  '}${line}`))
    wrap('3. No, and tell Claude what to do differently (esc)', inner - 2).forEach((line, i) => row(`${i ? '     ' : '  '}${line}`))
    this.lines.push(claude(`╰${'─'.repeat(this.width - 2)}╯`))
    return this
  }

  question(chip: string, question: string, options: [string, string][]) {
    this.lines.push(muted('─'.repeat(this.width)), ` ${shade('chip')(` ☐ ${chip} `)}`, '')
    wrap(question, this.width - 2).forEach(line => this.lines.push(` ${bold(line)}`))
    this.lines.push('')
    options.forEach(([label, detail], i) => {
      const head = `${i === 0 ? '❯' : ' '} ${i + 1}. ${label}`
      this.lines.push(` ${i === 0 ? blue(fit(head, this.width - 2)) : fit(head, this.width - 2)}`)
      wrap(detail, this.width - 8).forEach(line => this.lines.push(`      ${muted(line)}`))
    })
    this.lines.push(` ${'  '}${options.length + 1}. Type something.`, '', muted(fit(' Enter to select · ↑/↓ to navigate · Esc to cancel', this.width)))
    return this
  }

  /** The cursor waits in the input box, or is hidden while Claude asks something. */
  toString() {
    const up = this.lines.length - 1 - this.inputLine
    return this.lines.join('\r\n') + (this.inputLine < 0 ? '\x1b[?25l' : `\x1b[${up}A\x1b[3G`)
  }
}

/** A shell transcript in deckterm's own prompt style, with the OSC 133 marks that draw its separators. */
function shell(cols: number, cwd: string, branch: string, blocks: [string, string[], 'running'?][]) {
  const prompt = `${path(cwd)} ${green(`git:(${branch})`)}\r\n${blue('❯')} `
  const out: string[] = []
  for (const [command, output, running] of blocks) {
    out.push(`\x1b]133;A\x07${prompt}${command}\r\n\x1b]133;C\x07`)
    out.push(...output.map(line => `${fit(line, cols - 1)}\r\n`))
    if (running) break
    out.push('\x1b]133;D;0\x07\r\n')
  }
  if (!blocks.at(-1)?.[2]) out.push(`\x1b]133;A\x07${prompt}`)
  return out.join('')
}

const home = window.deck.homeDir
const juniper = `${home}/Code/juniper`
const worktree = (name: string) => `${juniper}/.claude/worktrees/${name}`
const ios = `${home}/Code/juniper-ios`
const docs = `${home}/Code/juniper-docs`
const short = (p: string) => p.replace(home, '~')

interface DemoScript {
  status: SessionState
  git: GitInfo | null
  /** How long it has been waiting for you, which decides the ⌘J order. */
  waitingMinutes?: number
  /** A plain shell rather than Claude, for the icon it gets. */
  shell?: boolean
  transcript: (cols: number) => string
}

// Juniper is an invented online shop: a web app, an iOS app and a docs site.
export const DEMO_SCRIPTS: Record<string, DemoScript> = {
  'apple-pay': {
    status: 'working',
    git: { branch: 'feat/apple-pay', added: 212, removed: 18, untracked: 3 },
    transcript: cols =>
      new ClaudeScreen(cols)
        .header(short(worktree('apple-pay')))
        .prompt('Add Apple Pay to checkout. Show the button only on devices that support it, and keep the card form as the fallback.')
        .tool('Read', 'src/app/checkout/page.tsx', 'Read 184 lines')
        .say('Checkout already creates a payment intent, so Apple Pay can reuse it. I\'ll add the button above the card form.')
        .edit('src/app/checkout/page.tsx', 7, 1, [
          [61, ' ', '<OrderSummary cart={cart} />'],
          [62, '+', '<ApplePayButton'],
          [63, '+', '  intent={intent}'],
          [64, '+', '  onPaid={() => router.push(`/orders/${order.id}`)}'],
          [65, '+', '/>'],
          [66, ' ', '<CardForm intent={intent} />'],
        ])
        .spinner('Running checkout tests', '1m 48s · ↓ 7.2k tokens')
        .input()
        .toString(),
  },
  'load-test': {
    status: 'done',
    waitingMinutes: 14,
    git: { branch: 'perf/checkout-load', added: 38, removed: 2, untracked: 1 },
    transcript: cols =>
      new ClaudeScreen(cols)
        .header(short(worktree('checkout-load')))
        .prompt('Load test checkout at three times last Black Friday\'s traffic and tell me what breaks first.')
        .tool('Bash', 'k6 run load/checkout.js --vus 1200 --duration 10m', '412,880 requests, 99.1% succeeded (10m 02s)')
        .say('Checkout holds up. One step is close to its limit:')
        .table([
          ['', 'p95', 'Errors'],
          ['Cart', '210 ms', '0.0%'],
          ['Payment intent', '1.4 s', '0.9%'],
          ['Confirmation', '380 ms', '0.1%'],
        ])
        .say('Payment intents wait for a database connection. With a pool of 60, p95 stays under 400 ms. Should I open a pull request?')
        .worked('11m 36s')
        .input()
        .toString(),
  },
  'double-charge': {
    status: 'input',
    waitingMinutes: 5,
    git: { branch: 'fix/idempotent-retry', added: 57, removed: 11, untracked: 1 },
    transcript: cols =>
      new ClaudeScreen(cols)
        .header(short(worktree('idempotent-retry')))
        .prompt('A few customers were charged twice when the payment step timed out and they pressed Pay again. Find out why and fix it.')
        .tool('Read', 'src/server/payments/intents.ts', 'Read 132 lines')
        .say('Every retry creates a new payment intent. I\'ll key them by order and attempt, so pressing Pay again reuses the first.')
        .tool('Write', 'prisma/schema.prisma', 'Added the PaymentAttempt model')
        .permission(
          'Bash command',
          'pnpm prisma migrate dev --name payment_attempts',
          'Create the table the idempotency key is built from',
          'pnpm prisma commands in this folder',
        )
        .toString(),
  },
  'offline-cart': {
    status: 'working',
    git: { branch: 'feat/offline-cart', added: 146, removed: 23, untracked: 2 },
    transcript: cols =>
      new ClaudeScreen(cols)
        .header(short(ios))
        .prompt('Keep the cart working when the phone goes offline, and sync it when it comes back.')
        .tool('Read', 'Sources/Cart/CartStore.swift', 'Read 211 lines')
        .say('Every cart change goes straight to the API. I\'ll queue them on disk while offline and replay them when the connection is back.')
        .edit('Sources/Cart/CartStore.swift', 14, 3, [
          [88, '-', 'try await api.update(cart)'],
          [88, '+', 'if network.isOnline {'],
          [89, '+', '    try await api.update(cart)'],
          [90, '+', '} else {'],
          [91, '+', '    pending.append(.update(cart))'],
          [92, '+', '}'],
        ])
        .spinner('Writing tests for the replay', '4m 10s · ↓ 11.2k tokens')
        .input()
        .toString(),
  },
  'launch-crash': {
    status: 'done',
    waitingMinutes: 31,
    git: { branch: 'fix/launch-crash', added: 12, removed: 4, untracked: 0 },
    transcript: cols =>
      new ClaudeScreen(cols)
        .header(short(ios))
        .prompt('Some iOS 26 users crash on launch. The crash log says Thread 0 crashed in KeychainStore.read. Find it and fix it.')
        .edit('Sources/Auth/KeychainStore.swift', 4, 2, [
          [31, '-', 'let token = String(data: item!, encoding: .utf8)!'],
          [32, '-', 'return token'],
          [31, '+', 'guard let item, let token = String(data: item, encoding: .utf8)'],
          [32, '+', 'else { return nil }'],
          [33, '+', 'return token'],
        ])
        .tool('Bash', 'xcodebuild test -scheme Juniper -only-testing:AuthTests', 'Executed 24 tests, with 0 failures')
        .say('Fixed. On a fresh install the keychain has no token yet, and the code force-unwrapped it. A missing token now means signed out.')
        .worked('3m 47s')
        .input()
        .toString(),
  },
  'order-export': {
    status: 'input',
    waitingMinutes: 9,
    git: { branch: 'main', added: 0, removed: 0, untracked: 0 },
    transcript: cols =>
      new ClaudeScreen(cols)
        .header(short(docs))
        .prompt('A store owner wants every order from Q3 in a spreadsheet. Check what we support and draft a reply.')
        .tool('Read', 'src/content/docs/orders/export.mdx', 'Read 58 lines')
        .say('Orders can be exported from the dashboard one month at a time, or all at once through the API.')
        .question('Reply', 'How should the reply handle a whole quarter?', [
          ['Three monthly exports (Recommended)', 'Works today from the dashboard and takes about two minutes.'],
          ['Explain the API export', 'One file, but they need to create an API key first.'],
          ['Run the export for them', 'Quickest for them, manual work for us.'],
        ])
        .toString(),
  },
  'getting-started': {
    status: 'idle',
    git: { branch: 'docs/getting-started', added: 64, removed: 51, untracked: 0 },
    transcript: cols =>
      new ClaudeScreen(cols)
        .header(short(docs))
        .prompt('Rewrite the getting started guide so a new store is taking orders in five minutes.')
        .tool('Read', 'src/content/docs/getting-started.mdx', 'Read 188 lines')
        .tool('Update', 'src/content/docs/getting-started.mdx', 'Updated with 64 additions and 51 removals')
        .say('Done. The guide is now five steps, and each one ends with something you can see in your store. I marked the three screenshots that need retaking.')
        .worked('2m 21s')
        .input()
        .toString(),
  },
  'docs-server': {
    status: 'running',
    shell: true,
    git: { branch: 'main', added: 0, removed: 0, untracked: 0 },
    transcript: cols =>
      shell(cols, short(docs), 'main', [
        ['git pull', ['Already up to date.']],
        [
          'pnpm dev',
          [
            '',
            `  ${green('VITE')} v8.3.4  ready in 388 ms`,
            '',
            `  ${green('➜')}  Local:   ${blue('http://localhost:4321/')}`,
            `  ${muted('➜  Network: use --host to expose')}`,
            `${muted('10:41:07')} ${blue('[vite]')} hmr update /docs/getting-started`,
            `${muted('10:52:33')} ${blue('[vite]')} hmr update /docs/orders/export`,
            `${muted('11:03:18')} ${blue('[vite]')} page reload src/content/docs/getting-started.mdx`,
          ],
          'running',
        ],
      ]),
  },
  triage: {
    status: 'idle',
    git: { branch: 'main', added: 0, removed: 0, untracked: 0 },
    transcript: cols =>
      new ClaudeScreen(cols)
        .header(short(juniper))
        .prompt('Support sent three checkout problems: Apple Pay is missing, a retry after a timeout charges twice, and nobody has load tested the new flow. Start a session for each in its own worktree, grouped under Checkout.')
        .tool('own-term - create_group (MCP)', 'name: "Checkout", color: "Blue"', 'Made the group Checkout')
        .tool('own-term - new_session (MCP)', 'folder: "~/Code/juniper", worktree: "apple-pay", group: "Checkout", icon: "credit-card", prompt: "Add Apple Pay to checkout. Show the button only on devices that support it…"', 'Started Apple Pay at checkout on feat/apple-pay')
        .tool('own-term - new_session (MCP)', 'folder: "~/Code/juniper", worktree: "idempotent-retry", group: "Checkout", icon: "bug", prompt: "A few customers were charged twice when the payment step timed out…"', 'Started Double charge on retry on fix/idempotent-retry')
        .tool('own-term - new_session (MCP)', 'folder: "~/Code/juniper", worktree: "checkout-load", group: "Checkout", icon: "chart-line", prompt: "Load test checkout at three times last Black Friday\'s traffic…"', 'Started Checkout load test on perf/checkout-load')
        .say('Three sessions are running under Checkout, each on its own branch. Ask me to check on them, or to tell one of them something, any time.')
        .worked('19s')
        .input()
        .toString(),
  },
  'release-notes': {
    status: 'idle',
    git: { branch: 'main', added: 0, removed: 0, untracked: 0 },
    transcript: cols =>
      new ClaudeScreen(cols)
        .header(short(juniper))
        .prompt('Write the release notes for 4.2 from the merged pull requests.')
        .tool('Bash', 'gh pr list --state merged --search "milestone:4.2"', 'Found 9 pull requests')
        .say("Here's a draft:")
        .bullets([
          ['Checkout:', 'pay with Apple Pay on devices that support it; the card form stays for everyone else.'],
          ['Orders:', 'export a month of orders as a spreadsheet from the dashboard.'],
          ['iOS:', 'the cart keeps working offline and syncs when you are back.'],
          ['Fixes:', 'pressing Pay again after a timeout no longer charges twice.'],
        ])
        .worked('1m 58s')
        .input()
        .toString(),
  },
}

const ids = Object.fromEntries(Object.keys(DEMO_SCRIPTS).map(key => [key, `demo-${key}`]))

// One group in each project, named for the work rather than repeating the project's name.
export const DEMO_GROUPS: Group[] = [
  { id: 'demo-checkout', name: 'Checkout', collapsed: false, color: 6 },
  { id: 'demo-ios', name: 'Release 3.1', collapsed: false, color: 5 },
  { id: 'demo-docs', name: 'Guide rewrite', collapsed: false, color: 8 },
]

const session = (key: string, name: string, icon: string, cwd: string, groupId: string | null, remind?: Session['remind']): Session =>
  ({ id: ids[key], name, icon, cwd, groupId, runClaude: false, demo: key, remind })

/** Tomorrow at 9:00, when the day is loaded: the reminder's preset. */
const tomorrowAt9 = () => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d.getTime()
}

export const DEMO_SESSIONS: Session[] = [
  session('apple-pay', 'Apple Pay at checkout', 'credit-card', worktree('apple-pay'), 'demo-checkout'),
  session('load-test', 'Checkout load test', 'chart-line', worktree('checkout-load'), 'demo-checkout'),
  session('double-charge', 'Double charge on retry', 'bug', worktree('idempotent-retry'), 'demo-checkout'),
  session('offline-cart', 'Offline cart sync', 'wifi', ios, 'demo-ios'),
  session('launch-crash', 'Crash on launch', 'flame', ios, 'demo-ios'),
  session('order-export', 'Q3 order export', 'receipt', docs, null),
  session('getting-started', 'Getting started guide', 'book-open', docs, 'demo-docs'),
  session('docs-server', 'Docs dev server', 'server', docs, 'demo-docs'),
  session('triage', 'Checkout bugs from support', 'inbox', juniper, null),
  session('release-notes', 'Release notes 4.2', 'newspaper', juniper, null, { at: tomorrowAt9(), note: 'Post them once 4.2 ships' }),
]

export const DEMO_VIEW: View = { kind: 'group', id: 'demo-checkout' }

/** The repository each of the day's folders is in, as git would say, which places its sessions in a project. */
export const demoRepo = (cwd: string) =>
  cwd.startsWith(ios) ? 'juniper/ios' : cwd.startsWith(docs) ? 'juniper/docs' : cwd.startsWith(juniper) ? 'juniper/shop' : null

/** The day's projects as Sam named them, how their tiles look, and the one the day opens on. */
export const DEMO_PROJECTS = {
  names: { 'juniper/shop': 'Shop', 'juniper/ios': 'iOS app', 'juniper/docs': 'Docs' } as Record<string, string>,
  looks: { Shop: { color: 6, icon: 'store' }, 'iOS app': { color: 5, icon: 'smartphone' }, Docs: { color: 8, icon: 'book-open' } } as Record<string, ProjectLook>,
  first: 'Shop',
}

/** The session whose browser has the shop's checkout page open, as Claude checks the Apple Pay button. */
export const DEMO_BROWSER = ids['apple-pay']

/** The notification the demo opens with, as if the session had just finished. */
export const DEMO_TOAST = {
  sessionId: ids['launch-crash'],
  text: 'Fixed. On a fresh install the keychain has no token yet, and the code force-unwrapped it. A missing token now means signed out.',
}
