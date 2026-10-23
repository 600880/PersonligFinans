import { useSyncExternalStore } from 'react'

// How the app looks, as picked on the User page and remembered in this browser, not on the User, so
// it applies before signing in too and never changes the Guest for other visitors.
export type Appearance = 'light' | 'dark' | 'system'

// Also read by the script in index.html that paints the first frame in the remembered theme.
const STORAGE_KEY = 'appearance'

const DARK_DEVICE_QUERY = '(prefers-color-scheme: dark)'

// Told each time the Appearance is applied, for useIsDark.
const appliedListeners = new Set<() => void>()

// The remembered pick, or Light when nothing was picked, the value is unknown, or storage can't be read.
export function readAppearance(): Appearance {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'system') return stored
  } catch {
    // Storage blocked, so nothing was remembered.
  }
  return 'light'
}

// Remembers the pick and applies it at once. When storage can't be written it still applies on
// screen, but isn't remembered.
export function chooseAppearance(appearance: Appearance) {
  try {
    localStorage.setItem(STORAGE_KEY, appearance)
  } catch {
    // Applied below all the same.
  }
  applyAppearance(appearance)
}

// Applies the remembered pick, and again whenever the device's setting changes, for System. Returns
// how to stop following the device.
export function followAppearance(): () => void {
  applyAppearance(readAppearance())
  // Missing where the browser can't tell, which then counts as a light device.
  const device = window.matchMedia?.(DARK_DEVICE_QUERY)
  if (!device) return () => {}
  const onChange = () => applyAppearance(readAppearance())
  device.addEventListener('change', onChange)
  return () => device.removeEventListener('change', onChange)
}

// Dark is a class on <html>, which Tailwind's dark variant is bound to, so Light can be chosen on a
// dark device.
function applyAppearance(appearance: Appearance) {
  const isDark =
    appearance === 'dark' || (appearance === 'system' && window.matchMedia?.(DARK_DEVICE_QUERY).matches === true)
  document.documentElement.classList.toggle('dark', isDark)
  appliedListeners.forEach((listener) => listener())
}

// Whether the app is dark right now, for colours given in code rather than by the dark variant, such
// as the charts'. Renders again whenever that changes, also when System follows the device.
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribeToApplied, hasDarkClass)
}

function subscribeToApplied(listener: () => void) {
  appliedListeners.add(listener)
  return () => appliedListeners.delete(listener)
}

function hasDarkClass() {
  return document.documentElement.classList.contains('dark')
}
