import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rateLimit } from '@/lib/rate-limit'

/**
 * The limiter returns two promises in one object, and they pull opposite ways.
 *
 * `ok` is the permissive half. It stays true whenever the limiter could not
 * reach a verdict, because a limiter that takes the payment path down with it
 * is worse than the abuse it prevents. Thirteen callers rely on exactly that.
 *
 * `verdict` is the half that admits whether anything was actually counted. It
 * exists for the one caller that must refuse instead — the avatar upload, where
 * an uncounted burst fills a bucket that has no delete path.
 *
 * Both halves are pinned here because the tempting cleanup — folding COUNTED,
 * DISABLED and UNAVAILABLE back into a single ALLOWED, since all three carry
 * `ok: true` — passes every other test in this repo while quietly returning the
 * avatar route to fail-open.
 */

const URL_BASE = 'https://upstash.test'
const TOKEN = 'upstash-token-not-a-real-one'

/** One Upstash pipeline reply, in the shape rateLimit reads: [INCR, EXPIRE, TTL]. */
function pipelineReply(count: unknown, ttl: unknown) {
  return [{ result: count }, { result: 1 }, { result: ttl }]
}

function upstashAnswers(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        ({
          ok: init.ok ?? true,
          status: init.status ?? 200,
          json: async () => body,
        }) as Response,
    ),
  )
}

function upstashThrows() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('connect ETIMEDOUT')
    }),
  )
}

beforeEach(() => {
  process.env.UPSTASH_REDIS_REST_URL = URL_BASE
  process.env.UPSTASH_REDIS_REST_TOKEN = TOKEN
  // The failure paths warn on purpose; silenced so a passing run stays readable.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
})

describe('with no Upstash credentials', () => {
  it('allows, and says so — a dev machine with no Redis still works', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN

    const result = await rateLimit('avatar-url:s1', 5, 3600)

    expect(result.ok).toBe(true)
    // Not 'unavailable': nothing is broken, this deployment simply opted out.
    // The avatar route keys off that difference to stay usable in development.
    expect(result.verdict).toBe('disabled')
  })
})

describe('when Upstash answers', () => {
  it('allows while the count is under the limit', async () => {
    upstashAnswers(pipelineReply(3, 120))

    const result = await rateLimit('avatar-url:s1', 5, 3600)

    expect(result).toEqual({ ok: true, retryAfter: 0, verdict: 'counted' })
  })

  it('still allows on the count that equals the limit', async () => {
    // The check is `count > limit`, so the fifth of five requests is the last
    // allowed one. Pinned because an off-by-one here is invisible in use.
    upstashAnswers(pipelineReply(5, 120))

    expect((await rateLimit('avatar-url:s1', 5, 3600)).ok).toBe(true)
  })

  it('refuses past the limit, and reports the real seconds remaining', async () => {
    upstashAnswers(pipelineReply(6, 120))

    const result = await rateLimit('avatar-url:s1', 5, 3600)

    expect(result.ok).toBe(false)
    expect(result.retryAfter).toBe(120)
    // A refusal is a real verdict: Redis answered.
    expect(result.verdict).toBe('counted')
  })

  it('falls back to the full window when the key carries no TTL', async () => {
    // TTL -1 means the key exists with no expiry. Reporting that verbatim would
    // tell the client to retry immediately, forever.
    upstashAnswers(pipelineReply(6, -1))

    expect((await rateLimit('avatar-url:s1', 5, 3600)).retryAfter).toBe(3600)
  })
})

describe('when Upstash is configured but cannot be trusted', () => {
  it('marks a bad status unavailable', async () => {
    upstashAnswers(null, { ok: false, status: 500 })

    expect((await rateLimit('avatar-url:s1', 5, 3600)).verdict).toBe('unavailable')
  })

  it('marks an unreadable payload unavailable', async () => {
    upstashAnswers(pipelineReply('not-a-number', 120))

    expect((await rateLimit('avatar-url:s1', 5, 3600)).verdict).toBe('unavailable')
  })

  it('marks an unreachable host unavailable', async () => {
    upstashThrows()

    expect((await rateLimit('avatar-url:s1', 5, 3600)).verdict).toBe('unavailable')
  })
})

describe('the fail-open promise the other thirteen callers depend on', () => {
  it('never refuses unless a count was actually taken', async () => {
    const outages = [
      () => upstashAnswers(null, { ok: false, status: 503 }),
      () => upstashAnswers(pipelineReply(undefined, undefined)),
      () => upstashThrows(),
    ]

    for (const outage of outages) {
      outage()
      const result = await rateLimit('donate:1.2.3.4', 5, 3600)
      // Donations keep working through a Redis outage. Only callers that read
      // `verdict` opt out of this.
      expect(result.ok).toBe(true)
      expect(result.verdict).toBe('unavailable')
    }
  })
})
