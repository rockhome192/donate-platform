import type { Role } from '@prisma/client'
import type { DefaultSession } from 'next-auth'

/**
 * What the session carries, and deliberately what it does NOT.
 *
 * `slug` used to be here. It was never read — every screen loads it from the
 * Streamer row — and once /dashboard/profile could change it, a copy sitting in
 * a JWT that lives until the next sign-in became a stale value waiting for
 * someone to trust it. Identifiers that the product can edit do not belong in a
 * token this app cannot revoke.
 *
 * `streamerId` stays because it is the row's primary key and never changes;
 * `role` stays because every route that cares re-checks the database anyway.
 */
declare module 'next-auth' {
  interface User {
    role: Role
    streamerId: string | null
  }

  interface Session {
    user: {
      id: string
      role: Role
      streamerId: string | null
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role: Role
    streamerId: string | null
  }
}
