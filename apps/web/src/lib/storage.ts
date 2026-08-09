/**
 * Presigned uploads to Cloudflare R2, signed here with AWS SigV4.
 *
 * No SDK. `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` is a large
 * dependency to carry into a serverless bundle for one operation, and this file
 * is the same shape as the two HMAC signers this project already hand-rolls
 * (the Omise webhook check and `/internal/publish`). R2 speaks the S3 API, so
 * "SigV4 over the S3 canonical request" is the whole integration.
 *
 * **The bytes never pass through this app.** The browser PUTs straight to R2
 * with a URL that is valid for a few minutes, for one key, for one content type
 * and for one exact byte count. A Vercel function has a request body limit and a
 * 60-second ceiling, and proxying an upload would spend both on something the
 * browser can do without help.
 *
 * WHAT ACTUALLY ENFORCES THE SIZE LIMIT is that `content-length` is one of the
 * signed headers. A presigned URL cannot otherwise stop a client from sending
 * 400 MB — the size the client declares when asking for the ticket is just a
 * claim. Signing it means R2 itself rejects a body of any other length, because
 * browsers set Content-Length from the body and cannot be told to lie about it.
 */

const SERVICE = 's3'
/** R2 has no regions; the S3 API still requires a region in the credential scope. */
const REGION = 'auto'
const ALGORITHM = 'AWS4-HMAC-SHA256'

/** Long enough for a slow phone upload, short enough that a leaked URL is worthless. */
export const UPLOAD_URL_TTL_SECONDS = 300

export type StorageConfig = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  /** Public base for reading the object back, e.g. https://cdn.example.com */
  publicBaseUrl: string
}

/**
 * Config or null — never a throw.
 *
 * Avatars are optional: a deployment with no bucket must still run, with the
 * upload button disabled and everything else working. `lib/env.ts` throws on a
 * missing required var, which is right for a signing secret and wrong here.
 */
export function storageConfig(): StorageConfig | null {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) return null
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl: publicBaseUrl.replace(/\/$/, ''),
  }
}

export function isObjectStorageConfigured(): boolean {
  return storageConfig() !== null
}

/** The bucket's S3 endpoint host. Virtual-hosted style, which R2 supports. */
function endpointHost(config: StorageConfig): string {
  return `${config.bucket}.${config.accountId}.r2.cloudflarestorage.com`
}

const encoder = new TextEncoder()

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256Hex(data: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(data)))
}

/**
 * RFC 3986 encoding, which is NOT what encodeURIComponent does.
 *
 * SigV4 canonicalisation requires `!'()*` to be percent-encoded too. Leaving
 * them raw produces a signature that is correct for a string the server never
 * computes, and the only symptom is a 403 with no detail.
 */
function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** Each path segment is encoded, but the separators are not. */
function encodeKey(key: string): string {
  return key.split('/').map(rfc3986).join('/')
}

/**
 * The four-step HMAC chain that turns a secret access key into a signing key.
 *
 * Exported only so a test can check it against AWS's own published worked
 * example (docs: "Examples of how to derive a signing key"). Nothing else in
 * this file is verifiable without a live bucket — the rest of SigV4 is string
 * assembly, and a test that rebuilds the same string proves nothing — so this
 * is the one place a known answer is available.
 */
export async function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<ArrayBuffer> {
  const kDate = await hmac(encoder.encode(`AWS4${secretAccessKey}`), dateStamp)
  const kRegion = await hmac(kDate, region)
  const kService = await hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

/** Hex form of the above, which is how AWS's worked example states its answer. */
export async function deriveSigningKeyHex(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<string> {
  return toHex(await deriveSigningKey(secretAccessKey, dateStamp, region, service))
}

export type PresignedUpload = {
  /** PUT the bytes here, with exactly these headers. */
  uploadUrl: string
  /** Send these verbatim — every one of them is signed. */
  headers: Record<string, string>
  /** Where the object will be readable once the PUT succeeds. */
  publicUrl: string
  key: string
}

/**
 * A presigned PUT for one object.
 *
 * @param contentLength exact byte count the client will send. Signed, so R2
 *                      rejects anything else.
 */
export async function presignUpload(
  config: StorageConfig,
  key: string,
  contentType: string,
  contentLength: number,
  now = new Date(),
): Promise<PresignedUpload> {
  const host = endpointHost(config)
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '') // 20260809T101500Z
  const dateStamp = amzDate.slice(0, 8)
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`

  // Signed headers must be sorted by lowercase name, and the same list has to
  // appear in the query string.
  const signedHeaders = 'content-length;content-type;host'
  const canonicalHeaders =
    `content-length:${contentLength}\n` + `content-type:${contentType}\n` + `host:${host}\n`

  const query = new Map<string, string>([
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', `${config.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(UPLOAD_URL_TTL_SECONDS)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ])
  // Sorted by key, and each side encoded — S3 sorts the canonical query string
  // byte-wise, and an unsorted one is a different string to sign.
  const canonicalQuery = [...query.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
    .join('&')

  const canonicalRequest = [
    'PUT',
    `/${encodeKey(key)}`,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    // The body is not hashed for a presigned URL: the signer has never seen it.
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [ALGORITHM, amzDate, scope, await sha256Hex(canonicalRequest)].join('\n')

  const signingKey = await deriveSigningKey(config.secretAccessKey, dateStamp, REGION, SERVICE)
  const signature = toHex(await hmac(signingKey, stringToSign))

  return {
    uploadUrl: `https://${host}/${encodeKey(key)}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    headers: { 'content-type': contentType },
    publicUrl: `${config.publicBaseUrl}/${encodeKey(key)}`,
    key,
  }
}

/** What an avatar may be. Kept here so the route and the client cannot disagree. */
export const AVATAR_CONTENT_TYPES: ReadonlyArray<string> = [
  'image/png',
  'image/jpeg',
  'image/webp',
]

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/**
 * Object key for one avatar.
 *
 * Namespaced by streamer id and given a random name rather than the uploaded
 * filename: a user-supplied name is attacker-controlled text in a URL, and a
 * fixed name per streamer would be served stale from every cache in between for
 * as long as the CDN says so.
 */
export function avatarKey(streamerId: string, contentType: string): string {
  const ext = EXTENSION[contentType] ?? 'bin'
  return `avatars/${streamerId}/${crypto.randomUUID()}.${ext}`
}
