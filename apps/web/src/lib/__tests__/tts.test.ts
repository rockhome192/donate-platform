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

/**
 * Only the existence check is stubbed. The upload still runs through the real
 * presign-and-PUT against the stubbed fetch below, because that is the part the
 * URL assertions are actually checking.
 */
const storage = vi.hoisted(() => ({ objectExists: vi.fn() }))
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  objectExists: storage.objectExists,
}))

const { synthesizeDonationSpeech, synthesizeTestSpeech, isTtsConfigured, ttsKey, testTtsKey } =
  await import('@/lib/tts')


/** The sentence the test button says, built from TEST_ALERT_SAMPLE. */
const TEST_SENTENCE = 'ทดสอบระบบ โดเนท 50 บาท พูดว่า นี่คือ alert ทดสอบ ไม่ใช่โดเนทจริง'

const TEST_REQ = { streamerId: 'str_1', enabled: true, volume: 70 }

/** SHA-256 of TEST_SENTENCE, first four bytes — what testTtsKey puts in the name. */
const FINGERPRINT = await (async () => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(TEST_SENTENCE))
  return Array.from(new Uint8Array(digest).slice(0, 4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
})()

const TEST_KEY = `tts/str_1/test-th-TH-PremwadeeNeural-${FINGERPRINT}.mp3`

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
    // Not set by configure(), but a test that switches the voice must not leak
    // it into the next one — the key is built from it.
    'TTS_VOICE',
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
  storage.objectExists.mockReset()
  // Nothing stored yet, unless a test says otherwise.
  storage.objectExists.mockResolvedValue(false)
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

describe('synthesizeTestSpeech', () => {
  /**
   * The test button used to hand the overlay a flat `ttsUrl: null`, which left
   * the voice as the one part of an alert nobody could check before going
   * live. It says the sentence now, and these tests pin the two things that
   * make that affordable.
   */
  it('says the sample sentence and stores it the first time', async () => {
    const url = await synthesizeTestSpeech(TEST_REQ)

    expect(url).toBe(`https://pub.example.com/${TEST_KEY}`)
    expect(azure.synthesizeWithAzure).toHaveBeenCalledWith(expect.anything(), TEST_SENTENCE)
  })

  /**
   * The whole reason this endpoint keeps its ordinary rate limit instead of
   * needing a spending budget of its own. Somebody dragging an OBS source
   * around presses test thirty times in a row; the sentence never changes, so
   * only the first press is allowed to cost anything.
   */
  it('spends nothing on a press whose recording already exists', async () => {
    storage.objectExists.mockResolvedValue(true)

    const url = await synthesizeTestSpeech(TEST_REQ)

    expect(url).toBe(`https://pub.example.com/${TEST_KEY}`)
    expect(azure.synthesizeWithAzure).not.toHaveBeenCalled()
    expect(puts).toHaveLength(0)
  })

  /**
   * Fail towards spending. A bucket that cannot answer costs one re-synthesis;
   * assuming the file is there costs an alert that points at nothing.
   */
  it('re-synthesises when the bucket cannot say whether the file is there', async () => {
    storage.objectExists.mockResolvedValue(false)

    expect(await synthesizeTestSpeech(TEST_REQ)).toBe(`https://pub.example.com/${TEST_KEY}`)
    expect(azure.synthesizeWithAzure).toHaveBeenCalled()
  })

  /**
   * Both inputs that change what the recording SAYS are in its name, which is
   * what makes reuse safe. Sharing one key across voices would replay the old
   * voice forever; sharing one across sentences would keep saying last month's
   * wording after somebody edits TEST_ALERT_SAMPLE. Nothing invalidates either.
   */
  it('follows the configured voice into the key', async () => {
    process.env.TTS_VOICE = 'th-TH-NiwatNeural'

    expect(await synthesizeTestSpeech(TEST_REQ)).toBe(
      `https://pub.example.com/tts/str_1/test-th-TH-NiwatNeural-${FINGERPRINT}.mp3`,
    )
  })

  it('puts a fingerprint of the sentence in the key', async () => {
    const url = await synthesizeTestSpeech(TEST_REQ)

    // Eight hex characters, and the same ones an independent digest produces.
    expect(url).toContain(`-${FINGERPRINT}.mp3`)
    expect(FINGERPRINT).toMatch(/^[0-9a-f]{8}$/)
  })

  /**
   * ttsEnabled and soundVolume are the streamer saying they do not want a
   * voice. Unlike minAlertAmount, which the test button ignores on purpose,
   * these are honoured — speaking anyway tests something they turned off.
   */
  it('spends nothing when the streamer has TTS off', async () => {
    expect(await synthesizeTestSpeech({ ...TEST_REQ, enabled: false })).toBeNull()
    expect(azure.synthesizeWithAzure).not.toHaveBeenCalled()
  })

  it('spends nothing when the alert volume is muted', async () => {
    expect(await synthesizeTestSpeech({ ...TEST_REQ, volume: 0 })).toBeNull()
    expect(azure.synthesizeWithAzure).not.toHaveBeenCalled()
  })

  it('spends nothing when the deployment has no key', async () => {
    delete process.env.AZURE_SPEECH_KEY
    expect(await synthesizeTestSpeech(TEST_REQ)).toBeNull()
    expect(azure.synthesizeWithAzure).not.toHaveBeenCalled()
  })

  /** A failed voice line still leaves an alert to look at, which is the point. */
  it('returns null when synthesis throws', async () => {
    azure.synthesizeWithAzure.mockRejectedValue(new Error('azure tts 429'))
    await expect(synthesizeTestSpeech(TEST_REQ)).resolves.toBeNull()
  })
})

describe('testTtsKey', () => {
  it('is one object per streamer, voice and sentence', () => {
    expect(testTtsKey('str_1', 'th-TH-PremwadeeNeural', 'deadbeef')).toBe(
      'tts/str_1/test-th-TH-PremwadeeNeural-deadbeef.mp3',
    )
  })

  /**
   * Neither input is typed by a donor, so this is a typo guard rather than an
   * injection guard: a stray slash would quietly write the file to a different
   * prefix, and the key would stop being the one object it is reused as.
   */
  it('keeps a malformed voice inside its own key', () => {
    expect(testTtsKey('str_1', '../../evil name', 'deadbeef')).toBe(
      'tts/str_1/test-------evil-name-deadbeef.mp3',
    )
  })
})

describe('isTtsConfigured', () => {
  it('needs both a voice and somewhere to put it', () => {
    expect(isTtsConfigured()).toBe(true)
    delete process.env.R2_PUBLIC_BASE_URL
    expect(isTtsConfigured()).toBe(false)
  })
})
