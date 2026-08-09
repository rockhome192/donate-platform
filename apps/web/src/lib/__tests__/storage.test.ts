import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  AVATAR_MAX_BYTES,
  UPLOAD_URL_TTL_SECONDS,
  avatarKey,
  deriveSigningKeyHex,
  presignUpload,
  storageConfig,
  type StorageConfig,
} from '@/lib/storage'

/**
 * What these can and cannot prove.
 *
 * SigV4 is mostly string assembly, and a test that rebuilds the same string
 * from the same spec is a copy of the implementation, not a check on it. So
 * what is checked here is what can be checked without a server: the HMAC chain
 * against a second crypto library, and the properties this app depends on —
 * that the byte count is bound into the signature, that the ticket expires,
 * and that a key cannot escape its own streamer's prefix.
 *
 * **A round trip against a real R2 bucket is the only thing that proves the
 * request is acceptable to the server**, and nothing below should be read as
 * saying otherwise. Until that has been run, the honest description of this
 * signer is "written to the spec and unit-tested", not "working".
 */

const CONFIG: StorageConfig = {
  accountId: 'acct123',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  bucket: 'donatr',
  publicBaseUrl: 'https://cdn.example.com',
}

const AT = new Date('2026-08-09T10:15:00.000Z')

describe('deriveSigningKey', () => {
  /**
   * The chain as the AWS documentation states it, written out here with
   * node:crypto rather than Web Crypto.
   *
   * This is not the implementation copied — the point is the OTHER crypto API.
   * `crypto.subtle.importKey` + `sign` is fiddly (raw key material, the HMAC
   * algorithm named twice, BufferSource typing) and getting that wiring subtly
   * wrong is the realistic failure here, not misreading four lines of pseudo-
   * code. A second library computing the same bytes rules that out.
   */
  function referenceSigningKey(
    secret: string,
    dateStamp: string,
    region: string,
    service: string,
  ): string {
    const step = (key: crypto.BinaryLike, data: string) =>
      crypto.createHmac('sha256', key).update(data, 'utf8').digest()

    const kDate = step(`AWS4${secret}`, dateStamp)
    const kRegion = step(kDate, region)
    const kService = step(kRegion, service)
    return step(kService, 'aws4_request').toString('hex')
  }

  it('matches an independent implementation of the documented chain', async () => {
    const args = ['wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', '20150830', 'us-east-1', 'iam'] as const
    expect(await deriveSigningKeyHex(...args)).toBe(referenceSigningKey(...args))
  })

  it('binds the key to the date, region and service', async () => {
    const base = await deriveSigningKeyHex('secret', '20260809', 'auto', 's3')
    expect(await deriveSigningKeyHex('secret', '20260810', 'auto', 's3')).not.toBe(base)
    expect(await deriveSigningKeyHex('secret', '20260809', 'us-east-1', 's3')).not.toBe(base)
    expect(await deriveSigningKeyHex('secret', '20260809', 'auto', 'iam')).not.toBe(base)
    expect(await deriveSigningKeyHex('other', '20260809', 'auto', 's3')).not.toBe(base)
  })
})

describe('presignUpload', () => {
  it('signs a PUT to the bucket host with the key as the path', async () => {
    const upload = await presignUpload(CONFIG, 'avatars/str_1/a.png', 'image/png', 1234, AT)
    const url = new URL(upload.uploadUrl)

    expect(url.protocol).toBe('https:')
    expect(url.host).toBe('donatr.acct123.r2.cloudflarestorage.com')
    expect(url.pathname).toBe('/avatars/str_1/a.png')
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(url.searchParams.get('X-Amz-Date')).toBe('20260809T101500Z')
    expect(url.searchParams.get('X-Amz-Expires')).toBe(String(UPLOAD_URL_TTL_SECONDS))
    expect(url.searchParams.get('X-Amz-Credential')).toBe(
      'AKIAIOSFODNN7EXAMPLE/20260809/auto/s3/aws4_request',
    )
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('signs content-length and content-type, so neither can be swapped later', async () => {
    const upload = await presignUpload(CONFIG, 'avatars/str_1/a.png', 'image/png', 1234, AT)
    expect(upload.uploadUrl).toContain('X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost')

    // The whole size limit rests on this: change the byte count and the URL is
    // no longer valid for that upload.
    const bigger = await presignUpload(CONFIG, 'avatars/str_1/a.png', 'image/png', 1235, AT)
    expect(signatureOf(bigger.uploadUrl)).not.toBe(signatureOf(upload.uploadUrl))

    const otherType = await presignUpload(CONFIG, 'avatars/str_1/a.png', 'image/webp', 1234, AT)
    expect(signatureOf(otherType.uploadUrl)).not.toBe(signatureOf(upload.uploadUrl))
  })

  it('is deterministic for the same inputs and moves with the clock', async () => {
    const a = await presignUpload(CONFIG, 'avatars/str_1/a.png', 'image/png', 10, AT)
    const b = await presignUpload(CONFIG, 'avatars/str_1/a.png', 'image/png', 10, AT)
    expect(signatureOf(a.uploadUrl)).toBe(signatureOf(b.uploadUrl))

    const later = await presignUpload(
      CONFIG,
      'avatars/str_1/a.png',
      'image/png',
      10,
      new Date('2026-08-09T10:15:01.000Z'),
    )
    expect(signatureOf(later.uploadUrl)).not.toBe(signatureOf(a.uploadUrl))
  })

  it('orders the canonical query string, which S3 requires', async () => {
    const upload = await presignUpload(CONFIG, 'avatars/str_1/a.png', 'image/png', 10, AT)
    const names = upload.uploadUrl
      .split('?')[1]!
      .split('&')
      .map((p) => p.split('=')[0]!)
      // X-Amz-Signature is appended after signing and is not part of the
      // canonical string.
      .filter((n) => n !== 'X-Amz-Signature')

    expect(names).toEqual([...names].sort())
  })

  it('percent-encodes each path segment but not the separators', async () => {
    const upload = await presignUpload(CONFIG, 'avatars/str 1/a b.png', 'image/png', 10, AT)
    expect(upload.uploadUrl).toContain('/avatars/str%201/a%20b.png?')
    expect(upload.publicUrl).toBe('https://cdn.example.com/avatars/str%201/a%20b.png')
  })

  it('returns the public URL on the configured base, not the signing host', async () => {
    const upload = await presignUpload(CONFIG, 'avatars/str_1/a.png', 'image/png', 10, AT)
    expect(upload.publicUrl).toBe('https://cdn.example.com/avatars/str_1/a.png')
    expect(upload.publicUrl).not.toContain('r2.cloudflarestorage.com')
  })
})

describe('avatarKey', () => {
  it('namespaces the object under the streamer id', () => {
    expect(avatarKey('str_1', 'image/png')).toMatch(/^avatars\/str_1\/[0-9a-f-]{36}\.png$/)
    expect(avatarKey('str_1', 'image/jpeg')).toMatch(/\.jpg$/)
    expect(avatarKey('str_1', 'image/webp')).toMatch(/\.webp$/)
  })

  it('never reuses a name, so a replaced avatar cannot be served from cache', () => {
    expect(avatarKey('str_1', 'image/png')).not.toBe(avatarKey('str_1', 'image/png'))
  })
})

describe('storageConfig', () => {
  it('is null unless every variable is present', () => {
    const saved = { ...process.env }
    try {
      delete process.env.R2_ACCOUNT_ID
      delete process.env.R2_ACCESS_KEY_ID
      delete process.env.R2_SECRET_ACCESS_KEY
      delete process.env.R2_BUCKET
      delete process.env.R2_PUBLIC_BASE_URL
      expect(storageConfig()).toBeNull()

      process.env.R2_ACCOUNT_ID = 'a'
      process.env.R2_ACCESS_KEY_ID = 'b'
      process.env.R2_SECRET_ACCESS_KEY = 'c'
      process.env.R2_BUCKET = 'd'
      // Still missing the public base: an upload that cannot be read back is
      // not a working configuration.
      expect(storageConfig()).toBeNull()

      process.env.R2_PUBLIC_BASE_URL = 'https://cdn.example.com/'
      expect(storageConfig()?.publicBaseUrl).toBe('https://cdn.example.com')
    } finally {
      process.env = saved
    }
  })
})

describe('AVATAR_MAX_BYTES', () => {
  it('is 2 MB', () => {
    expect(AVATAR_MAX_BYTES).toBe(2_097_152)
  })
})

function signatureOf(url: string): string {
  return new URL(url).searchParams.get('X-Amz-Signature') ?? ''
}
