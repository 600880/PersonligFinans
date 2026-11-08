import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { api, categories, fetchMock, importedStatement } from './test/fakeApi'
import { addActions, leavingTheSiteAsks, renderApp, renderAppAt, statementPdf } from './test/renderApp'

describe('Page addresses', () => {
  // The header items marked as the page being shown.
  function markedPages() {
    return within(screen.getByRole('navigation'))
      .getAllByRole('button')
      .filter((item) => item.getAttribute('aria-current') === 'page')
      .map((item) => item.textContent)
  }

  it.each([
    ['/transactions', 'Transactions', 'Transactions'],
    ['/categories', 'Categories', 'Categories'],
    ['/rules', 'Rules', 'Categorization Rules'],
    ['/user', 'User', 'User'],
  ])('opens %s on the %s page, marked in the header', async (path, page, heading) => {
    await renderAppAt(path)

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(markedPages()).toEqual([page])
    expect(screen.queryByRole('button', { name: 'Add transaction' })).not.toBeInTheDocument()
    expect(window.location.pathname).toBe(path)
  })

  it('opens / on the Dashboard, with no page marked in the header', async () => {
    await renderAppAt('/')

    expect(screen.getByRole('button', { name: 'Add transaction' })).toBeVisible()
    expect(markedPages()).toEqual([])
    expect(window.location.pathname).toBe('/')
  })

  it("opens any other address on the Dashboard, putting the Dashboard's address in its place", async () => {
    // Rules was visited before, so Back shows whether an entry was added for the Dashboard.
    window.history.replaceState(null, '', '/rules')
    window.history.pushState(null, '', '/no-such-page')
    await renderApp()

    expect(screen.getByRole('button', { name: 'Add transaction' })).toBeVisible()
    expect(markedPages()).toEqual([])
    expect(window.location.pathname).toBe('/')

    window.history.back()
    expect(await screen.findByRole('heading', { name: 'Categorization Rules' })).toBeInTheDocument()
  })

  it('puts the page chosen in the header in the address bar, and refreshing stays on it', async () => {
    const user = userEvent.setup()
    await renderAppAt('/')

    await user.click(screen.getByRole('button', { name: 'Rules' }))
    expect(window.location.pathname).toBe('/rules')

    cleanup()
    await renderApp()
    expect(await screen.findByRole('heading', { name: 'Categorization Rules' })).toBeInTheDocument()
    expect(markedPages()).toEqual(['Rules'])
  })

  it('steps through the pages visited with Back and Forward, marking each in the header', async () => {
    const user = userEvent.setup()
    await renderAppAt('/')
    await user.click(screen.getByRole('button', { name: 'Transactions' }))
    await user.click(screen.getByRole('button', { name: 'Categories' }))
    await screen.findByRole('heading', { name: 'Categories' })

    window.history.back()
    expect(await screen.findByRole('heading', { name: 'Transactions' })).toBeInTheDocument()
    expect(markedPages()).toEqual(['Transactions'])
    expect(window.location.pathname).toBe('/transactions')

    window.history.back()
    expect(await screen.findByRole('button', { name: 'Add transaction' })).toBeInTheDocument()
    expect(markedPages()).toEqual([])
    expect(window.location.pathname).toBe('/')

    window.history.forward()
    expect(await screen.findByRole('heading', { name: 'Transactions' })).toBeInTheDocument()
    expect(markedPages()).toEqual(['Transactions'])
  })

  it('adds no entry for choosing the page already shown in the header', async () => {
    const user = userEvent.setup()
    await renderAppAt('/rules')
    await user.click(screen.getByRole('button', { name: 'Categories' }))

    await user.click(screen.getByRole('button', { name: 'Categories' }))

    window.history.back()
    expect(await screen.findByRole('heading', { name: 'Categorization Rules' })).toBeInTheDocument()
  })

  it('adds no entry for a dialog', async () => {
    const user = userEvent.setup()
    await renderAppAt('/rules')
    await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))
    await user.click(screen.getByRole('button', { name: 'Add transaction' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /cancel/i }))

    window.history.back()

    expect(await screen.findByRole('heading', { name: 'Categorization Rules' })).toBeInTheDocument()
  })

  it('goes to the Dashboard with the PersonligFinans title, adding no entry while already there', async () => {
    const user = userEvent.setup()
    await renderAppAt('/rules')
    await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))
    expect(window.location.pathname).toBe('/')

    await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

    window.history.back()
    expect(await screen.findByRole('heading', { name: 'Categorization Rules' })).toBeInTheDocument()
  })
})

describe('Tab title', () => {
  it.each([
    ['/transactions', 'Transactions', 'Transactions - PersonligFinans'],
    ['/categories', 'Categories', 'Categories - PersonligFinans'],
    ['/rules', 'Categorization Rules', 'Rules - PersonligFinans'],
    ['/user', 'User', 'User - PersonligFinans'],
  ])('names the page opened at %s, as on a refresh', async (path, heading, title) => {
    await renderAppAt(path)

    await screen.findByRole('heading', { name: heading })
    expect(document.title).toBe(title)
  })

  it('is plain PersonligFinans on the Dashboard', async () => {
    await renderAppAt('/')

    expect(document.title).toBe('PersonligFinans')
  })

  it('follows the page reached by the header, a link, Back and Forward', async () => {
    const user = userEvent.setup()
    await renderAppAt('/')

    await user.click(screen.getByRole('button', { name: 'Categories' }))
    await screen.findByText('All groceries.')
    expect(document.title).toBe('Categories - PersonligFinans')

    await user.click(screen.getByRole('button', { name: 'Show rules for Groceries (3)' }))
    await screen.findByRole('heading', { name: 'Categorization Rules' })
    expect(document.title).toBe('Rules - PersonligFinans')

    window.history.back()
    await screen.findByText('All groceries.')
    expect(document.title).toBe('Categories - PersonligFinans')

    window.history.back()
    await screen.findByRole('button', { name: 'Add transaction' })
    expect(document.title).toBe('PersonligFinans')

    window.history.forward()
    await screen.findByText('All groceries.')
    expect(document.title).toBe('Categories - PersonligFinans')

    await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))
    expect(document.title).toBe('PersonligFinans')
  })

  it('is plain PersonligFinans on the landing page after Sign out', async () => {
    const user = userEvent.setup()
    await renderAppAt('/user')

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))

    await screen.findByRole('heading', { name: 'Sign in' })
    expect(document.title).toBe('PersonligFinans')
  })

  it('is plain PersonligFinans on the landing page after a call answers 401', async () => {
    const user = userEvent.setup()
    await renderAppAt('/rules')
    api.categoriesServed = new Response(null, { status: 401 })

    await user.click(screen.getByRole('button', { name: 'Categories' }))

    await screen.findByRole('heading', { name: 'Sign in' })
    expect(document.title).toBe('PersonligFinans')
  })

  it("is plain PersonligFinans on the landing page opened at a page's address", async () => {
    api.currentUser = new Response(null, { status: 401 })
    window.history.replaceState(null, '', '/rules')
    render(<App />)

    await screen.findByRole('heading', { name: 'Sign in' })
    expect(document.title).toBe('PersonligFinans')
  })

  it('is plain PersonligFinans on the page to choose a new password', async () => {
    window.history.replaceState(null, '', '/reset-password?email=me%40example.com&token=dG9rZW4')
    render(<App />)

    await screen.findByRole('heading', { name: 'Choose a new password' })
    expect(document.title).toBe('PersonligFinans')
  })
})

describe('Header', () => {
  function navItems() {
    return within(screen.getByRole('navigation')).getAllByRole('button')
  }

  function currentPage() {
    return navItems()
      .filter((item) => item.getAttribute('aria-current') === 'page')
      .map((item) => item.textContent)
  }

  it('shows Transactions, Categories, Rules then User, with no Back button', async () => {
    await renderApp()

    expect(navItems().map((item) => item.textContent)).toEqual(['Transactions', 'Categories', 'Rules', 'User'])
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })

  it('highlights the page being shown', async () => {
    const user = userEvent.setup()
    await renderApp()
    expect(currentPage()).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Transactions' }))
    expect(currentPage()).toEqual(['Transactions'])

    await user.click(screen.getByRole('button', { name: 'Categories' }))
    expect(currentPage()).toEqual(['Categories'])

    await user.click(screen.getByRole('button', { name: 'Rules' }))
    expect(currentPage()).toEqual(['Rules'])

    await user.click(screen.getByRole('button', { name: 'User' }))
    expect(currentPage()).toEqual(['User'])
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })

  it('goes to the home page when the app name is clicked', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'Rules' }))

    await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

    expect(screen.getByRole('button', { name: 'Add transaction' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /upload transactions/i })).toBeInTheDocument()
    expect(currentPage()).toEqual([])
  })

  describe('menu of pages on a narrow screen', () => {
    function menuButton() {
      return screen.getByRole('button', { name: 'Menu' })
    }

    it('opens and closes with its button', async () => {
      const user = userEvent.setup()
      await renderApp()
      expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
      expect(menuButton()).toHaveAttribute('aria-controls', screen.getByRole('navigation').id)

      await user.click(menuButton())
      expect(menuButton()).toHaveAttribute('aria-expanded', 'true')

      await user.click(menuButton())
      expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
    })

    it('closes once a page is chosen', async () => {
      const user = userEvent.setup()
      await renderApp()

      await user.click(menuButton())
      await user.click(screen.getByRole('button', { name: 'Rules' }))

      expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
      expect(currentPage()).toEqual(['Rules'])
    })

    it('opens the User page from the panel, and closes', async () => {
      const user = userEvent.setup()
      await renderApp()

      await user.click(menuButton())
      await user.click(screen.getByRole('button', { name: 'User' }))

      expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
      expect(currentPage()).toEqual(['User'])
      expect(screen.getByRole('heading', { name: 'User' })).toBeInTheDocument()
    })

    it('closes when the app name is clicked', async () => {
      const user = userEvent.setup()
      await renderApp()

      await user.click(menuButton())
      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

      expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
    })

    it('closes on Escape, or on a press outside it', async () => {
      const user = userEvent.setup()
      await renderApp()

      await user.click(menuButton())
      await user.keyboard('{Escape}')
      expect(menuButton()).toHaveAttribute('aria-expanded', 'false')

      await user.click(menuButton())
      await user.click(screen.getByRole('main'))
      expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
    })

    it('closes when Back changes the page', async () => {
      const user = userEvent.setup()
      await renderAppAt('/rules')
      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))
      await user.click(menuButton())

      window.history.back()

      expect(await screen.findByRole('heading', { name: 'Categorization Rules' })).toBeInTheDocument()
      expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
    })
  })
})

describe('Add transactions menu on a narrow screen', () => {
  function menuButton() {
    return screen.getByRole('button', { name: 'Add transactions' })
  }

  it('opens and closes the ways to add Transactions with its button', async () => {
    const user = userEvent.setup()
    await renderApp()
    expect(menuButton()).toHaveAttribute('aria-controls', screen.getByRole('group', { name: 'Ways to add transactions' }).id)

    await user.click(menuButton())
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true')

    await user.click(menuButton())
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes once a way is chosen', async () => {
    const user = userEvent.setup()
    await renderApp()

    await user.click(menuButton())
    await user.click(addActions().getByRole('button', { name: 'Add transaction' }))

    expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes on Escape, or on a press outside it', async () => {
    const user = userEvent.setup()
    await renderApp()

    await user.click(menuButton())
    await user.keyboard('{Escape}')
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false')

    await user.click(menuButton())
    await user.click(screen.getByRole('banner'))
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
  })

  it('is closed on returning to the Dashboard after Back changed the page while it was open', async () => {
    const user = userEvent.setup()
    await renderAppAt('/rules')
    await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))
    await user.click(menuButton())

    window.history.back()
    await screen.findByRole('heading', { name: 'Categorization Rules' })
    window.history.forward()

    expect(await screen.findByRole('button', { name: 'Add transactions' })).toHaveAttribute('aria-expanded', 'false')
  })

  it("shows an upload's progress, and still opens on the other ways while Upload transactions waits", async () => {
    let respond: (response: Response) => void = () => {}
    api.handleUpload = () => new Promise((resolve) => (respond = resolve))
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    // The Upload transactions button in the menu shows the same progress, but doesn't open anything.
    const button = screen.getByRole('button', { name: 'Categorizing… (0/1)', expanded: false })
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(addActions().getByRole('button', { name: 'Categorizing… (0/1)' })).toBeDisabled()
    expect(addActions().getByRole('button', { name: 'Add transaction' })).toBeEnabled()
    expect(addActions().getByRole('button', { name: 'Scan receipts' })).toBeEnabled()

    respond(Response.json(importedStatement, { status: 201 }))
    expect(await screen.findByRole('button', { name: 'Add transactions' })).toHaveAttribute('aria-busy', 'false')
  })
})

describe('Signed out mid-session', () => {
  it('returns to the landing page when a call answers 401, and signing in again starts afresh on the same page', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'Rules' }))
    api.categoriesServed = new Response(null, { status: 401 })

    await user.click(screen.getByRole('button', { name: 'Categories' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(window.location.pathname).toBe('/categories')

    api.categoriesServed = categories
    await user.type(screen.getByLabelText(/^email/i), 'me@example.com')
    await user.type(screen.getByLabelText(/^password/i), 'my long passphrase')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('navigation')
    expect(await screen.findByText('All groceries.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Categories' })).toHaveAttribute('aria-current', 'page')
    expect(window.location.pathname).toBe('/categories')
  })
})

describe('Antiforgery token', () => {
  // The antiforgery token sent with each form posted to the URL, in the order they were sent.
  function tokensSentTo(url: string) {
    return fetchMock.mock.calls
      .filter(([calledUrl, init]) => calledUrl === url && init?.method === 'POST')
      .map(([, init]) => (init?.headers as Record<string, string> | undefined)?.['X-CSRF-TOKEN'])
  }

  it('is fetched after signing in and sent with each Bank Statement of an Upload', async () => {
    const user = userEvent.setup()
    await renderApp()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/antiforgery-token', undefined)

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [statementPdf, statementPdf])

    await screen.findByRole('status')
    expect(tokensSentTo('/api/bank-statements')).toEqual(['token-1', 'token-1'])
    expect(api.antiforgeryTokensGiven).toBe(1)
  })

  it('is fetched afresh, and the Upload sent once more, when the server refuses it', async () => {
    let uploads = 0
    api.handleUpload = () =>
      ++uploads === 1 ? new Response(null, { status: 403 }) : Response.json(importedStatement, { status: 201 })
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    expect(await screen.findByRole('status')).toHaveTextContent('Imported 38 transactions')
    expect(tokensSentTo('/api/bank-statements')).toEqual(['token-1', 'token-2'])
  })

  it('sends the Upload only once more when the fresh token is refused too', async () => {
    api.handleUpload = () => new Response(null, { status: 403 })
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    expect(await screen.findByRole('alert')).toHaveTextContent('Upload failed (403).')
    expect(tokensSentTo('/api/bank-statements')).toEqual(['token-1', 'token-2'])
  })

  it('is fetched afresh for the User who signs in next', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)
    await screen.findByRole('status')

    await user.click(screen.getByRole('button', { name: 'User' }))
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await user.type(await screen.findByLabelText(/^email/i), 'other@example.com')
    await user.type(screen.getByLabelText(/^password/i), 'my long passphrase')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('navigation')
    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)
    await screen.findByRole('status')

    expect(tokensSentTo('/api/bank-statements')).toEqual(['token-1', 'token-2'])
  })
})

describe('Leave site?', () => {
  it('is never asked with nothing under way, on any page', async () => {
    const user = userEvent.setup()
    await renderApp()
    expect(leavingTheSiteAsks()).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Rules' }))

    expect(leavingTheSiteAsks()).toBe(false)
  })

  it('is no longer asked after signing out during an Upload', async () => {
    api.handleUpload = () => new Promise(() => {})
    const user = userEvent.setup()
    await renderApp()
    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)
    expect(leavingTheSiteAsks()).toBe(true)

    await user.click(screen.getByRole('button', { name: 'User' }))
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await screen.findByRole('heading', { name: 'Sign in' })

    expect(leavingTheSiteAsks()).toBe(false)
  })

  it('is asked while an Upload is under way, and no longer once it finishes', async () => {
    const responders: ((response: Response) => void)[] = []
    api.handleUpload = () => new Promise((resolve) => responders.push(resolve))
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [statementPdf, statementPdf])

    expect(leavingTheSiteAsks()).toBe(true)
    responders[0](Response.json(importedStatement, { status: 201 }))
    await waitFor(() => expect(responders).toHaveLength(2))
    expect(leavingTheSiteAsks()).toBe(true)

    responders[1](Response.json(importedStatement, { status: 201 }))
    await screen.findByRole('status')
    // The question stops once the app has caught up with the finished Upload, which can be just
    // after its summary shows.
    await waitFor(() => expect(leavingTheSiteAsks()).toBe(false))
  })
})
