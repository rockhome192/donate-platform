import { describe, expect, it } from 'vitest'
import { IMAGE_SNIFF_BYTES, sniffImageType } from '@/lib/images'

/**
 * The one check an uploader cannot talk their way past.
 *
 * Everything else about an upload is a claim: the content type comes from the
 * request, and the browser fills that in from the filename. These bytes are the
 * file itself, so this is what stands between the avatar folder and whatever
 * anyone cares to rename to .png.
 */

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

/** A realistic head: the signature followed by whatever the encoder put next. */
function fileStartingWith(signature: number[], length = 64): Uint8Array {
  const out = new Uint8Array(length)
  out.set(signature, 0)
  out.fill(0x42, signature.length)
  return out
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff, 0xe0]
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]

describe('sniffImageType', () => {
  it('names the three formats this app accepts', () => {
    expect(sniffImageType(fileStartingWith(PNG))).toBe('image/png')
    expect(sniffImageType(fileStartingWith(JPEG))).toBe('image/jpeg')
    expect(sniffImageType(fileStartingWith(WEBP))).toBe('image/webp')
  })

  /**
   * The fourth JPEG byte is the first marker and varies by flavour — E0 for
   * JFIF, E1 for Exif (every phone photo), DB for some encoders. Matching it
   * would reject valid files, so the signature stops at three bytes.
   */
  it('accepts every JPEG flavour, not just JFIF', () => {
    for (const marker of [0xe0, 0xe1, 0xdb, 0xee]) {
      expect(sniffImageType(fileStartingWith([0xff, 0xd8, 0xff, marker]))).toBe('image/jpeg')
    }
  })

  /**
   * WebP is a RIFF container, and the four bytes between the two markers are
   * the file length — so this is the one signature that is not a plain prefix,
   * and a checker that compared twelve contiguous bytes would reject every real
   * WebP but the one whose size happened to match.
   */
  it('ignores the length field in the middle of a WebP header', () => {
    const small = [...WEBP]
    small[4] = 0x10
    const large = [...WEBP]
    large[4] = 0xf0
    large[5] = 0xff

    expect(sniffImageType(fileStartingWith(small))).toBe('image/webp')
    expect(sniffImageType(fileStartingWith(large))).toBe('image/webp')
  })

  /** RIFF alone is not WebP — it is also WAV, AVI, and several others. */
  it('refuses a RIFF container that is not WebP', () => {
    const wav = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]
    expect(sniffImageType(fileStartingWith(wav))).toBeNull()
  })

  /** The case this whole path exists for. */
  it('refuses an executable renamed to .png', () => {
    // MZ, the DOS header every Windows .exe still starts with.
    expect(sniffImageType(fileStartingWith([0x4d, 0x5a, 0x90, 0x00]))).toBeNull()
  })

  it('refuses HTML, a text file, and empty input', () => {
    expect(sniffImageType(new TextEncoder().encode('<!doctype html><script>'))).toBeNull()
    expect(sniffImageType(new TextEncoder().encode('hello'))).toBeNull()
    expect(sniffImageType(bytes())).toBeNull()
  })

  /**
   * "Cannot be shown to be a PNG" and "is not a PNG" are the same verdict for
   * something about to be served publicly, so a truncated header is refused
   * rather than given the benefit of the doubt.
   */
  it('refuses a signature that is cut short', () => {
    expect(sniffImageType(bytes(...PNG.slice(0, 7)))).toBeNull()
    expect(sniffImageType(bytes(0xff, 0xd8))).toBeNull()
    // RIFF present, the WEBP marker never arrives.
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00))).toBeNull()
  })

  /** A near miss in the last byte is still a miss. */
  it('refuses a signature that is one byte wrong', () => {
    const almost = [...PNG]
    almost[7] = 0x0b
    expect(sniffImageType(fileStartingWith(almost))).toBeNull()
  })

  /**
   * The route reads exactly this many bytes off the front of the upload and
   * passes only those. If the constant ever shrank below a signature, files
   * would start being refused for no visible reason.
   */
  it('decides on no more than the bytes the caller is told to read', () => {
    expect(IMAGE_SNIFF_BYTES).toBe(12)
    for (const signature of [PNG, JPEG, WEBP]) {
      const head = fileStartingWith(signature).subarray(0, IMAGE_SNIFF_BYTES)
      expect(sniffImageType(head)).not.toBeNull()
    }
  })
})
