import { CloseCode, MAX_SOCKETS_PER_STREAMER } from '@dp/shared'

/**
 * In-memory socket registry, one Set of sockets per streamer.
 *
 * KNOWN LIMIT (DESIGN.md 8.6): this is per-process, so the service runs as a
 * single instance. Two instances would split the rooms and publishes would miss
 * half the overlays. The fix when it matters is a Redis pub/sub backplane — and
 * the seen-ticket set below has to move at the same time, not later.
 */

/** Minimal surface so tests don't need a real WebSocket. */
export interface Closable {
  close(code: number, reason?: string): void
}

export type AdmitResult =
  | { ok: true }
  | { ok: false; code: number; reason: string }

export class SocketRegistry {
  private rooms = new Map<string, Set<Closable>>()

  constructor(private readonly maxPerStreamer: number = MAX_SOCKETS_PER_STREAMER) {}

  /**
   * Quota rule: when a streamer is at capacity the NEWCOMER is refused. The
   * sockets already connected are never evicted.
   *
   * The first draft did the opposite — evict the oldest — while telling clients
   * 4003 was retryable. Six overlays then took turns killing each other
   * forever. Refusing the newcomer also guesses intent better: whatever is
   * already on air is what the streamer is actually using.
   */
  admit(streamerId: string, socket: Closable): AdmitResult {
    const room = this.rooms.get(streamerId)

    if (room && room.size >= this.maxPerStreamer) {
      return {
        ok: false,
        code: CloseCode.QUOTA_FULL,
        reason: `already ${room.size} overlays connected`,
      }
    }

    if (room) room.add(socket)
    else this.rooms.set(streamerId, new Set([socket]))

    return { ok: true }
  }

  remove(streamerId: string, socket: Closable): void {
    const room = this.rooms.get(streamerId)
    if (!room) return
    room.delete(socket)
    // Drop empty rooms so the Map doesn't grow forever on a long-lived process.
    if (room.size === 0) this.rooms.delete(streamerId)
  }

  sockets(streamerId: string): readonly Closable[] {
    return [...(this.rooms.get(streamerId) ?? [])]
  }

  size(streamerId: string): number {
    return this.rooms.get(streamerId)?.size ?? 0
  }

  totalConnections(): number {
    let n = 0
    for (const room of this.rooms.values()) n += room.size
    return n
  }

  /**
   * Kick every socket for a streamer. Used by POST /internal/disconnect, which
   * exists because this service has no database: it cannot notice on its own
   * that an overlay token was rotated or an account suspended, so apps/web has
   * to tell it. DESIGN.md 9.
   */
  disconnectAll(streamerId: string, code: number = CloseCode.BAD_TICKET): number {
    const room = this.rooms.get(streamerId)
    if (!room) return 0

    const n = room.size
    for (const socket of room) socket.close(code, 'disconnected by server')
    this.rooms.delete(streamerId)
    return n
  }
}
