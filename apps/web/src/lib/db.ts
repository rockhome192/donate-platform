import { PrismaClient } from '@prisma/client'

// Next dev reloads modules on every edit; without the global cache each reload
// opens a fresh pool and Neon starts refusing connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/** Prisma's unique-constraint violation. Used to turn races into no-ops. */
export function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: unknown }).code === 'P2002'
  )
}

/**
 * Which column(s) a P2002 was raised on.
 *
 * Registration needs this: one insert can collide on `User.email` or on
 * `Streamer.slug`, and "อีเมลนี้ถูกใช้แล้ว" for a taken slug sends the user to
 * fix the wrong field. `meta.target` is a string[] on Postgres, but it is typed
 * as unknown and is absent on some errors, so this narrows rather than casts.
 */
export function uniqueViolationTargets(e: unknown): string[] {
  if (!isUniqueViolation(e)) return []
  const target = (e as { meta?: { target?: unknown } }).meta?.target
  if (Array.isArray(target)) return target.filter((t): t is string => typeof t === 'string')
  return typeof target === 'string' ? [target] : []
}
