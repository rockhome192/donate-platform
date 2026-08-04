import './overlay.css'

/**
 * The OBS branch of the app. Everything the site wears — the DEMO banner, the
 * dark canvas — is deliberately absent, because this page is composited into a
 * live broadcast and anything it paints is on the stream.
 *
 * That is the entire reason app/(site) exists: the banner used to sit in the
 * root layout, which wraps every route with no way out.
 */
export default function OverlayLayout({ children }: { children: React.ReactNode }) {
  return children
}
