import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { api, fetchMock, guest, importedStatement } from './test/fakeApi'
import { deviceSetting, renderApp, renderAppAt, statementPdf } from './test/renderApp'

describe('Signing in', () => {
  const signedOut = () => new Response(null, { status: 401 })

  function landingPage(heading: 'Sign in' | 'Sign up' = 'Sign in') {
    return screen.findByRole('heading', { name: heading })
  }

  async function fillIn(user: ReturnType<typeof userEvent.setup>, email: string, password: string) {
    await user.type(screen.getByLabelText(/^email/i), email)
    await user.type(screen.getByLabelText(/^password/i), password)
  }

  async function confirmPassword(user: ReturnType<typeof userEvent.setup>, password: string) {
    await user.type(screen.getByLabelText(/^confirm password/i), password)
  }

  it('shows the landing page, not the app, when nobody is signed in', async () => {
    api.currentUser = signedOut()
    render(<App />)

    expect(await landingPage()).toBeInTheDocument()
    expect(screen.queryByText(/bank statements and receipts/i)).not.toBeInTheDocument()
    expect(screen.getByText('New user?', { exact: false })).toContainElement(screen.getByRole('button', { name: 'Sign up' }))
    expect(screen.getByText('Or try the app first, without signing up.')).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/user', '/api/user/password-reset/availability']),
    )
  })

  it('shows neither the landing page nor the app while asking who is signed in', async () => {
    let respond: (response: Response) => void = () => {}
    api.currentUser = new Promise((resolve) => (respond = resolve))
    render(<App />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/user'))
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()

    respond(Response.json({ email: 'me@example.com', isGuest: false }))
    expect(await screen.findByRole('navigation')).toBeInTheDocument()
  })

  it('logs in and shows the app', async () => {
    api.currentUser = signedOut()
    const user = userEvent.setup()
    render(<App />)
    await landingPage()

    await fillIn(user, 'me@example.com', 'my long passphrase')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('navigation')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add transaction' })).toBeInTheDocument()
    const signIn = fetchMock.mock.calls.find(([url]) => url === '/api/user/sign-in')
    expect(JSON.parse(signIn?.[1]?.body as string)).toEqual({ email: 'me@example.com', password: 'my long passphrase' })
  })

  it.each([
    [401, 'Wrong email or password.'],
    [429, 'Too many failed sign-ins, so this email is locked for a few minutes. Try again later.'],
  ])('stays on the landing page with the error of a sign-in refused with %i', async (status, detail) => {
    api.currentUser = signedOut()
    api.handleSignIn = () => Response.json({ detail }, { status })
    const user = userEvent.setup()
    render(<App />)
    await landingPage()

    await fillIn(user, 'me@example.com', 'wrong password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(detail)
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('signs up and shows the app', async () => {
    api.currentUser = signedOut()
    const user = userEvent.setup()
    render(<App />)
    await landingPage()

    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    await landingPage('Sign up')
    await fillIn(user, 'new@example.com', 'my long passphrase')
    await confirmPassword(user, 'my long passphrase')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(await screen.findByRole('navigation')).toBeInTheDocument()
    const signUp = fetchMock.mock.calls.find(([url]) => url === '/api/user/sign-up')
    expect(JSON.parse(signUp?.[1]?.body as string)).toEqual({ email: 'new@example.com', password: 'my long passphrase' })
    await user.click(screen.getByRole('button', { name: 'User' }))
    expect(screen.getByText('new@example.com')).toBeInTheDocument()
  })

  it('asks to confirm the password only when signing up', async () => {
    api.currentUser = signedOut()
    const user = userEvent.setup()
    render(<App />)
    await landingPage()
    expect(screen.queryByLabelText(/^confirm password/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(await screen.findByLabelText(/^confirm password/i)).toHaveAttribute('autocomplete', 'new-password')
  })

  it("refuses to sign up, sending nothing, when the passwords don't match", async () => {
    api.currentUser = signedOut()
    const user = userEvent.setup()
    render(<App />)
    await landingPage()

    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    await fillIn(user, 'new@example.com', 'my long passphrase')
    await confirmPassword(user, 'my long passphrse')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(await screen.findByText("Passwords don't match")).toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain('/api/user/sign-up')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('hides and clears the confirm field when switching to Sign in', async () => {
    api.currentUser = signedOut()
    const user = userEvent.setup()
    render(<App />)
    await landingPage()
    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    await fillIn(user, 'new@example.com', 'my long passphrase')
    await confirmPassword(user, 'my long passphrse')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    await screen.findByText("Passwords don't match")

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await landingPage()).toBeInTheDocument()
    expect(screen.queryByLabelText(/^confirm password/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    expect(await screen.findByLabelText(/^confirm password/i)).toHaveValue('')
    expect(screen.queryByText("Passwords don't match")).not.toBeInTheDocument()
  })

  it('shows each field error of a refused sign-up under its field', async () => {
    api.currentUser = signedOut()
    api.handleSignUp = () =>
      Response.json(
        { errors: { email: ['This email is already in use.'], password: ['Password must be at least 8 characters.'] } },
        { status: 400 },
      )
    const user = userEvent.setup()
    render(<App />)
    await landingPage()

    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    await fillIn(user, 'me@example.com', 'short')
    await confirmPassword(user, 'short')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(await screen.findByText('This email is already in use.')).toBeInTheDocument()
    expect(screen.getByText('Password must be at least 8 characters.')).toBeInTheDocument()
    expect(screen.getByLabelText(/^email/i)).toHaveValue('me@example.com')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('continues as the Guest and shows the app, signed in as Guest', async () => {
    api.currentUser = signedOut()
    const user = userEvent.setup()
    render(<App />)
    await landingPage()

    await user.click(screen.getByRole('button', { name: 'Continue as Guest' }))

    expect(await screen.findByRole('navigation')).toBeInTheDocument()
    const continueAsGuest = fetchMock.mock.calls.find(([url]) => url === '/api/user/continue-as-guest')
    expect(continueAsGuest?.[1]?.headers).toEqual({ 'Content-Type': 'application/json' })
    await user.click(screen.getByRole('button', { name: 'User' }))
    expect(screen.getByText(/signed in as/i)).toHaveTextContent('Signed in as Guest')
  })

  it('stays on the landing page, saying so, when continuing as the Guest fails', async () => {
    api.currentUser = signedOut()
    api.handleContinueAsGuest = () => new Response(null, { status: 500 })
    const user = userEvent.setup()
    render(<App />)
    await landingPage()

    await user.click(screen.getByRole('button', { name: 'Continue as Guest' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Continuing as Guest failed (500).')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('keeps the email but not the errors when switching between Sign in and Sign up', async () => {
    api.currentUser = signedOut()
    api.handleSignIn = () => Response.json({ detail: 'Wrong email or password.' }, { status: 401 })
    const user = userEvent.setup()
    render(<App />)
    await landingPage()
    await fillIn(user, 'me@example.com', 'wrong password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(await landingPage('Sign up')).toBeInTheDocument()
    expect(screen.getByText('Already signed up?', { exact: false })).toContainElement(
      screen.getByRole('button', { name: 'Sign in' }),
    )
    expect(screen.getByLabelText(/^email/i)).toHaveValue('me@example.com')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  describe('at the address of a page', () => {
    it.each(['/transactions', '/categories', '/rules', '/user', '/no-such-page'])(
      'shows the landing page at %s, leaving the address as it is',
      async (path) => {
        api.currentUser = signedOut()
        window.history.replaceState(null, '', path)
        render(<App />)

        expect(await landingPage()).toBeInTheDocument()
        expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
        expect(window.location.pathname).toBe(path)
      },
    )

    it('signs in to the page the address names', async () => {
      api.currentUser = signedOut()
      window.history.replaceState(null, '', '/rules')
      const user = userEvent.setup()
      render(<App />)
      await landingPage()

      await fillIn(user, 'me@example.com', 'my long passphrase')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))

      expect(await screen.findByRole('heading', { name: 'Categorization Rules' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Rules' })).toHaveAttribute('aria-current', 'page')
      expect(window.location.pathname).toBe('/rules')
    })

    it('signs up to the page the address names', async () => {
      api.currentUser = signedOut()
      window.history.replaceState(null, '', '/categories')
      const user = userEvent.setup()
      render(<App />)
      await landingPage()

      await user.click(screen.getByRole('button', { name: 'Sign up' }))
      await fillIn(user, 'new@example.com', 'my long passphrase')
      await confirmPassword(user, 'my long passphrase')
      await user.click(screen.getByRole('button', { name: 'Sign up' }))

      expect(await screen.findByText('All groceries.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Categories' })).toHaveAttribute('aria-current', 'page')
      expect(window.location.pathname).toBe('/categories')
    })

    it('continues as the Guest to the page the address names', async () => {
      api.currentUser = signedOut()
      window.history.replaceState(null, '', '/user')
      const user = userEvent.setup()
      render(<App />)
      await landingPage()

      await user.click(screen.getByRole('button', { name: 'Continue as Guest' }))

      expect(await screen.findByText(/signed in as/i)).toHaveTextContent('Signed in as Guest')
      expect(screen.getByRole('button', { name: 'User' })).toHaveAttribute('aria-current', 'page')
      expect(window.location.pathname).toBe('/user')
    })

    it("signs in on the Dashboard at the Dashboard's address from any other address", async () => {
      api.currentUser = signedOut()
      window.history.replaceState(null, '', '/no-such-page')
      const user = userEvent.setup()
      render(<App />)
      await landingPage()

      await fillIn(user, 'me@example.com', 'my long passphrase')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))

      expect(await screen.findByRole('button', { name: 'Add transaction' })).toBeVisible()
      expect(window.location.pathname).toBe('/')
    })

    it('keeps Sign in and Sign up one form at one address, adding no history entry on switching', async () => {
      api.currentUser = signedOut()
      window.history.replaceState(null, '', '/rules')
      const user = userEvent.setup()
      render(<App />)
      await landingPage()
      const entries = window.history.length

      await user.click(screen.getByRole('button', { name: 'Sign up' }))
      await landingPage('Sign up')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))
      await landingPage()

      expect(window.location.pathname).toBe('/rules')
      expect(window.history.length).toBe(entries)
    })
  })
})

describe('User page', () => {
  function userButton() {
    return screen.getByRole('button', { name: 'User' })
  }

  it('opens from the User entry, marked current, and says who is signed in', async () => {
    const user = userEvent.setup()
    await renderApp()
    expect(screen.queryByText(/signed in as/i)).not.toBeInTheDocument()

    await user.click(userButton())

    expect(userButton()).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'User' })).toBeInTheDocument()
    expect(screen.getByText(/signed in as/i)).toHaveTextContent('Signed in as me@example.com')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('says Signed in as Guest for the Guest', async () => {
    api.currentUser = guest
    const user = userEvent.setup()
    await renderApp()

    await user.click(userButton())

    expect(screen.getByText(/signed in as/i)).toHaveTextContent('Signed in as Guest')
    expect(screen.queryByText(guest.email)).not.toBeInTheDocument()
  })

  it("signs out to the landing page at the Dashboard's address, and signing in again starts afresh on the Dashboard", async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'Rules' }))

    await user.click(userButton())
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/user/sign-out', { method: 'POST' })
    expect(window.location.pathname).toBe('/')

    await user.type(screen.getByLabelText(/^email/i), 'me@example.com')
    await user.type(screen.getByLabelText(/^password/i), 'my long passphrase')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('navigation')
    expect(screen.getByRole('button', { name: 'Rules' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'Add transaction' })).toBeVisible()
  })

  it("puts the Dashboard's address in place of the page signed out on, so Back goes to the page before it", async () => {
    const user = userEvent.setup()
    await renderAppAt('/rules')
    await user.click(userButton())

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await screen.findByRole('heading', { name: 'Sign in' })
    expect(window.location.pathname).toBe('/')

    window.history.back()

    await waitFor(() => expect(window.location.pathname).toBe('/rules'))
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('sends none of the remaining Bank Statements of an Upload after signing out', async () => {
    const responders: ((response: Response) => void)[] = []
    api.handleUpload = () => new Promise((resolve) => responders.push(resolve))
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [statementPdf, statementPdf])
    await waitFor(() => expect(responders).toHaveLength(1))
    await user.click(userButton())
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await screen.findByRole('heading', { name: 'Sign in' })

    responders[0](Response.json(importedStatement, { status: 201 }))
    // Lets the finished upload's continuation run, which would send the next one.
    await act(async () => {})
    expect(responders).toHaveLength(1)
  })

  it('stays signed in, saying so, when signing out fails', async () => {
    api.handleSignOut = () => new Response(null, { status: 500 })
    const user = userEvent.setup()
    await renderApp()

    await user.click(userButton())
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Signing out failed. Try again.')
    expect(screen.getByRole('navigation')).toBeInTheDocument()
  })

  describe('Change password', () => {
    async function openUserPage(user: ReturnType<typeof userEvent.setup>) {
      await renderApp()
      await user.click(userButton())
    }

    async function fillIn(
      user: ReturnType<typeof userEvent.setup>,
      currentPassword: string,
      newPassword: string,
      confirmPassword = newPassword,
    ) {
      await user.type(screen.getByLabelText(/^current password/i), currentPassword)
      await user.type(screen.getByLabelText(/^new password/i), newPassword)
      await user.type(screen.getByLabelText(/^confirm password/i), confirmPassword)
      await user.click(screen.getByRole('button', { name: 'Change password' }))
    }

    function passwordRegion() {
      return screen.getByRole('region', { name: 'Change password' })
    }

    // The Change password status line, apart from the Delete data section's below it.
    function passwordStatus() {
      return within(passwordRegion()).findByRole('status')
    }

    function changePasswordRequests() {
      return fetchMock.mock.calls.filter(([url]) => url === '/api/user/change-password')
    }

    it('shows a form with the current password, a new one and the confirm field, and changes the password', async () => {
      const user = userEvent.setup()
      await openUserPage(user)

      expect(screen.getByLabelText(/^current password/i)).toHaveAttribute('autocomplete', 'current-password')
      expect(screen.getByLabelText(/^new password/i)).toHaveAttribute('autocomplete', 'new-password')
      expect(screen.getByLabelText(/^confirm password/i)).toHaveAttribute('autocomplete', 'new-password')
      await fillIn(user, 'my long passphrase', 'my new passphrase')

      expect(await passwordStatus()).toHaveTextContent('Password changed.')
      const [request] = changePasswordRequests()
      expect(request[1]?.headers).toEqual({ 'Content-Type': 'application/json' })
      expect(JSON.parse(request[1]?.body as string)).toEqual({
        currentPassword: 'my long passphrase',
        newPassword: 'my new passphrase',
      })
      expect(screen.getByText(/signed in as/i)).toHaveTextContent('Signed in as me@example.com')
    })

    it("says the new passwords don't match and sends nothing", async () => {
      const user = userEvent.setup()
      await openUserPage(user)

      await fillIn(user, 'my long passphrase', 'my new passphrase', 'my new passphrse')

      expect(screen.getByLabelText(/^confirm password/i).closest('label')).toHaveTextContent("Passwords don't match")
      expect(changePasswordRequests()).toHaveLength(0)
    })

    it('shows each field error of a refused change under its field, keeping the form open', async () => {
      api.handleChangePassword = () =>
        Response.json(
          {
            errors: {
              currentPassword: ['Wrong password.'],
              newPassword: ['Password must be at least 8 characters.'],
            },
          },
          { status: 400 },
        )
      const user = userEvent.setup()
      await openUserPage(user)

      await fillIn(user, 'wrong password', 'short')

      expect(await screen.findByText('Wrong password.')).toBeInTheDocument()
      expect(screen.getByLabelText(/^current password/i).closest('label')).toHaveTextContent('Wrong password.')
      expect(screen.getByLabelText(/^new password/i).closest('label')).toHaveTextContent(
        'Password must be at least 8 characters.',
      )
      expect(screen.getByRole('button', { name: 'Change password' })).toBeEnabled()
      expect(within(passwordRegion()).getByRole('status')).toHaveTextContent('')
    })

    it('says so when the email is locked, with the message Sign in gives', async () => {
      const locked = 'Too many failed sign-ins, so this email is locked for a few minutes. Try again later.'
      api.handleChangePassword = () => Response.json({ detail: locked }, { status: 429 })
      const user = userEvent.setup()
      await openUserPage(user)

      await fillIn(user, 'my long passphrase', 'my new passphrase')

      expect(await screen.findByRole('alert')).toHaveTextContent(locked)
      expect(screen.getByLabelText(/^current password/i)).toBeInTheDocument()
    })

    it('empties the fields after a change, and shows Password changed. until the next action', async () => {
      const user = userEvent.setup()
      await openUserPage(user)
      await fillIn(user, 'my long passphrase', 'my new passphrase')
      expect(await passwordStatus()).toHaveTextContent('Password changed.')

      expect(screen.getByLabelText(/^current password/i)).toHaveValue('')
      expect(screen.getByLabelText(/^new password/i)).toHaveValue('')
      expect(screen.getByLabelText(/^confirm password/i)).toHaveValue('')
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()

      await user.type(screen.getByLabelText(/^current password/i), 'm')

      expect(within(passwordRegion()).getByRole('status')).toHaveTextContent('')
    })

    it('is shown to the Guest with every field and the button disabled', async () => {
      api.currentUser = guest
      const user = userEvent.setup()
      await renderApp()

      await user.click(userButton())

      expect(screen.getByLabelText(/^current password/i)).toBeDisabled()
      expect(screen.getByLabelText(/^new password/i)).toBeDisabled()
      expect(screen.getByLabelText(/^confirm password/i)).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled()
    })
  })
})

describe('Guest notice', () => {
  function guestNotice() {
    return screen.queryByRole('note', { name: 'Guest' })
  }

  it('tells the Guest to use only test data, on every page', async () => {
    api.currentUser = guest
    const user = userEvent.setup()
    await renderApp()

    expect(guestNotice()).toHaveTextContent('Demo mode: only use test data.')
    await user.click(screen.getByRole('button', { name: 'Rules' }))
    expect(guestNotice()).toBeInTheDocument()
  })

  it('is not shown to a User who signed up', async () => {
    await renderApp()

    expect(guestNotice()).not.toBeInTheDocument()
  })

  it('goes with the Guest when the Guest signs out and a User signs in', async () => {
    api.currentUser = guest
    const user = userEvent.setup()
    await renderApp()

    await user.click(screen.getByRole('button', { name: 'User' }))
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await user.type(await screen.findByLabelText(/^email/i), 'me@example.com')
    await user.type(screen.getByLabelText(/^password/i), 'my long passphrase')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('navigation')

    expect(guestNotice()).not.toBeInTheDocument()
  })
})

describe('Appearance', () => {
  async function openUserPage() {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'User' }))
    return user
  }

  function appearance() {
    return within(screen.getByRole('radiogroup', { name: 'Appearance' }))
  }

  function isDark() {
    return document.documentElement.classList.contains('dark')
  }

  it('is Light until something is picked, even on a dark device', async () => {
    deviceSetting(true)
    await openUserPage()

    expect(appearance().getByRole('radio', { name: 'Light' })).toBeChecked()
    expect(isDark()).toBe(false)
  })

  it('applies Dark at once, and remembers it in this browser, through Sign out to the landing page', async () => {
    const user = await openUserPage()

    await user.click(appearance().getByRole('radio', { name: 'Dark' }))
    expect(isDark()).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(isDark()).toBe(true)
  })

  it('opens again in the remembered choice', async () => {
    const user = await openUserPage()
    await user.click(appearance().getByRole('radio', { name: 'Dark' }))
    // As a reload: the app gone, and the page not yet dark.
    cleanup()
    document.documentElement.classList.remove('dark')

    await openUserPage()

    expect(isDark()).toBe(true)
    expect(appearance().getByRole('radio', { name: 'Dark' })).toBeChecked()
  })

  it('follows the device for System, and switches when it does, which Light and Dark ignore', async () => {
    const device = deviceSetting(true)
    const user = await openUserPage()

    await user.click(appearance().getByRole('radio', { name: 'System' }))
    expect(isDark()).toBe(true)
    device.change(false)
    expect(isDark()).toBe(false)

    await user.click(appearance().getByRole('radio', { name: 'Dark' }))
    expect(isDark()).toBe(true)
    device.change(true)
    device.change(false)
    expect(isDark()).toBe(true)

    await user.click(appearance().getByRole('radio', { name: 'Light' }))
    device.change(true)
    expect(isDark()).toBe(false)
  })

  describe('before signing in', () => {
    // Signed out, with a pick made earlier in this browser and the page opened not yet dark.
    beforeEach(() => {
      api.currentUser = new Response(null, { status: 401 })
      localStorage.setItem('appearance', 'dark')
    })

    afterEach(() => {
      window.history.replaceState(null, '', '/')
    })

    it('opens the landing page in the pick made earlier in this browser', async () => {
      render(<App />)

      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
      expect(isDark()).toBe(true)
    })

    it('opens Choose a new password, from the link in a reset email, in the pick made earlier', async () => {
      window.history.replaceState(null, '', '/reset-password?email=me%40example.com&token=dG9rZW4')
      render(<App />)

      expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument()
      expect(isDark()).toBe(true)
    })
  })
})

describe('Password reset', () => {
  const ANSWER = "Email sent. The link is active for 1 hour."

  async function renderLandingPage() {
    api.currentUser = new Response(null, { status: 401 })
    render(<App />)
    await screen.findByRole('heading', { name: 'Sign in' })
  }

  function passwordResetLink() {
    return screen.queryByRole('button', { name: 'Forgot your password?' })
  }

  // The form that asks for a link to choose a new password.
  function resetForm() {
    return screen.getByRole('region', { name: 'Reset your password' })
  }

  it('offers "Forgot your password?" under Sign in when Password reset is available', async () => {
    api.passwordResetAvailability = { available: true, linkHours: 1 }
    await renderLandingPage()

    expect(await screen.findByRole('button', { name: 'Forgot your password?' })).toBeInTheDocument()
  })

  it.each([
    ['unavailable', { available: false, linkHours: 1 }],
    ['unknown', new Response(null, { status: 500 })],
  ])('offers no "Forgot your password?" when Password reset is %s', async (_, availability) => {
    api.passwordResetAvailability = availability
    await renderLandingPage()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/user/password-reset/availability'))
    await act(async () => {})
    expect(passwordResetLink()).not.toBeInTheDocument()
  })

  it('offers "Forgot your password?" under Sign in only, not Sign up', async () => {
    api.passwordResetAvailability = { available: true, linkHours: 1 }
    const user = userEvent.setup()
    await renderLandingPage()
    await screen.findByRole('button', { name: 'Forgot your password?' })

    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(await screen.findByRole('heading', { name: 'Sign up' })).toBeInTheDocument()
    expect(passwordResetLink()).not.toBeInTheDocument()
  })

  it('asks for a link to the email typed into Sign in, and gives the same answer whatever the email', async () => {
    api.passwordResetAvailability = { available: true, linkHours: 1 }
    const user = userEvent.setup()
    await renderLandingPage()
    await user.type(screen.getByLabelText(/^email/i), 'me@example.com')

    await user.click(await screen.findByRole('button', { name: 'Forgot your password?' }))

    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
    expect(within(resetForm()).getByLabelText(/^email/i)).toHaveValue('me@example.com')
    expect(within(resetForm()).queryByLabelText(/^password/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Send link' }))

    expect(await screen.findByRole('status')).toHaveTextContent(ANSWER)
    const request = fetchMock.mock.calls.find(([url]) => url === '/api/user/password-reset/request')
    expect(request?.[1]?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(request?.[1]?.body as string)).toEqual({ email: 'me@example.com' })
  })

  it('says how long the link works as the server says it', async () => {
    api.passwordResetAvailability = { available: true, linkHours: 2 }
    const user = userEvent.setup()
    await renderLandingPage()
    await user.click(await screen.findByRole('button', { name: 'Forgot your password?' }))

    await user.click(screen.getByRole('button', { name: 'Send link' }))

    expect(await screen.findByRole('status')).toHaveTextContent('The link is active for 2 hours.')
  })

  it('shows the field error of a refused request under the email', async () => {
    api.passwordResetAvailability = { available: true, linkHours: 1 }
    api.handleRequestPasswordReset = () => Response.json({ errors: { email: ['Email is required.'] } }, { status: 400 })
    const user = userEvent.setup()
    await renderLandingPage()
    await user.click(await screen.findByRole('button', { name: 'Forgot your password?' }))

    await user.click(screen.getByRole('button', { name: 'Send link' }))

    expect(await screen.findByText('Email is required.')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('goes back to Sign in with the email typed in', async () => {
    api.passwordResetAvailability = { available: true, linkHours: 1 }
    const user = userEvent.setup()
    await renderLandingPage()
    await user.click(await screen.findByRole('button', { name: 'Forgot your password?' }))
    await user.type(within(resetForm()).getByLabelText(/^email/i), 'me@example.com')

    await user.click(screen.getByRole('button', { name: 'Back to Sign in' }))

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^email/i)).toHaveValue('me@example.com')
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument()
  })

  it.each([
    [true, 'Too many failed sign-ins, so this email is locked for a few minutes. Try again later, or reset your password.'],
    [false, 'Too many failed sign-ins, so this email is locked for a few minutes. Try again later.'],
  ])('says a locked email can be reset only when Password reset is available (%s)', async (available, message) => {
    api.passwordResetAvailability = { available, linkHours: 1 }
    api.handleSignIn = () =>
      Response.json(
        { detail: 'Too many failed sign-ins, so this email is locked for a few minutes. Try again later.' },
        { status: 429 },
      )
    const user = userEvent.setup()
    await renderLandingPage()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/user/password-reset/availability'))
    await act(async () => {})

    await user.type(screen.getByLabelText(/^email/i), 'me@example.com')
    await user.type(screen.getByLabelText(/^password/i), 'wrong password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect((await screen.findByRole('alert')).textContent).toBe(message)
  })

  it('says nothing about resetting for a wrong password, even when Password reset is available', async () => {
    api.passwordResetAvailability = { available: true, linkHours: 1 }
    api.handleSignIn = () => Response.json({ detail: 'Wrong email or password.' }, { status: 401 })
    const user = userEvent.setup()
    await renderLandingPage()
    await screen.findByRole('button', { name: 'Forgot your password?' })

    await user.type(screen.getByLabelText(/^email/i), 'me@example.com')
    await user.type(screen.getByLabelText(/^password/i), 'wrong password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Wrong email or password.')
  })

  describe('choosing a new password from the link', () => {
    const EXPIRED = 'This link has expired or was already used.'

    // Opens the app at the link from a reset email, as following it in the email does.
    function followLink(query = '?email=me%40example.com&token=dG9rZW4') {
      window.history.replaceState(null, '', `/reset-password${query}`)
      render(<App />)
    }

    afterEach(() => {
      window.history.replaceState(null, '', '/')
    })

    function choosePage() {
      return screen.findByRole('heading', { name: 'Choose a new password' })
    }

    async function choose(user: ReturnType<typeof userEvent.setup>, password: string, confirmPassword = password) {
      await user.type(screen.getByLabelText(/^new password/i), password)
      await user.type(screen.getByLabelText(/^confirm password/i), confirmPassword)
      await user.click(screen.getByRole('button', { name: 'Set new password' }))
    }

    function newPasswordRequests() {
      return fetchMock.mock.calls.filter(([url]) => url === '/api/user/password-reset/new-password')
    }

    // Who is signed in makes no difference, so the page never asks.
    it.each([
      ['signed out', new Response(null, { status: 401 })],
      ['signed in', { email: 'someone-else@example.com', isGuest: false }],
      ['signed in as the Guest', guest],
    ])('shows the Choose a new password page when %s', async (_, signedIn) => {
      api.currentUser = signedIn
      followLink()

      expect(await choosePage()).toBeInTheDocument()
      expect(screen.getByText('me@example.com', { exact: false })).toBeInTheDocument()
      expect(screen.getByLabelText(/^new password/i)).toHaveAttribute('autocomplete', 'new-password')
      expect(screen.getByLabelText(/^confirm password/i)).toHaveAttribute('autocomplete', 'new-password')
      expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
      expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
      expect(fetchMock).not.toHaveBeenCalledWith('/api/user')
    })

    it("says the passwords don't match and sends nothing", async () => {
      const user = userEvent.setup()
      followLink()
      await choosePage()

      await choose(user, 'my new passphrase', 'my new passphrse')

      expect(screen.getByText("Passwords don't match")).toBeInTheDocument()
      expect(newPasswordRequests()).toHaveLength(0)
    })

    it('sets the new password with the email and token from the link, and shows the app as the User at /', async () => {
      api.currentUser = new Response(null, { status: 401 })
      const user = userEvent.setup()
      followLink()
      await choosePage()

      await choose(user, 'my new passphrase')

      expect(await screen.findByRole('navigation')).toBeInTheDocument()
      expect(window.location.pathname).toBe('/')
      expect(window.location.search).toBe('')
      const [request] = newPasswordRequests()
      expect(request[1]?.headers).toEqual({ 'Content-Type': 'application/json' })
      expect(JSON.parse(request[1]?.body as string)).toEqual({
        email: 'me@example.com',
        token: 'dG9rZW4',
        password: 'my new passphrase',
      })
      await user.click(screen.getByRole('button', { name: 'User' }))
      expect(screen.getByText(/signed in as/i)).toHaveTextContent('Signed in as me@example.com')
      expect(fetchMock).not.toHaveBeenCalledWith('/api/user')
    })

    it('shows a refused password under the field, and the link still works', async () => {
      api.handleChooseNewPassword = () =>
        Response.json({ errors: { password: ['Password must be at least 8 characters.'] } }, { status: 400 })
      const user = userEvent.setup()
      followLink()
      await choosePage()

      await choose(user, 'short')

      expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Set new password' })).toBeEnabled()
    })

    it('offers to send a new link to the email from an expired link, and sends it', async () => {
      api.passwordResetAvailability = { available: true, linkHours: 1 }
      api.handleChooseNewPassword = () => Response.json({ detail: EXPIRED }, { status: 410 })
      const user = userEvent.setup()
      followLink()
      await choosePage()

      await choose(user, 'my new passphrase')

      expect(await screen.findByText(EXPIRED)).toBeInTheDocument()
      expect(screen.queryByLabelText(/^new password/i)).not.toBeInTheDocument()
      await user.click(await screen.findByRole('button', { name: 'Send a new link' }))

      expect(await screen.findByRole('status')).toHaveTextContent(ANSWER)
      const request = fetchMock.mock.calls.find(([url]) => url === '/api/user/password-reset/request')
      expect(JSON.parse(request?.[1]?.body as string)).toEqual({ email: 'me@example.com' })
    })

    it.each([
      ['no token', '?email=me%40example.com'],
      ['an empty token', '?email=me%40example.com&token='],
    ])('treats a link with %s as expired, and offers a new one', async (_, query) => {
      api.passwordResetAvailability = { available: true, linkHours: 1 }
      const user = userEvent.setup()
      followLink(query)

      expect(await screen.findByText(EXPIRED)).toBeInTheDocument()
      expect(screen.queryByLabelText(/^new password/i)).not.toBeInTheDocument()
      await user.click(await screen.findByRole('button', { name: 'Send a new link' }))

      expect(await screen.findByRole('status')).toHaveTextContent(ANSWER)
      expect(newPasswordRequests()).toHaveLength(0)
    })

    // With no email to send it to, a new link is asked for from Sign in.
    it('treats a link with no email as expired, and goes to Sign in for a new one', async () => {
      api.passwordResetAvailability = { available: true, linkHours: 1 }
      api.currentUser = new Response(null, { status: 401 })
      const user = userEvent.setup()
      followLink('?token=dG9rZW4')

      expect(await screen.findByText(EXPIRED)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Send a new link' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Back to Sign in' }))

      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
      expect(window.location.pathname).toBe('/')
      expect(await screen.findByRole('button', { name: 'Forgot your password?' })).toBeInTheDocument()
    })
  })
})

describe('Delete data', () => {
  const august = {
    id: 3,
    accountNumber: '1111.22.33333',
    periodStart: '2026-08-01',
    periodEnd: '2026-08-31',
    importedOn: '2026-09-02',
    transactionCount: 1000,
  }
  const augustOfSavings = {
    id: 5,
    accountNumber: '4444.55.66666',
    periodStart: '2026-08-01',
    periodEnd: '2026-08-31',
    importedOn: '2026-09-02',
    transactionCount: 32,
  }
  const july = {
    id: 1,
    accountNumber: '1111.22.33333',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    importedOn: '2026-08-04',
    transactionCount: 1,
  }

  async function openUserPage() {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'User' }))
    return user
  }

  // The section as a whole, whose one status line or error is for whichever delete ran last.
  function deleteData() {
    return within(screen.getByRole('region', { name: 'Delete data' }))
  }

  function transactionsCard() {
    return within(screen.getByRole('region', { name: 'Delete Transactions' }))
  }

  // The toggle the Bank Statement list is collapsed behind, once it has loaded and counted them.
  function bankStatementsToggle() {
    return transactionsCard().findByRole('button', { name: /^Bank Statements \(/ })
  }

  // Opens the User page with the Bank Statement list expanded.
  async function openBankStatementList() {
    const user = await openUserPage()
    await user.click(await bankStatementsToggle())
    return user
  }

  // Each listed Bank Statement as its checkbox names it.
  async function listedBankStatements() {
    await transactionsCard().findAllByRole('checkbox')
    return transactionsCard()
      .getAllByRole('checkbox')
      .map((checkbox) => checkbox.closest('label')?.textContent)
  }

  function deleteSelected() {
    return transactionsCard().getByRole('button', { name: 'Delete selected' })
  }

  function deleteAllTransactions() {
    return transactionsCard().getByRole('button', { name: 'Delete all' })
  }

  function deleteAllRules() {
    return within(screen.getByRole('region', { name: 'Delete Categorization Rules' })).getByRole('button', {
      name: 'Delete all',
    })
  }

  it('keeps the Bank Statements collapsed on opening, counting them, and lists them from the toggle', async () => {
    api.bankStatements = [august, july]
    const user = await openUserPage()

    const toggle = await bankStatementsToggle()
    expect(toggle).toHaveAccessibleName('Bank Statements (2)')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(transactionsCard().queryAllByRole('checkbox')).toHaveLength(0)

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(transactionsCard().getAllByRole('checkbox')).toHaveLength(2)
  })

  it('says how many are ticked on the toggle, and keeps the ticks while collapsed', async () => {
    api.bankStatements = [august, july]
    const user = await openUserPage()
    const toggle = await bankStatementsToggle()
    await user.click(toggle)

    await user.click(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ }))
    expect(toggle).toHaveAccessibleName('Bank Statements (2, 1 selected)')
    await user.click(toggle)

    expect(transactionsCard().queryAllByRole('checkbox')).toHaveLength(0)
    await user.click(deleteSelected())
    expect(transactionsCard().getByText('Delete 1 Bank Statement and its 1 Transaction?')).toBeInTheDocument()
    await user.click(transactionsCard().getByRole('button', { name: 'Cancel' }))
    await user.click(toggle)
    expect(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ })).toBeChecked()
  })

  it('keeps the list collapsed after a delete when it was collapsed', async () => {
    api.bankStatements = [august, july]
    api.handleDeleteBankStatements = () => {
      api.bankStatements = [august]
      return Response.json({ bankStatementsDeleted: 1, transactionsDeleted: 1 })
    }
    const user = await openBankStatementList()
    await user.click(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ }))
    await user.click(await bankStatementsToggle())

    await user.click(deleteSelected())
    await user.click(transactionsCard().getByRole('button', { name: 'Confirm delete' }))
    await deleteData().findByText('1 Bank Statement deleted.')

    await waitFor(async () => expect(await bankStatementsToggle()).toHaveAccessibleName('Bank Statements (1)'))
    expect(await bankStatementsToggle()).toHaveAttribute('aria-expanded', 'false')
    expect(transactionsCard().queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('shows Delete all beside Delete selected while the list is collapsed', async () => {
    api.bankStatements = [july]
    await openUserPage()
    await bankStatementsToggle()

    expect(deleteSelected()).toBeDisabled()
    expect(deleteAllTransactions()).toBeInTheDocument()
  })

  it('lists the Bank Statements as served, with account number, period, import date and Transactions', async () => {
    api.bankStatements = [august, augustOfSavings, july]
    await openBankStatementList()

    expect(await listedBankStatements()).toEqual([
      '1111.22.3333301.08.2026–31.08.2026Imported 02.09.20261\u00a0000 Transactions',
      '4444.55.6666601.08.2026–31.08.2026Imported 02.09.202632 Transactions',
      '1111.22.3333301.07.2026–31.07.2026Imported 04.08.20261 Transaction',
    ])
    expect(fetchMock).toHaveBeenCalledWith('/api/bank-statements', undefined)
  })

  it('says there are none instead of the toggle when there are no Bank Statements, with Delete selected disabled', async () => {
    await openUserPage()

    expect(await transactionsCard().findByText('There are no Bank Statements.')).toBeInTheDocument()
    expect(transactionsCard().queryByRole('button', { name: /^Bank Statements/ })).not.toBeInTheDocument()
    expect(deleteSelected()).toBeDisabled()
  })

  it('says so instead of the toggle when the Bank Statements could not be loaded', async () => {
    api.bankStatements = new Response(null, { status: 500 })
    await openUserPage()

    expect(await transactionsCard().findByRole('alert')).toHaveTextContent('Could not load the Bank Statements.')
    expect(transactionsCard().queryByRole('button', { name: /^Bank Statements/ })).not.toBeInTheDocument()
    expect(transactionsCard().queryByText('There are no Bank Statements.')).not.toBeInTheDocument()
  })

  it('keeps Delete selected disabled until a Bank Statement is ticked', async () => {
    api.bankStatements = [august, july]
    const user = await openBankStatementList()
    expect(deleteSelected()).toBeDisabled()

    await user.click(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ }))
    expect(deleteSelected()).toBeEnabled()

    await user.click(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ }))
    expect(deleteSelected()).toBeDisabled()
  })

  it('asks with the counts, then deletes the ticked Bank Statements, says so and lists those left', async () => {
    api.bankStatements = [august, augustOfSavings, july]
    let deleted: number[] | undefined
    api.handleDeleteBankStatements = ({ ids }) => {
      deleted = ids
      api.bankStatements = [july]
      return Response.json({ bankStatementsDeleted: 2, transactionsDeleted: 1032 })
    }
    const user = await openBankStatementList()

    await user.click(transactionsCard().getByRole('checkbox', { name: /^1111\.22\.3333301\.08/ }))
    await user.click(transactionsCard().getByRole('checkbox', { name: /^4444\.55\.66666/ }))
    await user.click(deleteSelected())

    expect(deleted).toBeUndefined()
    expect(
      // The matcher reads the non-breaking space nb-NO groups thousands with as a space.
      transactionsCard().getByText('Delete 2 Bank Statements and their 1 032 Transactions?'),
    ).toBeInTheDocument()

    await user.click(transactionsCard().getByRole('button', { name: 'Confirm delete' }))

    expect(deleted).toEqual([3, 5])
    expect(await deleteData().findByRole('status')).toHaveTextContent('2 Bank Statements deleted.')
    await waitFor(async () =>
      expect(await listedBankStatements()).toEqual(['1111.22.3333301.07.2026–31.07.2026Imported 04.08.20261 Transaction']),
    )
    expect(transactionsCard().queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument()
    expect(deleteSelected()).toBeDisabled()
    // Stays until the next action.
    expect(deleteData().getByRole('status')).toHaveTextContent('2 Bank Statements deleted.')
    await user.click(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ }))
    expect(deleteData().getByRole('status')).toBeEmptyDOMElement()
  })

  it('words the question for one Bank Statement of one Transaction', async () => {
    api.bankStatements = [august, july]
    const user = await openBankStatementList()

    await user.click(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ }))
    await user.click(deleteSelected())

    expect(transactionsCard().getByText('Delete 1 Bank Statement and its 1 Transaction?')).toBeInTheDocument()
  })

  it('deletes nothing when the question is cancelled, keeping the ticks', async () => {
    api.bankStatements = [august, july]
    let deleted = false
    api.handleDeleteBankStatements = () => {
      deleted = true
      return Response.json({ bankStatementsDeleted: 1, transactionsDeleted: 1 })
    }
    const user = await openBankStatementList()

    await user.click(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ }))
    await user.click(deleteSelected())
    await user.click(transactionsCard().getByRole('button', { name: 'Cancel' }))

    expect(deleted).toBe(false)
    expect(transactionsCard().queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument()
    expect(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ })).toBeChecked()
  })

  it('says so when the delete fails, leaving the list and the ticks as they were', async () => {
    api.bankStatements = [august, july]
    api.handleDeleteBankStatements = () => new Response(null, { status: 500 })
    const user = await openBankStatementList()

    await user.click(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ }))
    await user.click(deleteSelected())
    await user.click(transactionsCard().getByRole('button', { name: 'Confirm delete' }))

    expect(await deleteData().findByRole('alert')).toHaveTextContent('Deleting failed (500).')
    expect(await listedBankStatements()).toHaveLength(2)
    expect(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ })).toBeChecked()
    expect(deleteSelected()).toBeEnabled()
  })

  it('lists again after a refused delete, so a Bank Statement deleted elsewhere is no longer offered', async () => {
    api.bankStatements = [august, july]
    api.handleDeleteBankStatements = () => {
      // Deleted meanwhile in another browser, as by another visitor using the Guest.
      api.bankStatements = [august]
      return Response.json(
        { errors: { ids: ['A Bank Statement to delete no longer exists. Nothing was deleted.'] } },
        { status: 400 },
      )
    }
    const user = await openBankStatementList()

    await user.click(transactionsCard().getByRole('checkbox', { name: /^1111\.22\.3333301\.08/ }))
    await user.click(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ }))
    await user.click(deleteSelected())
    await user.click(transactionsCard().getByRole('button', { name: 'Confirm delete' }))

    expect(await deleteData().findByRole('alert')).toHaveTextContent(
      'A Bank Statement to delete no longer exists. Nothing was deleted.',
    )
    await waitFor(() => expect(transactionsCard().getAllByRole('checkbox')).toHaveLength(1))
    expect(transactionsCard().getByRole('checkbox', { name: /^1111\.22\.3333301\.08/ })).toBeChecked()
  })

  it('asks with the count of every Transaction, then deletes them all, says how many and lists what is left', async () => {
    api.bankStatements = [august, augustOfSavings]
    api.deleteCounts = { transactionCount: 1032 }
    let deleted = false
    api.handleDeleteAllTransactions = () => {
      deleted = true
      api.bankStatements = []
      api.deleteCounts = { transactionCount: 0 }
      return Response.json({ transactionsDeleted: 1032 })
    }
    const user = await openUserPage()
    await waitFor(() => expect(deleteAllTransactions()).toBeEnabled())

    await user.click(deleteAllTransactions())

    expect(deleted).toBe(false)
    expect(deleteData().getByText('Delete all 1 032 Transactions?')).toBeInTheDocument()

    await user.click(deleteData().getByRole('button', { name: 'Confirm delete' }))

    expect(deleted).toBe(true)
    expect(await deleteData().findByRole('status')).toHaveTextContent('1 032 Transactions deleted.')
    expect(await transactionsCard().findByText('There are no Bank Statements.')).toBeInTheDocument()
    await waitFor(() => expect(deleteAllTransactions()).toBeDisabled())
    expect(deleteData().queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument()
  })

  it('words the question and the status line for one Transaction', async () => {
    api.deleteCounts = { transactionCount: 1 }
    api.handleDeleteAllTransactions = () => Response.json({ transactionsDeleted: 1 })
    const user = await openUserPage()
    await waitFor(() => expect(deleteAllTransactions()).toBeEnabled())

    await user.click(deleteAllTransactions())
    expect(deleteData().getByText('Delete all 1 Transaction?')).toBeInTheDocument()
    await user.click(deleteData().getByRole('button', { name: 'Confirm delete' }))

    expect(await deleteData().findByRole('status')).toHaveTextContent('1 Transaction deleted.')
  })

  it('disables Delete all Transactions when there are none', async () => {
    await openUserPage()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/user/delete-counts', undefined))
    await transactionsCard().findByText('There are no Bank Statements.')
    expect(deleteAllTransactions()).toBeDisabled()
  })

  it('keeps Delete all Transactions disabled, saying so, when counting them again fails', async () => {
    api.bankStatements = [july]
    api.deleteCounts = { transactionCount: 1001 }
    api.handleDeleteBankStatements = () => {
      api.deleteCounts = new Response(null, { status: 500 })
      return Response.json({ bankStatementsDeleted: 1, transactionsDeleted: 1 })
    }
    const user = await openBankStatementList()
    await waitFor(() => expect(deleteAllTransactions()).toBeEnabled())

    await user.click(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ }))
    await user.click(deleteSelected())
    await user.click(transactionsCard().getByRole('button', { name: 'Confirm delete' }))

    expect(await deleteData().findByText('Could not count the Transactions.')).toBeInTheDocument()
    expect(deleteAllTransactions()).toBeDisabled()
  })

  it('counts the Transactions again after deleting Bank Statements', async () => {
    api.bankStatements = [august, july]
    api.deleteCounts = { transactionCount: 1001 }
    api.handleDeleteBankStatements = () => {
      api.bankStatements = [august]
      api.deleteCounts = { transactionCount: 1000 }
      return Response.json({ bankStatementsDeleted: 1, transactionsDeleted: 1 })
    }
    const user = await openBankStatementList()

    await user.click(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ }))
    await user.click(deleteSelected())
    await user.click(transactionsCard().getByRole('button', { name: 'Confirm delete' }))
    await deleteData().findByText('1 Bank Statement deleted.')
    await user.click(deleteAllTransactions())

    expect(await deleteData().findByText('Delete all 1 000 Transactions?')).toBeInTheDocument()
  })

  it('says so when deleting all Transactions fails, leaving them to try again', async () => {
    api.bankStatements = [july]
    api.deleteCounts = { transactionCount: 1 }
    api.handleDeleteAllTransactions = () => new Response(null, { status: 500 })
    const user = await openBankStatementList()
    await waitFor(() => expect(deleteAllTransactions()).toBeEnabled())

    await user.click(deleteAllTransactions())
    await user.click(deleteData().getByRole('button', { name: 'Confirm delete' }))

    expect(await deleteData().findByRole('alert')).toHaveTextContent('Deleting failed (500).')
    expect(await listedBankStatements()).toHaveLength(1)
    expect(deleteAllTransactions()).toBeEnabled()
  })

  it('asks with the counts of rules and of the Transactions they categorized, then deletes them all and says how many', async () => {
    api.deleteCounts = { ruleCount: 1148, ruleCategorizedTransactionCount: 1310 }
    let deleted = false
    api.handleDeleteAllRules = () => {
      deleted = true
      api.deleteCounts = { ruleCount: 0, ruleCategorizedTransactionCount: 0 }
      return Response.json({ rulesDeleted: 1148 })
    }
    const user = await openUserPage()
    await waitFor(() => expect(deleteAllRules()).toBeEnabled())

    await user.click(deleteAllRules())

    expect(deleted).toBe(false)
    expect(
      deleteData().getByText('Delete all 1 148 Categorization Rules? 1 310 Transactions will become Uncategorized.'),
    ).toBeInTheDocument()

    await user.click(deleteData().getByRole('button', { name: 'Confirm delete' }))

    expect(deleted).toBe(true)
    expect(await deleteData().findByRole('status')).toHaveTextContent('1 148 Categorization Rules deleted.')
    await waitFor(() => expect(deleteAllRules()).toBeDisabled())
    expect(deleteData().queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument()
  })

  it('words the question and the status line for one rule and one Transaction', async () => {
    api.deleteCounts = { ruleCount: 1, ruleCategorizedTransactionCount: 1 }
    api.handleDeleteAllRules = () => Response.json({ rulesDeleted: 1 })
    const user = await openUserPage()
    await waitFor(() => expect(deleteAllRules()).toBeEnabled())

    await user.click(deleteAllRules())
    expect(
      deleteData().getByText('Delete all 1 Categorization Rule? 1 Transaction will become Uncategorized.'),
    ).toBeInTheDocument()
    await user.click(deleteData().getByRole('button', { name: 'Confirm delete' }))

    expect(await deleteData().findByRole('status')).toHaveTextContent('1 Categorization Rule deleted.')
  })

  it('asks only about the rules when deleting them makes no Transaction Uncategorized', async () => {
    api.deleteCounts = { ruleCount: 2, ruleCategorizedTransactionCount: 0 }
    const user = await openUserPage()
    await waitFor(() => expect(deleteAllRules()).toBeEnabled())

    await user.click(deleteAllRules())

    // The whole question, with no sentence saying 0 will become Uncategorized.
    expect(deleteData().getByText('Delete all 2 Categorization Rules?')).toBeInTheDocument()
  })

  it('keeps Delete all Categorization Rules disabled after another delete until the rules are counted again', async () => {
    api.deleteCounts = { transactionCount: 5, ruleCount: 3, ruleCategorizedTransactionCount: 2 }
    let respond: (response: Response) => void = () => {}
    api.handleDeleteAllTransactions = () => {
      api.deleteCounts = new Promise((resolve) => (respond = resolve))
      return Response.json({ transactionsDeleted: 5 })
    }
    const user = await openUserPage()
    await waitFor(() => expect(deleteAllRules()).toBeEnabled())

    await user.click(deleteAllTransactions())
    await user.click(deleteData().getByRole('button', { name: 'Confirm delete' }))
    await deleteData().findByText('5 Transactions deleted.')

    // Asking now would say 2 Transactions will become Uncategorized, though they were just deleted.
    expect(deleteAllRules()).toBeDisabled()
    respond(Response.json({ transactionCount: 0, ruleCount: 3, ruleCategorizedTransactionCount: 0 }))
    await waitFor(() => expect(deleteAllRules()).toBeEnabled())
    await user.click(deleteAllRules())
    expect(deleteData().getByText('Delete all 3 Categorization Rules?')).toBeInTheDocument()
  })

  it('disables Delete all Categorization Rules when there are none', async () => {
    api.deleteCounts = { transactionCount: 1 }
    await openUserPage()

    await waitFor(() => expect(deleteAllTransactions()).toBeEnabled())
    expect(deleteAllRules()).toBeDisabled()
  })

  it('keeps Delete all Categorization Rules disabled, saying so, when counting them fails', async () => {
    api.deleteCounts = new Response(null, { status: 500 })
    await openUserPage()

    expect(await deleteData().findByText('Could not count the Categorization Rules.')).toBeInTheDocument()
    expect(deleteAllRules()).toBeDisabled()
  })

  it('disables deleting while an Upload is in progress, saying why, and enables it once it finishes', async () => {
    api.bankStatements = [july]
    api.deleteCounts = { ruleCount: 148 }
    let respond: (response: Response) => void = () => {}
    api.handleUpload = () => new Promise((resolve) => (respond = resolve))
    const user = userEvent.setup()
    await renderApp()
    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)
    await user.click(screen.getByRole('button', { name: 'User' }))
    await user.click(await bankStatementsToggle())
    await listedBankStatements()

    await user.click(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ }))
    expect(deleteSelected()).toBeDisabled()
    expect(deleteAllTransactions()).toBeDisabled()
    expect(deleteAllRules()).toBeDisabled()
    expect(deleteData().getByText('Deleting waits for the Upload in progress to finish.')).toBeInTheDocument()

    // The Upload imported a Bank Statement, which the list and the counts then show.
    api.bankStatements = [august, july]
    api.deleteCounts = { transactionCount: 1001, ruleCount: 148 }
    respond(Response.json(importedStatement, { status: 201 }))

    await waitFor(() => expect(deleteSelected()).toBeEnabled())
    await waitFor(() => expect(deleteAllTransactions()).toBeEnabled())
    await waitFor(() => expect(deleteAllRules()).toBeEnabled())
    expect(deleteData().queryByText('Deleting waits for the Upload in progress to finish.')).not.toBeInTheDocument()
    await waitFor(async () => expect(await listedBankStatements()).toHaveLength(2))
    expect(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ })).toBeChecked()
  })

  it('shows what is left on the Dashboard and the Transactions page after a delete', async () => {
    api.bankStatements = [july]
    api.months = [{ year: 2026, month: 7 }]
    api.handleSpending = () => Response.json({ total: 250, slices: [{ categoryId: 1, amount: 250 }] })
    api.handleListPeriod = () =>
      Response.json([
        { id: 9, date: '2026-07-04', description: 'Rema 1000', amount: -250, categoryId: 1, note: null, locked: false, imported: true, bookmarked: false },
      ])
    api.handleDeleteBankStatements = () => {
      api.months = []
      api.handleSpending = () => Response.json({ total: 0, slices: [] })
      api.handleListPeriod = () => Response.json([])
      return Response.json({ bankStatementsDeleted: 1, transactionsDeleted: 1 })
    }
    const user = userEvent.setup()
    await renderApp()
    const spending = within(screen.getByRole('region', { name: 'Spending' }))
    await waitFor(() => expect(spending.getByText('Total').parentElement).toHaveTextContent('250,00 kr'))
    await user.click(screen.getByRole('button', { name: 'Transactions' }))
    expect(await screen.findByText('Rema 1000')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'User' }))
    await user.click(await bankStatementsToggle())
    await listedBankStatements()
    await user.click(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ }))
    await user.click(deleteSelected())
    await user.click(transactionsCard().getByRole('button', { name: 'Confirm delete' }))
    await deleteData().findByText('1 Bank Statement deleted.')

    await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))
    await waitFor(() => expect(spending.getByText('Total').parentElement).toHaveTextContent('0,00 kr'))
    await user.click(screen.getByRole('button', { name: 'Transactions' }))
    expect(await screen.findByText(/no transactions/i)).toBeInTheDocument()
    expect(screen.queryByText('Rema 1000')).not.toBeInTheDocument()
  })
})

describe('Delete user and all data', () => {
  async function openUserPage() {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'User' }))
    return user
  }

  function deleteData() {
    return within(screen.getByRole('region', { name: 'Delete data' }))
  }

  function deleteYourUser() {
    return deleteData().getByRole('button', { name: 'Delete user and all data' })
  }

  function deleteYourUserRequests() {
    return fetchMock.mock.calls.filter(([url]) => url === '/api/user/delete')
  }

  async function confirmWith(user: ReturnType<typeof userEvent.setup>, password: string) {
    await user.type(deleteData().getByLabelText(/^password/i), password)
    await user.click(deleteData().getByRole('button', { name: 'Confirm delete' }))
  }

  it('comes last, after every other delete', async () => {
    await openUserPage()

    expect(deleteData().getAllByRole('button').at(-1)).toBe(deleteYourUser())
    expect(deleteYourUser()).toBeEnabled()
  })

  it('asks for the password, then deletes the User and shows the landing page with no notice', async () => {
    const user = await openUserPage()

    await user.click(deleteYourUser())

    expect(deleteYourUserRequests()).toHaveLength(0)
    expect(
      deleteData().getByText('Delete your User and all its data for good? Enter your password to confirm.'),
    ).toBeInTheDocument()
    expect(deleteData().getByLabelText(/^password/i)).toHaveAttribute('autocomplete', 'current-password')

    await confirmWith(user, 'my long passphrase')

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    const [request] = deleteYourUserRequests()
    expect(request[1]?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(request[1]?.body as string)).toEqual({ password: 'my long passphrase' })
  })

  it("puts the Dashboard's address in place of the User page, as Sign out does, so the next sign-in starts on the Dashboard", async () => {
    const user = userEvent.setup()
    await renderAppAt('/rules')
    await user.click(screen.getByRole('button', { name: 'User' }))
    await user.click(deleteYourUser())

    await confirmWith(user, 'my long passphrase')
    await screen.findByRole('heading', { name: 'Sign in' })
    expect(window.location.pathname).toBe('/')

    await user.type(screen.getByLabelText(/^email/i), 'new@example.com')
    await user.type(screen.getByLabelText(/^password/i), 'my long passphrase')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('button', { name: 'Add transaction' })).toBeVisible()
    expect(window.location.pathname).toBe('/')

    window.history.back()
    await waitFor(() => expect(window.location.pathname).toBe('/rules'))
  })

  it('shows a wrong password under the field, keeping the dialog open and the User signed in', async () => {
    api.handleDeleteYourUser = () => Response.json({ errors: { password: ['Wrong password.'] } }, { status: 400 })
    const user = await openUserPage()
    await user.click(deleteYourUser())

    await confirmWith(user, 'wrong password')

    expect(await deleteData().findByText('Wrong password.')).toBeInTheDocument()
    expect(deleteData().getByLabelText(/^password/i).closest('label')).toHaveTextContent('Wrong password.')
    expect(deleteData().getByRole('button', { name: 'Confirm delete' })).toBeEnabled()
    expect(screen.getByRole('navigation')).toBeInTheDocument()
  })

  it('says so in the dialog when the email is locked, with the message Sign in gives', async () => {
    const locked = 'Too many failed sign-ins, so this email is locked for a few minutes. Try again later.'
    api.handleDeleteYourUser = () => Response.json({ detail: locked }, { status: 429 })
    const user = await openUserPage()
    await user.click(deleteYourUser())

    await confirmWith(user, 'my long passphrase')

    expect(await deleteData().findByRole('alert')).toHaveTextContent(locked)
    expect(deleteData().getByLabelText(/^password/i)).toBeInTheDocument()
    expect(screen.getByRole('navigation')).toBeInTheDocument()
  })

  it('closes without deleting anything on Cancel', async () => {
    const user = await openUserPage()
    await user.click(deleteYourUser())
    await user.type(deleteData().getByLabelText(/^password/i), 'my long passphrase')

    await user.click(deleteData().getByRole('button', { name: 'Cancel' }))

    expect(deleteData().queryByLabelText(/^password/i)).not.toBeInTheDocument()
    expect(deleteYourUser()).toBeEnabled()
    expect(deleteYourUserRequests()).toHaveLength(0)
  })

  it('is disabled for the Guest', async () => {
    api.currentUser = guest
    await openUserPage()

    expect(deleteYourUser()).toBeDisabled()
  })

  it('is disabled while an Upload is in progress, and enabled once it finishes', async () => {
    let respond: (response: Response) => void = () => {}
    api.handleUpload = () => new Promise((resolve) => (respond = resolve))
    const user = userEvent.setup()
    await renderApp()
    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)
    await user.click(screen.getByRole('button', { name: 'User' }))

    expect(deleteYourUser()).toBeDisabled()

    respond(Response.json(importedStatement, { status: 201 }))
    await waitFor(() => expect(deleteYourUser()).toBeEnabled())
  })
})
