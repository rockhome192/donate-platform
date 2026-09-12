import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredObject } from '@/lib/storage'

/**
 * The rules that decide whether a file is deleted, and the one direction they
 * are all allowed to fail in.
 *
 * An avatar wrongly deleted is a blank face on a page whose whole job is asking
 * an audience for money, and nothing can bring it back. An avatar wrongly kept
 * costs 200KB until the next run. So every test here is really the same test
 * asked four ways: given something ambiguous, does the planner keep it?
 */

const dbMock = vi.hoisted(() => ({ streamer: { findMany: vi.fn() } }))
vi.mock('@/lib/db', () => ({ db: dbMock, isUniqueViolation: () => false }))

const storage = vi.hoisted(() => ({ listObjects: vi.fn(), deleteObject: vi.fn() }))
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  listObjects: storage.listObjects,
  deleteObject: storage.deleteObject,
}))

const { planAvatarSweep, sweepAvatars, SWEEP_GRACE_MS } = await import('@/lib/avatars/sweep')

const NOW = new Date('2026-09-12T12:00:00.000Z')
const UUID = '3f1e0c2a-1111-4222-8333-444455556666'

/** An object old enough that the grace period is not what is protecting it. */
function object(key: string, ageMs = SWEEP_GRACE_MS * 2, size = 1024): StoredObject {
  return { key, lastModified: new Date(NOW.getTime() - ageMs), size }
}

describe('planAvatarSweep', () => {
  it('removes an old object no row names', () => {
    const orphan = object(`avatars/str_1/${UUID}.png`)

    const plan = planAvatarSweep([orphan], new Set(), NOW)

    expect(plan.remove).toEqual([orphan])
    expect(plan.bytes).toBe(1024)
  })

  it('keeps an object a row names', () => {
    const key = `avatars/str_1/${UUID}.png`

    const plan = planAvatarSweep([object(key)], new Set([key]), NOW)

    expect(plan.remove).toEqual([])
    expect(plan.kept['in-use']).toBe(1)
  })

  /**
   * The race this closes: a streamer PUTs a picture and then reads the form for
   * ten minutes before saving. In that window the object exists and no row
   * names it, which from the bucket's side is indistinguishable from an orphan.
   */
  it('keeps an object younger than the grace period, row or no row', () => {
    const fresh = object(`avatars/str_1/${UUID}.png`, SWEEP_GRACE_MS - 1)

    const plan = planAvatarSweep([fresh], new Set(), NOW)

    expect(plan.remove).toEqual([])
    expect(plan.kept['too-new']).toBe(1)
  })

  it('removes it once the grace period has passed', () => {
    const aged = object(`avatars/str_1/${UUID}.png`, SWEEP_GRACE_MS + 1)

    expect(planAvatarSweep([aged], new Set(), NOW).remove).toEqual([aged])
  })

  /**
   * Anything under the prefix that this app did not mint — a file put there by
   * hand, a shape some later feature adds — is not the sweep's to delete. An
   * unrecognised key is the only evidence available that something else owns it.
   */
  it('keeps a key avatarKey could not have produced', () => {
    const strangers = [
      object('avatars/str_1/notes.txt'),
      object('avatars/str_1/nested/a.png'),
      object('avatars/logo.png'),
    ]

    const plan = planAvatarSweep(strangers, new Set(), NOW)

    expect(plan.remove).toEqual([])
    expect(plan.kept['not-ours']).toBe(3)
  })

  /**
   * Both guards hold, and the stronger one should be the one reported. A key
   * this app never minted does not become deletable when it turns an hour old,
   * so filing it under 'too-new' would describe a future that never arrives.
   */
  it('reports a young stranger key as not-ours, not as too-new', () => {
    const plan = planAvatarSweep(
      [object('avatars/str_1/hand-made.png', SWEEP_GRACE_MS / 2)],
      new Set(),
      NOW,
    )

    expect(plan.kept).toEqual({ 'in-use': 0, 'too-new': 0, 'not-ours': 1 })
    expect(plan.remove).toEqual([])
  })

  it('counts each survivor under one reason', () => {
    const inUse = `avatars/str_1/${UUID}.png`
    const plan = planAvatarSweep(
      [
        object(inUse),
        object(`avatars/str_2/${UUID}.png`, SWEEP_GRACE_MS / 2),
        object('avatars/str_3/hand-made.png'),
        object(`avatars/str_4/${UUID}.png`),
      ],
      new Set([inUse]),
      NOW,
    )

    expect(plan.kept).toEqual({ 'in-use': 1, 'too-new': 1, 'not-ours': 1 })
    expect(plan.remove.map((o) => o.key)).toEqual([`avatars/str_4/${UUID}.png`])
  })
})

describe('sweepAvatars', () => {
  beforeEach(() => {
    process.env.R2_ACCOUNT_ID = 'acct123'
    process.env.R2_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE'
    process.env.R2_SECRET_ACCESS_KEY = 'secret'
    process.env.R2_BUCKET = 'donatr'
    process.env.R2_PUBLIC_BASE_URL = 'https://cdn.example.com'

    storage.listObjects.mockReset()
    storage.deleteObject.mockReset()
    storage.deleteObject.mockResolvedValue(true)
    dbMock.streamer.findMany.mockReset()
    dbMock.streamer.findMany.mockResolvedValue([])
  })

  afterEach(() => {
    for (const k of [
      'R2_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_BUCKET',
      'R2_PUBLIC_BASE_URL',
    ]) {
      delete process.env[k]
    }
  })

  /** The default a maintenance script gets when somebody forgets the flag. */
  it('deletes nothing unless asked in as many words', async () => {
    storage.listObjects.mockResolvedValue([object(`avatars/str_1/${UUID}.png`)])

    const result = await sweepAvatars({ now: NOW })

    expect(result.dryRun).toBe(true)
    expect(result.remove).toHaveLength(1)
    expect(result.deleted).toBe(0)
    expect(storage.deleteObject).not.toHaveBeenCalled()
  })

  it('deletes the planned objects when it is not a dry run', async () => {
    storage.listObjects.mockResolvedValue([object(`avatars/str_1/${UUID}.png`)])

    const result = await sweepAvatars({ dryRun: false, now: NOW })

    expect(storage.deleteObject).toHaveBeenCalledTimes(1)
    expect(storage.deleteObject.mock.calls[0]![1]).toBe(`avatars/str_1/${UUID}.png`)
    expect(result).toMatchObject({ deleted: 1, failed: 0, dryRun: false })
  })

  /**
   * The gap the plan cannot see. Deleting 200 objects at a fifth of a second
   * each takes forty seconds, and the last one was judged before the first was
   * touched — so a row saved during the loop points at a key already condemned.
   * Old enough that the grace period is spent, saved too late for the plan.
   */
  it('spares an object a row claims while the loop is running', async () => {
    const claimed = `avatars/str_1/${UUID}.png`
    const orphan = `avatars/str_2/${UUID}.png`
    storage.listObjects.mockResolvedValue([object(claimed), object(orphan)])

    // Nothing is in use when the plan is made...
    dbMock.streamer.findMany.mockResolvedValueOnce([])
    // ...and then someone presses Save, so every later read sees the claim.
    dbMock.streamer.findMany.mockResolvedValue([
      { avatarUrl: `https://cdn.example.com/${claimed}` },
    ])

    const result = await sweepAvatars({ dryRun: false, now: NOW })

    expect(result).toMatchObject({ deleted: 1, skipped: 1, failed: 0 })
    // The condemned key is spared; the real orphan still goes.
    const deletedKeys = storage.deleteObject.mock.calls.map((c) => c[1])
    expect(deletedKeys).toEqual([orphan])
  })

  /**
   * "What we meant to do" and "what happened" stop agreeing exactly when
   * somebody needs to know why, so they are two numbers.
   */
  it('reports the bytes it actually freed, not the bytes it planned to', async () => {
    const claimed = `avatars/str_1/${UUID}.png`
    storage.listObjects.mockResolvedValue([
      object(claimed, undefined, 4096),
      object(`avatars/str_2/${UUID}.png`, undefined, 1024),
    ])
    dbMock.streamer.findMany.mockResolvedValueOnce([])
    dbMock.streamer.findMany.mockResolvedValue([
      { avatarUrl: `https://cdn.example.com/${claimed}` },
    ])

    const result = await sweepAvatars({ dryRun: false, now: NOW })

    expect(result.bytes).toBe(5120)
    expect(result.bytesFreed).toBe(1024)
  })

  it('counts a delete that did not take, without stopping', async () => {
    storage.listObjects.mockResolvedValue([
      object(`avatars/str_1/${UUID}.png`),
      object(`avatars/str_2/${UUID}.png`),
    ])
    storage.deleteObject.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    expect(await sweepAvatars({ dryRun: false, now: NOW })).toMatchObject({
      deleted: 1,
      failed: 1,
    })
  })

  /**
   * The protection set is built from every row's avatarUrl, not from the ones
   * that pass an ownership check — a row naming another streamer's key still
   * keeps that object alive, because deleting it blanks a live page over a
   * historical mistake.
   */
  it('protects a key named by a row that should not have named it', async () => {
    const key = `avatars/str_2/${UUID}.png`
    storage.listObjects.mockResolvedValue([object(key)])
    dbMock.streamer.findMany.mockResolvedValue([{ avatarUrl: `https://cdn.example.com/${key}` }])

    const result = await sweepAvatars({ now: NOW })

    expect(result.remove).toEqual([])
    expect(result.kept['in-use']).toBe(1)
  })

  /** A row pointing somewhere else entirely protects nothing here, and must not crash. */
  it('ignores an avatarUrl that is not on our bucket', async () => {
    const orphan = object(`avatars/str_1/${UUID}.png`)
    storage.listObjects.mockResolvedValue([orphan])
    dbMock.streamer.findMany.mockResolvedValue([
      { avatarUrl: 'https://other.example/avatars/str_1/x.png' },
      { avatarUrl: 'not a url' },
    ])

    expect((await sweepAvatars({ now: NOW })).remove).toEqual([orphan])
  })

  /**
   * "0 objects to delete" and "I cannot see the bucket" must not print the same
   * sentence. The upload button degrades quietly when R2 is absent; a sweep
   * asked to clean a bucket it cannot reach is a misconfiguration.
   */
  it('refuses to report an empty bucket it cannot see', async () => {
    delete process.env.R2_BUCKET

    await expect(sweepAvatars()).rejects.toThrow('no R2 configuration')
    expect(storage.listObjects).not.toHaveBeenCalled()
  })

  /**
   * Listed before the rows are read, so the window between them can only add
   * rows, never objects. The other order lets an upload that lands mid-sweep be
   * deleted by a listing taken after it.
   */
  it('lists the bucket before reading the rows', async () => {
    const order: string[] = []
    storage.listObjects.mockImplementation(async () => {
      order.push('list')
      return []
    })
    dbMock.streamer.findMany.mockImplementation(async () => {
      order.push('rows')
      return []
    })

    await sweepAvatars({ now: NOW })

    expect(order).toEqual(['list', 'rows'])
  })
})
