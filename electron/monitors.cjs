// Monitors: commands Claude sets up through the own-term tools, which Own Term runs on a schedule in
// the user's shell environment. What they return is drawn on a page of its own, and rules on it
// notify. Claude writes a spec, never code: main runs the commands, keeps their history and checks the
// rules, and the page draws from that alone. A command runs only once the user has allowed it.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFile, spawn } = require('node:child_process')
const { Notification, shell } = require('electron')

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MIN_EVERY = 10 * SECOND
const MAX_EVERY = DAY
const DEFAULT_TIMEOUT = 30 * SECOND
const MAX_TIMEOUT = 5 * MINUTE
const DEFAULT_KEEP = DAY
const MAX_KEEP = 7 * DAY
const MAX_OUTPUT = 4 * 1024 * 1024
const MAX_ROWS = 500
const SEEN_MAX = 5000
// Points of history a source keeps at most, whatever its keep: a week of runs a minute apart.
const HISTORY_MAX = 10080
// A rule that flaps notifies once in this long; its state on the page still follows every run.
const NOTIFY_QUIET = 15 * MINUTE
// The login shell's environment is read once in a while, not for every run: .zshrc can take a second.
const ENV_TTL = 15 * MINUTE
const REMOVED_KEEP = 10
// What happened, for the page and Claude: rules firing and clearing, new rows, commands failing.
const EVENTS_KEEP = 7 * DAY
const EVENTS_MAX = 500
// New rows can come every run; they're capped apart, so they can't push out the rules' week.
const NEW_EVENTS_MAX = 200

const FORMATS = ['number', 'json', 'ndjson', 'csv', 'tsv', 'lines']
const PANEL_TYPES = ['stat', 'line', 'area', 'bar', 'table', 'log', 'status', 'checks', 'funnel']
const VALUE_FORMATS = ['number', 'compact', 'percent', 'ms', 'seconds', 'bytes']
const OPS = ['>', '>=', '<', '<=', '==', '!=', 'contains']
const AGGS = ['first', 'last', 'sum', 'avg', 'min', 'max', 'count']
const LEVELS = ['warn', 'alert', 'done']
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DEFAULT_WIDTH = { stat: 1, status: 1, line: 2, area: 2, bar: 2, log: 2, table: 4, checks: 1, funnel: 2 }

const SOURCE_KEYS = ['run', 'every', 'at', 'days', 'hours', 'format', 'timeout', 'keep', 'key', 'folder']
const PANEL_KEYS = {
  stat: ['field', 'format', 'unit', 'decimals', 'spark', 'compare'],
  status: [],
  line: ['y', 'x', 'format', 'unit', 'decimals'],
  area: ['y', 'x', 'format', 'unit', 'decimals'],
  bar: ['y', 'x', 'format', 'unit', 'decimals'],
  table: ['columns', 'limit', 'empty'],
  log: ['text', 'time', 'level', 'limit', 'empty'],
  checks: ['fields', 'format', 'unit', 'decimals'],
  funnel: ['fields', 'format', 'unit', 'decimals'],
}
const RULE_KEYS = ['name', 'source', 'level', 'for', 'field', 'agg', 'op', 'value', 'by', 'change', 'failing', 'new_rows', 'say', 'prompt']

const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text)
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const newId = () => crypto.randomUUID().slice(0, 8)

/** "30s", "5m", "2h", "1d" or "500ms" in milliseconds, or NaN. */
function duration(text) {
  const m = typeof text === 'string' && text.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/)
  if (!m) return NaN
  return Number(m[1]) * { ms: 1, s: SECOND, m: MINUTE, h: HOUR, d: DAY }[m[2]]
}

/** The days of the week a schedule allows, as Date.getDay() numbers, or null when it isn't one. */
function daySet(days) {
  if (days === undefined || days === 'daily') return new Set([0, 1, 2, 3, 4, 5, 6])
  if (days === 'weekdays') return new Set([1, 2, 3, 4, 5])
  if (days === 'weekends') return new Set([0, 6])
  if (Array.isArray(days) && days.length && days.every(d => DAY_NAMES.includes(d))) return new Set(days.map(d => DAY_NAMES.indexOf(d)))
  return null
}

/** "08-18": from 8:00 until 18:00, local. */
function hoursOf(text) {
  const m = typeof text === 'string' && text.trim().match(/^(\d{1,2})-(\d{1,2})$/)
  if (!m) return null
  const [from, to] = [Number(m[1]), Number(m[2])]
  return from < to && to <= 24 ? [from, to] : null
}

const atMinute = (day, minutes) => {
  const d = new Date(day)
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return d.getTime()
}

/**
 * When a source runs next, its last run having started at `last` (0 for never). A time of an `at`
 * schedule that passed while the app was closed runs once, at once; `every` keeps to `days` and `hours`.
 */
function nextRun(source, last, now = Date.now()) {
  const days = daySet(source.days)
  const dayAt = i => {
    const d = new Date(now)
    d.setDate(d.getDate() + i)
    return d
  }
  if (source.at) {
    const slots = source.at.map(t => t.split(':').map(Number)).map(([h, m]) => h * 60 + m)
    const times = []
    for (let i = -7; i <= 8; i++) if (days.has(dayAt(i).getDay())) for (const slot of slots) times.push(atMinute(dayAt(i), slot))
    times.sort((a, b) => a - b)
    const passed = times.filter(t => t <= now).at(-1)
    if (passed !== undefined && last && last < passed) return now
    return times.find(t => t > now) ?? now + DAY
  }
  const wanted = Math.max(now, last ? last + duration(source.every) : now)
  const [from, to] = hoursOf(source.hours) ?? [0, 24]
  for (let i = 0; i <= 8; i++) {
    const day = new Date(wanted)
    day.setDate(day.getDate() + i)
    if (!days.has(day.getDay())) continue
    const start = atMinute(day, from * 60)
    const end = atMinute(day, to * 60)
    if (i === 0 && wanted >= start && wanted < end) return wanted
    if (start >= wanted) return start
  }
  return wanted
}

/** How a source's schedule reads: "every 5m, 08-18 on weekdays" or "at 09:07, 12:07". */
function scheduleText(source) {
  const when = source.at ? `at ${source.at.join(', ')}` : `every ${source.every}${source.hours ? `, ${source.hours}` : ''}`
  const days = source.days === undefined || source.days === 'daily' ? '' : ` on ${Array.isArray(source.days) ? source.days.join(', ') : source.days}`
  return when + days
}

const expand = folder => folder.trim().replace(/^~(?=\/|$)/, os.homedir())

// ── The spec ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Checks a spec as Claude sent it and returns it cleaned, with every mistake listed by where it is, so
 * Claude can fix them all in one go. Unknown fields are mistakes too: ignoring one would let Claude
 * think the page does something it doesn't.
 */
function check(input, { icons, folder: defaultFolder }) {
  const errors = []
  const fail = (where, message) => errors.push(`${where}: ${message}`)
  const unknown = (where, value, allowed) => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(where, `unknown field “${key}”; it takes ${allowed.join(', ')}`)
  }
  const str = (value, where, max, required = true) => {
    if (value === undefined || value === null || value === '') {
      if (required) fail(where, 'missing')
      return undefined
    }
    if (typeof value !== 'string') return void fail(where, 'must be a string')
    return clip(value.trim(), max)
  }
  const folderAt = (value, where) => {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string') return void fail(where, 'must be a string')
    const full = expand(value)
    if (!path.isAbsolute(full) || !fs.statSync(full, { throwIfNoEntry: false })?.isDirectory()) return void fail(where, `“${value}” isn't a folder; give an absolute path or ~/…`)
    return full
  }
  const spec = {}
  if (!isObject(input)) return { errors: ['The monitor must be an object.'] }
  unknown('monitor', input, ['name', 'icon', 'description', 'folder', 'expires', 'marks', 'sources', 'panels', 'rules'])
  spec.name = str(input.name, 'name', 60)
  if (input.icon !== undefined && input.icon !== null) {
    if (!icons.includes(input.icon)) fail('icon', `no icon “${input.icon}”; leave it out or use one from the list`)
    else spec.icon = input.icon
  }
  spec.description = str(input.description, 'description', 400, false)
  spec.folder = folderAt(input.folder, 'folder') ?? defaultFolder ?? os.homedir()
  if (input.expires !== undefined) {
    const expires = duration(input.expires)
    if (!(expires >= 10 * MINUTE && expires <= 30 * DAY)) fail('expires', 'a duration from 10m to 30d, like "6h"')
    spec.expires = input.expires
  }
  if (input.marks !== undefined) {
    if (!Array.isArray(input.marks) || input.marks.length > 10) fail('marks', 'a list of up to 10 { at, label }')
    else {
      spec.marks = []
      input.marks.forEach((mark, i) => {
        const where = `marks[${i}]`
        if (!isObject(mark)) return fail(where, 'must be an object')
        unknown(where, mark, ['at', 'label'])
        const at = typeof mark.at === 'string' ? Date.parse(mark.at) : NaN
        if (Number.isNaN(at)) return fail(`${where}.at`, 'a time, as ISO text like "2026-10-16T09:30:00Z"')
        const label = str(mark.label, `${where}.label`, 40)
        if (label) spec.marks.push({ at: new Date(at).toISOString(), label })
      })
    }
  }

  spec.sources = {}
  if (!isObject(input.sources) || !Object.keys(input.sources).length) fail('sources', 'give at least one source, as { "<name>": { run, every, format } }')
  else {
    const names = Object.keys(input.sources)
    if (names.length > 12) fail('sources', 'at most 12')
    for (const name of names.slice(0, 12)) {
      const where = `sources.${name}`
      const s = input.sources[name]
      if (!/^[a-z][a-z0-9_]{0,31}$/.test(name)) fail(where, 'a source name is lowercase letters, digits and _, starting with a letter')
      if (!isObject(s)) {
        fail(where, 'must be an object')
        continue
      }
      unknown(where, s, SOURCE_KEYS)
      const source = {}
      source.run = str(s.run, `${where}.run`, 4000)
      if ((s.every === undefined) === (s.at === undefined)) fail(where, 'give `every` or `at`, one of them')
      if (s.every !== undefined) {
        const every = duration(s.every)
        if (!(every >= MIN_EVERY && every <= MAX_EVERY)) fail(`${where}.every`, 'a duration from 10s to 1d, like "30s", "5m" or "1h"')
        source.every = s.every
      }
      if (s.at !== undefined) {
        const times = Array.isArray(s.at) ? s.at : [s.at]
        if (!times.length || times.length > 24 || times.some(t => typeof t !== 'string' || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(t.trim()))) {
          fail(`${where}.at`, 'local times of day, like ["09:07", "12:07", "16:07"]')
        } else source.at = [...new Set(times.map(t => t.trim().padStart(5, '0')))].sort()
      }
      if (s.days !== undefined) {
        if (!daySet(s.days)) fail(`${where}.days`, `"daily", "weekdays", "weekends" or a list of ${DAY_NAMES.join(', ')}`)
        else source.days = s.days
      }
      if (s.hours !== undefined) {
        if (s.every === undefined) fail(`${where}.hours`, 'limits `every`; with `at`, the times already say when')
        else if (!hoursOf(s.hours)) fail(`${where}.hours`, 'local hours like "08-18", from 8:00 until 18:00')
        else source.hours = s.hours.trim()
      }
      if (!FORMATS.includes(s.format)) fail(`${where}.format`, `one of ${FORMATS.join(', ')}`)
      source.format = s.format
      if (s.timeout !== undefined) {
        const timeout = duration(s.timeout)
        if (!(timeout >= SECOND && timeout <= MAX_TIMEOUT)) fail(`${where}.timeout`, 'a duration from 1s to 5m')
        source.timeout = s.timeout
      }
      if (s.keep !== undefined) {
        const keep = duration(s.keep)
        if (!(keep >= MINUTE && keep <= MAX_KEEP)) fail(`${where}.keep`, 'a duration from 1m to 7d')
        source.keep = s.keep
      }
      if (s.key !== undefined) source.key = str(s.key, `${where}.key`, 100)
      const folder = folderAt(s.folder, `${where}.folder`)
      if (folder) source.folder = folder
      spec.sources[name] = source
    }
  }
  const sourceNames = Object.keys(spec.sources)
  const sourceRef = (value, where) => {
    if (!sourceNames.includes(value)) fail(where, sourceNames.length ? `no source “${value}”; the sources are ${sourceNames.join(', ')}` : 'no such source')
    return value
  }
  const fieldOf = (value, where, required) => {
    if (value === undefined || value === null) {
      if (required) fail(where, 'missing')
      return undefined
    }
    if (typeof value !== 'string' || !value.trim()) return void fail(where, 'a field name')
    return value.trim()
  }
  const valueFormat = (p, panel, where) => {
    if (p.format !== undefined) {
      if (!VALUE_FORMATS.includes(p.format)) fail(`${where}.format`, `one of ${VALUE_FORMATS.join(', ')}`)
      else panel.format = p.format
    }
    if (p.unit !== undefined) panel.unit = str(p.unit, `${where}.unit`, 16)
    if (p.decimals !== undefined) {
      if (!Number.isInteger(p.decimals) || p.decimals < 0 || p.decimals > 6) fail(`${where}.decimals`, 'a whole number from 0 to 6')
      else panel.decimals = p.decimals
    }
  }
  // A source whose format is number has one field, value, so a panel or rule on it can leave it out.
  const defaultField = source => (spec.sources[source]?.format === 'number' ? 'value' : undefined)

  spec.panels = []
  if (!Array.isArray(input.panels) || !input.panels.length) fail('panels', 'give at least one panel')
  else {
    if (input.panels.length > 24) fail('panels', 'at most 24')
    input.panels.slice(0, 24).forEach((p, i) => {
      const where = `panels[${i}]`
      if (!isObject(p)) return fail(where, 'must be an object')
      if (!PANEL_TYPES.includes(p.type)) return fail(`${where}.type`, `one of ${PANEL_TYPES.join(', ')}`)
      unknown(where, p, ['type', 'source', 'title', 'width', ...PANEL_KEYS[p.type]])
      const panel = { type: p.type, source: sourceRef(p.source, `${where}.source`) }
      if (p.title !== undefined) panel.title = str(p.title, `${where}.title`, 80)
      if (p.width !== undefined) {
        if (![1, 2, 3, 4].includes(p.width)) fail(`${where}.width`, '1, 2, 3 or 4 quarters of the page')
        else panel.width = p.width
      }
      if (p.type === 'stat') {
        panel.field = fieldOf(p.field ?? defaultField(panel.source), `${where}.field`, true)
        valueFormat(p, panel, where)
        if (p.spark !== undefined) panel.spark = p.spark !== false
      }
      if (p.type === 'line' || p.type === 'area' || p.type === 'bar') {
        const y = p.y ?? defaultField(panel.source)
        const ys = Array.isArray(y) ? y : [y]
        if (!ys.length || ys.length > 6 || ys.some(f => typeof f !== 'string' || !f.trim())) fail(`${where}.y`, 'a field, or a list of up to 6')
        else panel.y = ys.map(f => f.trim())
        if (p.x !== undefined) panel.x = fieldOf(p.x, `${where}.x`)
        valueFormat(p, panel, where)
      }
      if (p.type === 'table') {
        if (p.columns !== undefined) {
          if (!Array.isArray(p.columns) || !p.columns.length || p.columns.some(c => typeof c !== 'string')) fail(`${where}.columns`, 'a list of field names')
          else panel.columns = p.columns.slice(0, 12)
        }
      }
      if (p.type === 'log') {
        panel.text = fieldOf(p.text ?? (spec.sources[panel.source]?.format === 'lines' ? 'line' : undefined), `${where}.text`, true)
        if (p.time !== undefined) panel.time = fieldOf(p.time, `${where}.time`)
        if (p.level !== undefined) panel.level = fieldOf(p.level, `${where}.level`)
      }
      if (p.type === 'stat' && p.compare !== undefined) {
        if (p.compare !== false && !(duration(p.compare) >= MINUTE && duration(p.compare) <= MAX_KEEP)) fail(`${where}.compare`, 'a duration from 1m to 7d, like "1h" or "24h", or false')
        else panel.compare = p.compare
      }
      if (p.type === 'checks' || p.type === 'funnel') {
        const items = Array.isArray(p.fields) ? p.fields : []
        if (!items.length || items.length > 12) fail(`${where}.fields`, 'a list of up to 12 fields, each a name or { field, label }')
        else {
          panel.fields = items.map((item, j) => {
            const at = `${where}.fields[${j}]`
            if (typeof item === 'string') return { field: fieldOf(item, at, true) }
            if (!isObject(item)) return void fail(at, 'a field name, or { field, label }')
            unknown(at, item, ['field', 'label'])
            const label = item.label === undefined ? undefined : str(item.label, `${at}.label`, 60)
            return { field: fieldOf(item.field, `${at}.field`, true), ...(label && { label }) }
          }).filter(Boolean)
        }
        valueFormat(p, panel, where)
      }
      if ((p.type === 'table' || p.type === 'log') && p.empty !== undefined) panel.empty = str(p.empty, `${where}.empty`, 80)
      if (p.type === 'table' || p.type === 'log') {
        if (p.limit !== undefined) {
          if (!Number.isInteger(p.limit) || p.limit < 1 || p.limit > MAX_ROWS) fail(`${where}.limit`, `a whole number from 1 to ${MAX_ROWS}`)
          else panel.limit = p.limit
        }
      }
      spec.panels.push(panel)
    })
  }

  spec.rules = []
  if (input.rules !== undefined && !Array.isArray(input.rules)) fail('rules', 'must be a list')
  else {
    const rules = input.rules ?? []
    if (rules.length > 24) fail('rules', 'at most 24')
    rules.slice(0, 24).forEach((r, i) => {
      const where = `rules[${i}]`
      if (!isObject(r)) return fail(where, 'must be an object')
      unknown(where, r, RULE_KEYS)
      const rule = { name: str(r.name, `${where}.name`, 80), source: sourceRef(r.source, `${where}.source`) }
      if (!LEVELS.includes(r.level)) fail(`${where}.level`, 'warn, alert or done')
      rule.level = r.level
      if (r.for !== undefined) {
        if (!Number.isInteger(r.for) || r.for < 1 || r.for > 100) fail(`${where}.for`, 'a whole number of runs in a row, from 1')
        else rule.for = r.for
      }
      const kinds = [r.op !== undefined, r.failing === true, r.new_rows === true].filter(Boolean).length
      if (kinds !== 1) return fail(where, 'give exactly one test: op and value (with field), failing: true, or new_rows: true')
      if (r.failing === true) rule.failing = true
      else if (r.new_rows === true) {
        rule.new_rows = true
        if (spec.sources[rule.source] && !spec.sources[rule.source].key) fail(where, `new_rows needs a key on sources.${rule.source}: the field that tells rows apart, like an id`)
      } else {
        if (!OPS.includes(r.op)) fail(`${where}.op`, `one of ${OPS.join(' ')}`)
        rule.op = r.op
        if (r.agg !== undefined && !AGGS.includes(r.agg)) fail(`${where}.agg`, `one of ${AGGS.join(', ')}`)
        if (r.agg !== undefined) rule.agg = r.agg
        if (rule.agg !== 'count') rule.field = fieldOf(r.field ?? defaultField(rule.source), `${where}.field`, true)
        if (r.op === 'contains' ? typeof r.value !== 'string' : typeof r.value !== 'number' && typeof r.value !== 'string') {
          fail(`${where}.value`, r.op === 'contains' ? 'the text to look for' : 'a number, or text for == and !=')
        }
        if (typeof r.value === 'string' && ['>', '>=', '<', '<='].includes(r.op)) fail(`${where}.value`, `${r.op} compares numbers`)
        rule.value = r.value
        if (r.by !== undefined) rule.by = fieldOf(r.by, `${where}.by`)
        if (r.change !== undefined) {
          if (r.change !== 'run' && !(duration(r.change) >= MINUTE && duration(r.change) <= MAX_KEEP)) fail(`${where}.change`, '"run" (since the run before) or a duration from 1m to 7d, like "1h" or "24h"')
          if (r.by !== undefined) fail(`${where}.change`, "can't be used with by; have the command print each group's change instead")
          if (typeof r.value !== 'number') fail(`${where}.value`, 'change compares a number')
          rule.change = r.change
        }
      }
      if ((r.by !== undefined || r.change !== undefined) && r.op === undefined) fail(where, 'by and change go with op and value')
      if (r.say !== undefined) rule.say = str(r.say, `${where}.say`, 300)
      if (r.prompt !== undefined) rule.prompt = str(r.prompt, `${where}.prompt`, 2000)
      // Its state is kept by what it tests, so reordering or renaming rules doesn't swap their states.
      const { name: _name, say: _say, prompt: _prompt, ...test } = rule
      let id = crypto.createHash('sha256').update(JSON.stringify(test)).digest('hex').slice(0, 8)
      while (spec.rules.some(x => x.id === id)) id += 'x'
      spec.rules.push({ id, ...rule })
    })
  }
  return errors.length ? { errors } : { spec }
}

/** A stored spec as Claude would send it, to check again on its way back (an Undo). */
function asInput(spec) {
  const { id, by, created, updated, expiresAt, ...rest } = spec
  return { ...rest, rules: spec.rules.map(({ id: _id, ...rule }) => rule) }
}

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)

/** Which command, where: its history belongs to it, and is dropped when it changes. */
const runHash = (spec, name) => hash([spec.sources[name].run, spec.sources[name].folder ?? spec.folder])

/** What the user allows for a source: its command and folder, and the prompts its rules would send Claude. */
const commandHash = (spec, name) => {
  const prompts = spec.rules.filter(r => r.source === name && r.prompt).map(r => r.prompt).sort()
  return prompts.length ? hash([spec.sources[name].run, spec.sources[name].folder ?? spec.folder, prompts]) : runHash(spec, name)
}

// ── Output ────────────────────────────────────────────────────────────────────────────────────────

const NUMBER = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

/** Nested objects become dotted fields (a.b); lists and anything deeper stay as JSON text. */
function flatten(value, prefix = '', out = {}, depth = 0) {
  for (const [key, v] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key
    if (isObject(v) && depth < 3) flatten(v, name, out, depth + 1)
    else out[name] = v === null || ['number', 'string', 'boolean'].includes(typeof v) ? v : JSON.stringify(v)
  }
  return out
}

const rowsOf = value => Array.isArray(value)
  ? value.map(item => (isObject(item) ? flatten(item) : { value: item }))
  : isObject(value) ? [flatten(value)] : [{ value }]

function splitLine(line, separator) {
  const cells = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') cell += c, i++
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"' && !cell) quoted = true
    else if (c === separator) cells.push(cell), (cell = '')
    else cell += c
  }
  cells.push(cell)
  return cells
}

function table(text, separator) {
  const [head, ...lines] = text.split(/\r?\n/).filter(l => l.trim())
  if (!head) return []
  const names = splitLine(head, separator).map(n => n.trim())
  return lines.map(line => {
    const cells = splitLine(line, separator)
    return Object.fromEntries(names.map((name, i) => {
      const cell = (cells[i] ?? '').trim()
      return [name, NUMBER.test(cell) ? Number(cell) : cell === '' ? null : cell]
    }))
  })
}

/** A run's output as rows of fields, the one shape panels and rules read. */
function parse(text, format) {
  if (format === 'number') {
    const trimmed = text.trim()
    if (!NUMBER.test(trimmed)) throw new Error(`Expected a number, got “${clip(trimmed, 120) || 'nothing'}”`)
    return [{ value: Number(trimmed) }]
  }
  if (format === 'json') {
    try {
      return rowsOf(JSON.parse(text))
    } catch (error) {
      throw new Error(`Not JSON: ${error.message}. It began “${clip(text.trim(), 120)}”`)
    }
  }
  if (format === 'ndjson') {
    return text.split('\n').filter(l => l.trim()).map((line, i) => {
      try {
        return rowsOf(JSON.parse(line))[0]
      } catch {
        throw new Error(`Line ${i + 1} isn't JSON: “${clip(line.trim(), 120)}”`)
      }
    })
  }
  if (format === 'csv' || format === 'tsv') return table(text, format === 'csv' ? ',' : '\t')
  return text.split('\n').map(l => l.trimEnd()).filter(Boolean).map(line => ({ line }))
}

// ── Rules ─────────────────────────────────────────────────────────────────────────────────────────

function aggregate(rows, field, agg = 'first') {
  if (agg === 'count') return rows.length
  const values = rows.map(r => r[field]).filter(v => v !== undefined && v !== null)
  if (agg === 'first') return values[0]
  if (agg === 'last') return values.at(-1)
  const numbers = values.map(Number).filter(Number.isFinite)
  if (!numbers.length) return undefined
  if (agg === 'sum') return numbers.reduce((a, b) => a + b, 0)
  if (agg === 'avg') return numbers.reduce((a, b) => a + b, 0) / numbers.length
  return agg === 'min' ? Math.min(...numbers) : Math.max(...numbers)
}

function compare(actual, op, expected) {
  if (actual === undefined || actual === null) return false
  if (op === 'contains') return String(actual).toLowerCase().includes(String(expected).toLowerCase())
  if (op === '==') return typeof expected === 'number' ? Number(actual) === expected : String(actual) === expected
  if (op === '!=') return typeof expected === 'number' ? Number(actual) !== expected : String(actual) !== expected
  const n = Number(actual)
  if (!Number.isFinite(n)) return false
  return op === '>' ? n > expected : op === '>=' ? n >= expected : op === '<' ? n < expected : n <= expected
}

const shown = value => (typeof value === 'number' ? String(Math.round(value * 100) / 100) : String(value))
const signed = n => `${n > 0 ? '+' : ''}${shown(n)}`

/** A rule's say: {field} from the first matching row, and {count}, {value}, {keys}, {change}. */
const render = (template, row, extra) => template.replace(/\{([^{}]+)\}/g, (_, name) => {
  const value = name in extra ? extra[name] : row?.[name]
  return value === undefined || value === null ? '—' : shown(value)
})

// ── The service ───────────────────────────────────────────────────────────────────────────────────

module.exports = function monitors({ app, ipcMain, shellEnv, userZdotdir, send, showMonitor, icons }) {
  const dir = path.join(app.getPath('userData'), 'monitors')
  fs.mkdirSync(dir, { recursive: true })
  const specFile = id => path.join(dir, `${id}.json`)
  const dataFile = id => path.join(dir, `${id}.data.json`)
  const stateFile = path.join(dir, 'state.json')

  /** Per monitor: the spec, and what main knows of it at runtime. */
  const all = new Map()
  // What the user decided, apart from the specs Claude writes: which commands they allowed, and paused.
  let decided = {}
  try {
    decided = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  } catch {}
  const saveDecided = () => fs.writeFileSync(stateFile, JSON.stringify(decided, null, 1))
  const removed = []

  const blank = () => ({ sources: {}, rules: {}, unseen: 0 })

  function load() {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json') || file.endsWith('.data.json') || file === 'state.json') continue
      try {
        const spec = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
        let data = blank()
        try {
          data = { ...data, ...JSON.parse(fs.readFileSync(dataFile(spec.id), 'utf8')) }
        } catch {}
        all.set(spec.id, { spec, data, timers: {}, running: new Set(), rev: 0 })
      } catch {}
    }
  }

  const writing = new Map()
  // A run's history is written a few seconds later; quitting writes what's still waiting.
  app.on('before-quit', () => {
    for (const [id, timer] of writing) {
      clearTimeout(timer)
      const m = all.get(id)
      if (m) fs.writeFileSync(dataFile(id), JSON.stringify(m.data))
    }
    writing.clear()
  })
  function saveData(id) {
    if (writing.has(id)) return
    writing.set(id, setTimeout(() => {
      writing.delete(id)
      const m = all.get(id)
      // Written at once, so a removal can't be followed by a write that brings the file back.
      if (m) fs.writeFileSync(dataFile(id), JSON.stringify(m.data))
    }, 5000))
  }

  const approvedOf = id => new Set(decided[id]?.approved ?? [])
  const isApproved = (m, name) => approvedOf(m.spec.id).has(commandHash(m.spec, name))
  const isPaused = id => !!decided[id]?.paused
  /** Until when the user silenced a rule: a time, or "clear" for until it stops firing. */
  function snoozedUntil(id, ruleId) {
    const until = decided[id]?.snoozed?.[ruleId]
    return until === 'clear' || (typeof until === 'number' && until > Date.now()) ? until : undefined
  }
  const isSnoozed = (id, ruleId) => snoozedUntil(id, ruleId) !== undefined

  function log(m, event) {
    const events = (m.data.events ?? []).filter(e => e.t > event.t - EVENTS_KEEP)
    events.push(event)
    let fresh = events.filter(e => e.kind === 'new').length - NEW_EVENTS_MAX
    m.data.events = events.filter(e => e.kind !== 'new' || fresh-- <= 0).slice(-EVENTS_MAX)
  }

  // ── Running ─────────────────────────────────────────────────────────────────────────────────────

  // The environment of the user's interactive login shell, where their database URLs and tokens live.
  let env = null
  let envAt = 0
  let envPending = null
  function loginEnv() {
    if (env && Date.now() - envAt < ENV_TTL) return Promise.resolve(env)
    envPending ??= new Promise(resolve => {
      const base = shellEnv()
      delete base.ZDOTDIR
      if (userZdotdir) base.ZDOTDIR = userZdotdir
      const marker = '__OWN_TERM_ENV__'
      const child = execFile(process.env.SHELL || '/bin/zsh', ['-ilc', `printf '\\n${marker}\\n'; env -0`], { env: base, cwd: os.homedir(), timeout: 10000, maxBuffer: 8 * 1024 * 1024 }, (_error, stdout) => {
        const at = typeof stdout === 'string' ? stdout.lastIndexOf(`\n${marker}\n`) : -1
        // A .zshrc that hangs or fails still leaves the app's own environment, which has PATH.
        const read = at < 0 ? base : Object.fromEntries(stdout.slice(at + marker.length + 2).split('\0').filter(Boolean).map(pair => {
          const eq = pair.indexOf('=')
          return [pair.slice(0, eq), pair.slice(eq + 1)]
        }))
        for (const key of Object.keys(read)) if (key.startsWith('DECKTERM_') || key.startsWith('CLAUDE_CODE_') || key === 'CLAUDECODE') delete read[key]
        env = read
        envAt = Date.now()
        envPending = null
        resolve(env)
      })
      child.stdin?.end()
    })
    return envPending
  }

  // Each is its own process group, which the app has to end itself: on quit, removal or a new spec.
  const children = new Map()
  const kill = child => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  }
  function killRuns(id) {
    for (const [child, of] of children) if (of === id) kill(child)
  }
  app.on('will-quit', () => children.forEach((_, child) => kill(child)))

  /** Runs a command once: its output, or why it failed. `since` starts its window, the last good run. */
  async function execute(spec, name, since) {
    const source = spec.sources[name]
    const started = Date.now()
    const base = await loginEnv()
    return new Promise(resolve => {
      const child = spawn(process.env.SHELL || '/bin/zsh', ['-c', source.run], {
        cwd: source.folder ?? spec.folder,
        env: {
          ...base, NO_COLOR: '1', TERM: 'dumb', OWN_TERM_MONITOR: spec.id,
          // Counting from where the last good run stopped neither misses nor counts twice what came between.
          OWN_TERM_SINCE: new Date(since).toISOString(), OWN_TERM_NOW: new Date(started).toISOString(),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        // Its own process group, so a timeout ends the pipeline it started, not just the shell.
        detached: true,
      })
      children.set(child, spec.id)
      let out = ''
      let err = ''
      let over = false
      child.stdout.on('data', chunk => {
        if (out.length < MAX_OUTPUT) out += chunk
        else over = true
      })
      child.stderr.on('data', chunk => (err = (err + chunk).slice(-8000)))
      const limit = duration(source.timeout) || DEFAULT_TIMEOUT
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {}
      }, limit)
      const done = result => {
        clearTimeout(timer)
        children.delete(child)
        resolve({ ...result, t: started, ms: Date.now() - started })
      }
      child.on('error', error => done({ ok: false, error: error.message }))
      child.on('close', code => {
        if (timedOut) return done({ ok: false, error: `Took longer than ${source.timeout ?? '30s'} and was stopped.` })
        if (code !== 0) return done({ ok: false, error: `Exit code ${code}${err.trim() ? `: ${clip(err.trim(), 2000)}` : ''}` })
        if (over) return done({ ok: false, error: 'Printed more than 4 MB; have the command return less.' })
        try {
          const rows = parse(out, source.format)
          done({ ok: true, rows: rows.slice(0, MAX_ROWS), total: rows.length })
        } catch (error) {
          done({ ok: false, error: error.message })
        }
      })
    })
  }

  async function runSource(id, name) {
    const m = all.get(id)
    if (!m || m.running.has(name) || !m.spec.sources[name] || !isApproved(m, name)) return
    m.running.add(name)
    changed(id)
    const spec = m.spec
    const source = spec.sources[name]
    const since = m.data.sources[name]?.cursor ?? Date.now() - (duration(source.every) || DAY)
    const result = await execute(spec, name, since)
    m.running.delete(name)
    // Removed or replaced while it ran: what it returned belongs to a spec that's gone, whose rules
    // (and prompts) the user may not have allowed.
    if (all.get(id) !== m || m.spec !== spec) {
      if (all.get(id) === m && m.spec.sources[name]) schedule(id, name)
      changed(id)
      return
    }
    record(m, name, result)
    changed(id)
    saveData(id)
    schedule(id, name)
  }

  function record(m, name, result) {
    const source = m.spec.sources[name]
    const keep = duration(source.keep) || DEFAULT_KEEP
    const before = m.data.sources[name] ?? { history: [], seen: [] }
    const entry = { t: result.t, ok: result.ok }
    // The history is one point per run, from the first row's numbers: a command that returns one row
    // is measured over time; one that returns a table draws from its latest rows instead.
    if (result.ok) {
      const first = result.rows[0] ?? {}
      const v = Object.fromEntries(Object.entries(first).filter(([, value]) => typeof value === 'number'))
      if (Object.keys(v).length) entry.v = v
    }
    const history = [...before.history.filter(h => h.t > result.t - keep), entry]
    const wasOk = before.latest ? before.latest.ok : true
    if (wasOk && !result.ok) log(m, { t: result.t, kind: 'failed', source: name, text: clip(result.error ?? 'The command failed.', 300) })
    if (!wasOk && result.ok) log(m, { t: result.t, kind: 'recovered', source: name, text: 'Its command works again.' })
    const latest = { t: result.t, ms: result.ms, ok: result.ok, ...(result.ok ? { rows: result.rows, total: result.total } : { error: result.error }) }
    // A failed run keeps the rows of the last good one, which the page still draws, dimmed.
    const lastGood = result.ok ? latest : before.lastGood
    // New rows are found once for the source, so every new_rows rule on it sees the same ones.
    let fresh = []
    let seen = before.seen ?? []
    if (result.ok && source.key) {
      const known = new Set(seen)
      fresh = result.rows.filter(r => r[source.key] !== undefined && r[source.key] !== null && !known.has(String(r[source.key])))
      seen = [...seen, ...fresh.map(r => String(r[source.key]))].slice(-SEEN_MAX)
    }
    // Rows are kept once: in lastGood, with latest saying only how the run went.
    const state = { history: history.slice(-HISTORY_MAX), latest: { ...latest, rows: undefined }, lastGood, seen, cursor: result.ok ? result.t : before.cursor }
    m.data.sources[name] = state
    for (const rule of m.spec.rules.filter(r => r.source === name)) evaluate(m, rule, result, before, fresh)
  }

  function evaluate(m, rule, result, before, fresh) {
    const prior = m.data.rules[rule.id] ?? { firing: false, streak: 0 }
    const say = (rows, extra, fallback) => (rule.say ? render(rule.say, rows[0], { count: rows.length, ...extra }) : fallback)
    if (rule.new_rows) {
      if (!result.ok) return
      // The first run only learns what's there, as the pings do (status.cjs).
      if (!before.lastGood || !fresh.length) {
        m.data.rules[rule.id] = { ...prior, firing: false }
        return
      }
      const snoozed = isSnoozed(m.spec.id, rule.id)
      if (!snoozed) m.data.unseen = (m.data.unseen ?? 0) + fresh.length
      const first = fresh[0]
      const text = Object.values(first).find(v => typeof v === 'string' && v.length > 12) ?? JSON.stringify(first)
      const message = say(fresh, {}, `${fresh.length} new: ${clip(String(text), 160)}`)
      m.data.rules[rule.id] = { ...prior, firing: false, message, last: { t: result.t, count: fresh.length } }
      log(m, { t: result.t, kind: 'new', rule: rule.id, name: rule.name, level: rule.level, count: fresh.length, text: message, ...(snoozed && { snoozed }) })
      fire(m, rule, message, fresh)
      return
    }
    let holds
    let value
    let matched = []
    let keys
    let message
    if (rule.failing) {
      holds = !result.ok
      message = say([], {}, clip(result.error ?? 'The command failed.', 200))
    } else {
      // A failed run says nothing about the value; the failing rule is for that.
      if (!result.ok) return
      const rows = result.rows
      if (rule.by) {
        // Each group on its own: fires while any holds, and names them.
        const groups = new Map()
        for (const row of rows) {
          const k = String(row[rule.by] ?? '—')
          if (!groups.has(k)) groups.set(k, [])
          groups.get(k).push(row)
        }
        const hits = [...groups].map(([k, group]) => ({ k, group, v: aggregate(group, rule.field, rule.agg) })).filter(g => compare(g.v, rule.op, rule.value))
        holds = hits.length > 0
        keys = hits.map(h => h.k)
        value = hits[0]?.v
        matched = hits.map(h => h.group[0])
        const named = `${keys.slice(0, 5).join(', ')}${keys.length > 5 ? ` and ${keys.length - 5} more` : ''}`
        message = say(matched, { value, keys: named }, `${rule.by} ${named}: ${rule.agg && rule.agg !== 'first' ? `${rule.agg} of ` : ''}${rule.field ?? 'rows'} ${rule.op} ${shown(rule.value)}`)
      } else {
        const now = aggregate(rows, rule.field, rule.agg)
        if (rule.change) {
          // Its own series of values, so the change is of what the rule tests, whatever the aggregate.
          const span = rule.change === 'run' ? 0 : duration(rule.change)
          const series = [...(prior.series ?? []).filter(p => p.t >= result.t - span - DAY), ...(typeof now === 'number' ? [{ t: result.t, v: now }] : [])].slice(-2000)
          const earlier = rule.change === 'run' ? series.at(-2) : series.filter(p => p.t <= result.t - span).at(-1)
          prior.series = series
          if (typeof now !== 'number' || !earlier) return void (m.data.rules[rule.id] = { ...prior })
          value = now - earlier.v
          holds = compare(value, rule.op, rule.value)
          matched = rows.slice(0, 1)
          const over = rule.change === 'run' ? 'since the run before' : `in ${rule.change}`
          message = say(matched, { value, change: signed(value), before: earlier.v, now }, `${rule.field ?? 'rows'} ${signed(value)} ${over} (${shown(earlier.v)} → ${shown(now)})`)
        } else {
          value = now
          holds = compare(value, rule.op, rule.value)
          matched = rule.agg === 'count' || rule.agg === 'sum' || rule.agg === 'avg' ? rows
            : rule.agg === 'last' ? rows.slice(-1)
            : rule.agg === 'min' || rule.agg === 'max' ? rows.filter(r => compare(r[rule.field], rule.op, rule.value))
            : rows.slice(0, 1)
          message = say(matched, { value }, `${rule.field ?? 'rows'} is ${shown(value)} (${rule.op} ${shown(rule.value)})`)
        }
      }
    }
    const streak = holds ? prior.streak + 1 : 0
    const firing = streak >= (rule.for ?? 1)
    const next = { ...prior, streak, firing, value, keys: firing ? keys : undefined, message: firing ? message : prior.message, since: firing === prior.firing ? prior.since : result.t }
    m.data.rules[rule.id] = next
    // A group joining a by-rule that already fires is news too.
    const joined = firing && prior.firing && keys?.some(k => !prior.keys?.includes(k))
    const snoozed = isSnoozed(m.spec.id, rule.id)
    if ((firing && !prior.firing) || joined) {
      log(m, { t: result.t, kind: 'fired', rule: rule.id, name: rule.name, level: rule.level, text: message, ...(keys?.length && { keys: keys.slice(0, 20) }), ...(snoozed && { snoozed }) })
    } else if (!firing && prior.firing) {
      log(m, { t: result.t, kind: 'cleared', rule: rule.id, name: rule.name, level: rule.level, text: 'Back to normal.' })
      // Snoozed until it clears: it has.
      if (decided[m.spec.id]?.snoozed?.[rule.id] === 'clear') setSnooze(m.spec.id, rule.id, null, false)
    }
    if ((firing && !prior.firing) || joined) {
      // Silenced, the user wasn't told, so it doesn't start the quiet time either.
      if (!snoozed && (joined || !prior.notified || result.t - prior.notified > NOTIFY_QUIET)) {
        next.notified = result.t
        fire(m, rule, message, matched)
      }
    } else if (!firing && prior.firing && rule.level === 'alert' && prior.notified && !snoozed) {
      notify(m, rule, 'Back to normal.', true)
    }
  }

  /** A rule started firing: the user hears of it, Claude is woken if the rule asks, and a done rule ends the monitor. */
  function fire(m, rule, message, rows) {
    // Paused, or finished by a done rule earlier in this run: nothing more is news.
    if (isPaused(m.spec.id)) return
    // Silenced by the user: still on the page and in the log, but no one is told.
    if (rule.level !== 'done' && isSnoozed(m.spec.id, rule.id)) return
    notify(m, rule, message)
    if (rule.prompt && isApproved(m, rule.source)) {
      send('monitor:wake', {
        monitor: m.spec.id, name: m.spec.name, session: m.spec.by, rule: rule.name, level: rule.level,
        message, prompt: rule.prompt, source: rule.source, rows: rows.slice(0, 20),
      })
    }
    if (rule.level === 'done') finish(m.spec.id, `${rule.name}: ${message}`)
  }

  /** Pauses a monitor for good reason: a done rule fired, or it expired. Resuming starts it again. */
  function finish(id, why) {
    const m = all.get(id)
    if (m) log(m, { t: Date.now(), kind: 'finished', text: why })
    decided[id] = { ...decided[id], paused: true, done: { at: Date.now(), why } }
    saveDecided()
    if (m) saveData(id)
    stop(id)
    changed(id)
  }

  const live = new Map()
  function notify(m, rule, body, recovered = false) {
    if (!Notification.isSupported() || isPaused(m.spec.id)) return
    const snoozable = !recovered && rule.level !== 'done'
    const notification = new Notification({
      title: `${m.spec.name}: ${rule.name}`,
      subtitle: recovered ? undefined : { alert: 'Alert', warn: 'Warning', done: 'Done' }[rule.level],
      body,
      ...(snoozable && { actions: [{ type: 'button', text: 'Snooze 1 Hour' }] }),
    })
    // Kept, or its click would never arrive.
    const key = `${m.spec.id}:${rule.id}`
    live.get(key)?.close()
    live.set(key, notification)
    notification.on('click', () => {
      live.delete(key)
      showMonitor(m.spec.id)
    })
    notification.on('action', () => {
      live.delete(key)
      setSnooze(m.spec.id, rule.id, Date.now() + HOUR)
    })
    notification.on('close', () => live.delete(key))
    notification.show()
  }

  // A timed snooze ends by itself; a rule still firing then is news again.
  const snoozeTimers = new Map()
  function snoozeTimer(id, ruleId) {
    const key = `${id}:${ruleId}`
    clearTimeout(snoozeTimers.get(key))
    snoozeTimers.delete(key)
    const until = decided[id]?.snoozed?.[ruleId]
    if (typeof until !== 'number' || until <= Date.now()) return
    snoozeTimers.set(key, setTimeout(() => {
      snoozeTimers.delete(key)
      const m = all.get(id)
      const rule = m?.spec.rules.find(r => r.id === ruleId)
      if (!m || !rule || decided[id]?.snoozed?.[ruleId] !== until) return
      setSnooze(id, ruleId, null, false)
      const state = m.data.rules[ruleId]
      if (state?.firing && !isPaused(id)) notify(m, rule, `Still firing after its snooze. ${state.message ?? ''}`.trim())
    }, Math.min(until - Date.now(), 2 ** 31 - 1)))
  }

  /** Silences a rule until a time or "clear", or lets it speak again with null. */
  function setSnooze(id, ruleId, until, closeNotification = true) {
    const m = all.get(id)
    if (!m || !m.spec.rules.some(r => r.id === ruleId)) return
    // Until it clears means this firing; one that cleared before the choice would silence the next.
    if (until === 'clear' && !m.data.rules[ruleId]?.firing) until = null
    const snoozed = Object.fromEntries(Object.entries(decided[id]?.snoozed ?? {}).filter(([rid]) => rid !== ruleId && isSnoozed(id, rid)))
    if (until === 'clear' || typeof until === 'number') snoozed[ruleId] = until
    decided[id] = { ...decided[id], snoozed }
    saveDecided()
    if (closeNotification) live.get(`${id}:${ruleId}`)?.close()
    snoozeTimer(id, ruleId)
    changed(id)
  }

  function schedule(id, name) {
    const m = all.get(id)
    if (!m) return
    clearTimeout(m.timers[name])
    delete m.timers[name]
    if (isPaused(id) || !isApproved(m, name)) return
    const last = m.data.sources[name]?.latest?.t ?? 0
    // Timers can't wait longer than about 24 days; a later run is planned again when this one fires.
    const target = nextRun(m.spec.sources[name], last)
    m.timers[name] = setTimeout(() => (Date.now() >= target - 1000 ? runSource(id, name) : schedule(id, name)), Math.min(Math.max(0, target - Date.now()), 2 ** 31 - 1))
  }

  function scheduleAll(id) {
    const m = all.get(id)
    if (!m) return
    for (const name of Object.keys(m.timers)) if (!m.spec.sources[name]) clearTimeout(m.timers[name])
    if (isPaused(id)) return
    if (m.spec.expiresAt) {
      const left = m.spec.expiresAt - Date.now()
      if (left <= 0) return finish(id, `Ran for ${m.spec.expires}, as long as it was set to.`)
      clearTimeout(m.expiry)
      m.expiry = setTimeout(() => scheduleAll(id), Math.min(left, 2 ** 31 - 1))
    }
    for (const name of Object.keys(m.spec.sources)) schedule(id, name)
  }

  function stop(id) {
    const m = all.get(id)
    if (!m) return
    for (const timer of Object.values(m.timers)) clearTimeout(timer)
    clearTimeout(m.expiry)
    m.timers = {}
  }

  // ── What the window sees ────────────────────────────────────────────────────────────────────────

  function summary(m) {
    const { spec, data } = m
    const id = spec.id
    const names = Object.keys(spec.sources)
    const pending = names.filter(n => !isApproved(m, n))
    const firing = spec.rules
      .filter(r => data.rules[r.id]?.firing && r.level !== 'done' && !isSnoozed(id, r.id))
      .map(r => ({ id: r.id, name: r.name, level: r.level, value: data.rules[r.id].value, since: data.rules[r.id].since, message: data.rules[r.id].message, keys: data.rules[r.id].keys }))
    const done = isPaused(id) ? decided[id]?.done : undefined
    const failed = names.map(n => ({ name: n, latest: data.sources[n]?.latest })).find(s => s.latest && !s.latest.ok)
    const lastRun = Math.max(0, ...names.map(n => data.sources[n]?.latest?.t ?? 0))
    const state = pending.length ? 'approval'
      : done ? 'done'
      : isPaused(id) ? 'paused'
      : firing.some(f => f.level === 'alert') ? 'alert'
      : firing.length ? 'warn'
      : failed ? 'error'
      : lastRun ? 'ok'
      : 'pending'
    const stat = spec.panels.find(p => p.type === 'stat')
    const statRows = stat && data.sources[stat.source]?.lastGood?.rows
    return {
      id,
      name: spec.name,
      icon: spec.icon,
      by: spec.by,
      created: spec.created,
      state,
      paused: isPaused(id),
      done,
      expiresAt: spec.expiresAt,
      pending,
      unseen: data.unseen ?? 0,
      firing,
      snoozed: Object.fromEntries(spec.rules.filter(r => isSnoozed(id, r.id)).map(r => [r.id, snoozedUntil(id, r.id)])),
      error: failed ? `${failed.name}: ${clip(failed.latest.error ?? '', 300)}` : undefined,
      lastRun: lastRun || undefined,
      running: m.running.size > 0,
      headline: stat && statRows?.length ? { value: statRows[0][stat.field] ?? null, format: stat.format, unit: stat.unit, decimals: stat.decimals } : undefined,
      rev: m.rev,
    }
  }

  const list = () => [...all.values()].sort((a, b) => (a.spec.created ?? 0) - (b.spec.created ?? 0)).map(summary)

  let pushing = null
  function changed(id) {
    const m = all.get(id)
    if (m) m.rev++
    if (pushing) return
    pushing = setTimeout(() => {
      pushing = null
      send('monitors', list())
    }, 50)
  }

  /** Fields a panel or rule names that the source's rows don't have, once there are rows to look at. */
  function problems(m) {
    const out = []
    const fieldsOf = name => {
      const rows = m.data.sources[name]?.lastGood?.rows
      if (!rows?.length) return null
      return new Set(rows.slice(0, 20).flatMap(r => Object.keys(r)))
    }
    const missing = (where, source, fields) => {
      const have = fieldsOf(source)
      if (!have) return
      for (const f of fields.filter(Boolean)) {
        if (!have.has(f)) out.push(`${where}: no field “${f}” in ${source}'s rows; they have ${[...have].slice(0, 20).join(', ')}`)
      }
    }
    m.spec.panels.forEach((p, i) => {
      const where = `panels[${i}] (${p.type}${p.title ? ` “${p.title}”` : ''})`
      missing(where, p.source, [p.field, ...(p.y ?? []), p.x, p.text, p.time, p.level, ...(p.columns ?? []), ...(p.fields ?? []).map(f => f.field)])
    })
    m.spec.rules.forEach((r, i) => missing(`rules[${i}] (“${r.name}”)`, r.source, [r.field]))
    for (const name of Object.keys(m.spec.sources)) if (m.spec.sources[name].key) missing(`sources.${name}.key`, name, [m.spec.sources[name].key])
    return out
  }

  function detail(id) {
    const m = all.get(id)
    if (!m) return null
    const sources = Object.fromEntries(Object.keys(m.spec.sources).map(name => {
      const s = m.data.sources[name]
      const timer = m.timers[name]
      return [name, {
        approved: isApproved(m, name),
        running: m.running.has(name),
        scheduled: !!timer,
        latest: s?.latest ? { ...s.latest, rows: undefined } : undefined,
        rows: s?.lastGood?.rows ?? [],
        total: s?.lastGood?.total ?? 0,
        history: s?.history ?? [],
      }]
    }))
    return { spec: m.spec, summary: summary(m), sources, rules: m.data.rules, events: m.data.events ?? [], lookedAt: m.data.lookedAt, problems: problems(m), file: specFile(id) }
  }

  // ── Changes ─────────────────────────────────────────────────────────────────────────────────────

  function save(input, { replace, by, folder, restore }) {
    const existing = replace ? all.get(replace) : null
    if (replace && !existing) return { errors: [`No monitor ${replace}.`] }
    const { spec, errors } = check(restore ? asInput(input) : input, { icons, folder: existing?.spec.folder ?? folder })
    if (errors) return { errors }
    const id = existing?.spec.id ?? newId()
    const now = Date.now()
    // Saving again starts its time over, so Claude can extend a watch by saving it.
    const full = { ...spec, id, by: existing?.spec.by ?? by, created: existing?.spec.created ?? now, updated: now, ...(spec.expires && { expiresAt: restore && input.expiresAt ? input.expiresAt : now + duration(spec.expires) }) }
    fs.writeFileSync(specFile(id), JSON.stringify(full, null, 2) + '\n')
    const old = existing?.spec
    if (existing) {
      stop(id)
      killRuns(id)
      existing.spec = full
      // The history of a command that changed is another command's.
      for (const name of Object.keys(existing.data.sources)) {
        if (!full.sources[name] || !old.sources[name] || runHash(old, name) !== runHash(full, name)) delete existing.data.sources[name]
      }
      existing.data.rules = Object.fromEntries(Object.entries(existing.data.rules).filter(([rid]) => full.rules.some(r => r.id === rid)))
      saveData(id)
    } else all.set(id, { spec: full, data: blank(), timers: {}, running: new Set(), rev: 0 })
    scheduleAll(id)
    changed(id)
    const m = all.get(id)
    return { id, created: !existing, previous: old, pending: Object.keys(full.sources).filter(n => !isApproved(m, n)) }
  }

  ipcMain.handle('monitors:list', () => list())
  ipcMain.handle('monitors:get', (_e, id) => detail(id))
  ipcMain.handle('monitors:save', (_e, input, options = {}) => save(input, options))
  // `updated` is the version of the spec the user was shown: one Claude changed since isn't what they allowed.
  ipcMain.handle('monitors:approve', (_e, id, updated) => {
    const m = all.get(id)
    if (!m || m.spec.updated !== updated) return false
    const hashes = Object.keys(m.spec.sources).map(n => commandHash(m.spec, n))
    // Earlier commands stay allowed, so undoing a change Claude made doesn't ask again.
    decided[id] = { ...decided[id], approved: [...new Set([...(decided[id]?.approved ?? []), ...hashes])].slice(-50) }
    saveDecided()
    for (const name of Object.keys(m.spec.sources)) runSource(id, name)
    changed(id)
    return true
  })
  ipcMain.handle('monitors:pause', (_e, id, paused) => {
    if (!all.has(id)) return
    const m = all.get(id)
    decided[id] = { ...decided[id], paused: !!paused, done: paused ? decided[id]?.done : undefined }
    saveDecided()
    if (!paused && m.spec.expiresAt && m.spec.expiresAt <= Date.now()) {
      // Resumed after it expired: it runs until paused again.
      delete m.spec.expiresAt
      fs.writeFileSync(specFile(id), JSON.stringify(m.spec, null, 2) + '\n')
    }
    if (paused) stop(id)
    else scheduleAll(id)
    changed(id)
  })
  ipcMain.handle('monitors:run', async (_e, id) => {
    const m = all.get(id)
    if (!m) return
    await Promise.all(Object.keys(m.spec.sources).map(async name => {
      // A run already under way is waited for rather than started again.
      while (m.running.has(name)) await new Promise(r => setTimeout(r, 200))
      await runSource(id, name)
    }))
  })
  // `looked`: the page is being left, so what happens from now on is news the next time it opens.
  ipcMain.handle('monitors:seen', (_e, id, looked) => {
    const m = all.get(id)
    if (!m || (!m.data.unseen && !looked)) return
    m.data.unseen = 0
    if (looked) m.data.lookedAt = Date.now()
    saveData(id)
    changed(id)
  })
  ipcMain.handle('monitors:snooze', (_e, id, ruleId, until) => setSnooze(id, ruleId, until))
  ipcMain.handle('monitors:remove', (_e, id) => {
    const m = all.get(id)
    if (!m) return false
    stop(id)
    killRuns(id)
    all.delete(id)
    removed.push({ m, decided: decided[id] })
    if (removed.length > REMOVED_KEEP) removed.shift()
    delete decided[id]
    saveDecided()
    fs.rmSync(specFile(id), { force: true })
    fs.rmSync(dataFile(id), { force: true })
    changed(id)
    return true
  })
  ipcMain.handle('monitors:restore', (_e, id) => {
    const index = removed.findIndex(r => r.m.spec.id === id)
    if (index < 0 || all.has(id)) return false
    const [{ m, decided: was }] = removed.splice(index, 1)
    all.set(id, m)
    if (was) decided[id] = was
    saveDecided()
    for (const rule of m.spec.rules) snoozeTimer(id, rule.id)
    fs.writeFileSync(specFile(id), JSON.stringify(m.spec, null, 2) + '\n')
    saveData(id)
    scheduleAll(id)
    changed(id)
    return true
  })
  ipcMain.on('monitors:reveal', (_e, id) => all.has(id) && shell.showItemInFolder(specFile(id)))

  load()
  for (const m of all.values()) for (const rule of m.spec.rules) snoozeTimer(m.spec.id, rule.id)
  // Started a little apart, so a launch doesn't run every command at once.
  ;[...all.keys()].forEach((id, i) => setTimeout(() => scheduleAll(id), 3000 + i * 1000))
}

module.exports.check = check
module.exports.nextRun = nextRun
module.exports.parse = parse
