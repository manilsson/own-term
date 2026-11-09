// Tokens Claude can be given (request_secret in tools.cjs): sealed with the Keychain in one file, and
// decrypted only into a session's grant folder once the user picks one. Nothing here returns a value.
const fs = require('node:fs')
const path = require('node:path')

const NAME = /^[A-Za-z0-9_-]{1,64}$/
const SESSION = /^[\w-]{1,64}$/

/**
 * `seal` is Electron's safeStorage, passed in so the store runs under node:test too. `onChange` is
 * called after every change, so the window can show who holds what.
 */
function createSecrets({ dir, seal, onChange = () => {} }) {
  const storeFile = path.join(dir, 'secrets.json')
  const grantsDir = path.join(dir, 'session-secrets')

  const read = () => {
    try {
      const store = JSON.parse(fs.readFileSync(storeFile, 'utf8'))
      return store && typeof store === 'object' && !Array.isArray(store) ? store : {}
    } catch {
      return {}
    }
  }
  const write = store => {
    const tmp = `${storeFile}.tmp`
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(store, null, 1), { mode: 0o600 })
    fs.renameSync(tmp, storeFile)
  }
  const sessions = () => {
    try {
      return fs.readdirSync(grantsDir).filter(id => SESSION.test(id))
    } catch {
      return []
    }
  }
  const grantFile = (sessionId, name) => path.join(grantsDir, sessionId, name)
  const holders = name => sessions().filter(id => fs.existsSync(grantFile(id, name)))
  const grantedAt = name => Object.fromEntries(holders(name).map(id => [id, fs.statSync(grantFile(id, name)).mtimeMs]))
  const find = (store, name) => Object.keys(store).find(n => n.toLowerCase() === String(name).toLowerCase())
  const existing = (store, name) => {
    const found = find(store, name)
    if (!found) throw new Error(`No token called “${name}”.`)
    return found
  }
  const seals = value => {
    if (!seal.available()) throw new Error("Your Mac's Keychain isn't available, so Own Term can't store tokens.")
    if (typeof value !== 'string' || !value) throw new Error('The token is empty.')
    return seal.encrypt(value).toString('base64')
  }
  const checkName = name => {
    if (typeof name !== 'string' || !NAME.test(name)) throw new Error('Names use letters, digits, - and _ (up to 64).')
  }
  const writeGrant = (file, value) => {
    // mkdir's mode is masked and skipped for folders already there, so it's set outright.
    for (const folder of [grantsDir, path.dirname(file)]) {
      fs.mkdirSync(folder, { recursive: true })
      fs.chmodSync(folder, 0o700)
    }
    fs.writeFileSync(file, value, { mode: 0o600 })
    fs.chmodSync(file, 0o600)
  }
  const unseal = entry => {
    try {
      return seal.decrypt(Buffer.from(entry.sealed, 'base64'))
    } catch {
      throw new Error("That token can't be read; replace it in Settings.")
    }
  }

  const store = {
    list() {
      return Object.entries(read()).map(([name, entry]) => ({
        name, createdAt: entry?.createdAt ?? 0, updatedAt: entry?.updatedAt ?? 0, holders: holders(name), granted: grantedAt(name),
      }))
    },
    add(name, value) {
      checkName(name)
      const store = read()
      const taken = find(store, name)
      if (taken) throw new Error(`A token called “${taken}” already exists.`)
      const now = Date.now()
      store[name] = { sealed: seals(value), createdAt: now, updatedAt: now }
      write(store)
    },
    replace(name, value) {
      const store = read()
      const found = existing(store, name)
      store[found] = { ...store[found], sealed: seals(value), updatedAt: Date.now() }
      write(store)
      for (const id of holders(found)) {
        const file = grantFile(id, found)
        const { atime, mtime } = fs.statSync(file)
        writeGrant(file, value)
        // When it was given stays when it was given.
        fs.utimesSync(file, atime, mtime)
      }
    },
    rename(from, to) {
      checkName(to)
      const store = read()
      const found = existing(store, from)
      const taken = find(store, to)
      if (taken && taken !== found) throw new Error(`A token called “${taken}” already exists.`)
      const { [found]: entry, ...rest } = store
      write({ ...rest, [to]: entry })
      for (const id of holders(found)) fs.renameSync(grantFile(id, found), grantFile(id, to))
    },
    remove(name) {
      const store = read()
      const found = existing(store, name)
      for (const id of holders(found)) fs.rmSync(grantFile(id, found), { force: true })
      delete store[found]
      write(store)
    },
    /** Decrypts the token into the session's folder and returns the file's path. */
    grant(sessionId, name) {
      if (typeof sessionId !== 'string' || !SESSION.test(sessionId)) throw new Error('Not a session.')
      const store = read()
      const found = existing(store, name)
      const file = grantFile(sessionId, found)
      writeGrant(file, unseal(store[found]))
      return file
    },
    revoke(sessionId, name) {
      if (!SESSION.test(sessionId) || !NAME.test(name)) return
      fs.rmSync(grantFile(sessionId, name), { force: true })
    },
    endSession(sessionId) {
      if (!SESSION.test(sessionId)) return
      fs.rmSync(path.join(grantsDir, sessionId), { recursive: true, force: true })
    },
    clearGrants() {
      fs.rmSync(grantsDir, { recursive: true, force: true })
    },
  }
  // A change that throws changed nothing, so only one that went through is reported.
  for (const name of ['add', 'replace', 'rename', 'remove', 'grant', 'revoke', 'endSession', 'clearGrants']) {
    const change = store[name]
    store[name] = (...args) => {
      const result = change(...args)
      onChange()
      return result
    }
  }
  return store
}

module.exports = { createSecrets }
