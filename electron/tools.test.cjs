// Run with `node --test electron/*.test.cjs`.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createSecrets } = require('./secrets.cjs')
const { handleMcp, answerWithin } = require('./tools.cjs')

const VALUE = 'sk_test_0000'
const DECLINED = 'The user declined.'
const flip = s => [...s].reverse().join('')

function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-test-'))
  const secrets = createSecrets({ dir, seal: { available: () => true, encrypt: s => Buffer.from(flip(s)), decrypt: b => flip(b.toString()) } })
  secrets.add('demo-api-key', VALUE)
  secrets.dir = dir
  return secrets
}
const call = (sessionId, ask, secrets, args = { why: 'to call the demo API' }, verified = true) =>
  handleMcp(sessionId, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'request_secret', arguments: args } }, ask, async () => null, secrets, verified)
const body = answer => answer.result.content[0].text

test('tools/list offers request_secret with only a why argument', async () => {
  const answer = await handleMcp('s1', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null, null, store())
  const tool = answer.result.tools.find(t => t.name === 'request_secret')
  assert.ok(tool)
  assert.deepEqual(Object.keys(tool.inputSchema.properties), ['why'])
  assert.deepEqual(tool.inputSchema.required, ['why'])
  assert.equal(typeof tool.description, 'string')
  assert.match(tool.description, /\$\(cat '<path>'\)/)
  assert.match(tool.description, /never print/)
})

test('a caller without its session key cannot open the picker', async () => {
  let asked = false
  const answer = await call('s1', async () => ((asked = true), { picked: 'demo-api-key' }), store(), undefined, false)
  assert.equal(body(answer), "request_secret can only be asked from the session's own Claude.")
  assert.equal(asked, false)
})

test('a picked token is granted and only its path comes back', async () => {
  const secrets = store()
  const asked = []
  const answer = await call('s1', async (...a) => (asked.push(a), { picked: 'demo-api-key' }), secrets)
  const file = path.join(secrets.dir, 'session-secrets', 's1', 'demo-api-key')
  assert.equal(fs.readFileSync(file, 'utf8'), VALUE)
  assert.equal(body(answer), `Granted "demo-api-key" for this session at ${file}. Use it as $(cat '${file}') inside a command. Never print it.`)
  assert.ok(!JSON.stringify(answer).includes(VALUE))
  assert.equal(answer.result.isError, false)
  assert.deepEqual(asked, [['s1', 'request_secret', { why: 'to call the demo API' }]])
})

test('every other outcome reads as declined', async () => {
  const secrets = store()
  const outcomes = [
    async () => ({}),
    async () => { throw new Error('window gone') },
    async () => ({ picked: 'nope' }),
    async () => ({ picked: 42 }),
  ]
  for (const ask of outcomes) {
    const answer = await call('s1', ask, secrets)
    assert.equal(body(answer), DECLINED)
    assert.equal(answer.result.isError, false)
  }
  assert.deepEqual(secrets.list()[0].holders, [])
})

test('an unreadable token reads as declined', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-test-'))
  const secrets = createSecrets({ dir, seal: { available: () => true, encrypt: s => Buffer.from(s), decrypt: () => { throw new Error('bad') } } })
  secrets.add('demo-api-key', VALUE)
  assert.equal(body(await call('s1', async () => ({ picked: 'demo-api-key' }), secrets)), DECLINED)
})

test('the Today page has no session to grant to', async () => {
  let asked = false
  const answer = await call('today', async () => ((asked = true), {}), store())
  assert.equal(body(answer), 'request_secret needs a session; the Today page has none.')
  assert.equal(asked, false)
})

test('one request at a time per session', async () => {
  const secrets = store()
  let release
  const first = call('s1', () => new Promise(resolve => (release = resolve)), secrets)
  const second = await call('s1', async () => ({ picked: 'demo-api-key' }), secrets)
  assert.equal(body(second), 'A request is already open in this session.')
  const other = await call('s2', async () => ({ picked: 'demo-api-key' }), secrets)
  assert.match(body(other), /^Granted/)
  release({})
  assert.equal(body(await first), DECLINED)
  // Closed again once answered.
  assert.match(body(await call('s1', async () => ({ picked: 'demo-api-key' }), secrets)), /^Granted/)
})

test('why is trimmed and cut to 300 characters', async () => {
  let got
  await call('s1', async (_s, _t, args) => ((got = args.why), {}), store(), { why: `  ${'x'.repeat(400)}  ` })
  assert.equal(got, 'x'.repeat(300))
})

test('main waits 310 seconds for the picker', () => {
  assert.equal(answerWithin('request_secret', {}), 310000)
})
