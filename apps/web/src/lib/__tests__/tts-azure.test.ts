import { afterEach, describe, expect, it, vi } from 'vitest'
import { TtsUnavailableError, buildSsml, synthesizeWithAzure } from '@/lib/tts/azure'

/**
 * The one paid call in this codebase.
 *
 * Every assertion here is about not spending money badly or not breaking the
 * alert when the spend fails: the right document going out, a failure surfacing
 * as a typed error the caller can swallow, and an empty 200 not being mistaken
 * for audio.
 */

const config = {
  key: 'not-a-real-key',
  region: 'southeastasia',
  voice: 'th-TH-PremwadeeNeural',
  locale: 'th-TH',
}

afterEach(() => vi.restoreAllMocks())

function mockFetch(res: { ok?: boolean; status?: number; audio?: ArrayBuffer }) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return {
      ok: res.ok ?? true,
      status: res.status ?? 200,
      arrayBuffer: async () => res.audio ?? new Uint8Array([0xff, 0xfb, 0x90]).buffer,
    } as Response
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

describe('buildSsml', () => {
  it('wraps the text in the configured voice and locale', () => {
    const ssml = buildSsml(config, 'สวัสดี')
    expect(ssml).toContain('xml:lang="th-TH"')
    expect(ssml).toContain('<voice name="th-TH-PremwadeeNeural">สวัสดี</voice>')
  })

  it('escapes the text, so a donor cannot inject their own elements', () => {
    const ssml = buildSsml(config, '</voice><voice name="en-US-JennyNeural">pwned')
    // Exactly one opening voice tag: the one we wrote.
    expect(ssml.match(/<voice /g)).toHaveLength(1)
    expect(ssml).toContain('&lt;/voice&gt;')
  })
})

describe('synthesizeWithAzure', () => {
  it('posts SSML to the region endpoint with the key and an mp3 output format', async () => {
    const { impl, calls } = mockFetch({ ok: true })
    const out = await synthesizeWithAzure(config, 'สวัสดี', impl)

    expect(calls[0]!.url).toBe(
      'https://southeastasia.tts.speech.microsoft.com/cognitiveservices/v1',
    )
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['Ocp-Apim-Subscription-Key']).toBe('not-a-real-key')
    expect(headers['Content-Type']).toBe('application/ssml+xml')
    expect(headers['X-Microsoft-OutputFormat']).toContain('mp3')
    expect(String(calls[0]!.init.body)).toContain('<speak')
    expect(out.contentType).toBe('audio/mpeg')
    expect(out.audio.byteLength).toBeGreaterThan(0)
  })

  /**
   * 401 is the wrong key, 403 is a key from another region, 429 is the free
   * tier's 20-per-60s. All three have to reach the caller as one thing it can
   * catch, because the caller's answer to all three is the same: publish the
   * alert without a voice line.
   */
  it.each([401, 403, 429, 500])('raises a typed error on %i', async (status) => {
    const { impl } = mockFetch({ ok: false, status })
    await expect(synthesizeWithAzure(config, 'สวัสดี', impl)).rejects.toBeInstanceOf(
      TtsUnavailableError,
    )
    await expect(synthesizeWithAzure(config, 'สวัสดี', impl)).rejects.toMatchObject({ status })
  })

  it('treats an empty 200 as a failure rather than as silent audio', async () => {
    const { impl } = mockFetch({ ok: true, audio: new ArrayBuffer(0) })
    await expect(synthesizeWithAzure(config, 'สวัสดี', impl)).rejects.toBeInstanceOf(
      TtsUnavailableError,
    )
  })
})
