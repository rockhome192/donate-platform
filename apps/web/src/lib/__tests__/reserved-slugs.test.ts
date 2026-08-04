import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { RESERVED_SLUGS } from '@dp/shared'

/**
 * Keeps RESERVED_SLUGS honest against the routes that actually exist.
 *
 * A streamer page is `/{slug}` at the root, so every static top-level segment
 * shadows a slug. The failure is silent in both directions: add `app/pricing`
 * and the streamer who already owns `pricing` loses their page with no error,
 * and nothing in a build or a type check would ever mention it.
 *
 * So this reads the route tree instead of trusting a hand-kept list. It fails
 * the moment somebody adds a top-level route without reserving its name --
 * which is precisely when a human would forget.
 */

const APP_DIR = fileURLToPath(new URL('../../app', import.meta.url))

/**
 * Route groups `(name)` are organisational and contribute nothing to the URL,
 * so a page inside one still sits at the root and must be collected. Private
 * folders `_name`, dynamic segments `[param]` and parallel routes `@slot` do
 * not produce a competing static path.
 */
function topLevelRoutes(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('(')) {
      found.push(...topLevelRoutes(`${dir}/${entry.name}`))
      continue
    }
    if (entry.name.startsWith('_') || entry.name.startsWith('[') || entry.name.startsWith('@')) {
      continue
    }
    found.push(entry.name)
  }
  return found
}

describe('reserved slugs vs the real route tree', () => {
  const routes = topLevelRoutes(APP_DIR)

  it('finds the routes it is supposed to be checking', () => {
    // Guards the walker itself: a bug that returned [] would make the
    // assertion below pass forever while checking nothing.
    expect(routes).toContain('api')
    expect(routes.length).toBeGreaterThan(1)
  })

  it.each(routes)('/%s is reserved, so no streamer can be shadowed by it', (route) => {
    expect(RESERVED_SLUGS.has(route)).toBe(true)
  })
})
