// The demo day's shop, served for the Apple Pay session's browser: one page, on the port a dev server
// would use, so the browser's bar reads like a day's work and not like a file.
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const PAGE = path.join(__dirname, 'demo', 'checkout.html')
let site = null

const serve = (req, res) => {
  if (req.url !== '/checkout') return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  fs.createReadStream(PAGE).pipe(res)
}

const listen = (host, port) => new Promise((resolve, reject) => {
  const server = http.createServer(serve)
  server.once('error', reject)
  server.listen(port, host, () => resolve(server))
})

// "localhost" is ::1 to one program and 127.0.0.1 to another, so the port is only ours if both are.
async function claim(port) {
  const v4 = await listen('127.0.0.1', port)
  try {
    await listen('::1', v4.address().port)
  } catch (error) {
    v4.close()
    throw error
  }
  return v4.address().port
}

/** The checkout page's address, on the first free port from a dev server's 3000, or any port. */
function demoSite() {
  if (site) return site
  site = (async () => {
    for (const candidate of [3000, 3001, 3002, 0]) {
      try {
        return `http://localhost:${await claim(candidate)}/checkout`
      } catch {}
    }
    throw new Error('No port for the demo site.')
  })()
  site.catch(() => (site = null))
  return site
}

module.exports = { demoSite }
