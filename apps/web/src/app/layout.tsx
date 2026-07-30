import type { Metadata } from 'next'
import { Anuphan, Bai_Jamjuree, Space_Grotesk, Space_Mono } from 'next/font/google'
import './globals.css'
import { DemoBanner } from '@/components/DemoBanner'

// Self-hosted at build time by next/font — no runtime request to Google, so no
// third party gets a hit every time an overlay reloads mid-stream.
const anuphan = Anuphan({
  subsets: ['thai', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-anuphan',
  display: 'swap',
})
const baiJamjuree = Bai_Jamjuree({
  subsets: ['thai', 'latin'],
  weight: ['500', '600', '700'],
  variable: '--font-bai-jamjuree',
  display: 'swap',
})
const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-space-mono',
  display: 'swap',
})
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'DONATR — ระบบรับโดเนทสำหรับสตรีมเมอร์ (demo)',
  description:
    'ระบบรับโดเนทสำหรับสตรีมเมอร์ พร้อม alert เรียลไทม์บน OBS — โปรเจกต์สาธิต ไม่รับเงินจริง',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="th"
      className={`${anuphan.variable} ${baiJamjuree.variable} ${spaceMono.variable} ${spaceGrotesk.variable}`}
    >
      <body className="min-h-dvh font-sans antialiased">
        <DemoBanner />
        {children}
      </body>
    </html>
  )
}
