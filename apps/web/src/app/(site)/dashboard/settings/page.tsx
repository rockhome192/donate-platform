import { redirect } from 'next/navigation'

/**
 * /dashboard/settings was one page holding both alert settings and the OBS
 * overlay source. It is now two, and this stays behind as a redirect rather
 * than a 404: the old URL is in browser histories and, more to the point, in
 * the messages where somebody was told where to find their overlay URL.
 *
 * Alerts rather than overlay, because the settings page led with the alert
 * form — that is the page whoever follows this link was looking at.
 */
export default function SettingsRedirect(): never {
  redirect('/dashboard/alerts')
}
