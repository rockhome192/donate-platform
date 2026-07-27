import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // @dp/shared is published as raw TypeScript (no build step), so Next has to
  // compile it the same way it compiles app code.
  transpilePackages: ['@dp/shared'],
  typedRoutes: true,
}

export default nextConfig
