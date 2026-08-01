import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The reconciler is the half of DESIGN.md 7.4 that pays for answering the
 * provider 200 early. Its two jobs share a cycle, and the ORDER between them is
 * the part that is easy to get wrong and impossible to notice until a viewer
 * pays on the last second of a charge.
 */

const { dbMock, processMock, callOrder } = vi.hoisted(() => {
  const callOrder: string[] = []
  return {
    callOrder,
    dbMock: {
      webhookEvent: {
        findMany: vi.fn(async (_args?: unknown): Promise<Array<{ id: string }>> => {
          callOrder.push('reconcile')
          return []
        }),
        count: vi.fn(async (_args?: unknown): Promise<number> => 0),
      },
      donation: {
        updateMany: vi.fn(
          async (_args: {
            where: { status: string; expiresAt?: { lt: Date } }
            data: { status: string }
          }): Promise<{ count: number }> => {
            callOrder.push('sweep')
            return { count: 0 }
          },
        ),
      },
    },
    processMock: vi.fn(),
  }
})

vi.mock('@/lib/db', () => ({ db: dbMock, isUniqueViolation: () => false }))
vi.mock('../webhooks/process', () => ({ MAX_ATTEMPTS: 5, processWebhookEvent: processMock }))

import {
  reconcileWebhookEvents,
  runReconcilerCycle,
  stuckEventCount,
  sweepExpiredDonations,
} from '../webhooks/reconcile'

beforeEach(() => {
  vi.clearAllMocks()
  callOrder.length = 0
  processMock.mockResolvedValue({ result: 'processed', detail: 'ok' })
})

describe('runReconcilerCycle', () => {
  /**
   * Sweeping first can stamp EXPIRED over a donation whose webhook is sitting
   * unprocessed in this very batch. The PAID update is guarded on
   * status = 'PENDING', so it would then match zero rows: money in, donation
   * expired, nobody notified. DESIGN.md 6.3.
   */
  it('reconciles webhook events BEFORE sweeping expiries', async () => {
    await runReconcilerCycle()

    expect(callOrder).toEqual(['reconcile', 'sweep'])
  })

  it('reports what it did', async () => {
    dbMock.webhookEvent.findMany.mockResolvedValueOnce([{ id: 'evnt_1' }, { id: 'evnt_2' }])
    processMock
      .mockResolvedValueOnce({ result: 'processed', detail: 'ok' })
      .mockResolvedValueOnce({ result: 'retry', detail: 'provider down' })
    dbMock.donation.updateMany.mockResolvedValueOnce({ count: 3 })

    expect(await runReconcilerCycle()).toEqual({
      picked: 2,
      processed: 1,
      retried: 1,
      parked: 0,
      skipped: 0,
      expired: 3,
    })
  })
})

describe('the cycle budget', () => {
  /**
   * BATCH caps how many events are picked up, not how long they take: each one
   * can wait on the payment provider, whose own timeout is 15s. A degraded
   * gateway would otherwise push the cycle past the function's maxDuration and
   * the caller would get nothing back at all — worst visibility exactly when
   * the provider is struggling.
   */
  it('stops when the deadline has passed and leaves the rest for the next cycle', async () => {
    dbMock.webhookEvent.findMany.mockResolvedValueOnce([
      { id: 'evnt_1' },
      { id: 'evnt_2' },
      { id: 'evnt_3' },
    ])

    // A deadline already in the past: nothing should be touched.
    const report = await reconcileWebhookEvents(Date.now() - 1)

    expect(processMock).not.toHaveBeenCalled()
    expect(report).toMatchObject({ picked: 3, skipped: 3, processed: 0 })
  })

  it('skipped events keep their attempt count, so the next cycle repeats them', async () => {
    dbMock.webhookEvent.findMany.mockResolvedValueOnce([{ id: 'evnt_1' }])
    await reconcileWebhookEvents(Date.now() - 1)

    // Nothing was called on the event at all — no attempt burned for work that
    // never happened.
    expect(processMock).not.toHaveBeenCalled()
  })
})

describe('reconcileWebhookEvents', () => {
  it('picks only unprocessed events below the attempt ceiling, oldest first', async () => {
    await reconcileWebhookEvents()

    expect(dbMock.webhookEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { processedAt: null, attempts: { lt: 5 } },
        orderBy: { receivedAt: 'asc' },
      }),
    )
  })

  it('keeps going when one event throws', async () => {
    dbMock.webhookEvent.findMany.mockResolvedValueOnce([{ id: 'evnt_1' }, { id: 'evnt_2' }])
    processMock.mockRejectedValueOnce(new Error('boom'))

    const report = await reconcileWebhookEvents()

    expect(processMock).toHaveBeenCalledTimes(2)
    expect(report).toMatchObject({ picked: 2, retried: 1, processed: 1 })
  })

  it('counts a parked event separately from a retryable one', async () => {
    dbMock.webhookEvent.findMany.mockResolvedValueOnce([{ id: 'evnt_1' }])
    processMock.mockResolvedValueOnce({ result: 'review', detail: 'amount mismatch' })

    expect(await reconcileWebhookEvents()).toMatchObject({ parked: 1, retried: 0, processed: 0 })
  })
})

describe('sweepExpiredDonations', () => {
  /**
   * The grace period is the second line of defence behind the ordering above:
   * a webhook for a last-second payment arrives AFTER expiresAt has passed.
   */
  it('spares donations that expired within the last two minutes', async () => {
    const now = new Date('2026-08-01T12:00:00.000Z')

    await sweepExpiredDonations(now)

    expect(dbMock.donation.updateMany).toHaveBeenCalledWith({
      where: { status: 'PENDING', expiresAt: { lt: new Date('2026-08-01T11:58:00.000Z') } },
      data: { status: 'EXPIRED' },
    })
  })

  it('only ever moves rows out of PENDING', async () => {
    await sweepExpiredDonations()

    const where = dbMock.donation.updateMany.mock.calls[0]![0].where
    expect(where.status).toBe('PENDING')
  })
})

describe('stuckEventCount', () => {
  it('counts the events that exhausted their retries and need a human', async () => {
    await stuckEventCount()

    expect(dbMock.webhookEvent.count).toHaveBeenCalledWith({
      where: { processedAt: null, attempts: { gte: 5 } },
    })
  })
})
