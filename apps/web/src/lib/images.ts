/**
 * What a file actually is, read from the file rather than from what it claims.
 *
 * A content type sent by a client is a claim, and the filename it came from is
 * a weaker claim still — a browser fills File.type in by looking at the
 * extension, so renaming anything to .png is enough to make it say image/png.
 * The bytes at the front of the file are the only part an uploader cannot
 * restate, which is why this exists and why it is checked server-side.
 *
 * Pure and dependency-free on purpose: this is a handful of byte comparisons,
 * and an image library here would mean decoding attacker-supplied pixels to
 * answer a question that the first twelve bytes already answer.
 */

/** Enough for the longest signature below, including WebP's split marker. */
export const IMAGE_SNIFF_BYTES = 12

/**
 * The magic numbers, as the format specifications state them.
 *
 *   PNG   89 50 4E 47 0D 0A 1A 0A   — the last four bytes are a CRLF/EOF trap
 *                                     for files mangled by a text-mode copy
 *   JPEG  FF D8 FF                  — SOI then the first marker; byte four
 *                                     varies by flavour (E0 JFIF, E1 Exif, DB)
 *                                     so matching further would reject valid
 *                                     files
 *   WebP  "RIFF" ???? "WEBP"        — a RIFF container, and the four bytes in
 *                                     between are the file length, which is
 *                                     why this one is not a plain prefix
 */
const SIGNATURES: ReadonlyArray<{ type: string; at: ReadonlyArray<[number, number[]]> }> = [
  { type: 'image/png', at: [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]] },
  { type: 'image/jpeg', at: [[0, [0xff, 0xd8, 0xff]]] },
  {
    type: 'image/webp',
    at: [
      [0, [0x52, 0x49, 0x46, 0x46]], // RIFF
      [8, [0x57, 0x45, 0x42, 0x50]], // WEBP
    ],
  },
]

function matchesAt(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  if (bytes.length < offset + expected.length) return false
  return expected.every((byte, i) => bytes[offset + i] === byte)
}

/**
 * The content type these bytes really are, or null for anything not on the
 * list.
 *
 * Null is the answer for a truncated file too. A two-byte upload cannot be
 * shown to be a PNG, and "cannot be shown to be" is the same verdict as "is
 * not" for something about to be served to an audience.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  for (const signature of SIGNATURES) {
    if (signature.at.every(([offset, expected]) => matchesAt(bytes, offset, expected))) {
      return signature.type
    }
  }
  return null
}
