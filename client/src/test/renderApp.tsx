// Opening the app in a test, and the steps tests share once it is open.

import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import App from '../App'

// Renders the app for a signed-in User, once it has asked who is signed in and shows the app.
export async function renderApp() {
  render(<App />)
  await screen.findByRole('navigation')
}

// Renders the app at an address, as opening a bookmark to it, or refreshing there, does.
export async function renderAppAt(path: string) {
  window.history.replaceState(null, '', path)
  await renderApp()
}

// The device's light or dark setting, which System follows and can be changed while the app is open.
export function deviceSetting(dark: boolean) {
  const listeners = new Set<() => void>()
  const query = {
    get matches() {
      return dark
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }
  vi.stubGlobal('matchMedia', () => query)
  return {
    change(toDark: boolean) {
      dark = toDark
      act(() => listeners.forEach((listener) => listener()))
    },
  }
}

// The ways to add Transactions, rather than the Add transactions button that opens them as a menu on
// a narrow screen.
export function addActions() {
  return within(screen.getByRole('group', { name: 'Ways to add transactions' }))
}

export const statementPdf = new File(['%PDF-1.7'], 'kontoutskrift.pdf', { type: 'application/pdf' })

export async function openModal() {
  const user = userEvent.setup()
  await renderApp()
  await user.click(screen.getByRole('button', { name: 'Add transaction' }))
  await screen.findByRole('option', { name: 'Groceries' })
  return user
}

export async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/description/i), 'Rema 1000')
  await user.type(screen.getByLabelText(/^out$/i), '249.90')
  await user.selectOptions(screen.getByLabelText(/category/i), 'Groceries')
}

// Whether refreshing or closing the tab now would ask the browser's own "Leave site?" question
// first, which it does when the beforeunload event is cancelled.
export function leavingTheSiteAsks() {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

// Chooses the Bookmark once the Folders are loaded.
export async function chooseBookmark(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.selectOptions(screen.getByLabelText(/^bookmark/i), await screen.findByRole('option', { name }))
}
