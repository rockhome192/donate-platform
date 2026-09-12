/**
 * Presigned uploads to Cloudflare R2, signed here with AWS SigV4.
 *
 * No SDK. `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` is a large
 * dependency to carry into a serverless bundle for one operation, and this file
 * is the same shape as the two HMAC signers this project already hand-rolls
 * (the Omise webhook check and `/internal/publish`). R2 speaks the S3 API, so
 * "SigV4 over the S3 canonical request" is the whole integration.
 *
 * **Nothing outside this app writes to the bucket.** Presigned URLs are minted
 * here and spent here, by the server, in the same request: `putObject` signs a
 * PUT and sends the bytes itself.
 *
 * That is a reversal, and the reasoning is worth keeping. This file used to
 * hand the presigned URL to the BROWSER, so the bytes never passed through a
 * Vercel function — which has a request body limit and a duration ceiling, and
 * spending both to relay something the browser can send itself looked like a
 * clear waste. What that traded away was the only chance to look at the bytes:
 * a signed URL binds the content type and the exact length, but both are
 * CLAIMS BY THE UPLOADER, and no signature can make a file that says image/png
 * actually be one. Checking the numbers settled it — an avatar is capped at
 * 2MB and the body limit is 4.5MB, so the relay that looked impossible fits
 * with room to spare. See lib/images.ts for what the app does with the chance.
 *
 * The signed `content-length` still earns its place: the TTS path and the
 * avatar path both send bodies they have measured, and signing the length means
 * R2 rejects any other, so a bug on our side cannot quietly store the wrong
 * number of bytes.
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

type PresignRequest = {
  method: 'GET' | 'HEAD' | 'PUT' | 'DELETE'
  /** Object key, or '' for a bucket-level request such as a listing. */
  key: string
  /** Headers the request will carry beyond host. Lowercase names, as signed. */
  headers?: Record<string, string | number>
  /** Query parameters the request will carry, e.g. list-type=2. */
  query?: Record<string, string>
  ttlSeconds?: number
  now?: Date
}

/**
 * One presigned S3 request, whatever the verb.
 *
 * This lived inside presignUpload until the bucket needed a way to shrink as
 * well as grow. Nothing about SigV4 is upload-specific — the method is one line
 * of the canonical request — so this split is the whole cost of DELETE and LIST.
 */
async function presignedUrl(
  config: StorageConfig,
  {
    method,
    key,
    headers = {},
    query = {},
    ttlSeconds = UPLOAD_URL_TTL_SECONDS,
    now = new Date(),
  }: PresignRequest,
): Promise<string> {
  const host = endpointHost(config)
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '') // 20260809T101500Z
  const dateStamp = amzDate.slice(0, 8)
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`

  // Signed headers must be sorted by lowercase name, and the same list has to
  // appear in the query string.
  const all: Record<string, string | number> = { ...headers, host }
  const names = Object.keys(all).sort()
  const signedHeaders = names.join(';')
  const canonicalHeaders = names.map((name) => `${name}:${all[name]}\n`).join('')

  const params = new Map<string, string>([
    ...Object.entries(query),
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', `${config.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(ttlSeconds)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ])
  // Sorted by key, and each side encoded — S3 sorts the canonical query string
  // byte-wise, and an unsorted one is a different string to sign.
  const canonicalQuery = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
    .join('&')

  const canonicalRequest = [
    method,
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

  return `https://${host}/${encodeKey(key)}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

/**
 * Where an object is readable, given its key.
 *
 * The one place the public URL is spelled, so a caller that already knows an
 * object exists can address it without re-uploading to find out where it went.
 */
export function publicUrlForKey(config: StorageConfig, key: string): string {
  return `${config.publicBaseUrl}/${encodeKey(key)}`
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
  const uploadUrl = await presignedUrl(config, {
    method: 'PUT',
    key,
    headers: { 'content-length': contentLength, 'content-type': contentType },
    now,
  })

  return {
    uploadUrl,
    headers: { 'content-type': contentType },
    publicUrl: publicUrlForKey(config, key),
    key,
  }
}

/**
 * Is this key already stored?
 *
 * Signed and sent to the S3 endpoint rather than HEADing the public URL, which
 * would be simpler and would also be answered by a CDN — from a cache that can
 * be wrong in both directions, and stays wrong for as long as it likes. The
 * question here decides whether to spend money, so it is asked of the bucket.
 *
 * False on any failure, which is the direction that costs a few characters
 * rather than handing out a URL to something that is not there.
 */
export async function objectExists(config: StorageConfig, key: string): Promise<boolean> {
  try {
    const url = await presignedUrl(config, {
      method: 'HEAD',
      key,
      ttlSeconds: SERVER_URL_TTL_SECONDS,
    })
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
    })
    return res.ok
  } catch (err) {
    console.warn(`[storage] existence check failed for ${key}:`, err)
    return false
  }
}

/** Ceiling on one PUT. Both callers are inside a request somebody is waiting on. */
const PUT_TIMEOUT_MS = 8_000

/**
 * Sign a PUT and spend it, in one call.
 *
 * The one way bytes reach the bucket. Callers hand over something they have
 * already measured and already decided is allowed to exist — this function
 * asks no questions about the content, it only carries it.
 *
 * Returns the public URL, or null if the write did not land. Never throws: one
 * caller is a webhook processor that must not fail a paid donation over a slow
 * bucket, and the other turns null into a 502 of its own wording.
 */
export async function putObject(
  config: StorageConfig,
  key: string,
  contentType: string,
  body: ArrayBuffer,
  label: string,
): Promise<string | null> {
  try {
    const upload = await presignUpload(config, key, contentType, body.byteLength)

    const res = await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: upload.headers,
      body,
      // On the donation path this runs inside the webhook handler, ahead of the
      // publish, so a hung PUT delays the alert exactly as a hung Azure would.
      signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error(`[storage] upload failed ${res.status} for ${label}`)
      return null
    }

    return upload.publicUrl
  } catch (err) {
    console.error(`[storage] upload failed for ${label}:`, err)
    return null
  }
}

/**
 * Seconds, not minutes, on the calls this app makes itself: the URL is signed
 * and used in the same breath, so a longer window only widens what a leaked log
 * line would be worth.
 */
const SERVER_URL_TTL_SECONDS = 60

/** Long enough for R2 to answer, short enough not to hold a request open. */
const SERVER_TIMEOUT_MS = 8_000

/**
 * Delete one object. Returns whether the bucket no longer holds it.
 *
 * A 404 counts as success, because the caller's goal is the absence of the
 * object and S3 answers a delete of a missing key with 204 regardless. Never
 * throws: both callers are tidying up after a write that already succeeded, and
 * neither may fail the thing the user actually asked for.
 */
export async function deleteObject(config: StorageConfig, key: string): Promise<boolean> {
  try {
    const url = await presignedUrl(config, {
      method: 'DELETE',
      key,
      ttlSeconds: SERVER_URL_TTL_SECONDS,
    })
    const res = await fetch(url, {
      method: 'DELETE',
      signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
    })
    if (!res.ok && res.status !== 404) {
      console.warn(`[storage] delete ${key} answered ${res.status}`)
      return false
    }
    return true
  } catch (err) {
    console.warn(`[storage] delete ${key} failed:`, err)
    return false
  }
}

/** One object as the bucket describes it. */
export type StoredObject = {
  key: string
  lastModified: Date
  size: number
}

/** The five predefined XML entities, undone. Keys this app mints contain none. */
function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * ListObjectsV2 answers in XML, and this project has no XML parser.
 *
 * Regex over markup is normally a mistake. It is defensible here because the
 * document is machine-generated by one known service, the fields read are three
 * flat leaves, and the alternative is a parser dependency in a serverless
 * bundle for one maintenance script. An entry that does not match is skipped,
 * which for a sweep means the object is kept — the safe direction to fail.
 */
export function parseObjectListing(xml: string): {
  objects: StoredObject[]
  nextToken: string | null
} {
  const objects: StoredObject[] = []

  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = match[1] ?? ''
    const key = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1]
    const modified = block.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1]
    const size = block.match(/<Size>(\d+)<\/Size>/)?.[1]
    if (!key || !modified) continue

    const lastModified = new Date(modified)
    if (Number.isNaN(lastModified.getTime())) continue

    objects.push({ key: unescapeXml(key), lastModified, size: Number(size ?? 0) })
  }

  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml)
  const nextToken = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1]

  // "There is more, and here is where to continue" is one statement. Half of it
  // is not a smaller truth, it is an unusable answer: returning null here would
  // read to the caller as "that was the last page", which is precisely the lie
  // that makes a sweep believe it has seen the whole bucket. A regex reader
  // over a body that was cut short mid-document lands here, so it is reachable.
  if (truncated && !nextToken) {
    throw new Error('[storage] listing says it is truncated but names no continuation token')
  }

  return { objects, nextToken: truncated && nextToken ? unescapeXml(nextToken) : null }
}

/** A listing page holds 1000 keys. A sweep that stopped early would be a sweep that lies. */
const MAX_LIST_PAGES = 100

/**
 * Every object under a prefix, following continuation tokens to the end.
 *
 * Throws rather than returning what it managed to read. A partial listing is
 * the one input that would make a sweep delete things it should have kept:
 * every key it failed to see looks exactly like a key nothing references.
 */
export async function listObjects(config: StorageConfig, prefix: string): Promise<StoredObject[]> {
  const all: StoredObject[] = []
  let token: string | null = null

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const query: Record<string, string> = { 'list-type': '2', prefix }
    if (token) query['continuation-token'] = token

    const url = await presignedUrl(config, {
      method: 'GET',
      key: '',
      query,
      ttlSeconds: SERVER_URL_TTL_SECONDS,
    })
    const res = await fetch(url, { signal: AbortSignal.timeout(SERVER_TIMEOUT_MS) })
    if (!res.ok) {
      throw new Error(`[storage] list ${prefix} answered ${res.status}`)
    }

    const listing = parseObjectListing(await res.text())
    all.push(...listing.objects)
    if (!listing.nextToken) return all
    token = listing.nextToken
  }

  throw new Error(`[storage] list ${prefix} exceeded ${MAX_LIST_PAGES} pages`)
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

/** Exactly what avatarKey's last segment looks like, and nothing else. */
const AVATAR_FILENAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/

/**
 * Is this URL one that THIS streamer's own upload produced?
 *
 * "On our bucket" is not enough. Every avatar URL is public and appears
 * verbatim in the page source of its donate page, so checking only the bucket
 * lets any streamer paste someone else's avatar into their own profile and wear
 * that person's face on a page whose entire purpose is asking their audience
 * for money. The key is namespaced by streamer id precisely so ownership is
 * decidable here.
 *
 * Parsed rather than string-matched, because the URL is later handed to a
 * browser and a browser resolves dot segments: `/avatars/<mine>/../<theirs>/x`
 * passes any startsWith test and then fetches somebody else's object. `new URL`
 * normalises those away before the comparison. The tail is matched against the
 * exact shape avatarKey emits, so the only URLs accepted are ones this app
 * minted — query strings and fragments included, since neither can appear on a
 * key we generated and both are ways to make one string address another object.
 */
export function ownsAvatarUrl(
  config: StorageConfig,
  streamerId: string,
  rawUrl: string,
): boolean {
  let url: URL
  let base: URL
  try {
    url = new URL(rawUrl)
    base = new URL(`${config.publicBaseUrl}/`)
  } catch {
    return false
  }
  if (url.origin !== base.origin) return false
  if (url.search !== '' || url.hash !== '') return false

  const prefix = `${base.pathname}avatars/${streamerId}/`
  if (!url.pathname.startsWith(prefix)) return false
  return AVATAR_FILENAME.test(url.pathname.slice(prefix.length))
}

/**
 * The key any URL on our public base addresses, or null for a URL elsewhere.
 *
 * Asks nothing about ownership, and that is the point: this is what a sweep
 * uses to decide which objects are still SPOKEN FOR, where the widest possible
 * answer is the safe one. A row whose avatarUrl predates ownsAvatarUrl, or
 * points at another streamer's key, still protects the object it names —
 * deleting it would blank a live page to tidy up a historical mistake.
 */
export function publicUrlToKey(config: StorageConfig, rawUrl: string): string | null {
  let url: URL
  let base: URL
  try {
    url = new URL(rawUrl)
    base = new URL(`${config.publicBaseUrl}/`)
  } catch {
    return null
  }
  if (url.origin !== base.origin) return null
  if (!url.pathname.startsWith(base.pathname)) return null

  const key = decodeURIComponent(url.pathname.slice(base.pathname.length))
  return key === '' ? null : key
}

/**
 * The key behind an avatar URL this streamer owns, or null.
 *
 * The narrow counterpart of publicUrlToKey, and the asymmetry between them is
 * deliberate: this one answers "may I DELETE this", so it defers to
 * ownsAvatarUrl rather than forming a second, looser opinion about which URLs
 * belong to whom. A cleanup that guesses is a cleanup that erases somebody
 * else's face. Null means "do not touch it", never "probably fine".
 */
export function avatarKeyFromUrl(
  config: StorageConfig,
  streamerId: string,
  rawUrl: string,
): string | null {
  if (!ownsAvatarUrl(config, streamerId, rawUrl)) return null
  return publicUrlToKey(config, rawUrl)
}

/**
 * Is this key one avatarKey() could have produced?
 *
 * The sweep's last guard. Anything under avatars/ that this app did not mint —
 * a file someone put there by hand, a prefix a later feature adds — is not the
 * sweep's to delete, and an unrecognised shape is the only evidence available.
 */
export function isAvatarKey(key: string): boolean {
  const parts = key.split('/')
  if (parts.length !== 3) return false
  const [prefix, streamerId, filename] = parts
  return prefix === 'avatars' && Boolean(streamerId) && AVATAR_FILENAME.test(filename ?? '')
}
