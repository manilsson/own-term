// Own Term's own MCP server, for Claude running in one of its sessions: see and organize the sessions
// and groups, set reminders, start sessions. Claude reaches it over HTTP on the hook server, at
// /mcp/<session>; the zsh integration passes the config (mcpConfig below) only in Own Term's shells.
// The sidebar's state lives in the window, so each call is answered there (src/tools.ts).
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { browserMcpInstalled } = require('./mcp.cjs')
const ICONS = require('./session-icons.json')

const NAME = 'own-term'
const COLORS = 'Red, Orange, Yellow, Green, Mint, Teal, Blue, Indigo, Purple, Pink or Gray'

const INSTRUCTIONS = [
  'You are running inside Own Term, a macOS terminal for Claude Code. Its sidebar lists sessions, each a',
  'terminal, most with Claude in them, sorted into groups by the work they belong to. These tools let you see',
  'and change that: list and describe sessions, rename them, give them icons and move them, make and change',
  'groups, set reminders, start and end sessions, send a prompt to Claude in another session, put sessions on',
  'screen, keep to-dos on the user\'s Today page, read what is on their plate (get_status), name the projects its',
  'sidebar and Today page are grouped by and set their color and icon (list_projects, set_projects, update_project),',
  'and make monitors:',
  'pages in the sidebar that Own Term fills by running commands on a schedule, with rules that notify the user',
  '(save_monitor). Use them when the user asks you to. Never rename, move, reorganize, change the icon of or',
  'end a session, send a prompt, add or change a to-do, change projects, or make or change a monitor on your own initiative,',
  'not even for your own session. When the user asks you to keep an eye on something over time (polling a',
  'database, logs or an endpoint), offer a monitor instead of polling it yourself. Where a tool takes `session`,',
  'it defaults to the session you are running in. Sessions and groups can be given by id or by exact name.',
  'Every change shows the user a notice, with Undo where it can be undone.',
].join(' ')

// The Today page's chat (status.cjs) calls in as this caller, which is no session.
const TODAY = 'today'
const TODAY_INSTRUCTIONS = [
  'You are answering on the user\'s Today page in Own Term, a macOS terminal for Claude Code, not running in',
  'one of its sessions. Its sidebar lists sessions sorted into groups by the work they belong to. These tools',
  'see and change that, the Today page\'s to-dos and the projects it is grouped by. Use them only when the user asks for a change. You have',
  'no session of your own, so name the session wherever a tool takes one. Every change shows the user a',
  'notice, with Undo where it can be undone.',
].join(' ')

// Without this, a session whose chrome-devtools server has died launches a Chrome of its own, outside Own Term.
const BROWSER = [
  'Your chrome-devtools tools drive a Chrome of this session\'s own, which Own Term shows live in its pane;',
  'use them when the user asks you to drive a browser. If those tools are missing, their server has stopped:',
  'ask the user to reconnect chrome-devtools with /mcp rather than starting a Chrome or Playwright yourself.',
  'Logins are shared by every session\'s browser. When a site there asks the user to sign in, ask them to',
  'press Sign In in Chrome on the browser\'s bar in Own Term and then Done Signing In (Google and others',
  'refuse sign-ins in a browser you drive); their page then goes on to where they finished.',
].join(' ')

const session = { type: 'string', description: 'Session id or exact name. Defaults to the session you are running in.' }
const monitor = { type: 'string', description: 'Monitor id or exact name.' }

// The spec save_monitor takes, described for Claude: these descriptions are all it knows of the format.
const valueFormat = {
  format: { type: 'string', enum: ['number', 'compact', 'percent', 'ms', 'seconds', 'bytes'], description: 'How values read: number (default), compact (12.3k), percent (a fraction: 0.25 reads 25%), ms or seconds (as a duration), bytes.' },
  unit: { type: 'string', description: 'Written after a number or compact value, like "req/s".' },
  decimals: { type: 'integer', description: 'Digits after the point. Default: whole numbers as they are, others up to 2.' },
}
const SOURCE = {
  type: 'object',
  description: [
    'A command Own Term runs on a schedule with zsh -c, in the user\'s login shell environment (what their .zshrc exports; not its aliases), in `folder`. It must exit 0 and print only what `format` says; stderr is ignored unless it fails. Have the command do the querying and shaping (SQL aggregates, jq) so it prints exactly the rows to show.',
    'Each run gets $OWN_TERM_SINCE and $OWN_TERM_NOW, ISO times in UTC: when the last successful run started, and when this one did. Count events in that window and nothing is missed or counted twice, even when a run is late or fails (its window carries over). The first run looks back one `every`, or a day.',
    'Seq: `seqcli query --profile=<p> -q "select count(*) as n from stream where <filter> group by <field>" --start=$OWN_TERM_SINCE --end=$OWN_TERM_NOW --no-color` prints CSV with a header (format csv). `seqcli search --profile=<p> -f "<filter>" --json --start=$OWN_TERM_SINCE --end=$OWN_TERM_NOW -c 200` prints one event per line (format ndjson; key "@t", its time to the tick, as it prints no event id; fields @t time, @mt or @m message, @l level, plus the event\'s properties).',
    'Postgres: `PGCONNECT_TIMEOUT=10 psql "<db>" --csv -v ON_ERROR_STOP=1 -c "set statement_timeout=\'20s\'; select …"` (keep the header: no -t; select times as ISO text). Credentials stay where the user keeps them (~/.pgpass, seqcli profiles, their environment): never write a password or token into the command.',
  ].join(' '),
  properties: {
    run: { type: 'string', description: 'The shell command.' },
    every: { type: 'string', description: 'How often: "30s", "5m", "1h"; 10s to 1d. Give this or `at`.' },
    at: { type: 'array', items: { type: 'string' }, description: 'Local times of day to run instead, like ["09:07", "12:07", "16:07"]. A time missed while the app was closed runs once when it opens.' },
    days: { type: ['string', 'array'], items: { type: 'string' }, description: '"daily" (default), "weekdays", "weekends", or a list of sun, mon, tue, wed, thu, fri, sat.' },
    hours: { type: 'string', description: 'With `every`: only between these local hours, like "08-18".' },
    format: {
      type: 'string',
      enum: ['number', 'json', 'ndjson', 'csv', 'tsv', 'lines'],
      description: 'What it prints, read as rows of fields. number: one number, as the field `value`. json: an array of objects (rows), one object (one row), or a number; nested objects become dotted fields (a.b). ndjson: one JSON object per line. csv / tsv: a header line, then rows (psql --csv). lines: each line a row with the field `line`.',
    },
    timeout: { type: 'string', description: 'Stopped after this long; default "30s", up to "5m".' },
    keep: { type: 'string', description: 'How much history to keep; default "24h", up to "7d".' },
    key: { type: 'string', description: 'The field that tells rows apart, like an event id. Needed for new_rows rules.' },
    folder: { type: 'string', description: 'Where it runs, if not the monitor\'s folder.' },
  },
  required: ['run', 'every', 'format'],
}
const PANEL = {
  type: 'object',
  description: [
    'One card on the monitor\'s page, drawn by Own Term from a source\'s rows. Each run of a source is kept as one point of history: its time and the first row\'s numeric fields. So a command that prints one row (a count, a latency) builds a series over time, and one that prints a table is drawn from its latest rows.',
    'stat: a big value, the first row\'s `field`, with a sparkline of its history and its change since an hour ago. line / area / bar: `y` fields; without `x`, plotted over time from the history (one point per run); with `x`, plotted from the latest rows, `x` being a time or a label. Print times (an hour, a day) as ISO text, not as formatted labels: Own Term labels them, and draws marks and the stretches a rule fired on them. table: the latest rows (`columns` picks and orders them). log: the latest rows as lines of `text`, with an optional `time` and `level` (error, warn… colors it). status: up while the command succeeds, with a strip of recent runs.',
    'checks: named values of the first row as one compact list, each green, orange or red by the rules on its field (plain with none): for counts whose good value is 0, like stuck jobs, instead of a stat each. funnel: stages from the first row\'s fields, in order, as bars with the share of the stage before that made it: for a flow like calls → matched → linked.',
    'A table or log with no rows takes one line on the page, saying `empty`; one whose rows are trouble (a list of stuck or failed things) is good news empty, so give it a rule on its source, like new_rows.',
  ].join(' '),
  properties: {
    type: { type: 'string', enum: ['stat', 'line', 'area', 'bar', 'table', 'log', 'status', 'checks', 'funnel'] },
    source: { type: 'string', description: 'A key of `sources`.' },
    title: { type: 'string' },
    width: { type: 'integer', enum: [1, 2, 3, 4], description: 'Quarters of the page. Default: stat, status and checks 1, charts, log and funnel 2, table 4.' },
    field: { type: 'string', description: 'stat: the field to show; `value` for a number source.' },
    spark: { type: 'boolean', description: 'stat: a sparkline of its history (default true).' },
    compare: { type: ['string', 'boolean'], description: 'stat: show the change since this long ago, like "1h" (default) or "24h" (this time yesterday); false for none. Needs the source to keep that much history.' },
    fields: { type: 'array', items: { type: ['string', 'object'], properties: { field: { type: 'string' }, label: { type: 'string' } } }, description: 'checks and funnel: the first row\'s fields, in order, each a name or { field, label }: [{ "field": "stuck_processing", "label": "Stuck in processing" }].' },
    empty: { type: 'string', description: 'table and log: what it says with no rows, like "No stuck meetings".' },
    y: { type: ['string', 'array'], items: { type: 'string' }, description: 'line, area, bar: the field, or up to 6 fields as series.' },
    x: { type: 'string', description: 'line, area, bar: the field along the bottom, from the latest rows. Leave out to plot over time.' },
    columns: { type: 'array', items: { type: 'string' }, description: 'table: the fields to show, in order. Default: every field.' },
    text: { type: 'string', description: 'log: the field with the message; `line` for a lines source.' },
    time: { type: 'string', description: 'log: the field with each row\'s time.' },
    level: { type: 'string', description: 'log: the field with each row\'s level.' },
    limit: { type: 'integer', description: 'table and log: rows shown; default 20 and 50.' },
    ...valueFormat,
  },
  required: ['type', 'source'],
}
const RULE = {
  type: 'object',
  description: [
    'Checked by Own Term after every run of its source; the user is notified when it starts firing (and, at alert level, when it stops), at most once in 15 minutes per rule, and the monitor turns orange or red in the sidebar. Give exactly one test: `op` and `value` on a `field`, `failing: true`, or `new_rows: true`.',
    'With `by`, each group of rows (by that field, like an account) is tested on its own: the rule fires while any group holds, names them, and notifies again when another group joins. With `change`, it tests how much the value moved: since the run before ("run"), or over a time ("1h"; "24h" compares with yesterday).',
    'Level done ends a watch: when it fires the user hears "Done" and the monitor stops running (for a backfill or a job that should finish).',
  ].join(' '),
  properties: {
    name: { type: 'string', description: 'What it means, as the notification says it: "Checkout latency high".' },
    source: { type: 'string' },
    level: { type: 'string', enum: ['warn', 'alert', 'done'] },
    field: { type: 'string', description: 'The field to test; `value` for a number source.' },
    agg: { type: 'string', enum: ['first', 'last', 'sum', 'avg', 'min', 'max', 'count'], description: 'How the latest rows become one value: the first row\'s (default), the last row\'s, or over all rows; count needs no field.' },
    op: { type: 'string', enum: ['>', '>=', '<', '<=', '==', '!=', 'contains'] },
    value: { type: ['number', 'string'], description: 'A number, or text for ==, != and contains.' },
    failing: { type: 'boolean', description: 'Fires while the command fails, times out or prints something it can\'t read.' },
    new_rows: { type: 'boolean', description: 'Notifies when rows appear with a `key` it hasn\'t seen, like new error events; the first run only learns what is there.' },
    by: { type: 'string', description: 'Test each group of rows with the same value of this field on its own, like "AccountId".' },
    change: { type: 'string', description: 'Test the change in the value instead: "run" (since the run before), or a time like "1h" or "24h". Not with `by`: have the command print each group\'s change instead.' },
    say: { type: 'string', description: 'What the notification says, naming what fired: {field} from the first matching row, {count} matching rows, {value}, {keys} (the groups, with by), {change}. Like "{count} meetings failing: {MeetingId} ({AccountId})".' },
    prompt: { type: 'string', description: 'Wakes Claude: when the rule starts firing, this is sent as a prompt to the session that saved the monitor, with the message and the matching rows (up to 20), if Claude is running there and not waiting on a question. Say what to do: "Find the log lines behind it and tell me what it means for customers." The user allows it with the commands.' },
    for: { type: 'integer', description: 'Runs in a row the test must hold before it fires; default 1. Use 2 or 3 to ride out one spike.' },
  },
  required: ['name', 'source', 'level'],
}
const group = { type: 'string', description: 'Group id or exact name.' }
const project = { type: 'string', description: 'A project\'s exact name, from list_projects. Defaults to the one the sidebar shows.' }
const color = { type: 'string', description: `One of ${COLORS}.` }

const TOOLS = [
  {
    name: 'list_sessions',
    description: 'Every session and group in Own Term, with the monitors each group holds and the projects it is in (none: listed in every project): each session\'s id, name, group, project, status (working, needs input, your turn, reminder, running a command, idle), folder, git branch, reminder and what it last did or said. The session you are running in is marked `you`.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'describe_session',
    description: 'What a session is about: its latest prompts and the last thing Claude said in it. Use it to name or group sessions well.',
    inputSchema: { type: 'object', properties: { session } },
  },
  {
    name: 'rename_session',
    description: 'Renames a session. Own Term stops naming it automatically.',
    inputSchema: { type: 'object', properties: { session, name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'set_session_icon',
    description: 'Gives a session an icon, shown before its name in the sidebar and in its pane header, so it is easy to tell apart. Pick one that says what the work is about. `icon: null` removes it.',
    inputSchema: {
      type: 'object',
      properties: { session, icon: { type: ['string', 'null'], enum: [...ICONS, null], description: 'A Lucide icon name from the list.' } },
      required: ['icon'],
    },
  },
  {
    name: 'move_session',
    description: 'Moves a session into a group, or out of every group when `group` is null.',
    inputSchema: { type: 'object', properties: { session, group: { ...group, type: ['string', 'null'] } }, required: ['group'] },
  },
  {
    name: 'create_group',
    description: 'Makes a group, optionally moving sessions and monitors into it. Returns its id.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        color,
        sessions: { type: 'array', items: { type: 'string' }, description: 'Session ids or names.' },
        monitors: { type: 'array', items: { type: 'string' }, description: 'Monitor ids or names.' },
        project: { ...project, description: 'The project it is listed under while its sessions\' repositories don\'t say. Defaults to the one the sidebar shows.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_group',
    description: 'Renames a group or changes its color.',
    inputSchema: { type: 'object', properties: { group, name: { type: 'string' }, color }, required: ['group'] },
  },
  {
    name: 'delete_group',
    description: 'Removes a group. Its sessions and monitors stay, in no group; nothing is ended.',
    inputSchema: { type: 'object', properties: { group }, required: ['group'] },
  },
  {
    name: 'organize',
    description: 'Rearranges many sessions in one step, undone as one: the groups you list get exactly the sessions you list for them (a group whose name matches an existing one is reused, others are made), sessions can be renamed, and sessions you don\'t mention stay where they are.',
    inputSchema: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              color,
              sessions: { type: 'array', items: { type: 'string' } },
              monitors: { type: 'array', items: { type: 'string' }, description: 'The monitors it holds, exactly. Leave out to keep the ones it has.' },
            },
            required: ['name', 'sessions'],
          },
        },
        rename: { type: 'object', additionalProperties: { type: 'string' }, description: 'Session id or name → new name.' },
        ungroup: { type: 'array', items: { type: 'string' }, description: 'Sessions to take out of every group.' },
        remove_empty_groups: { type: 'boolean', description: 'Remove groups left with no sessions or monitors.' },
      },
    },
  },
  {
    name: 'remind',
    description: 'Sets a reminder to come back to a session. When it is due, the session joins Needs You and the user is notified, with the note. Give `in_minutes` or `at`. With `todo`, it sets or moves the time of a to-do on the Today page instead; for a new reminder that isn\'t about a session, use add_note with a time.',
    inputSchema: {
      type: 'object',
      properties: {
        session,
        todo: { type: 'string', description: 'A to-do\'s id or exact text, to remind the user of it instead of a session.' },
        in_minutes: { type: 'number' },
        at: { type: 'string', description: 'Local date and time, like 2026-10-13T09:00.' },
        note: { type: 'string', description: 'What to do when the user is back.' },
      },
    },
  },
  {
    name: 'cancel_reminder',
    description: 'Removes a session\'s reminder, or with `todo` a to-do\'s (the to-do stays): one still to come, and one that came due and waits for the user.',
    inputSchema: { type: 'object', properties: { session, todo: { type: 'string', description: 'A to-do\'s id or exact text.' } } },
  },
  {
    name: 'new_session',
    description: 'Starts a new session in a folder and shows it. By default it runs Claude Code, with `prompt` sent as its first message if given; with `claude: false` it opens a plain shell. `worktree` makes a new git worktree and branch of that name to work in.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Absolute path, or ~/…' },
        name: { type: 'string', description: 'Otherwise Own Term names it from the first prompt.' },
        icon: { type: 'string', enum: ICONS, description: 'An icon for it, as in set_session_icon.' },
        group,
        project: { ...project, description: 'The project it belongs to, when its folder is in no repository that says. Defaults to the one the sidebar shows.' },
        prompt: { type: 'string' },
        claude: { type: 'boolean' },
        worktree: { type: 'string' },
        show: { type: 'string', enum: ['beside', 'alone'], description: 'Beside what is on screen (the default), or alone.' },
      },
      required: ['folder'],
    },
  },
  {
    name: 'review_pr',
    description: 'Does what Review with Claude on the user\'s Today page does: checks a pull request out in a worktree of the user\'s clone of its repository and starts a session there with Claude asked to review it, using the user\'s review prompt from Settings.',
    inputSchema: { type: 'object', properties: { pr: { type: 'string', description: 'owner/repo#123, or the pull request\'s URL.' } }, required: ['pr'] },
  },
  {
    name: 'start_issue',
    description: 'Does what Start does for a Linear issue on the user\'s Today page: makes a worktree on the issue\'s branch in a repository folder and starts a session there with Claude given the issue. Only issues assigned to the user (get_status lists them).',
    inputSchema: {
      type: 'object',
      properties: {
        issue: { type: 'string', description: 'Its identifier, like ABC-123.' },
        folder: { type: 'string', description: 'The repository to work in: absolute path, or ~/…. Defaults to where the issue\'s team was last started.' },
      },
      required: ['issue'],
    },
  },
  {
    name: 'close_session',
    description: 'Ends a session: stops its shell and whatever runs in it, and removes it from the sidebar. A session that is working, waiting for an answer or running a command is refused unless `force` is true. The user can undo it from the notice, which reopens the session and resumes its Claude conversation. To end the session you are running in, the user must have asked for exactly that; pass its id, and it ends a moment after this returns.',
    inputSchema: { type: 'object', properties: { session: { ...session, description: 'Session id or exact name.' }, force: { type: 'boolean' } }, required: ['session'] },
  },
  {
    name: 'send_prompt',
    description: 'Sends a prompt to Claude in another session, as if the user typed it there and pressed Return. Claude must be running in that session. A session that is mid-turn queues it until its turn ends; one waiting for an answer to a question or permission, or with unsent text in its prompt, is refused. Then use wait_for to get the reply.',
    inputSchema: {
      type: 'object',
      properties: { session: { ...session, description: 'Session id or exact name.' }, prompt: { type: 'string' } },
      required: ['session', 'prompt'],
    },
  },
  {
    name: 'wait_for',
    description: 'Waits until Claude in another session finishes its turn, then returns its last reply. Call it right after send_prompt: a turn that hasn\'t started yet is waited for too. It also returns when the session needs the user to answer something, or is ended.',
    inputSchema: {
      type: 'object',
      properties: {
        session: { ...session, description: 'Session id or exact name.' },
        timeout_seconds: { type: 'number', description: 'How long to wait at most: default 600, up to 1800.' },
      },
      required: ['session'],
    },
  },
  {
    name: 'add_note',
    description: 'Adds a to-do to the user\'s Today page in Own Term, where they plan their work; their brief and standup read it. Use it when the user asks you to note, remember or plan something. It is tied to the session you are running in unless `session` says another, or null for none. With `in_minutes` or `at` it is also a reminder: the user is notified then, and it waits on the Reminders page until checked off. Use that for a reminder that isn\'t about coming back to a session, with `session: null`.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The to-do, short and specific, as the user would write it.' },
        in_minutes: { type: 'number' },
        at: { type: 'string', description: 'Local date and time, like 2026-10-13T09:00.' },
        issue: { type: 'string', description: 'A Linear issue it is about, like ABC-123.' },
        session: { ...session, type: ['string', 'null'] },
      },
      required: ['text'],
    },
  },
  {
    name: 'list_notes',
    description: 'The to-dos on the user\'s Today page, with their ids; checked-off ones too with `done: true`.',
    inputSchema: { type: 'object', properties: { done: { type: 'boolean' } } },
  },
  {
    name: 'complete_note',
    description: 'Checks off a to-do on the user\'s Today page, or unchecks it with `done: false`.',
    inputSchema: { type: 'object', properties: { note: { type: 'string', description: 'Its id, or its exact text.' }, done: { type: 'boolean' } }, required: ['note'] },
  },
  {
    name: 'remove_note',
    description: 'Removes a to-do from the user\'s Today page.',
    inputSchema: { type: 'object', properties: { note: { type: 'string', description: 'Its id, or its exact text.' } }, required: ['note'] },
  },
  {
    name: 'get_status',
    description: 'What the user has on their plate, from their Today page: the brief Claude wrote for them, sessions that need them, reminders, pull requests waiting for their review and their own open ones, their Linear issues, and their to-dos.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_projects',
    description: 'The projects the user\'s sidebar and Today page are grouped by, each with its repositories (owner/name), where its name comes from (set by the user, the sidebar group that holds the repository\'s sessions, or the repository\'s own name), its color and icon on the project rail (a session icon\'s name, `favicon` or `initials`), in the rail\'s order, and whether its repository has a favicon. Sessions, pull requests, issues, to-dos and prompts are placed by their repository; the sidebar and the Today page show one project at a time, or all.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_projects',
    description: 'Names the projects repositories belong to on the Today page. Repositories given the same name become one project (acme-api and acme-web both "Acme"); null gives a repository back its own default name. Repositories you don\'t mention keep theirs. Undone as one.',
    inputSchema: {
      type: 'object',
      properties: {
        projects: {
          type: 'object',
          additionalProperties: { type: ['string', 'null'] },
          description: 'Repository (owner/name, or its name alone when that is unique) → project name, at most 40 characters, or null.',
        },
      },
      required: ['projects'],
    },
  },
  {
    name: 'update_project',
    description: 'Sets how a project looks on the rail beside the sidebar and where it sits: its color, its icon and its position (1 is first; ⌃⌘1…9 follow the rail). `icon` is a session icon\'s name, `favicon` (its repository\'s own icon, the default when it has one) or `initials`; null gives either back its default. Undone as one.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'The project\'s exact name, from list_projects.' },
        color: { type: ['string', 'null'], description: `One of ${COLORS}, or null.` },
        icon: { type: ['string', 'null'], enum: [...ICONS, 'favicon', 'initials', null] },
        position: { type: 'integer', minimum: 1, description: 'Where it goes on the rail, 1 being first; the others keep their order.' },
      },
      required: ['project'],
    },
  },
  {
    name: 'save_monitor',
    description: [
      'Makes a monitor, or replaces one\'s spec with `monitor`. A monitor is a page in Own Term\'s sidebar, under Monitors, that Own Term fills by running shell commands (sources) on a schedule, drawn as panels (values, charts, tables, logs), with rules that notify the user. It keeps running whether or not any session is open, and costs no tokens: you write the spec once, Own Term does the polling.',
      'Before saving, run each command once yourself with Bash so you know it works and prints what its format expects. Own Term runs nothing until the user presses Allow on the monitor\'s page; a changed command or folder needs Allow again. Then call get_monitor with run: true to see what the panels got, and fix any problems it lists.',
      'The spec is checked when saved; every mistake comes back at once, by where it is.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        monitor: { ...monitor, description: 'The monitor to replace, by id or exact name. Leave out to make a new one.' },
        group: { ...group, description: 'Group id or exact name to put it in, shown with that group\'s sessions. Leave out to keep it where it is (a new one goes under Monitors).' },
        name: { type: 'string', description: 'Short, as the sidebar shows it: "Checkout health".' },
        icon: { type: 'string', enum: ICONS, description: 'An icon for it, as in set_session_icon.' },
        description: { type: 'string', description: 'A line under the title: what it watches and why.' },
        folder: { type: 'string', description: 'Where commands run: absolute path or ~/…. Defaults to your session\'s folder.' },
        expires: { type: 'string', description: 'Stop by itself after this long, like "6h" for a watch after a release; saving it again starts the time over. Default: runs until paused or removed.' },
        marks: { type: 'array', items: { type: 'object', properties: { at: { type: 'string', description: 'ISO time.' }, label: { type: 'string', description: 'A few words: "PR #2726 live".' } }, required: ['at', 'label'] }, description: 'Moments drawn as a line on every time chart, like when a release went out, so a before and after reads at a glance. Up to 10.' },
        sources: { type: 'object', additionalProperties: SOURCE, description: 'The commands, by a short name of your choosing (lowercase, digits, _): { "latency": { … } }.' },
        panels: { type: 'array', items: PANEL, description: 'The cards, in order; they flow four quarters to a row.' },
        rules: { type: 'array', items: RULE },
      },
      required: ['name', 'sources', 'panels'],
    },
  },
  {
    name: 'move_monitor',
    description: 'Puts a monitor in a group, where it shows with the group\'s sessions and opens beside them, or takes it out of every group (back under Monitors) when `group` is null. A monitor is in one group at most.',
    inputSchema: { type: 'object', properties: { monitor, group: { ...group, type: ['string', 'null'] } }, required: ['monitor', 'group'] },
  },
  {
    name: 'list_monitors',
    description: 'The user\'s monitors: each one\'s id, name, group, state (waiting for Allow, paused, alert, warning, failing, ok), the rules firing, how many rules the user snoozed (get_monitor names them), the last run and any error.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_monitor',
    description: 'One monitor in full, to check it works or to review what it has seen: its spec, and for each source whether it is allowed, its last run (time, how long, error) and its latest rows; for each number in its history, the lowest, highest, average, first and last over `since`, and when it was lowest and highest; each rule\'s state, and whether the user snoozed it; what happened over `since` (rules firing and clearing, new rows, commands failing and working again), to answer what went on while the user was away; and problems, such as a panel naming a field the rows don\'t have. With `run: true` it runs the allowed commands first and waits for them.',
    inputSchema: {
      type: 'object',
      properties: {
        monitor,
        run: { type: 'boolean' },
        since: { type: 'string', description: 'How far back to review the history: "30m", "6h", "1d". Default "1h"; it reaches back as far as the source keeps.' },
        points: { type: 'boolean', description: 'Also give every point of history in that time, up to 300 a source, evenly spread when there are more.' },
      },
      required: ['monitor'],
    },
  },
  {
    name: 'pause_monitor',
    description: 'Pauses a monitor (its commands stop running and it doesn\'t notify) or resumes it with `paused: false`.',
    inputSchema: { type: 'object', properties: { monitor, paused: { type: 'boolean' } }, required: ['monitor'] },
  },
  {
    name: 'remove_monitor',
    description: 'Removes a monitor and its history. The user can undo it from the notice.',
    inputSchema: { type: 'object', properties: { monitor }, required: ['monitor'] },
  },
  {
    name: 'show_sessions',
    description: 'Puts sessions and monitors on screen: one alone, or several side by side, monitors after sessions. When the sidebar shows another project, it switches to theirs (to all projects if they span several).',
    inputSchema: {
      type: 'object',
      properties: {
        sessions: { type: 'array', items: { type: 'string' } },
        monitors: { type: 'array', items: { type: 'string' }, description: 'Monitor ids or names to show beside the sessions.' },
      },
    },
  },
]

// The config Claude Code is given in Own Term's shells; it fills in the session from the environment.
function writeMcpConfig(file) {
  const config = {
    mcpServers: {
      [NAME]: {
        type: 'http',
        url: 'http://127.0.0.1:${DECKTERM_PORT}/mcp/${DECKTERM_SESSION}',
        headers: { 'X-Deckterm-Token': '${DECKTERM_TOKEN}' },
      },
    },
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
}

/** Answers one JSON-RPC message from Claude Code; `ask` runs a tool in the window. */
async function handleMcp(sessionId, message, ask, findTranscript) {
  const { id, method, params } = message ?? {}
  if (id === undefined) return null
  const reply = result => ({ jsonrpc: '2.0', id, result })
  if (method === 'initialize') {
    return reply({
      protocolVersion: params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: NAME, version: '1' },
      instructions: sessionId === TODAY ? TODAY_INSTRUCTIONS : browserMcpInstalled() ? `${INSTRUCTIONS} ${BROWSER}` : INSTRUCTIONS,
    })
  }
  if (method === 'ping') return reply({})
  if (method === 'tools/list') return reply({ tools: TOOLS })
  if (method === 'tools/call') {
    const name = params?.name
    if (!TOOLS.some(t => t.name === name)) return reply(text(`No tool called ${name}.`, true))
    const args = { ...params?.arguments }
    if (name === 'new_session' || (name === 'start_issue' && args.folder)) {
      // The window can't look at the disk, and a shell given a missing folder quietly starts in home.
      const folder = typeof args.folder === 'string' ? args.folder.trim().replace(/^~(?=\/|$)/, os.homedir()) : ''
      if (!path.isAbsolute(folder) || !fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory()) {
        return reply(text(`“${args.folder}” isn't a folder; give an absolute path or ~/….`, true))
      }
      args.folder = folder
    }
    const result = await ask(sessionId, name, args).catch(error => ({ text: error.message, isError: true }))
    let body = result.text
    if (result.transcript) body += `\n\n${await digest(result.transcript, findTranscript)}`
    return reply(text(body, result.isError))
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method ${method}` } }
}

const text = (body, isError = false) => ({ content: [{ type: 'text', text: body }], isError })

/** A conversation's latest prompts and Claude's last reply, from the end of its transcript. */
async function digest(claudeSessionId, findTranscript) {
  const file = await findTranscript(claudeSessionId)
  if (!file) return 'No transcript found for its Claude conversation.'
  const handle = await fsp.open(file, 'r')
  let tail
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, 2 * 1024 * 1024)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    tail = buffer.toString('utf8').split('\n').slice(size > length ? 1 : 0)
  } finally {
    await handle.close()
  }
  const prompts = []
  let reply = ''
  for (const line of tail) {
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.isSidechain) continue
    const content = entry.message?.content
    if (entry.type === 'user' && typeof content === 'string' && !entry.isMeta && !content.startsWith('<')) prompts.push(content.trim())
    if (entry.type === 'assistant' && Array.isArray(content)) {
      const said = content.filter(c => c?.type === 'text').map(c => c.text).join(' ').trim()
      if (said) reply = said
    }
  }
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s)
  const latest = prompts.slice(-5).map(p => `- ${clip(p.replace(/\s+/g, ' '), 400)}`)
  return [
    latest.length ? `Latest prompts, oldest first:\n${latest.join('\n')}` : 'No prompts yet.',
    reply ? `Claude's last reply:\n${clip(reply, 800)}` : '',
  ].filter(Boolean).join('\n\n')
}

// How long main waits for the window to answer a call: wait_for answers when its turn ends.
const answerWithin = (name, args) => name === 'wait_for'
  ? (Math.min(1800, Math.max(5, Number(args?.timeout_seconds) || 600)) + 20) * 1000
  // It may ask GitHub and Linear first.
  : name === 'get_status' ? 60000
  // Fetching the pull request can take a while on a big repository.
  : name === 'review_pr' ? 150000
  : name === 'start_issue' ? 60000
  // Its commands can each take up to five minutes.
  : name === 'get_monitor' && args?.run === true ? 330000
  : 15000

module.exports = { writeMcpConfig, handleMcp, answerWithin, NAME, TODAY }
