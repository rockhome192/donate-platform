/**
 * The Thai banks a slip can name, by the three-digit code that appears in a
 * transfer slip's `receivingBank` / `sendingBank`.
 *
 * Not exhaustive — it is the set a viewer might plausibly transfer from or to,
 * which is what a picker needs. An unknown code is not an error anywhere: layer
 * 3 compares codes as strings and never asks what they mean, so this list only
 * decides what a human sees.
 */
export const THAI_BANKS: ReadonlyArray<{ code: string; name: string }> = [
  { code: '002', name: 'กรุงเทพ (BBL)' },
  { code: '004', name: 'กสิกรไทย (KBank)' },
  { code: '006', name: 'กรุงไทย (KTB)' },
  { code: '011', name: 'ทหารไทยธนชาต (ttb)' },
  { code: '014', name: 'ไทยพาณิชย์ (SCB)' },
  { code: '022', name: 'ซีไอเอ็มบี ไทย (CIMBT)' },
  { code: '024', name: 'ยูโอบี (UOB)' },
  { code: '025', name: 'กรุงศรีอยุธยา (BAY)' },
  { code: '030', name: 'ออมสิน (GSB)' },
  { code: '033', name: 'อาคารสงเคราะห์ (GHB)' },
  { code: '034', name: 'เพื่อการเกษตร (BAAC)' },
  { code: '069', name: 'เกียรตินาคินภัทร (KKP)' },
  { code: '071', name: 'ทิสโก้ (TISCO)' },
]

/** The bank's name, or the bare code when we do not have one for it. */
export function bankName(code: string | null | undefined): string {
  if (!code) return ''
  return THAI_BANKS.find((b) => b.code === code)?.name ?? code
}
