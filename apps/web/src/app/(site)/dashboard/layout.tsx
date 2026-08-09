import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { AppNav } from '@/components/AppNav'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * The console shell. Everything under /dashboard is one tool with one
 * navigation, rather than a handful of pages that link to each other.
 *
 * The session check lives here as well as in each page, and deliberately so:
 * a layout in Next.js is not a security boundary — it does not re-run on every
 * client-side navigation the way a page's own server render does, and a page
 * that trusted its parent for auth would be one refactor away from being
 * reachable. This one exists to decide what the shell should SHOW.
 */

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login?callbackUrl=/dashboard')

  // The nav wants a human name, which lives on Streamer, not User. An admin has
  // no Streamer row, so it falls back to the email rather than rendering blank.
  const streamer = session.user.streamerId
    ? await db.streamer.findUnique({
        where: { id: session.user.streamerId },
        select: { displayName: true, slug: true },
      })
    : null

  return (
    <div className="md:flex">
      <AppNav
        displayName={streamer?.displayName ?? session.user.email ?? 'บัญชีผู้ใช้'}
        email={session.user.email ?? ''}
        slug={streamer?.slug ?? null}
        isAdmin={session.user.role === 'ADMIN'}
      />
      <main className="min-w-0 flex-1 px-5 py-6 md:px-8 md:py-8">
        <div className="mx-auto w-full max-w-4xl">{children}</div>
      </main>
    </div>
  )
}
