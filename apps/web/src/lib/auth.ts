import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { db } from './db'

// NextAuth v4 on Next.js 16 — the same pairing already running in taskboard
// (next 16.2.6 + next-auth 4.24.x), so this is a proven combination.

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null

        const user = await db.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
          include: { streamer: { select: { id: true, slug: true } } },
        })
        if (!user?.passwordHash) return null

        const ok = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!ok) return null

        return {
          id: user.id,
          email: user.email,
          role: user.role,
          streamerId: user.streamer?.id ?? null,
          slug: user.streamer?.slug ?? null,
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role
        token.streamerId = user.streamerId
        token.slug = user.slug
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? ''
        session.user.role = token.role
        session.user.streamerId = token.streamerId
        session.user.slug = token.slug
      }
      return session
    },
  },
}
