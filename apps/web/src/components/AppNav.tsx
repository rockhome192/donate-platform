'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'

/**
 * The console's navigation — the thing the app did not have.
 *
 * Until now the only way from the dashboard to settings was a button on the
 * dashboard, and the only way back was a "← กลับ" link. Every screen was a
 * dead end you reversed out of, which is why the app read as a few pages
 * rather than one tool.
 *
 * Two presentations of one list, not two lists: a rail on md and up, a
 * horizontal strip below it. The strip scrolls rather than wraps, so adding a
 * destination later cannot silently push the last one onto a second row where
 * a thumb never finds it.
 */

type Props = {
  displayName: string
  email: string
  /** Streamer slug, for the "open my donate page" link. Absent for an admin. */
  slug: string | null
  /**
   * Whether to show the admin destination. Cosmetic only — /dashboard/admin
   * checks the role itself against the database. Hiding a link is not access
   * control, it is tidiness.
   */
  isAdmin?: boolean
}

type Item = { href: Route; label: string; icon: string }

const ITEMS: readonly Item[] = [
  { href: '/dashboard', label: 'แดชบอร์ด', icon: '▤' },
  { href: '/dashboard/profile', label: 'โปรไฟล์', icon: '◍' },
  { href: '/dashboard/alerts', label: 'ตั้งค่า Alert', icon: '◈' },
  { href: '/dashboard/overlay', label: 'Overlay', icon: '◉' },
]

const ADMIN_ITEM: Item = { href: '/dashboard/admin', label: 'Admin', icon: '⚑' }

/**
 * `/dashboard` must match exactly or it stays highlighted on every child
 * route, and two items look active at once.
 */
function isActive(pathname: string, href: string): boolean {
  return href === '/dashboard' ? pathname === href : pathname.startsWith(href)
}

export function AppNav({ displayName, email, slug, isAdmin = false }: Props) {
  const pathname = usePathname()
  const items = isAdmin ? [...ITEMS, ADMIN_ITEM] : ITEMS

  return (
    <>
      {/* ---------------------------------------------------------- desktop */}
      {/*
        Sticks below the demo banner rather than at the viewport top: the
        banner is `sticky top-0 z-50` and never scrolls away (DESIGN.md 0), so
        top-0 here would put the rail underneath it. 2.25rem is the banner's
        height at md and up, where its text never wraps.
      */}
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface md:sticky md:top-9 md:flex md:h-[calc(100dvh-2.25rem)] md:flex-col">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span aria-hidden className="grid size-7 place-items-center rounded-chip bg-accent text-body text-white">
            ◉
          </span>
          <span className="font-display text-h3 font-bold tracking-wide">DONATR</span>
        </div>

        <nav aria-label="เมนูหลัก" className="flex-1 px-3">
          <ul className="space-y-0.5">
            {items.map((item) => {
              const active = isActive(pathname, item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-3 rounded-control px-3 py-2.5 text-label transition-colors ${
                      active
                        ? 'bg-surface-2 font-semibold text-ink'
                        : 'text-muted hover:bg-surface-2/60 hover:text-ink'
                    }`}
                  >
                    {/* The rail is the only thing that reads as "you are here"
                        at a glance; the weight and background carry it for
                        anyone who cannot see the colour. */}
                    <span
                      aria-hidden
                      className={`h-4 w-0.5 rounded-full ${active ? 'bg-accent-text' : 'bg-transparent'}`}
                    />
                    <span aria-hidden className={active ? 'text-accent-text' : 'text-faint'}>
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <UserBlock displayName={displayName} email={email} slug={slug} />
      </aside>

      {/* ----------------------------------------------------------- mobile */}
      <nav
        aria-label="เมนูหลัก"
        className="sticky top-9 z-40 -mx-5 flex gap-1.5 overflow-x-auto border-b border-line bg-canvas/95 px-5 py-2.5 backdrop-blur md:hidden"
      >
        {items.map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`shrink-0 rounded-chip px-3 py-1.5 text-label whitespace-nowrap transition-colors ${
                active
                  ? 'bg-surface-2 font-semibold text-ink'
                  : 'text-muted hover:text-ink'
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </>
  )
}

function UserBlock({ displayName, email, slug }: Props) {
  return (
    <div className="border-t border-line px-4 py-4">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-label"
        >
          {displayName.slice(0, 1)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-label font-semibold text-ink">{displayName}</p>
          <p className="truncate font-mono text-micro text-faint">{email}</p>
        </div>
      </div>

      {slug && (
        <Link
          href={`/${slug}`}
          className="mt-3 block truncate text-meta text-muted underline underline-offset-4 hover:text-ink"
        >
          เปิดหน้าโดเนท /{slug}
        </Link>
      )}

      <button
        type="button"
        onClick={() => signOut({ callbackUrl: '/' })}
        className="mt-2 text-meta text-faint underline underline-offset-4 hover:text-ink"
      >
        ออกจากระบบ
      </button>
    </div>
  )
}
