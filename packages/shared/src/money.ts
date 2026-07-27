/**
 * Money is ALWAYS an integer number of satang (1 baht = 100 satang).
 *
 * Never float. `0.1 + 0.2 !== 0.3` and that difference is somebody's money.
 * Omise's API also takes the minor unit, so this matches the provider 1:1.
 */

export const SATANG_PER_BAHT = 100

/** Absolute system bounds. Per-streamer min/max are checked separately — see DESIGN.md 7.1.1 */
export const SYSTEM_MIN_SATANG = 100 // 1.00 THB
export const SYSTEM_MAX_SATANG = 10_000_000 // 100,000.00 THB

/**
 * Convert a baht amount from UI input into satang.
 *
 * Rounds rather than truncates, because 20.1 * 100 is 2009.9999999999998 in
 * binary floating point and truncation would quietly drop a satang.
 *
 * Anything finer than a satang is REJECTED rather than rounded. 1.005 baht is
 * not a real THB amount, and silently turning it into 100 satang loses half a
 * satang with nobody the wiser. Same rule as everywhere else in this codebase:
 * money never disappears quietly.
 *
 * The tolerance check is what separates the two cases -- 20.1 lands within a
 * rounding error of a whole satang, 1.005 does not.
 */
export function toSatang(baht: number): number {
  if (!Number.isFinite(baht)) throw new RangeError('baht must be finite')

  const scaled = baht * SATANG_PER_BAHT
  const rounded = Math.round(scaled)

  if (Math.abs(scaled - rounded) > 1e-9) {
    throw new RangeError(
      `${baht} baht is finer than one satang; amounts take at most 2 decimal places`,
    )
  }
  return rounded
}

export function toBaht(satang: number): number {
  assertSatang(satang)
  return satang / SATANG_PER_BAHT
}

/** Display string, e.g. 250050 -> "2,500.50" */
export function formatBaht(satang: number): string {
  assertSatang(satang)
  return (satang / SATANG_PER_BAHT).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function assertSatang(satang: number): void {
  if (!Number.isInteger(satang)) {
    throw new TypeError(`amount must be an integer number of satang, got ${satang}`)
  }
}
