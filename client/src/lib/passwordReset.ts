// Where the link in a reset email opens the app, with the email and token in its query string.
export const RESET_PASSWORD_PATH = '/reset-password'

// The email and token from a reset email's link, each empty when the link has none. The token stays
// as the link holds it, which is how the server takes it back.
export interface ResetLink {
  email: string
  token: string
}

// The link the app was opened at, or null when it wasn't opened at a reset email's link.
export function resetLinkAt(location: Location): ResetLink | null {
  if (location.pathname !== RESET_PASSWORD_PATH) return null
  const query = new URLSearchParams(location.search)
  return { email: query.get('email')?.trim() ?? '', token: query.get('token')?.trim() ?? '' }
}

// The answer to asking for a link to choose a new password, from the landing page or from an expired
// link. The same for every email, whether or not it is a User's, as the server's answer is, so nobody
// can find out which emails are in use. "1 hour" or, say, "2 hours", as the email says it.
export function linkSent(linkHours: number) {
  return `If that email is in use, we've sent a link to it. It works for ${linkHours === 1 ? '1 hour' : `${linkHours} hours`}.`
}
