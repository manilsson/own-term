// Run with `node --test electron/*.test.cjs`.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createSecrets } = require('./secrets.cjs')

const VALUE = 'sk_test_0000'
const flip = s => [...s].reverse().join('')
const fakeSeal = (overrides = {}) => ({
  available: () => true,
  encrypt: s => Buffer.from(flip(s)),
  decrypt: b => flip(b.toString()),
  ...overrides,
})

function setup(seal = fakeSeal()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-test-'))
  return { dir, secrets: createSecrets({ dir, seal }) }
}
const mode = file => fs.statSync(file).mode & 0o777

test('add then list shows the name and never the value', () => {
  const { dir, secrets } = setup()
  secrets.add('demo-api-key', VALUE)
  const list = secrets.list()
  assert.deepEqual(list.map(s => s.name), ['demo-api-key'])
  assert.deepEqual(list[0].holders, [])
  assert.equal(typeof list[0].createdAt, 'number')
  assert.ok(!JSON.stringify(list).includes(VALUE))
  const file = path.join(dir, 'secrets.json')
  assert.ok(!fs.readFileSync(file, 'utf8').includes(VALUE))
  assert.equal(mode(file), 0o600)
})

test('names are validated and unique case-insensitively', () => {
  const { secrets } = setup()
  assert.throws(() => secrets.add('a b', VALUE), /Names use letters, digits, - and _ \(up to 64\)\./)
  assert.throws(() => secrets.add('x'.repeat(65), VALUE), /Names use/)
  assert.throws(() => secrets.add('demo-key', ''), /The token is empty\./)
  secrets.add('demo-key', VALUE)
  assert.throws(() => secrets.add('Demo-Key', 'other'), /A token called “demo-key” already exists\./)
})

test('grant writes the exact value in a 0600 file in a 0700 folder', () => {
  const { dir, secrets } = setup()
  secrets.add('demo-api-key', VALUE)
  const file = secrets.grant('s1', 'demo-api-key')
  assert.equal(file, path.join(dir, 'session-secrets', 's1', 'demo-api-key'))
  assert.equal(fs.readFileSync(file, 'utf8'), VALUE)
  assert.equal(mode(file), 0o600)
  assert.equal(mode(path.dirname(file)), 0o700)
  assert.equal(mode(path.join(dir, 'session-secrets')), 0o700)
  assert.deepEqual(secrets.list()[0].holders, ['s1'])
})

test('grant rejects a bad session id and an unknown name', () => {
  const { secrets } = setup()
  secrets.add('demo-api-key', VALUE)
  assert.throws(() => secrets.grant('../x', 'demo-api-key'))
  assert.throws(() => secrets.grant('s1', 'nope'), /No token called “nope”\./)
})

test('replace rewrites granted files', () => {
  const { secrets } = setup()
  secrets.add('demo-api-key', VALUE)
  const file = secrets.grant('s1', 'demo-api-key')
  secrets.replace('demo-api-key', 'sk_test_1111')
  assert.equal(fs.readFileSync(file, 'utf8'), 'sk_test_1111')
})

test('rename moves granted files', () => {
  const { dir, secrets } = setup()
  secrets.add('demo-api-key', VALUE)
  const file = secrets.grant('s1', 'demo-api-key')
  secrets.rename('demo-api-key', 'demo-renamed')
  assert.ok(!fs.existsSync(file))
  assert.equal(fs.readFileSync(path.join(dir, 'session-secrets', 's1', 'demo-renamed'), 'utf8'), VALUE)
  assert.deepEqual(secrets.list().map(s => s.name), ['demo-renamed'])
})

test('rename to a different case of the same name is allowed', () => {
  const { secrets } = setup()
  secrets.add('demo-key', VALUE)
  secrets.rename('demo-key', 'Demo-Key')
  assert.deepEqual(secrets.list().map(s => s.name), ['Demo-Key'])
})

test('remove deletes the token and its granted files', () => {
  const { secrets } = setup()
  secrets.add('demo-api-key', VALUE)
  const file = secrets.grant('s1', 'demo-api-key')
  secrets.remove('demo-api-key')
  assert.ok(!fs.existsSync(file))
  assert.deepEqual(secrets.list(), [])
})

test('revoke, endSession and clearGrants delete grant files', () => {
  const { dir, secrets } = setup()
  secrets.add('a', VALUE)
  secrets.add('b', VALUE)
  const a1 = secrets.grant('s1', 'a')
  const b1 = secrets.grant('s1', 'b')
  secrets.revoke('s1', 'a')
  assert.ok(!fs.existsSync(a1))
  assert.ok(fs.existsSync(b1))
  secrets.endSession('s1')
  assert.ok(!fs.existsSync(path.dirname(b1)))
  secrets.grant('s2', 'a')
  secrets.clearGrants()
  assert.ok(!fs.existsSync(path.join(dir, 'session-secrets')))
  assert.equal(secrets.list().length, 2)
})

test('an unavailable keychain refuses to save', () => {
  const { secrets } = setup(fakeSeal({ available: () => false }))
  assert.throws(() => secrets.add('demo-key', VALUE), /Your Mac's Keychain isn't available, so Own Term can't store tokens\./)
})

test('a corrupt store lists nothing and an unreadable token cannot be granted', () => {
  const { dir, secrets } = setup()
  fs.writeFileSync(path.join(dir, 'secrets.json'), '{')
  assert.deepEqual(secrets.list(), [])

  const broken = setup(fakeSeal({ decrypt: () => { throw new Error('bad') } }))
  broken.secrets.add('demo-key', VALUE)
  assert.throws(() => broken.secrets.grant('s1', 'demo-key'), /That token can't be read; replace it in Settings\./)
})
