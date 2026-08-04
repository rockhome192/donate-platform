import { DemoBanner } from '@/components/DemoBanner'

/**
 * Everything a human browses: landing, donate page, login, dashboard.
 *
 * The group exists to draw a line the root layout could not. `/overlay/{token}`
 * is rendered by OBS into a live broadcast and must carry no chrome at all —
 * so the chrome lives here, one level below the root, and the overlay simply
 * never enters this branch.
 *
 * The DEMO banner is not optional on any page in this group (DESIGN.md 0): the
 * project talks about money and QR codes, and a visitor must never be able to
 * mistake it for something that takes real payments.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DemoBanner />
      {children}
    </>
  )
}
