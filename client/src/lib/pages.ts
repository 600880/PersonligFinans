import { useEffect, useEffectEvent, useRef, useState } from 'react'

// The pages of the signed-in app, each at an address of its own, so the address bar says which page
// is shown, refreshing stays on it, and Back and Forward step between the pages visited. Only the
// page is in the address, never what was chosen on it. This is the only code that changes the
// address for a page; the reset email's link is read on its own, once, when the app starts.
export type Page = 'dashboard' | 'transactions' | 'categories' | 'rules' | 'user'

const PATHS: Record<Page, string> = {
  dashboard: '/',
  transactions: '/transactions',
  categories: '/categories',
  rules: '/rules',
  user: '/user',
}

// Told each time going to a page adds a history entry.
const addressListeners = new Set<() => void>()

// The page the address bar names, or undefined for any other address.
function pageAtAddress(): Page | undefined {
  return (Object.keys(PATHS) as Page[]).find((page) => PATHS[page] === window.location.pathname)
}

// Adds a history entry for the page, so Back returns to the page shown before. Choosing the page
// already shown adds none, so Back isn't cluttered with repeats.
export function goToPage(page: Page) {
  if (pageAtAddress() === page) return
  window.history.pushState(null, '', PATHS[page])
  addressListeners.forEach((listener) => listener())
}

// Puts the Dashboard's address in place of the current history entry, so Back never returns to the
// one replaced. It tells no page shown, since it is only for leaving the app — by Sign out, Delete
// your User or leaving the reset-password page — or for an address that names no page, where the
// Dashboard is shown anyway; so the app being left never acts on it as a page change.
export function replaceWithDashboardAddress() {
  window.history.replaceState(null, '', PATHS.dashboard)
}

// The page to show: the one the address bar names, or the Dashboard for any other address, which is
// then replaced with the Dashboard's without adding a history entry. Follows each page gone to, and
// each entry Back or Forward lands on. onPageChange is told of each change as it happens, from the
// page shown before, in the same update that shows the next, so whatever it changes shows with the
// page.
export function useShownPage(onPageChange: (from: Page, to: Page) => void): Page {
  const [page, setPage] = useState<Page>(() => pageAtAddress() ?? 'dashboard')
  // The page shown, kept as it changes rather than once rendered, so two changes in a row each start
  // from the right page.
  const shownRef = useRef(page)

  const followAddress = useEffectEvent(() => {
    const addressed = pageAtAddress()
    if (addressed === undefined) replaceWithDashboardAddress()
    const next = addressed ?? 'dashboard'
    const from = shownRef.current
    if (next === from) return
    shownRef.current = next
    onPageChange(from, next)
    setPage(next)
  })

  useEffect(() => {
    followAddress()
    addressListeners.add(followAddress)
    window.addEventListener('popstate', followAddress)
    return () => {
      addressListeners.delete(followAddress)
      window.removeEventListener('popstate', followAddress)
    }
  }, [])

  return page
}
