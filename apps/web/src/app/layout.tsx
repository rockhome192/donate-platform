import type { Metadata } from 'next'
import './globals.css'
import { DemoBanner } from '@/components/DemoBanner'

export const metadata: Metadata = {
  title: 'donate-platform — demo',
  description:
    'ระบบรับโดเนทสำหรับสตรีมเมอร์ พร้อม alert เรียลไทม์บน OBS — โปรเจกต์สาธิต ไม่รับเงินจริง',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="min-h-dvh antialiased">
        <DemoBanner />
        {children}
      </body>
    </html>
  )
}
