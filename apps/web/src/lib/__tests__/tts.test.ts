import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The gate in front of the paid call, and the promise that nothing here can
 * take an alert off the stream.
 *
 * `synthesizeDonationSpeech` returns null for four different reasons and never
 * throws. That is the contract the webhook processor is written against: a
 * donation that is PAID must reach the overlay whether or not anything could be
 * said about it.
 */

const azure = vi.hoisted(() => ({ synthesizeWithAzure: vi.fn() }))
vi.mock('@/lib/tts/azure', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tts/azure')>()),
  synthesizeWithAzure: azure.synthesizeWithAzure,
}))

const { synthesizeDonationSpeech, isTtsConfigured, ttsKey } = await import('@/lib/tts')

const REQ = {
  donationId: 'don_1',
  streamerId: 'str_1',
  donorName: 'สมชาย',
  message: 'สู้ ๆ',
  amount: 5_000,
  enabled: true,
  volume: 70,
}

function configure() {
  process.env.AZURE_SPEECH_KEY = 'not-a-real-key'
  process.env.AZURE_SPEECH_REGION = 'southeastasia'
  process.env.R2_ACCOUNT_ID = 'acct123'
  process.env.R2_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE'
  process.env.R2_SECRET_ACCESS_KEY = 'secret'
  process.env.R2_BUCKET = 'donate'
  process.env.R2_PUBLIC_BASE_URL = 'https://pub.example.com'
}

function unconfigure() {
  for (const k of [
    'AZURE_SPEECH_KEY',
    'AZURE_SPEECH_REGION',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
    'R2_PUBLIC_BASE_URL',
  ]) {
    delete process.env[k]
  }
}

let puts: Array<{ url: string; init: RequestInit }>

beforeEach(() => {
  configure()
  azure.synthesizeWithAzure.mockReset()
  azure.synthesizeWithAzure.mockResolvedValue({
    audio: new Uint8Array([1, 2, 3]).buffer,
    contentType: 'audio/mpeg',
  })
  puts = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      puts.push({ url, init })
      return { ok: true, status: 200 } as Response
    }),
  )
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  unconfigure()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('synthesizeDonationSpeech', () => {
  it('stores the audio and returns the public URL', async () => {
    const url = await synthesizeDonationSpeech(REQ)

    expect(url).toBe('https://pub.example.com/tts/str_1/don_1.mp3')
    expect(puts).toHaveLength(1)
    expect(puts[0]!.init.method).toBe('PUT')
    expect(puts[0]!.url).toContain('donate.acct123.r2.cloudflarestorage.com')
  })

  /**
   * The three free refusals, checked before any network call. Each one is a
   * whole class of donations that costs nothing, which is the only reason a
   * 500,000-character free tier is enough.
   */
  it('spends nothing when the streamer has TTS off', async () => {
    expect(await synthesizeDonationSpeech({ ...REQ, enabled: false })).toBeNull()
    expect(azure.synthesizeWithAzure).not.toHaveBeenCalled()
  })

  /**
   * The overlay plays the voice line through the alert-sound volume, so 0% is
   * not "quiet" — it is a muted element. Paying Azure to speak into it is the
   * one way this feature could bill for something literally nobody can hear.
   */
  it('spends nothing when the alert volume is muted', async () => {
    expect(await synthesizeDonationSpeech({ ...REQ, volume: 0 })).toBeNull()
    expect(azure.synthesizeWithAzure).not.toHaveBeenCalled()
  })

  it('spends nothing when the deployment has no key', async () => {
    delete process.env.AZURE_SPEECH_KEY
    expect(await synthesizeDonationSpeech(REQ)).toBeNull()
    expect(azure.synthesizeWithAzure).not.toHaveBeenCalled()
  })

  it('spends nothing when there is nowhere to put the result', async () => {
    delete process.env.R2_BUCKET
    expect(await synthesizeDonationSpeech(REQ)).toBeNull()
    expect(azure.synthesizeWithAzure).not.toHaveBeenCalled()
  })

  it('spends nothing on a donation with no message', async () => {
    expect(await synthesizeDonationSpeech({ ...REQ, message: '  ' })).toBeNull()
    expect(azure.synthesizeWithAzure).not.toHaveBeenCalled()
  })

  /** Both failure paths return null. Neither may reach the webhook processor. */
  it('returns null when synthesis throws', async () => {
    azure.synthesizeWithAzure.mockRejectedValue(new Error('azure tts 429'))
    await expect(synthesizeDonationSpeech(REQ)).resolves.toBeNull()
  })

  it('returns null when the upload is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 }) as Response))
    await expect(synthesizeDonationSpeech(REQ)).resolves.toBeNull()
  })
})

describe('ttsKey', () => {
  /**
   * Deterministic, unlike avatarKey: re-synthesising the same donation is the
   * same sentence and should overwrite rather than leave an orphan behind.
   */
  it('names the object after the donation', () => {
    expect(ttsKey('str_1', 'don_1')).toBe('tts/str_1/don_1.mp3')
  })
})

describe('isTtsConfigured', () => {
  it('needs both a voice and somewhere to put it', () => {
    expect(isTtsConfigured()).toBe(true)
    delete process.env.R2_PUBLIC_BASE_URL
    expect(isTtsConfigured()).toBe(false)
  })
})
