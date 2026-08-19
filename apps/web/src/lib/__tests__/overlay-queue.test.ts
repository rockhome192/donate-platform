import { describe, expect, it } from 'vitest'
import type { AlertPayload } from '@dp/shared'
import { AlertQueue, renderAlertTemplate } from '@/lib/overlay/queue'

function alert(id: string, over: Partial<AlertPayload> = {}): AlertPayload {
  return {
    id,
    donorName: 'มายด์',
    message: 'สู้ ๆ',
    amount: 15000,
    createdAt: '2026-08-04T10:00:00.000Z',
    ttsUrl: null,
    ...over,
  }
}

describe('AlertQueue', () => {
  it('plays in arrival order', () => {
    const q = new AlertQueue()
    q.pushAll([alert('a'), alert('b'), alert('c')])

    expect([q.shift()?.id, q.shift()?.id, q.shift()?.id]).toEqual(['a', 'b', 'c'])
    expect(q.shift()).toBeUndefined()
  })

  /**
   * The case this class exists for. Reconnect fetches /missed, and /missed
   * returns everything not yet acked -- including whatever the socket delivered
   * seconds before the drop. Without dedupe the streamer sees one donation
   * twice and concludes they were charged twice.
   */
  it('refuses an id it has already queued', () => {
    const q = new AlertQueue()
    expect(q.push(alert('a'))).toBe(true)
    expect(q.push(alert('a'))).toBe(false)
    expect(q.size).toBe(1)
  })

  it('refuses an id it has already PLAYED, not just one still queued', () => {
    const q = new AlertQueue()
    q.push(alert('a'))
    q.shift()

    expect(q.push(alert('a'))).toBe(false)
    expect(q.size).toBe(0)
  })

  it('reports how many of a batch were new', () => {
    const q = new AlertQueue()
    q.push(alert('a'))

    expect(q.pushAll([alert('a'), alert('b'), alert('c')])).toBe(2)
  })

  /**
   * An eight-hour stream must not grow this set forever. Eviction is safe
   * because the only way an evicted id comes back is /missed returning it,
   * which means its ack never landed -- and replaying an alert whose completion
   * was never recorded is what DESIGN.md 8.4 asks for.
   */
  it('bounds the dedupe set instead of leaking across a long stream', () => {
    const q = new AlertQueue()
    for (let i = 0; i < 600; i++) {
      q.push(alert(`d${i}`))
      q.shift()
    }

    // Well inside the window: still remembered.
    expect(q.push(alert('d599'))).toBe(false)
    // Evicted long ago: allowed back, and it plays rather than being lost.
    expect(q.push(alert('d0'))).toBe(true)
  })
})

describe('renderAlertTemplate', () => {
  it('fills the streamer template', () => {
    expect(renderAlertTemplate('{name} โดเนท {amount} บาท', alert('a'))).toBe(
      'มายด์ โดเนท 150.00 บาท',
    )
  })

  it('leaves an unknown placeholder alone rather than deleting it', () => {
    // A typo should look like a typo, not like missing data.
    expect(renderAlertTemplate('{name} — {nmae}', alert('a'))).toBe('มายด์ — {nmae}')
  })

  /**
   * Single pass, not chained .replace(). With chaining, a donor called
   * "{amount}" would be substituted again by the next replace and put a number
   * on screen that no donation contained.
   */
  it('does not re-substitute text that came from the donor name', () => {
    const evil = alert('a', { donorName: '{amount}' })
    expect(renderAlertTemplate('{name} โดเนท {amount}', evil)).toBe('{amount} โดเนท 150.00')
  })

  it('repeats a placeholder wherever it appears', () => {
    expect(renderAlertTemplate('{name}! {name}!', alert('a'))).toBe('มายด์! มายด์!')
  })
})

describe('AlertQueue.forget', () => {
  /**
   * The bug this exists for: the client abandons an ack, but the id is still in
   * `seen` because the alert DID play. /missed hands the donation back forever,
   * push() discards it every time, and it is never shown or acked again.
   */
  it('lets an abandoned id be delivered again by /missed', () => {
    const q = new AlertQueue()
    q.push(alert('a'))
    q.shift()
    expect(q.push(alert('a'))).toBe(false)

    q.forget(['a'])

    expect(q.push(alert('a'))).toBe(true)
    expect(q.size).toBe(1)
  })

  it('ignores ids it never saw', () => {
    const q = new AlertQueue()
    expect(() => q.forget(['never-seen'])).not.toThrow()
  })

  it('leaves other ids remembered', () => {
    const q = new AlertQueue()
    q.pushAll([alert('a'), alert('b')])
    q.forget(['a'])

    expect(q.push(alert('b'))).toBe(false)
  })
})
