import { existsSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { CloseCode, HEARTBEAT_INTERVAL_MS, type ServerMessage } from '@dp/shared'
import {
  MAX_BODY_BYTES,
  isOriginAllowed,
  verifyInternalRequest,
} from './internal.js'
import { startReconcilerDriver } from './reconciler-driver.js'
import { SocketRegistry } from './rooms.js'
import { SeenTickets, verifyTicket } from './ticket.js'

/**
 * The realtime service (DESIGN.md 8.3, 8.5, 8.6, 9).
 *
 * It holds overlay sockets and nothing else: no Prisma, no payment keys, no
 * schema. Everything it is allowed to know arrives either inside a ticket that
 * apps/web signed, or on an /internal route that apps/web authenticated with a
 * shared HMAC. That is what lets Vercel and Railway deploy independently.
 */

/**
 * Load apps/realtime/.env ourselves.
 *
 * Next.js does this for apps/web, which is why nobody noticed that nothing
 * does it here: `tsx` and plain `node` both leave .env alone, so every var this
 * service reads was silently undefined in local dev — including the ones the
 * reconciler driver needs, which is why it only ever logged "not scheduling".
 *
 * -if-exists semantics on purpose: Railway injects real environment variables
 * and ships no .env file, and a hard failure there would be a crash loop over
 * a file that is not supposed to exist.
 */
const localEnv = fileURLToPath(new URL('../.env', import.meta.url))
if (existsSync(localEnv)) {
  process.loadEnvFile(localEnv)
}

const PORT = Number(process.env.PORT ?? 8080)

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    // Fail at boot, loudly. A process that starts and then refuses every
    // socket looks like a network fault and gets debugged in the wrong place.
    console.error(`[realtime] missing required env var: ${name}`)
    process.exit(1)
  }
  return value
}

const JWT_SECRET = required('REALTIME_JWT_SECRET')
const INTERNAL_SECRET = required('REALTIME_INTERNAL_SECRET')
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS

if (!ALLOWED_ORIGINS) {
  console.warn('[realtime] ALLOWED_ORIGINS unset — accepting any Origin on the WebSocket handshake')
}

export const registry = new SocketRegistry()
const seenTickets = new SeenTickets()

/** Per-socket state the registry does not need to care about. */
type SocketMeta = { streamerId: string; isAlive: boolean }
const meta = new WeakMap<WebSocket, SocketMeta>()

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 })

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
}

// ---------------------------------------------------------------- HTTP

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/**
 * Reads the body as a string, because the HMAC covers the RAW bytes — parsing
 * first and re-serialising would change key order and whitespace and never
 * match. Capped so an unauthenticated caller cannot make the process buffer
 * unbounded input before we have checked a single signature.
 */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        resolve(null)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(null))
  })
}

async function handleInternal(
  req: IncomingMessage,
  res: ServerResponse,
  route: 'publish' | 'disconnect',
): Promise<void> {
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })

  const rawBody = await readBody(req)
  if (rawBody === null) return json(res, 413, { error: 'body too large' })

  const auth = verifyInternalRequest({
    signature: req.headers['x-signature'] as string | undefined,
    timestamp: req.headers['x-timestamp'] as string | undefined,
    rawBody,
    secret: INTERNAL_SECRET,
  })
  if (!auth.ok) return json(res, auth.status, { error: auth.reason })

  let body: { streamerId?: unknown; message?: unknown; code?: unknown }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return json(res, 400, { error: 'invalid json' })
  }

  const streamerId = typeof body.streamerId === 'string' ? body.streamerId : null
  if (!streamerId) return json(res, 400, { error: 'streamerId required' })

  if (route === 'disconnect') {
    const code = typeof body.code === 'number' ? body.code : CloseCode.BAD_TICKET
    const closed = registry.disconnectAll(streamerId, code)
    return json(res, 200, { closed })
  }

  if (!body.message || typeof body.message !== 'object') {
    return json(res, 400, { error: 'message required' })
  }

  const sockets = registry.sockets(streamerId) as WebSocket[]
  for (const socket of sockets) send(socket, body.message as ServerMessage)

  // Zero delivered is a normal answer, not an error: the streamer may simply
  // have no overlay open. apps/web must not retry on it — /missed is what
  // covers that case (DESIGN.md 8.4).
  return json(res, 200, { delivered: sockets.length })
}

const server = createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0]

  if (path === '/healthz') {
    return json(res, 200, {
      ok: true,
      connections: registry.totalConnections(),
      pendingTickets: seenTickets.size,
      uptimeSeconds: Math.round(process.uptime()),
    })
  }
  if (path === '/internal/publish') return void handleInternal(req, res, 'publish')
  if (path === '/internal/disconnect') return void handleInternal(req, res, 'disconnect')

  json(res, 404, { error: 'not found' })
})

// ---------------------------------------------------------------- WebSocket

/**
 * Rejections happen AFTER the handshake completes, so the client receives a
 * real application close code instead of a bare transport failure.
 *
 * DESIGN.md 8.5 has the client branch on those codes, and a connection refused
 * at the HTTP layer arrives as 1006 — indistinguishable from the wifi dropping.
 * The cost is that an unauthenticated caller can make us finish a handshake
 * before being closed; the rate limit that bounds this sits on /ticket, which
 * is the only place a legitimate client can get one.
 */
function rejectSocket(socket: WebSocket, code: number, reason: string): void {
  send(socket, { type: 'error', code: String(code), message: reason })
  socket.close(code, reason)
}

server.on('upgrade', (req, socket: Duplex, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (url.pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
    socket.destroy()
    return
  }

  // Origin is checked before the handshake: a cross-origin caller has no
  // business completing one, and there is no close code that would help it.
  if (!isOriginAllowed(req.headers.origin, ALLOWED_ORIGINS)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    socket.destroy()
    return
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    void admit(ws, url.searchParams.get('ticket') ?? '')
  })
})

async function admit(ws: WebSocket, ticket: string): Promise<void> {
  const result = await verifyTicket(ticket, JWT_SECRET, seenTickets)

  if (!result.ok) {
    // Both 'invalid' and 'replayed' are BAD_TICKET, which the client treats as
    // retryable — it asks /ticket for a fresh one, and THAT response is what
    // tells it whether to keep trying. This service cannot tell an expired
    // ticket from a rotated overlayToken, because it never sees the database.
    rejectSocket(ws, CloseCode.BAD_TICKET, result.reason)
    return
  }

  const admitted = registry.admit(result.streamerId, ws)
  if (!admitted.ok) {
    rejectSocket(ws, admitted.code, admitted.reason)
    return
  }

  meta.set(ws, { streamerId: result.streamerId, isAlive: true })

  ws.on('pong', () => {
    const state = meta.get(ws)
    if (state) state.isAlive = true
  })

  ws.on('message', (raw) => {
    // Receive-only by design. `ping` is answered so a client behind a proxy
    // that eats protocol-level frames can still prove liveness; `ack` is NOT
    // handled here — alertedAt lives in Postgres and only apps/web can write
    // it, so the overlay acks over HTTP (DESIGN.md 8.4). Everything else is
    // dropped without a reply.
    try {
      const message = JSON.parse(raw.toString())
      if (message?.type === 'ping') {
        send(ws, { type: 'pong', t: Date.now() })
      }
    } catch {
      // Malformed frame from a client we cannot help. Not worth a log line per
      // occurrence — that is a free way to fill a disk.
    }
  })

  const cleanup = () => registry.remove(result.streamerId, ws)
  ws.on('close', cleanup)
  ws.on('error', cleanup)

  send(ws, {
    type: 'hello',
    streamerId: result.streamerId,
    serverTime: new Date().toISOString(),
  })
}

/**
 * A TCP connection that died without closing looks identical to an idle one,
 * and a streamer would sit through a whole stream not knowing alerts stopped
 * arriving. Anything that missed the previous round is gone.
 *
 * terminate(), not close(): close() waits for a handshake from a peer that is
 * already gone, so the dead socket would linger.
 */
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    const state = meta.get(ws)
    if (!state) continue
    if (!state.isAlive) {
      ws.terminate()
      continue
    }
    state.isAlive = false
    ws.ping()
  }
}, HEARTBEAT_INTERVAL_MS)

// ---------------------------------------------------------------- lifecycle

server.listen(PORT, () => {
  console.log(`[realtime] listening on :${PORT}`)
})

const reconciler = startReconcilerDriver()

// Railway sends SIGTERM on redeploy. SERVICE_RESTART is in the retryable set,
// so overlays reconnect with jitter instead of hanging on a dead socket.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`[realtime] ${signal} received, shutting down`)
    clearInterval(heartbeat)
    reconciler?.stop()
    for (const ws of wss.clients) ws.close(CloseCode.SERVICE_RESTART, 'server restarting')
    server.close(() => process.exit(0))
  })
}
