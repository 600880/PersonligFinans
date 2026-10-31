import { useEffect, useEffectEvent, useRef, useState } from 'react'

// The pages of the signed-in app, each at an address of its own, so the address bar says which page
// is shown, refreshing stays on it, and Back and Forward step between the pages visited. Only the
// page is in the address, never what was chosen on it. This is the only code that changes the
// address for a page; the reset email's link is read on its own, once, when the app starts.
export type Page = 'home' | 'transactions' | 'categories' | 'rules' | 'user'

const PATHS: Record<Page, string> = {
  home: '/',
  transactions: '/transactions',
  categories: '/categories',
  rules: '/rules',
  user: '/user',
}

// Told each time the address changes to another entry, by going to a page or replacing the address.
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

// Puts the page's address in place of the current history entry, so Back never returns to the one
// replaced.
export function replacePage(page: Page) {
  window.history.replaceState(null, '', PATHS[page])
  addressListeners.forEach((listener) => listener())
}

// The page to show: the one the address bar names, or the Dashboard for any other address, which is
// then replaced with the Dashboard's without adding a history entry. Follows each page gone to, and
// each entry Back or Forward lands on. onPageChange is told of each change as it happens, from the
// page shown before, in the same update that shows the next, so whatever it changes shows with the
// page.
export function useShownPage(onPageChange: (from: Page, to: Page) => void): Page {
  const [page, setPage] = useState<Page>(() => pageAtAddress() ?? 'home')
  // The page shown, kept as it changes rather than once rendered, so two changes in a row each start
  // from the right page.
  const shownRef = useRef(page)

  const followAddress = useEffectEvent(() => {
    const addressed = pageAtAddress()
    if (addressed === undefined) window.history.replaceState(null, '', PATHS.home)
    const next = addressed ?? 'home'
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
