'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ACK_MAX_IDS,
  CLIENT_PING_INTERVAL_MS,
  CLIENT_PONG_TIMEOUT_MS,
  formatBaht,
  type AlertPayload,
  type ServerMessage,
} from '@dp/shared'
import { AlertQueue, renderAlertTemplate } from '@/lib/overlay/queue'
import { STOP_MESSAGE, afterClose, afterTicket, type StopReason } from '@/lib/overlay/reconnect'

/**
 * The overlay itself — DESIGN.md 8.2, 8.4, 8.5.
 *
 * Runs inside an OBS Browser Source, which is Chromium with two properties
 * that shape everything below: it will not reconnect a dropped WebSocket for
 * you, and nobody is watching it. A failure here is not a bad page — it is a
 * streamer finishing a four-hour stream before noticing no alert ever fired.
 *
 * So the loop is written to survive rather than to be tidy:
 *
 *   - every connect asks for a fresh ticket, because a ticket lives 60s and is
 *     single-use
 *   - backoff carries jitter, so a realtime redeploy does not bring every
 *     overlay back in the same millisecond
 *   - the STOP conditions are enumerated and terminal, because a client that
 *     retries a permanent refusal spins until the tab is closed
 *   - `hello` always triggers /missed, first connect and reconnect alike, since
 *     a WebSocket buffers nothing across a gap
 *
 * The decisions themselves live in lib/overlay/reconnect.ts and are unit
 * tested; what is left here is the wiring, which is not.
 */

type Props = {
  token: string
  suspended: boolean
  /** e.g. ws://localhost:8080 — must be wss:// wherever the page is https. */
  wsUrl: string
  template: string
  durationMs: number
}

type Status = 'connecting' | 'live' | 'reconnecting' | 'stopped'

/** How long the exit animation runs; it is played inside durationMs, not after. */
const ALERT_OUT_MS = 380

export function OverlayClient({ token, suspended, wsUrl, template, durationMs }: Props) {
  const [status, setStatus] = useState<Status>('connecting')
  const [stopReason, setStopReason] = useState<StopReason | null>(null)
  const [current, setCurrent] = useState<{ alert: AlertPayload; leaving: boolean } | null>(null)
  const [debug, setDebug] = useState(false)

  // Refs, not state, for everything the animation loop touches: a re-render
  // must never be able to drop the queue or replay an alert (DESIGN.md 8.2).
  const queueRef = useRef(new AlertQueue())
  const playingRef = useRef(false)
  const unackedRef = useRef<string[]>([])

  useEffect(() => {
    setDebug(new URLSearchParams(window.location.search).get('debug') === '1')
  }, [])

  /**
   * Reports finished alerts. Ids that fail to send are put BACK, because the
   * server treats an un-acked donation as un-shown and will hand it to the next
   * /missed — dropping them silently is how an alert plays twice.
   */
  const flushAcks = useCallback(async () => {
    const ids = unackedRef.current
    if (ids.length === 0) return
    unackedRef.current = []

    try {
      const res = await fetch(`/api/overlay/${encodeURIComponent(token)}/ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ donationIds: ids }),
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      // Newest last, and bounded: an unbounded array in a page that runs for
      // eight hours is a leak, and one request cannot carry more than the cap
      // anyway.
      const kept = [...ids, ...unackedRef.current]
      unackedRef.current = kept.slice(-ACK_MAX_IDS)

      // Anything that fell off is being abandoned by this tab, so the queue has
      // to forget it too. It is still `alertedAt IS NULL` in the database and
      // will come back on the next /missed — but only the queue's dedupe set
      // stands between that redelivery and being silently dropped, and it was
      // put there by this very alert having played. See AlertQueue.forget.
      queueRef.current.forget(kept.slice(0, Math.max(0, kept.length - ACK_MAX_IDS)))
    }
  }, [token])

  const playNext = useCallback(() => {
    if (playingRef.current) return
    const next = queueRef.current.shift()
    if (!next) return
    playingRef.current = true
    setCurrent({ alert: next, leaving: false })
  }, [])

  const loadMissed = useCallback(async () => {
    try {
      const res = await fetch(`/api/overlay/${encodeURIComponent(token)}/missed`, {
        cache: 'no-store',
      })
      if (!res.ok) return
      const body = (await res.json()) as { alerts?: AlertPayload[] }
      if (queueRef.current.pushAll(body.alerts ?? []) > 0) playNext()
    } catch {
      // The socket is up, so alerts are still arriving live; the next connect
      // fetches this again. Nothing to show and nobody to show it to.
    }
  }, [token, playNext])

  // ---------------------------------------------------------------- playback

  const currentId = current?.alert.id
  useEffect(() => {
    if (!currentId) return

    const leaveAt = Math.max(0, durationMs - ALERT_OUT_MS)
    const toLeaving = setTimeout(
      () => setCurrent((c) => (c ? { ...c, leaving: true } : c)),
      leaveAt,
    )
    const toDone = setTimeout(() => {
      // Acked when it FINISHES, not when it starts: an OBS crash halfway
      // through should leave the alert un-acked so it plays again, which is
      // the whole reason alertedAt lives in Postgres and not in this tab.
      unackedRef.current.push(currentId)
      void flushAcks()

      setCurrent(null)
      playingRef.current = false
      playNext()
    }, durationMs)

    return () => {
      clearTimeout(toLeaving)
      clearTimeout(toDone)
    }
    // `current` also changes when `leaving` flips, which must NOT restart these
    // timers — hence the id rather than the object.
  }, [currentId, durationMs, flushAcks, playNext])

  // -------------------------------------------------------------- connection

  useEffect(() => {
    if (suspended) {
      setStatus('stopped')
      setStopReason('suspended')
      return
    }

    let cancelled = false
    let socket: WebSocket | null = null
    let waitTimer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        waitTimer = setTimeout(resolve, ms)
      })

    const stop = (reason: StopReason) => {
      setStatus('stopped')
      setStopReason(reason)
    }

    /** Resolves with the close code once the socket is gone. */
    const runSocket = (ticket: string) =>
      new Promise<number>((resolve) => {
        const ws = new WebSocket(`${wsUrl}/ws?ticket=${encodeURIComponent(ticket)}`)
        socket = ws

        let pingTimer: ReturnType<typeof setInterval> | undefined
        let pongTimer: ReturnType<typeof setTimeout> | undefined
        const clearTimers = () => {
          if (pingTimer) clearInterval(pingTimer)
          if (pongTimer) clearTimeout(pongTimer)
        }

        ws.onmessage = (event) => {
          let message: ServerMessage
          try {
            message = JSON.parse(String(event.data))
          } catch {
            return
          }

          if (message.type === 'hello') {
            // Reset only HERE. A socket that opens and is immediately rejected
            // has succeeded at nothing, and resetting on open would turn a
            // rejection loop into a tight one.
            attempt = 0
            setStatus('live')
            void loadMissed()
            void flushAcks()

            /**
             * The server runs its own protocol ping, but that only protects the
             * SERVER from a dead peer. A tab whose connection vanished without
             * a close frame sees nothing at all — so the client proves the link
             * in the other direction too, and gives up on it if no pong lands.
             */
            pingTimer = setInterval(() => {
              if (ws.readyState !== WebSocket.OPEN) return
              ws.send(JSON.stringify({ type: 'ping', t: Date.now() }))
              if (pongTimer) clearTimeout(pongTimer)
              pongTimer = setTimeout(() => ws.close(), CLIENT_PONG_TIMEOUT_MS)
            }, CLIENT_PING_INTERVAL_MS)
          } else if (message.type === 'donation.alert') {
            if (queueRef.current.push(message.data)) playNext()
          } else if (message.type === 'pong') {
            if (pongTimer) clearTimeout(pongTimer)
          }
          // 'error' carries the same information as the close code that follows
          // it, and 'settings.updated' is not wired yet.
        }

        ws.onclose = (event) => {
          clearTimers()
          socket = null
          resolve(event.code)
        }
        // No onerror branch: the spec guarantees a close event follows, and
        // handling both would run the reconnect decision twice.
      })

    const loop = async () => {
      while (!cancelled) {
        setStatus(attempt === 0 ? 'connecting' : 'reconnecting')

        let decision
        try {
          const res = await fetch(`/api/overlay/${encodeURIComponent(token)}/ticket`, {
            cache: 'no-store',
          })
          const retryAfter = Number(res.headers.get('retry-after'))
          decision = afterTicket(
            res.status,
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
            attempt,
          )

          if (decision.action === 'connect') {
            const { ticket } = (await res.json()) as { ticket: string }
            if (cancelled) return

            const code = await runSocket(ticket)
            if (cancelled) return

            decision = afterClose(code, attempt)
          }
        } catch {
          // Offline, DNS gone, Vercel unreachable. Status 0 is not a status —
          // it routes to the same "the web app is having a bad minute" branch
          // as a 5xx, which is backoff-and-return.
          decision = afterTicket(0, undefined, attempt)
        }

        // The /ticket fetch above can settle after this effect was torn down —
        // a StrictMode double-mount in dev, or a Fast Refresh. Without this the
        // discarded loop would still call setStatus/setStopReason and could
        // flash "overlay stopped" over a connection that is perfectly live.
        if (cancelled) return

        if (decision.action === 'stop') {
          stop(decision.reason)
          return
        }
        if (decision.action === 'retry') {
          attempt = decision.attempt
          setStatus('reconnecting')
          await wait(decision.delayMs)
        }
      }
    }

    void loop()

    return () => {
      cancelled = true
      if (waitTimer) clearTimeout(waitTimer)
      socket?.close()
    }
  }, [token, wsUrl, suspended, loadMissed, flushAcks, playNext])

  // ------------------------------------------------------------------ render

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      {current && (
        <div
          className={`absolute top-[6%] left-[4%] flex w-[min(30rem,80%)] items-center gap-3.5 rounded-panel bg-gradient-to-br from-money-soft to-money px-5 py-4 text-money-ink shadow-xl shadow-black/40 ${
            current.leaving ? 'animate-alert-out' : 'animate-alert-in'
          }`}
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-control bg-black/10 text-h2">
            🎉
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-h3 font-bold">
              {renderAlertTemplate(template, current.alert)}
            </p>
            {current.alert.message && (
              // Rendered as a text node. Never dangerouslySetInnerHTML: this is
              // attacker-controlled text running on the streamer's own machine.
              <p className="truncate text-label opacity-85">{current.alert.message}</p>
            )}
          </div>
        </div>
      )}

      {/*
        Shown on the broadcast on purpose. All three reasons are permanent and
        need a human — a silent overlay looks exactly like a quiet chat, and the
        streamer would find out hours later.
      */}
      {status === 'stopped' && stopReason && (
        <div
          role="alert"
          className="absolute top-[6%] left-[4%] w-[min(30rem,80%)] rounded-panel border border-danger/50 bg-canvas/90 px-5 py-4"
        >
          <p className="label-tech text-danger">overlay stopped</p>
          <p className="mt-1.5 text-label text-ink">{STOP_MESSAGE[stopReason]}</p>
        </div>
      )}

      {/* ?debug=1 only. Anything permanently on screen here is on the stream. */}
      {debug && (
        <div className="absolute right-2 bottom-2 rounded-chip bg-canvas/85 px-2.5 py-1.5 font-mono text-micro text-muted">
          <span
            className={
              status === 'live'
                ? 'text-live'
                : status === 'stopped'
                  ? 'text-danger'
                  : 'text-pending'
            }
          >
            ● {status}
          </span>
          {current && <span className="ml-2">now: ฿{formatBaht(current.alert.amount)}</span>}
        </div>
      )}
    </div>
  )
}
