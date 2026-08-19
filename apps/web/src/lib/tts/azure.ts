/**
 * Azure Speech, the only provider here, and why it is not the browser.
 *
 * The obvious implementation of "read the message out loud" is
 * `speechSynthesis` in the overlay, which is free and needs no key. It does not
 * work: OBS renders a Browser Source with CEF, CEF does not implement the Web
 * Speech API, and `speechSynthesis.getVoices()` returns an empty list there —
 * silently, with no error to catch. This machine also has no Thai voice
 * installed at all, which is the second half of the same problem: even where
 * the API exists, Thai is not a voice every viewer's OS happens to ship.
 *
 * So synthesis happens here, once, on the server, and the overlay is handed a
 * URL to an audio file — a path already proven to work inside OBS by the alert
 * chime.
 *
 * Azure over Google because it publishes Thai neural voices (Premwadee, Niwat,
 * Achara) and its free tier is 500,000 characters a month that does not expire.
 * At a 300-character ceiling per donation that is thousands of donations a
 * month at no cost, and this project will never approach it.
 */

import { escapeSsml } from './text'

export type SynthesizedSpeech = {
  /**
   * ArrayBuffer rather than Uint8Array: it is handed straight to fetch as a
   * body, and TypeScript 5.9's typed-array generics make a Uint8Array from
   * arrayBuffer() not assignable to BodyInit without a cast that would hide a
   * real mistake later.
   */
  audio: ArrayBuffer
  contentType: string
}

export type AzureTtsConfig = {
  key: string
  /** e.g. southeastasia — the region the Speech resource was created in. */
  region: string
  /** Full Azure voice name, e.g. th-TH-PremwadeeNeural. */
  voice: string
  /** BCP-47 tag for the SSML root. Must match the voice's locale. */
  locale: string
}

/** 48kbit mono mp3: small enough to hand to a browser source, plainly good enough for speech. */
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'

/**
 * Azure counts a request as failed after 10s of silence anyway; the point of a
 * timeout here is that a donation must not sit unpublished behind a hung TTS
 * call. The alert matters more than the voice.
 */
const TIMEOUT_MS = 8_000

export function buildSsml(config: AzureTtsConfig, text: string): string {
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${config.locale}">` +
    `<voice name="${config.voice}">${escapeSsml(text)}</voice>` +
    `</speak>`
  )
}

export class TtsUnavailableError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'TtsUnavailableError'
  }
}

/**
 * One synthesis call. Throws TtsUnavailableError on anything that is not audio;
 * the caller treats that as "this donation has no voice line" and publishes the
 * alert regardless.
 */
export async function synthesizeWithAzure(
  config: AzureTtsConfig,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SynthesizedSpeech> {
  const res = await fetchImpl(
    `https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': config.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
        // Azure documents this header as required and rejects some requests
        // without it.
        'User-Agent': 'donatr-demo',
      },
      body: buildSsml(config, text),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  )

  if (!res.ok) {
    // The body is a short diagnostic, not audio. 401 = wrong key, 403 = wrong
    // region for the key, 429 = free-tier rate limit (20 per 60s on F0).
    throw new TtsUnavailableError(`azure tts ${res.status}`, res.status)
  }

  const audio = await res.arrayBuffer()
  if (audio.byteLength === 0) throw new TtsUnavailableError('azure tts returned no audio')

  return { audio, contentType: 'audio/mpeg' }
}
