import { Panel, PanelHeader } from '@/components/ui'

/**
 * OBS setup, on the page that hands out the URL rather than on a help page of
 * its own. Someone reading this is holding the URL right now; sending them
 * somewhere else to learn what to do with it is the whole problem with docs.
 *
 * The two checkbox notes are the ones that actually cause support questions.
 * Neither loses a donation — /missed replays anything the overlay was not
 * connected for — but both make the overlay look broken, and "it looked broken
 * so I stopped using it" is how a streamer leaves.
 */

const STEPS = [
  {
    no: '01',
    title: 'เพิ่ม Browser Source',
    body: 'ใน OBS ที่แผง Sources กด + แล้วเลือก Browser ตั้งชื่ออะไรก็ได้ เช่น DONATR alert',
  },
  {
    no: '02',
    title: 'วาง URL',
    body: 'กดปุ่มคัดลอกด้านบน แล้ววางลงช่อง URL ตั้ง Width 1920 Height 1080 ให้เท่ากับความละเอียดที่สตรีม',
  },
  {
    no: '03',
    title: 'ทดสอบ',
    body: 'กดปุ่ม "ทดสอบ alert" ด้านบน ถ้าตั้งถูก alert จะเด้งใน OBS ทันที และปุ่มจะบอกว่าส่งถึงกี่จอ',
  },
] as const

export function ObsSteps() {
  return (
    <Panel>
      <PanelHeader label="วิธีตั้งค่าใน OBS" />
      <div className="space-y-5 p-4">
        <ol className="space-y-4">
          {STEPS.map((step) => (
            <li key={step.no} className="flex gap-3.5">
              <span className="label-tech mt-0.5 shrink-0 text-accent-text">{step.no}</span>
              <div className="min-w-0">
                <p className="font-semibold text-ink">{step.title}</p>
                <p className="mt-0.5 text-label text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="space-y-2.5 border-t border-line pt-4">
          <p className="label-tech text-faint">ตัวเลือกใน OBS ที่ควรรู้</p>
          <p className="text-label text-muted">
            <span className="font-mono text-meta text-ink">Shutdown source when not visible</span> —
            ถ้าติ๊กไว้ OBS จะปิดหน้า overlay ทุกครั้งที่สลับไปฉากอื่น alert ที่เข้ามาตอนนั้นจะไม่ขึ้นทันที
            แต่<span className="text-money">ไม่หาย</span> ระบบเก็บไว้ให้แล้วเด้งย้อนตอนกลับมาฉากเดิม
            ถ้าไม่อยากให้เด้งย้อนทีเดียวหลายอัน ให้เอาติ๊กออก
          </p>
          <p className="text-label text-muted">
            <span className="font-mono text-meta text-ink">
              Refresh browser when scene becomes active
            </span>{' '}
            — ไม่จำเป็นต้องติ๊ก overlay ต่อกลับเองอยู่แล้วเมื่อเน็ตหลุด
          </p>
        </div>
      </div>
    </Panel>
  )
}
