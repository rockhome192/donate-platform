import { createServer } from 'node:http'
import { SocketRegistry } from './rooms.js'

/**
 * M0: process boots, Railway's health check passes, room registry is wired.
 * The WebSocket upgrade, ticket verification, heartbeat and /internal/* routes
 * land in M2a — see DESIGN.md 8.x.
 */

const PORT = Number(process.env.PORT ?? 8080)
export const registry = new SocketRegistry()

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        ok: true,
        connections: registry.totalConnections(),
        uptimeSeconds: Math.round(process.uptime()),
      }),
    )
    return
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(PORT, () => {
  console.log(`[realtime] listening on :${PORT}`)
})

// Railway sends SIGTERM on redeploy. Closing cleanly lets clients see a normal
// shutdown and reconnect with jitter instead of hanging on a dead socket.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`[realtime] ${signal} received, shutting down`)
    server.close(() => process.exit(0))
  })
}
