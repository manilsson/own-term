// Evaluates JavaScript in the running app's window, for driving and inspecting it from a terminal.
// Usage: node scripts/cdp.mjs [--panel] "<expression>" — needs `npm run dev`, which opens the debugger on
// port 9333. --panel evaluates in the menu bar's panel instead of the main window.
const args = process.argv.slice(2)
const panel = args[0] === '--panel'
const expression = panel ? args[1] : args[0]
const targets = await (await fetch('http://127.0.0.1:9333/json')).json()
const target = targets.find(t => t.type === 'page' && new URL(t.url).searchParams.has('panel') === panel)
if (!target) throw new Error(panel ? 'The panel isn\'t open; click the menu bar icon first.' : 'No app window.')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve => ws.addEventListener('open', resolve))
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.id !== 1) return
  const { result, exceptionDetails } = message.result
  console.log(exceptionDetails ? exceptionDetails.exception?.description : JSON.stringify(result.value, null, 1))
  ws.close()
})
