import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { todayIsoDate } from './lib/date'
import { monthOfDate } from './lib/month'

const categories = [
  {
    id: 1,
    name: 'Groceries',
    description: 'All groceries.',
    colour: '#2a78d6',
    builtIn: true,
    transactionCount: 12,
    ruleCount: 3,
  },
  {
    id: 13,
    name: 'Other',
    description: "Costs that don't belong in any other category.",
    colour: '#9085e9',
    builtIn: true,
    transactionCount: 1,
    ruleCount: 0,
  },
]

// A Category as the categories endpoint returns it. Tests that only need a Category's name leave
// out the rest.
type ServedCategory = { id: number; name: string } & Partial<(typeof categories)[number]>

type Month = { year: number; month: number }

// Every month from `from` to `to`, both included, as the monthly Spending endpoint returns them:
// with the slices given for "year-month" and none for the other months.
function monthlySpending(
  from: Month,
  to: Month,
  slices: Record<string, { categoryId: number | null; amount: number }[]> = {},
) {
  const entries = []
  // Steps through calendar months with Date, rather than the month arithmetic the app uses.
  const last = new Date(to.year, to.month - 1)
  for (const date = new Date(from.year, from.month - 1); date <= last; date.setMonth(date.getMonth() + 1)) {
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    entries.push({ year, month, slices: slices[`${year}-${month}`] ?? [] })
  }
  return entries
}

type PostHandler = (body: unknown) => Response
type UploadHandler = (body: FormData) => Response | Promise<Response>

let handlePost: PostHandler
let handleUpload: UploadHandler
let rules: { id: number; keyword: string; categoryId: number; aiGenerated: boolean; isNew: boolean }[] | Response
let handleAddRule: PostHandler
let handleAddCategory: PostHandler
let handleEditRule: (id: number, body: unknown) => Response
let handleDeleteRule: (id: number) => Response
// The query holds the delete's choice, e.g. the replacement Category.
let handleDeleteCategory: (id: number, query: URLSearchParams) => Response
let handleEditCategory: (id: number, body: unknown) => Response | Promise<Response>
let months: { year: number; month: number }[] | Response
// month is undefined for a whole year.
let handleListPeriod: (year: number, month: number | undefined) => Response | Promise<Response>
let handleChangeCategory: (id: number, body: unknown) => Response | Promise<Response>
let handleChangeNote: (id: number, body: unknown) => Response
let handleDeleteTransaction: (id: number) => Response | Promise<Response>
let handleAddBookmark: (id: number) => Response | Promise<Response>
let handleRemoveBookmark: (id: number) => Response | Promise<Response>
let handleFileBookmark: (id: number, body: unknown) => Response | Promise<Response>
let handleListBookmarks: () => Response | Promise<Response>
// The bookmarks in one Folder, and the User's Folders as the folders endpoint lists them.
let handleListFolderBookmarks: (folderId: number) => Response | Promise<Response>
let folders: { id: number; name: string }[] | Response | Promise<Response>
let handleAddFolder: PostHandler
let handleRenameFolder: (id: number, body: unknown) => Response | Promise<Response>
let handleDeleteFolder: (id: number) => Response | Promise<Response>
// What the categories endpoint returns: `categories` unless a test adds to it or makes it fail.
let categoriesServed: ServedCategory[] | Response
// The month or quarter is undefined when the Spending of a whole year, or of a quarter, is asked for.
let handleSpending: (year: number, month: number | undefined, quarter: number | undefined, includeTransfers: boolean) => Response
// The Spending of each month of the Span from `from` to `to`.
let handleMonthlySpending: (from: Month, to: Month, includeTransfers: boolean) => Response
// Who is signed in: signed in as a User unless a test signs out, or keeps the answer waiting.
let currentUser: { email: string; isGuest: boolean } | Response | Promise<Response>
let handleSignIn: PostHandler
let handleSignUp: PostHandler
let handleContinueAsGuest: () => Response
let handleSignOut: () => Response
// Whether Password reset is available, meaning the server has an email sender: not unless a test
// says so, as when developing locally.
let passwordResetAvailability: { available: boolean; linkHours: number } | Response
let handleRequestPasswordReset: PostHandler
let handleChooseNewPassword: PostHandler
let handleChangePassword: PostHandler
// How many antiforgery tokens the server has given. Each is new: token-1, token-2 and so on.
let antiforgeryTokensGiven: number
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url === '/api/user') {
    return currentUser instanceof Response || currentUser instanceof Promise ? currentUser : Response.json(currentUser)
  }
  if (url === '/api/user/sign-in' && init?.method === 'POST') return handleSignIn(JSON.parse(init.body as string))
  if (url === '/api/user/sign-up' && init?.method === 'POST') return handleSignUp(JSON.parse(init.body as string))
  if (url === '/api/user/continue-as-guest' && init?.method === 'POST') return handleContinueAsGuest()
  if (url === '/api/user/sign-out' && init?.method === 'POST') return handleSignOut()
  if (url === '/api/user/password-reset/availability') {
    return passwordResetAvailability instanceof Response ? passwordResetAvailability : Response.json(passwordResetAvailability)
  }
  if (url === '/api/user/password-reset/request' && init?.method === 'POST') {
    return handleRequestPasswordReset(JSON.parse(init.body as string))
  }
  if (url === '/api/user/password-reset/new-password' && init?.method === 'POST') {
    return handleChooseNewPassword(JSON.parse(init.body as string))
  }
  if (url === '/api/user/change-password' && init?.method === 'POST') {
    return handleChangePassword(JSON.parse(init.body as string))
  }
  if (url === '/api/antiforgery-token') return Response.json({ token: `token-${++antiforgeryTokensGiven}` })
  const monthlyUrl =
    /^\/api\/spending\/monthly\?fromYear=(\d+)&fromMonth=(\d+)&toYear=(\d+)&toMonth=(\d+)(&includeTransfers=true)?$/.exec(url)
  if (monthlyUrl) {
    const [, fromYear, fromMonth, toYear, toMonth, transfers] = monthlyUrl
    return handleMonthlySpending(
      { year: Number(fromYear), month: Number(fromMonth) },
      { year: Number(toYear), month: Number(toMonth) },
      transfers !== undefined,
    )
  }
  const spendingUrl = /^\/api\/spending\?year=(\d+)(?:&quarter=(\d+))?(?:&month=(\d+))?(&includeTransfers=true)?$/.exec(url)
  if (spendingUrl) {
    const [, year, quarter, month, transfers] = spendingUrl
    return handleSpending(
      Number(year),
      month ? Number(month) : undefined,
      quarter ? Number(quarter) : undefined,
      transfers !== undefined,
    )
  }
  const periodUrl = /^\/api\/transactions\?year=(\d+)(?:&month=(\d+))?$/.exec(url)
  if (periodUrl) return handleListPeriod(Number(periodUrl[1]), periodUrl[2] ? Number(periodUrl[2]) : undefined)
  const categoryUrl = /^\/api\/transactions\/(\d+)\/category$/.exec(url)
  if (categoryUrl && init?.method === 'PUT') {
    return handleChangeCategory(Number(categoryUrl[1]), JSON.parse(init.body as string))
  }
  const noteUrl = /^\/api\/transactions\/(\d+)\/note$/.exec(url)
  if (noteUrl && init?.method === 'PUT') return handleChangeNote(Number(noteUrl[1]), JSON.parse(init.body as string))
  const bookmarkUrl = /^\/api\/transactions\/(\d+)\/bookmark$/.exec(url)
  if (bookmarkUrl && init?.method === 'POST') return handleAddBookmark(Number(bookmarkUrl[1]))
  if (bookmarkUrl && init?.method === 'DELETE') return handleRemoveBookmark(Number(bookmarkUrl[1]))
  if (bookmarkUrl && init?.method === 'PUT') return handleFileBookmark(Number(bookmarkUrl[1]), JSON.parse(init.body as string))
  if (url === '/api/bookmarks') return handleListBookmarks()
  const folderBookmarksUrl = /^\/api\/bookmarks\?folderId=(\d+)$/.exec(url)
  if (folderBookmarksUrl) return handleListFolderBookmarks(Number(folderBookmarksUrl[1]))
  if (url === '/api/folders' && init?.method === 'POST') return handleAddFolder(JSON.parse(init.body as string))
  if (url === '/api/folders') {
    return folders instanceof Response || folders instanceof Promise ? folders : Response.json(folders)
  }
  const folderUrl = /^\/api\/folders\/(\d+)$/.exec(url)
  if (folderUrl && init?.method === 'PUT') return handleRenameFolder(Number(folderUrl[1]), JSON.parse(init.body as string))
  if (folderUrl && init?.method === 'DELETE') return handleDeleteFolder(Number(folderUrl[1]))
  const transactionUrl = /^\/api\/transactions\/(\d+)$/.exec(url)
  if (transactionUrl && init?.method === 'DELETE') return handleDeleteTransaction(Number(transactionUrl[1]))
  if (url === '/api/transactions/months') {
    return months instanceof Response ? months : Response.json(months)
  }
  const ruleUrl = /^\/api\/categorization-rules\/(\d+)$/.exec(url)
  if (ruleUrl && init?.method === 'PUT') {
    return handleEditRule(Number(ruleUrl[1]), JSON.parse(init.body as string))
  }
  if (ruleUrl && init?.method === 'DELETE') return handleDeleteRule(Number(ruleUrl[1]))
  const categoryUrlMatch = /^\/api\/categories\/(\d+)(?:\?(.*))?$/.exec(url)
  if (categoryUrlMatch && init?.method === 'PUT') {
    return handleEditCategory(Number(categoryUrlMatch[1]), JSON.parse(init.body as string))
  }
  if (categoryUrlMatch && init?.method === 'DELETE') {
    return handleDeleteCategory(Number(categoryUrlMatch[1]), new URLSearchParams(categoryUrlMatch[2]))
  }
  if (url === '/api/categories' && init?.method === 'POST') {
    return handleAddCategory(JSON.parse(init.body as string))
  }
  if (url === '/api/categories') {
    return categoriesServed instanceof Response ? categoriesServed : Response.json(categoriesServed)
  }
  if (url === '/api/transactions' && init?.method === 'POST') {
    return handlePost(JSON.parse(init.body as string))
  }
  if (url === '/api/bank-statements' && init?.method === 'POST') {
    return handleUpload(init.body as FormData)
  }
  if (url === '/api/categorization-rules' && init?.method === 'POST') {
    return handleAddRule(JSON.parse(init.body as string))
  }
  if (url === '/api/categorization-rules') {
    return rules instanceof Response ? rules : Response.json(rules)
  }
  return new Response(null, { status: 404 })
})

beforeEach(() => {
  handlePost = () => Response.json({ id: 1 }, { status: 201 })
  handleUpload = () => Response.json(importedStatement, { status: 201 })
  rules = [
    { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
    { id: 2, keyword: 'overføring mellom egne kontoer', categoryId: 13, aiGenerated: false, isNew: false },
  ]
  handleAddRule = (body) =>
    Response.json({ id: 3, ...(body as object), aiGenerated: false, isNew: false, transactionsChanged: 0 }, { status: 201 })
  handleEditRule = (id, body) =>
    Response.json({ id, ...(body as object), aiGenerated: false, isNew: false, transactionsChanged: 0 })
  handleDeleteRule = () => Response.json({ transactionsChanged: 0 })
  handleDeleteCategory = () => Response.json({ transactionsChanged: 0 })
  handleEditCategory = (id, body) => {
    const category = categories.find((c) => c.id === id)
    return Response.json({ ...category, id, ...(body as object) })
  }
  handleAddCategory = (body) =>
    Response.json(
      { id: 20, ...(body as object), colour: '#0891b2', builtIn: false, transactionCount: 0, ruleCount: 0 },
      { status: 201 },
    )
  months = []
  handleListPeriod = () => Response.json([])
  handleChangeCategory = () => new Response(null, { status: 500 })
  handleChangeNote = () => new Response(null, { status: 500 })
  handleDeleteTransaction = () => new Response(null, { status: 204 })
  handleAddBookmark = () => Response.json({ folderId: null })
  handleRemoveBookmark = () => new Response(null, { status: 204 })
  handleFileBookmark = (_id, body) => Response.json(body)
  handleListBookmarks = () => Response.json([])
  handleListFolderBookmarks = () => Response.json([])
  folders = []
  handleAddFolder = (body) => Response.json({ id: 30, ...(body as object) }, { status: 201 })
  handleRenameFolder = (id, body) => Response.json({ id, ...(body as object) })
  handleDeleteFolder = () => new Response(null, { status: 204 })
  handleSpending = () => Response.json({ total: 0, slices: [] })
  handleMonthlySpending = (from, to) => Response.json(monthlySpending(from, to))
  categoriesServed = categories
  currentUser = { email: 'me@example.com', isGuest: false }
  handleSignIn = (body) => Response.json({ email: (body as { email: string }).email, isGuest: false })
  handleSignUp = (body) => Response.json({ email: (body as { email: string }).email, isGuest: false })
  handleContinueAsGuest = () => Response.json(guest)
  handleSignOut = () => new Response(null, { status: 204 })
  antiforgeryTokensGiven = 0
  passwordResetAvailability = { available: false, linkHours: 1 }
  handleRequestPasswordReset = () => new Response(null, { status: 204 })
  handleChooseNewPassword = (body) => Response.json({ email: (body as { email: string }).email, isGuest: false })
  handleChangePassword = () => new Response(null, { status: 204 })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  fetchMock.mockClear()
  vi.unstubAllGlobals()
})

const importedStatement = {
  id: 7,
  accountNumber: '1111.22.33333',
  periodStart: '2026-08-01',
  periodEnd: '2026-08-31',
  transactionCount: 38,
  uncategorizedCount: 7,
  aiCategorizationUnavailable: false,
  dailyAiLimitReached: false,
}

// Renders the app for a signed-in User, once it has asked who is signed in and shows the app.
async function renderApp() {
  render(<App />)
  await screen.findByRole('navigation')
}

// The ways to add Transactions, rather than the Add transactions button that opens them as a menu on
// a narrow screen.
function addActions() {
  return within(screen.getByRole('group', { name: 'Ways to add transactions' }))
}

// The Guest as the API reports it.
const guest = { email: 'guest@personligfinans.invalid', isGuest: true }

const statementPdf = new File(['%PDF-1.7'], 'kontoutskrift.pdf', { type: 'application/pdf' })

async function openModal() {
  const user = userEvent.setup()
  await renderApp()
  await user.click(screen.getByRole('button', { name: 'Add transaction' }))
  await screen.findByRole('option', { name: 'Groceries' })
  return user
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/description/i), 'Rema 1000')
  await user.type(screen.getByLabelText(/^out$/i), '249.90')
  await user.selectOptions(screen.getByLabelText(/category/i), 'Groceries')
}

// Chooses the Bookmark once the Folders are loaded.
async function chooseBookmark(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.selectOptions(screen.getByLabelText(/^bookmark/i), await screen.findByRole('option', { name }))
}

describe('App', () => {
  it('shows the Add transaction button with no modal open', async () => {
    await renderApp()
    expect(screen.getByRole('button', { name: 'Add transaction' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the modal with empty fields and no category chosen', async () => {
    await openModal()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText(/date/i)).toHaveValue(todayIsoDate())
    expect(screen.getByLabelText(/description/i)).toHaveValue('')
    expect(screen.getByLabelText(/^in$/i)).toHaveValue(null)
    expect(screen.getByLabelText(/^out$/i)).toHaveValue(null)
    expect(screen.getByLabelText(/^note$/i)).toHaveValue('')
    expect(screen.getByLabelText(/category/i)).toHaveValue('')
  })

  it('offers the categories loaded from the API', async () => {
    await openModal()

    const options = within(screen.getByLabelText(/category/i))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toEqual(['Choose…', 'Groceries', 'Other'])
  })

  it('asks for the Bookmark between Category and Note, offering -, Bookmarks, then the Folders, with - chosen', async () => {
    folders = [
      { id: 30, name: 'Tax deductible' },
      { id: 31, name: 'Warranty' },
    ]
    await openModal()

    const fields = [/date/i, /description/i, /^in$/i, /^out$/i, /category/i, /^bookmark/i, /^note$/i].map((label) =>
      screen.getByLabelText(label),
    )
    for (const [earlier, later] of fields.slice(0, -1).map((field, i) => [field, fields[i + 1]])) {
      expect(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    const bookmark = screen.getByLabelText(/^bookmark/i)
    await waitFor(() => expect(bookmark).toBeEnabled())
    expect(within(bookmark).getAllByRole('option').map((option) => option.textContent)).toEqual([
      '-',
      'Bookmarks',
      'Tax deductible',
      'Warranty',
    ])
    expect(within(bookmark).getByRole<HTMLOptionElement>('option', { name: '-' }).selected).toBe(true)
  })

  it('keeps Save disabled until description, amount and category are filled in', async () => {
    const user = await openModal()
    const saveButton = screen.getByRole('button', { name: /^save$/i })
    expect(saveButton).toBeDisabled()

    await user.type(screen.getByLabelText(/description/i), 'Rema 1000')
    await user.type(screen.getByLabelText(/^out$/i), '249.90')
    expect(saveButton).toBeDisabled()

    await user.selectOptions(screen.getByLabelText(/category/i), 'Groceries')
    expect(saveButton).toBeEnabled()
  })

  it('posts the transaction with Out as a negative amount, then closes and confirms', async () => {
    let posted: unknown
    handlePost = (body) => {
      posted = body
      return Response.json({ id: 1 }, { status: 201 })
    }
    const user = await openModal()
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(posted).toEqual({
      date: todayIsoDate(),
      description: 'Rema 1000',
      amount: -249.9,
      note: null,
      categoryId: 1,
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Transaction saved')
  })

  it('posts the chosen Folder with the transaction, then closes and confirms', async () => {
    folders = [{ id: 30, name: 'Tax deductible' }]
    let posted: unknown
    handlePost = (body) => {
      posted = body
      return Response.json({ id: 1 }, { status: 201 })
    }
    const user = await openModal()
    await fillValidForm(user)
    await chooseBookmark(user, 'Tax deductible')

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(posted).toEqual(expect.objectContaining({ description: 'Rema 1000', bookmark: { folderId: 30 } }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Transaction saved')
  })

  it('posts no Folder for Bookmarks', async () => {
    folders = [{ id: 30, name: 'Tax deductible' }]
    let posted: unknown
    handlePost = (body) => {
      posted = body
      return Response.json({ id: 1 }, { status: 201 })
    }
    const user = await openModal()
    await fillValidForm(user)
    await chooseBookmark(user, 'Bookmarks')

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(posted).toEqual(expect.objectContaining({ bookmark: { folderId: null } }))
  })

  it('shows under the Bookmark that the chosen Folder no longer exists, keeping the input', async () => {
    folders = [{ id: 30, name: 'Tax deductible' }]
    handlePost = () => Response.json({ errors: { bookmark: ['The folder no longer exists.'] } }, { status: 400 })
    const user = await openModal()
    await fillValidForm(user)
    await chooseBookmark(user, 'Tax deductible')

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    const bookmark = screen.getByLabelText(/^bookmark/i)
    expect(bookmark.closest('label')).toHaveTextContent('The folder no longer exists.')
    expect(bookmark).toHaveValue('30')
    expect(screen.getByLabelText(/^out$/i)).toHaveValue(249.9)
  })

  it('keeps the Bookmark at - and disabled while the Folders load', async () => {
    folders = new Promise(() => {})
    await openModal()

    const bookmark = screen.getByLabelText(/^bookmark/i)
    expect(bookmark).toBeDisabled()
    expect(within(bookmark).getAllByRole('option').map((option) => option.textContent)).toEqual(['-'])
  })

  it('saves without a bookmark when the Folders could not be loaded, saying so under the Bookmark', async () => {
    folders = new Response(null, { status: 500 })
    let posted: unknown
    handlePost = (body) => {
      posted = body
      return Response.json({ id: 1 }, { status: 201 })
    }
    const user = await openModal()
    const bookmark = screen.getByLabelText(/^bookmark/i)
    await waitFor(() => expect(bookmark.closest('label')).toHaveTextContent('Could not load folders.'))
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(posted).not.toHaveProperty('bookmark')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stays open with the input kept and shows field errors from the server', async () => {
    handlePost = () =>
      Response.json(
        { errors: { description: ['Description is required.'] } },
        { status: 400 },
      )
    const user = await openModal()
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Description is required.')).toBeInTheDocument()
    expect(screen.getByLabelText(/^out$/i)).toHaveValue(249.9)
  })

  it('shows a general error when the server fails', async () => {
    handlePost = () => new Response(null, { status: 500 })
    const user = await openModal()
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(screen.getByRole('alert')).toHaveTextContent('Saving failed (500).')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes and discards input when Cancel is clicked', async () => {
    const user = await openModal()
    await user.type(screen.getByLabelText(/description/i), 'Groceries')

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add transaction' }))
    expect(screen.getByLabelText(/description/i)).toHaveValue('')
  })

  it('shows Upload transactions to the left of Add transaction', async () => {
    await renderApp()

    const buttons = addActions()
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(buttons.slice(0, 2)).toEqual(['Upload transactions', 'Add transaction'])
  })

  it('uploads the chosen PDF and shows how many transactions were imported and categorized', async () => {
    let uploaded: FormData | undefined
    handleUpload = (body) => {
      uploaded = body
      return Response.json(importedStatement, { status: 201 })
    }
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    expect(uploaded?.get('file')).toBe(statementPdf)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Imported 38 transactions from statement 01.08.2026–31.08.2026: 31 categorized, 7 Uncategorized',
    )
  })

  it('says when AI categorization was unavailable during the import', async () => {
    handleUpload = () =>
      Response.json({ ...importedStatement, aiCategorizationUnavailable: true }, { status: 201 })
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(
      'Imported 38 transactions from statement 01.08.2026–31.08.2026: 31 categorized, 7 Uncategorized',
    )
    expect(status).toHaveTextContent('AI categorization unavailable — 7 rows left Uncategorized')
  })

  it('only accepts PDF files', async () => {
    await renderApp()

    expect(screen.getByLabelText(/bank statement pdf/i)).toHaveAttribute('accept', 'application/pdf')
  })

  it('shows a disabled Categorizing… (0/1) button with a spinner while a single upload is in progress', async () => {
    let respond: (response: Response) => void = () => {}
    handleUpload = () => new Promise((resolve) => (respond = resolve))
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    const button = addActions().getByRole('button', { name: 'Categorizing… (0/1)' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')

    respond(Response.json(importedStatement, { status: 201 }))
    const idle = await screen.findByRole('button', { name: /upload transactions/i })
    expect(idle).toBeEnabled()
    expect(idle).not.toHaveAttribute('aria-busy', 'true')
  })

  it('uploads several picked PDFs one at a time in pick order, counting finished ones on the button', async () => {
    const uploaded: (FormDataEntryValue | null)[] = []
    const responders: ((response: Response) => void)[] = []
    handleUpload = (body) => {
      uploaded.push(body.get('file'))
      return new Promise((resolve) => responders.push(resolve))
    }
    const julyPdf = new File(['%PDF-1.7'], 'juli.pdf', { type: 'application/pdf' })
    const septemberPdf = new File(['%PDF-1.7'], 'september.pdf', { type: 'application/pdf' })
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [julyPdf, statementPdf, septemberPdf])

    const button = addActions().getByRole('button', { name: 'Categorizing… (0/3)' })
    expect(button).toBeDisabled()
    expect(uploaded).toEqual([julyPdf])

    responders[0](Response.json(importedStatement, { status: 201 }))
    expect(await addActions().findByRole('button', { name: 'Categorizing… (1/3)' })).toBeDisabled()
    await waitFor(() => expect(uploaded).toEqual([julyPdf, statementPdf]))

    responders[1](Response.json(importedStatement, { status: 201 }))
    expect(await addActions().findByRole('button', { name: 'Categorizing… (2/3)' })).toBeDisabled()
    await waitFor(() => expect(uploaded).toEqual([julyPdf, statementPdf, septemberPdf]))

    responders[2](Response.json(importedStatement, { status: 201 }))
    expect(await screen.findByRole('button', { name: /upload transactions/i })).toBeEnabled()
  })

  it('sends every PDF picked together with the same upload id, and a new one for the next pick', async () => {
    const uploadIds: (FormDataEntryValue | null)[] = []
    handleUpload = (body) => {
      uploadIds.push(body.get('uploadId'))
      return Response.json(importedStatement, { status: 201 })
    }
    const julyPdf = new File(['%PDF-1.7'], 'juli.pdf', { type: 'application/pdf' })
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [julyPdf, statementPdf])
    await screen.findByRole('button', { name: /upload transactions/i })
    await user.upload(screen.getByLabelText(/bank statement pdf/i), [julyPdf])
    await waitFor(() => expect(uploadIds).toHaveLength(3))

    expect(uploadIds[0]).toEqual(expect.any(String))
    expect(uploadIds[1]).toBe(uploadIds[0])
    expect(uploadIds[2]).not.toBe(uploadIds[0])
  })

  it('reloads the Dashboard after each imported statement, while the rest are still uploading', async () => {
    const responders: ((response: Response) => void)[] = []
    handleUpload = () => new Promise((resolve) => responders.push(resolve))
    const monthsRequests = () => fetchMock.mock.calls.filter(([url]) => url === '/api/transactions/months').length
    const user = userEvent.setup()
    await renderApp()
    await waitFor(() => expect(monthsRequests()).toBe(1))

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [statementPdf, statementPdf])
    responders[0](Response.json(importedStatement, { status: 201 }))

    await waitFor(() => expect(monthsRequests()).toBe(2))
    expect(addActions().getByRole('button', { name: 'Categorizing… (1/2)' })).toBeDisabled()

    await waitFor(() => expect(responders).toHaveLength(2))
    responders[1](Response.json(importedStatement, { status: 201 }))
    await waitFor(() => expect(monthsRequests()).toBe(3))
  })

  it('sums several imported statements into one line, saying how many had AI categorization unavailable', async () => {
    const statements = [
      { ...importedStatement, transactionCount: 38, uncategorizedCount: 7 },
      { ...importedStatement, id: 8, transactionCount: 40, uncategorizedCount: 0, aiCategorizationUnavailable: true },
      { ...importedStatement, id: 9, transactionCount: 22, uncategorizedCount: 5, aiCategorizationUnavailable: true },
    ]
    let call = 0
    handleUpload = () => Response.json(statements[call++], { status: 201 })
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [statementPdf, statementPdf, statementPdf])

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Imported 3 Bank Statements, 100 transactions: 88 categorized, 12 Uncategorized. ' +
        'AI categorization unavailable for 2 Bank Statements',
    )
  })

  it('says Bank Statement in the singular when AI categorization was unavailable for one of them', async () => {
    let call = 0
    handleUpload = () =>
      Response.json({ ...importedStatement, aiCategorizationUnavailable: call++ === 0 }, { status: 201 })
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [statementPdf, statementPdf])

    expect(await screen.findByRole('status')).toHaveTextContent(
      /AI categorization unavailable for 1 Bank Statement$/,
    )
  })

  it('says when the daily AI limit was reached during the import', async () => {
    handleUpload = () => Response.json({ ...importedStatement, dailyAiLimitReached: true }, { status: 201 })
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(
      'Imported 38 transactions from statement 01.08.2026–31.08.2026: 31 categorized, 7 Uncategorized. ' +
        'Daily AI limit reached until midnight Norwegian time — 7 rows left Uncategorized',
    )
    expect(status).not.toHaveTextContent('AI categorization unavailable')
  })

  it('sums several imported statements into one line, saying how many reached the daily AI limit', async () => {
    const statements = [
      { ...importedStatement, transactionCount: 38, uncategorizedCount: 7, aiCategorizationUnavailable: true },
      { ...importedStatement, id: 8, transactionCount: 40, uncategorizedCount: 3, dailyAiLimitReached: true },
      { ...importedStatement, id: 9, transactionCount: 22, uncategorizedCount: 5, dailyAiLimitReached: true },
    ]
    let call = 0
    handleUpload = () => Response.json(statements[call++], { status: 201 })
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [statementPdf, statementPdf, statementPdf])

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Imported 3 Bank Statements, 100 transactions: 85 categorized, 15 Uncategorized. ' +
        'AI categorization unavailable for 1 Bank Statement. ' +
        'Daily AI limit reached until midnight Norwegian time for 2 Bank Statements',
    )
  })

  it('says Bank Statement in the singular when the daily AI limit was reached for one of them', async () => {
    let call = 0
    handleUpload = () => Response.json({ ...importedStatement, dailyAiLimitReached: call++ === 1 }, { status: 201 })
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [statementPdf, statementPdf])

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(
      /14 Uncategorized\. Daily AI limit reached until midnight Norwegian time for 1 Bank Statement$/,
    )
    expect(status).not.toHaveTextContent('AI categorization unavailable')
  })

  it('says nothing about AI categorization when it was available for every imported statement', async () => {
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [statementPdf, statementPdf])

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Imported 2 Bank Statements, 76 transactions: 62 categorized, 14 Uncategorized')
    expect(status).not.toHaveTextContent('AI categorization')
    expect(status).not.toHaveTextContent('Daily AI limit')
  })

  it('keeps uploading after a rejected statement and lists it by filename under the summary', async () => {
    const uploaded: (FormDataEntryValue | null)[] = []
    const responders: ((response: Response) => void)[] = []
    handleUpload = (body) => {
      uploaded.push(body.get('file'))
      return new Promise((resolve) => responders.push(resolve))
    }
    const julyPdf = new File(['%PDF-1.7'], 'juli.pdf', { type: 'application/pdf' })
    const scanPdf = new File(['%PDF-1.7'], 'scan.pdf', { type: 'application/pdf' })
    const septemberPdf = new File(['%PDF-1.7'], 'september.pdf', { type: 'application/pdf' })
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [julyPdf, scanPdf, septemberPdf])
    responders[0](Response.json(importedStatement, { status: 201 }))
    await waitFor(() => expect(responders).toHaveLength(2))
    responders[1](Response.json({ errors: { file: ['The PDF could not be read. It may be damaged.'] } }, { status: 400 }))

    expect(await addActions().findByRole('button', { name: 'Categorizing… (2/3)' })).toBeDisabled()
    await waitFor(() => expect(uploaded).toEqual([julyPdf, scanPdf, septemberPdf]))
    responders[2](Response.json({ ...importedStatement, id: 8 }, { status: 201 }))

    expect(await screen.findByRole('button', { name: /upload transactions/i })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Imported 2 Bank Statements, 76 transactions: 62 categorized, 14 Uncategorized',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('scan.pdf: The PDF could not be read. It may be damaged.')
  })

  it('lists only the rejected PDFs, one per line, when every statement was rejected', async () => {
    let call = 0
    handleUpload = () => {
      if (call++ === 0) throw new TypeError('Failed to fetch')
      return Response.json({ errors: { file: ['The file is not a PDF.'] } }, { status: 400 })
    }
    const augustPdf = new File(['%PDF-1.7'], 'august.pdf', { type: 'application/pdf' })
    const notesPdf = new File(['notes'], 'notes.pdf', { type: 'application/pdf' })
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [augustPdf, notesPdf])

    const alert = await screen.findByRole('alert')
    expect([...alert.children].map((line) => line.textContent)).toEqual([
      'august.pdf: Could not reach the server.',
      'notes.pdf: The file is not a PDF.',
    ])
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /upload transactions/i })).toBeEnabled()
  })

  it('lists the second copy of a PDF picked twice as already imported', async () => {
    let call = 0
    handleUpload = () =>
      call++ === 0
        ? Response.json(importedStatement, { status: 201 })
        : Response.json(
            {
              title: 'Conflict',
              status: 409,
              detail: 'Statement for 1111.22.33333, 01.08.2026–31.08.2026 has already been imported.',
            },
            { status: 409 },
          )
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [statementPdf, statementPdf])

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'kontoutskrift.pdf: Statement for 1111.22.33333, 01.08.2026–31.08.2026 has already been imported.',
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Imported 38 transactions from statement 01.08.2026–31.08.2026: 31 categorized, 7 Uncategorized',
    )
  })

  it('shows why the server rejected the statement and re-enables the button', async () => {
    handleUpload = () =>
      Response.json(
        { errors: { file: ['The file is not a Sparebanken Norge Bank Statement.'] } },
        { status: 400 },
      )
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'kontoutskrift.pdf: The file is not a Sparebanken Norge Bank Statement.',
    )
    expect(screen.getByRole('button', { name: /upload transactions/i })).toBeEnabled()
  })

  it('says when the statement has already been imported', async () => {
    handleUpload = () =>
      Response.json(
        {
          title: 'Conflict',
          status: 409,
          detail: 'Statement for 1111.22.33333, 01.08.2026–31.08.2026 has already been imported.',
        },
        { status: 409 },
      )
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'kontoutskrift.pdf: Statement for 1111.22.33333, 01.08.2026–31.08.2026 has already been imported.',
    )
  })

  it('shows a general error when the server cannot be reached', async () => {
    handleUpload = () => {
      throw new TypeError('Failed to fetch')
    }
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    expect(await screen.findByRole('alert')).toHaveTextContent('kontoutskrift.pdf: Could not reach the server.')
    expect(screen.getByRole('button', { name: /upload transactions/i })).toBeEnabled()
  })

  it('clears an upload error once a later upload succeeds', async () => {
    handleUpload = () => new Response(null, { status: 500 })
    const user = userEvent.setup()
    await renderApp()
    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)
    expect(await screen.findByRole('alert')).toHaveTextContent('kontoutskrift.pdf: Upload failed (500).')

    handleUpload = () => Response.json(importedStatement, { status: 201 })
    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Imported 38 transactions from statement 01.08.2026–31.08.2026',
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  describe('leaving home', () => {
    it('clears the import summary', async () => {
      const user = userEvent.setup()
      await renderApp()
      await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)
      expect(await screen.findByRole('status')).toHaveTextContent('Imported 38 transactions')

      await user.click(screen.getByRole('button', { name: 'Transactions' }))
      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

      expect(screen.getByRole('status')).toBeEmptyDOMElement()
    })

    it('clears the rejected PDFs', async () => {
      handleUpload = () => new Response(null, { status: 500 })
      const user = userEvent.setup()
      await renderApp()
      await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)
      expect(await screen.findByRole('alert')).toHaveTextContent('kontoutskrift.pdf: Upload failed (500).')

      await user.click(screen.getByRole('button', { name: 'Rules' }))
      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('clears Transaction saved', async () => {
      const user = await openModal()
      await fillValidForm(user)
      await user.click(screen.getByRole('button', { name: /^save$/i }))
      expect(screen.getByRole('status')).toHaveTextContent('Transaction saved')

      await user.click(screen.getByRole('button', { name: 'Categories' }))
      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

      expect(screen.getByRole('status')).toBeEmptyDOMElement()
    })

    it('still shows an upload that finished while away, even after moving between other pages', async () => {
      let respond: (response: Response) => void = () => {}
      handleUpload = () => new Promise((resolve) => (respond = resolve))
      const user = userEvent.setup()
      await renderApp()
      await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

      await user.click(screen.getByRole('button', { name: 'Transactions' }))
      const response = Response.json(importedStatement, { status: 201 })
      const read = vi.spyOn(response, 'json')
      respond(response)
      // Lets the upload finish while away, before moving on to another page.
      await waitFor(() => expect(read).toHaveBeenCalled())
      await act(async () => {})
      await user.click(screen.getByRole('button', { name: 'Categories' }))
      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

      expect(await screen.findByRole('button', { name: /upload transactions/i })).toBeEnabled()
      expect(screen.getByRole('status')).toHaveTextContent('Imported 38 transactions')
    })

    it('is not clicking the title while on home, which keeps the messages', async () => {
      const user = userEvent.setup()
      await renderApp()
      await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)
      expect(await screen.findByRole('status')).toHaveTextContent('Imported 38 transactions')

      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

      expect(screen.getByRole('status')).toHaveTextContent('Imported 38 transactions')
    })
  })

  it('shows the import summary in place of Transaction saved when a transaction is saved during an upload', async () => {
    let respond: (response: Response) => void = () => {}
    handleUpload = () => new Promise((resolve) => (respond = resolve))
    const user = await openModal()
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    await user.click(screen.getByRole('button', { name: 'Add transaction' }))
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(screen.getByRole('status')).toHaveTextContent('Transaction saved')
    respond(Response.json(importedStatement, { status: 201 }))

    expect(await screen.findByRole('button', { name: /upload transactions/i })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('Imported 38 transactions')
  })

  it('keeps Transaction saved on screen until something replaces it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = await openModal()
      await fillValidForm(user)
      await user.click(screen.getByRole('button', { name: /^save$/i }))

      await act(() => vi.advanceTimersByTimeAsync(60_000))

      expect(screen.getByRole('status')).toHaveTextContent('Transaction saved')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Possible duplicate notice', () => {
  type PossibleDuplicate = { id: number; date: string; description: string; amount: number }

  // What the Possible duplicate endpoint answers for a date and a signed Amount, and every question
  // it was asked.
  let handlePossibleDuplicates: (date: string, amount: number) => Response | Promise<Response>
  let asked: { date: string; amount: number }[]

  const rema: PossibleDuplicate = { id: 5, date: '2026-10-14', description: 'REMA 1000 GRØNLAND', amount: -249.9 }
  const kiwi: PossibleDuplicate = { id: 9, date: '2026-10-16', description: 'Kiwi Torggata', amount: -249.9 }

  // Answers rema and kiwi as the Possible duplicates of Out 249.90, and none for any other Amount.
  function answerTwoForOut24990() {
    handlePossibleDuplicates = (_date, amount) => Response.json(amount === -249.9 ? [rema, kiwi] : [])
  }

  // The form asks only once typing has paused, so the tests move the clock on past that pause.
  async function afterThePause() {
    await act(() => vi.advanceTimersByTimeAsync(1_000))
  }

  function notice() {
    return screen.queryByRole('region', { name: /possible duplicate/i })
  }

  function findNotice() {
    return screen.findByRole('region', { name: /possible duplicate/i })
  }

  // Puts the whole value in at once, so that no half-typed value is ever valid on the way, such as
  // 10.00 of 10.005.
  async function enter(user: ReturnType<typeof userEvent.setup>, label: RegExp, value: string) {
    await user.clear(screen.getByLabelText(label))
    if (value !== '') await user.paste(value)
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    handlePossibleDuplicates = () => Response.json([])
    asked = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const possibleDuplicatesUrl = /^\/api\/transactions\/possible-duplicates\?(.*)$/.exec(url)
        if (!possibleDuplicatesUrl) return fetchMock(url, init)
        const query = new URLSearchParams(possibleDuplicatesUrl[1])
        const question = { date: query.get('date')!, amount: Number(query.get('amount')) }
        asked.push(question)
        return handlePossibleDuplicates(question.date, question.amount)
      }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("lists each Possible duplicate's date, Description and Amount once Date and amount are filled", async () => {
    answerTwoForOut24990()
    const user = await openModal()

    await user.type(screen.getByLabelText(/^out$/i), '249.90')
    await afterThePause()

    const items = within(await findNotice()).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('14.10.2026')).toBeInTheDocument()
    expect(within(items[0]).getByText('REMA 1000 GRØNLAND')).toBeInTheDocument()
    expect(within(items[0]).getByText('-249,90 kr')).toBeInTheDocument()
    expect(within(items[1]).getByText('16.10.2026')).toBeInTheDocument()
    expect(within(items[1]).getByText('Kiwi Torggata')).toBeInTheDocument()
    expect(asked.at(-1)).toEqual({ date: todayIsoDate(), amount: -249.9 })
  })

  it('asks nothing and shows no notice while the Date or amount is empty or invalid', async () => {
    handlePossibleDuplicates = () => Response.json([rema])
    const user = await openModal()

    // Today's date but no amount.
    await afterThePause()
    expect(asked).toEqual([])

    await enter(user, /^out$/i, '0')
    await afterThePause()
    expect(asked).toEqual([])

    await enter(user, /^out$/i, '10.005')
    await afterThePause()
    expect(asked).toEqual([])

    // Both In and Out.
    await enter(user, /^in$/i, '249.90')
    await afterThePause()
    expect(asked).toEqual([])

    // A valid amount but no date.
    await enter(user, /date/i, '')
    await enter(user, /^out$/i, '')
    await afterThePause()
    expect(asked).toEqual([])
    expect(screen.getByLabelText(/^in$/i)).toHaveValue(249.9)
    expect(notice()).not.toBeInTheDocument()
  })

  it('follows the Date and amount, and goes away when there are none for them', async () => {
    handlePossibleDuplicates = (date, amount) =>
      Response.json(date === '2026-10-15' && amount === -249.9 ? [rema] : [])
    const user = await openModal()
    await enter(user, /date/i, '2026-10-15')

    await enter(user, /^out$/i, '249.90')
    await afterThePause()
    expect(await findNotice()).toHaveTextContent('REMA 1000 GRØNLAND')

    await enter(user, /^out$/i, '100')
    await afterThePause()
    await waitFor(() => expect(asked.at(-1)).toEqual({ date: '2026-10-15', amount: -100 }))
    expect(notice()).not.toBeInTheDocument()

    await enter(user, /^out$/i, '249.90')
    await afterThePause()
    expect(await findNotice()).toBeInTheDocument()

    await enter(user, /date/i, '2026-10-25')
    await afterThePause()
    await waitFor(() => expect(asked.at(-1)).toEqual({ date: '2026-10-25', amount: -249.9 }))
    expect(notice()).not.toBeInTheDocument()
  })

  it('ignores an answer that arrives after the amount has changed', async () => {
    let answerLate: (response: Response) => void = () => {}
    handlePossibleDuplicates = (_date, amount) =>
      amount === -249.9 ? new Promise((resolve) => (answerLate = resolve)) : Response.json([])
    const user = await openModal()
    const amountOut = screen.getByLabelText(/^out$/i)

    await user.type(amountOut, '249.90')
    await afterThePause()
    await user.clear(amountOut)
    await user.paste('100')
    await afterThePause()
    await waitFor(() => expect(asked.at(-1)).toEqual({ date: todayIsoDate(), amount: -100 }))
    await act(async () => answerLate(Response.json([rema])))

    expect(notice()).not.toBeInTheDocument()
  })

  it('shows nothing when the check fails', async () => {
    handlePossibleDuplicates = () => new Response(null, { status: 500 })
    const user = await openModal()

    await user.type(screen.getByLabelText(/^out$/i), '249.90')
    await afterThePause()
    await waitFor(() => expect(asked).toHaveLength(1))

    expect(notice()).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('saves the Transaction while the notice shows', async () => {
    answerTwoForOut24990()
    let posted: unknown
    handlePost = (body) => {
      posted = body
      return Response.json({ id: 1 }, { status: 201 })
    }
    const user = await openModal()
    await fillValidForm(user)
    await afterThePause()
    await findNotice()

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(posted).toEqual({
      date: todayIsoDate(),
      description: 'Rema 1000',
      amount: -249.9,
      note: null,
      categoryId: 1,
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Transaction saved')
  })
})

describe('Categories page', () => {
  async function openCategoriesPage() {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'Categories' }))
    await screen.findByRole('heading', { name: 'Categories' })
    return user
  }

  // Each listed Category's cells, in the order shown.
  async function listedRows() {
    await screen.findByText('All groceries.')
    return screen
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .slice(0, 4)
          .map((cell) => cell.textContent),
      )
  }

  it('opens from the header and lists each Category with its description and counts, in the order served', async () => {
    categoriesServed = [
      categories[0],
      { id: 7, name: 'Health', description: 'Pharmacy etc.', builtIn: false, transactionCount: 0, ruleCount: 2 },
      categories[1],
    ]
    await openCategoriesPage()

    expect((await listedRows()).map((cells) => cells.slice(0, 4))).toEqual([
      ['Groceries Built-in', 'All groceries.', '12', '3'],
      ['Health', 'Pharmacy etc.', '0', '2'],
      ['Other Built-in', "Costs that don't belong in any other category.", '1', '0'],
    ])
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Name',
      'Description',
      'Transactions',
      'Rules',
      'Actions',
    ])
  })

  it('marks only the Built-in Categories with a badge', async () => {
    categoriesServed = [
      categories[0],
      { id: 7, name: 'Health', description: 'Pharmacy etc.', builtIn: false, transactionCount: 0, ruleCount: 0 },
    ]
    await openCategoriesPage()
    await listedRows()

    expect(screen.getAllByText('Built-in')).toHaveLength(1)
    expect(within(screen.getByRole('row', { name: /Groceries/ })).getByText('Built-in')).toBeInTheDocument()
  })

  it('adds a Category, lists it by name after the Built-in Categories and offers it on the Rules page', async () => {
    const health = { id: 7, name: 'Health', description: 'Pharmacy etc.', builtIn: false, transactionCount: 0, ruleCount: 0 }
    categoriesServed = [...categories, health]
    let posted: unknown
    handleAddCategory = (body) => {
      posted = body
      const added = {
        id: 20,
        name: 'Fitness',
        description: 'Gym and sports.',
        colour: '#0891b2',
        builtIn: false,
        transactionCount: 0,
        ruleCount: 0,
      }
      categoriesServed = [...categories, added, health]
      return Response.json(added, { status: 201 })
    }
    const user = await openCategoriesPage()
    await listedRows()

    await user.type(screen.getByLabelText('Name'), '  Fitness ')
    await user.type(screen.getByLabelText('Description'), ' Gym and sports.  ')
    await user.click(screen.getByRole('button', { name: 'Add category' }))

    expect(posted).toEqual({ name: 'Fitness', description: 'Gym and sports.' })
    expect(await screen.findByRole('status')).toHaveTextContent('Category added.')
    expect(await listedRows()).toEqual([
      ['Groceries Built-in', 'All groceries.', '12', '3'],
      ['Other Built-in', "Costs that don't belong in any other category.", '1', '0'],
      ['Fitness', 'Gym and sports.', '0', '0'],
      ['Health', 'Pharmacy etc.', '0', '0'],
    ])
    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(screen.getByLabelText('Description')).toHaveValue('')

    await user.click(screen.getByRole('button', { name: 'Rules' }))
    expect(await screen.findByRole('option', { name: 'Fitness' })).toBeInTheDocument()
  })

  it('places an added Category where the API lists it: in the Norwegian alphabet, whatever the browser language', async () => {
    const health = { id: 7, name: 'Health', description: 'Pharmacy etc.', builtIn: false, transactionCount: 0, ruleCount: 0 }
    const yearly = { id: 8, name: 'Årlig', description: 'Yearly costs.', builtIn: false, transactionCount: 0, ruleCount: 0 }
    categoriesServed = [...categories, health, yearly]
    handleAddCategory = () =>
      Response.json(
        { id: 20, name: 'Ære', description: 'Gifts.', builtIn: false, transactionCount: 0, ruleCount: 0 },
        { status: 201 },
      )
    const user = await openCategoriesPage()
    await listedRows()

    await user.type(screen.getByLabelText('Name'), 'Ære')
    await user.type(screen.getByLabelText('Description'), 'Gifts.')
    await user.click(screen.getByRole('button', { name: 'Add category' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Category added.')
    expect((await listedRows()).map((cells) => cells[0])).toEqual([
      'Groceries Built-in',
      'Other Built-in',
      'Health',
      'Ære',
      'Årlig',
    ])
  })

  it("shows the server's field errors and keeps the input", async () => {
    handleAddCategory = () =>
      Response.json(
        {
          errors: {
            name: ["A category named 'Groceries' already exists."],
            description: ['Description is required.'],
          },
        },
        { status: 400 },
      )
    const user = await openCategoriesPage()
    await listedRows()

    await user.type(screen.getByLabelText('Name'), 'groceries')
    await user.click(screen.getByRole('button', { name: 'Add category' }))

    expect(await screen.findByText("A category named 'Groceries' already exists.")).toBeInTheDocument()
    expect(screen.getByText('Description is required.')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('groceries')
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('shows a general error when the server cannot be reached', async () => {
    handleAddCategory = () => {
      throw new TypeError('Failed to fetch')
    }
    const user = await openCategoriesPage()
    await listedRows()

    await user.type(screen.getByLabelText('Name'), 'Hobby')
    await user.type(screen.getByLabelText('Description'), 'Hobby supplies.')
    await user.click(screen.getByRole('button', { name: 'Add category' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.')
    expect(screen.getByLabelText('Name')).toHaveValue('Hobby')
  })

  it('says when the Categories could not be loaded', async () => {
    categoriesServed = new Response(null, { status: 500 })
    await openCategoriesPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the categories.')
  })

  describe('deleting', () => {
    const health = { id: 7, name: 'Health', description: 'Pharmacy etc.', builtIn: false, transactionCount: 0, ruleCount: 0 }

    function categoryRow(name: string) {
      return screen.getByRole('row', { name: new RegExp(`^${name}`) })
    }

    it('offers delete only on Categories that are not Built-in, showing it disabled on the rest', async () => {
      categoriesServed = [categories[0], health, categories[1]]
      await openCategoriesPage()
      await listedRows()

      expect(within(categoryRow('Health')).getByRole('button', { name: 'Delete' })).toBeEnabled()
      for (const builtIn of ['Groceries', 'Other']) {
        const deleteButton = within(categoryRow(builtIn)).getByRole('button', { name: 'Delete' })
        expect(deleteButton).toBeDisabled()
        expect(deleteButton).toHaveAttribute('title', "Built-in Categories can't be deleted")
      }
    })

    it('asks for confirmation, then deletes the Category and removes its row', async () => {
      categoriesServed = [categories[0], health]
      let deletedId: number | undefined
      handleDeleteCategory = (id) => {
        deletedId = id
        return Response.json({ transactionsChanged: 0 })
      }
      const user = await openCategoriesPage()
      await listedRows()

      await user.click(within(categoryRow('Health')).getByRole('button', { name: 'Delete' }))

      expect(deletedId).toBeUndefined()
      expect(within(categoryRow('Health')).getByText('Delete Health?')).toBeInTheDocument()

      await user.click(within(categoryRow('Health')).getByRole('button', { name: 'Confirm delete' }))

      expect(deletedId).toBe(7)
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Category deleted. 0 transactions changed category.',
      )
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
      expect(screen.queryByRole('row', { name: /^Health/ })).not.toBeInTheDocument()
    })

    it('asks for a replacement when the Category is in use, and moves it there', async () => {
      categoriesServed = [categories[0], { ...health, transactionCount: 3, ruleCount: 2 }, categories[1]]
      let deleted: { id: number; query: string } | undefined
      handleDeleteCategory = (id, query) => {
        deleted = { id, query: query.toString() }
        return Response.json({ transactionsChanged: 3 })
      }
      const user = await openCategoriesPage()
      await listedRows()

      await user.click(within(categoryRow('Health')).getByRole('button', { name: 'Delete' }))

      const replacement = within(categoryRow('Health')).getByRole('combobox', {
        name: 'Move its transactions and rules to',
      })
      expect(within(replacement).getAllByRole('option').map((option) => option.textContent)).toEqual([
        'Choose a category',
        'Groceries',
        'Other',
      ])
      const confirm = within(categoryRow('Health')).getByRole('button', { name: 'Confirm delete' })
      expect(confirm).toBeDisabled()

      await user.selectOptions(replacement, 'Other')
      expect(within(categoryRow('Health')).getByRole('radio', { name: 'Move its transactions and rules to' })).toBeChecked()
      await user.click(confirm)

      expect(deleted).toEqual({ id: 7, query: 'replacementCategoryId=13' })
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Category deleted. 3 transactions changed category.',
      )
      expect(await listedRows()).toEqual([
        ['Groceries Built-in', 'All groceries.', '12', '3'],
        ['Other Built-in', "Costs that don't belong in any other category.", '4', '2'],
      ])
    })

    it('offers deleting its rules instead, and says how many transactions changed category', async () => {
      categoriesServed = [categories[0], { ...health, transactionCount: 2, ruleCount: 1 }, categories[1]]
      let deleted: { id: number; query: string } | undefined
      handleDeleteCategory = (id, query) => {
        deleted = { id, query: query.toString() }
        // A remaining Groceries rule picked up one of its Transactions; the other is Uncategorized.
        categoriesServed = [{ ...categories[0], transactionCount: 13 }, categories[1]]
        return Response.json({ transactionsChanged: 2 })
      }
      const user = await openCategoriesPage()
      await listedRows()

      await user.click(within(categoryRow('Health')).getByRole('button', { name: 'Delete' }))

      const row = categoryRow('Health')
      const choices = within(row).getByRole('group', { name: 'Delete Health?' })
      const move = within(choices).getByRole('radio', { name: 'Move its transactions and rules to' })
      const deleteRules = within(choices).getByRole('radio', {
        name: 'Delete its rules and leave its transactions Uncategorized unless another rule matches them',
      })
      const confirm = within(row).getByRole('button', { name: 'Confirm delete' })
      expect(move).not.toBeChecked()
      expect(deleteRules).not.toBeChecked()
      expect(confirm).toBeDisabled()

      await user.click(deleteRules)
      expect(confirm).toBeEnabled()

      // Moving needs a replacement chosen first.
      await user.click(move)
      expect(confirm).toBeDisabled()

      await user.click(deleteRules)
      await user.click(confirm)

      expect(deleted).toEqual({ id: 7, query: 'deleteRules=true' })
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Category deleted. 2 transactions changed category.',
      )
      // Reloaded, since the remaining rules may have given its Transactions to other Categories.
      await waitFor(async () =>
        expect(await listedRows()).toEqual([
          ['Groceries Built-in', 'All groceries.', '13', '3'],
          ['Other Built-in', "Costs that don't belong in any other category.", '1', '0'],
        ]),
      )
    })

    it("shows the server's reason when the replacement is refused", async () => {
      categoriesServed = [categories[0], { ...health, ruleCount: 1 }]
      handleDeleteCategory = () =>
        Response.json(
          { status: 400, errors: { replacementCategoryId: ['The replacement Category does not exist.'] } },
          { status: 400 },
        )
      const user = await openCategoriesPage()
      await listedRows()

      await user.click(within(categoryRow('Health')).getByRole('button', { name: 'Delete' }))
      await user.selectOptions(within(categoryRow('Health')).getByRole('combobox'), 'Groceries')
      await user.click(within(categoryRow('Health')).getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('The replacement Category does not exist.')
      expect(within(categoryRow('Health')).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    })

    it('keeps the Category when the confirmation is cancelled', async () => {
      categoriesServed = [categories[0], health]
      let deleted = false
      handleDeleteCategory = () => {
        deleted = true
        return Response.json({ transactionsChanged: 0 })
      }
      const user = await openCategoriesPage()
      await listedRows()

      await user.click(within(categoryRow('Health')).getByRole('button', { name: 'Delete' }))
      await user.click(within(categoryRow('Health')).getByRole('button', { name: 'Cancel' }))

      expect(deleted).toBe(false)
      expect(within(categoryRow('Health')).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
      expect(screen.queryByText('Delete Health?')).not.toBeInTheDocument()
    })

    it("shows the server's reason and keeps the row when the delete is refused", async () => {
      // Listed as unused, but something started using it since.
      categoriesServed = [categories[0], health]
      handleDeleteCategory = () =>
        Response.json(
          { status: 400, errors: { category: ["Health is in use, so it can't be deleted."] } },
          { status: 400 },
        )
      const user = await openCategoriesPage()
      await listedRows()

      await user.click(within(categoryRow('Health')).getByRole('button', { name: 'Delete' }))
      await user.click(within(categoryRow('Health')).getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByRole('alert')).toHaveTextContent("Health is in use, so it can't be deleted.")
      expect(within(categoryRow('Health')).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    })

    it('removes a Category that was already deleted elsewhere', async () => {
      categoriesServed = [categories[0], health]
      handleDeleteCategory = () => Response.json({ title: 'Not Found', status: 404 }, { status: 404 })
      const user = await openCategoriesPage()
      await listedRows()

      await user.click(within(categoryRow('Health')).getByRole('button', { name: 'Delete' }))
      await user.click(within(categoryRow('Health')).getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByRole('status')).toHaveTextContent('The category was already deleted.')
      expect(screen.queryByRole('row', { name: /^Health/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it("clears the add form's errors once a delete succeeds", async () => {
      categoriesServed = [categories[0], health]
      handleAddCategory = () => Response.json({ errors: { name: ['Name is required.'] } }, { status: 400 })
      const user = await openCategoriesPage()
      await listedRows()
      await user.click(screen.getByRole('button', { name: 'Add category' }))
      await screen.findByText('Name is required.')

      await user.click(within(categoryRow('Health')).getByRole('button', { name: 'Delete' }))
      await user.click(within(categoryRow('Health')).getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Category deleted.')
      expect(screen.queryByText('Name is required.')).not.toBeInTheDocument()
    })

    it('shows a general error when a delete cannot reach the server', async () => {
      categoriesServed = [categories[0], health]
      handleDeleteCategory = () => {
        throw new TypeError('Failed to fetch')
      }
      const user = await openCategoriesPage()
      await listedRows()

      await user.click(within(categoryRow('Health')).getByRole('button', { name: 'Delete' }))
      await user.click(within(categoryRow('Health')).getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.')
      expect(categoryRow('Health')).toBeInTheDocument()
    })
  })

  describe('editing', () => {
    const health = { id: 7, name: 'Health', description: 'Pharmacy etc.', builtIn: false, transactionCount: 4, ruleCount: 2 }

    function categoryRow(name: RegExp) {
      return screen.getByRole('row', { name })
    }

    async function startEditing(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
      await user.click(within(categoryRow(name)).getByRole('button', { name: 'Edit' }))
      const row = screen.getByRole('button', { name: 'Save' }).closest('tr')!
      return within(row)
    }

    it('edits a Category inline and keeps it sorted by name after the Built-in Categories', async () => {
      const travel = { id: 10, name: 'Travel', description: 'All travel.', builtIn: false, transactionCount: 0, ruleCount: 0 }
      categoriesServed = [...categories, health, travel]
      let edited: { id: number; body: unknown } | undefined
      handleEditCategory = (id, body) => {
        edited = { id, body }
        return Response.json({ ...health, name: 'Wellness', description: 'Pharmacy, gym etc.' })
      }
      const user = await openCategoriesPage()
      await listedRows()

      const row = await startEditing(user, /Health/)
      expect(row.getByLabelText('Name')).toHaveValue('Health')
      expect(row.getByLabelText('Description')).toHaveValue('Pharmacy etc.')
      await user.clear(row.getByLabelText('Name'))
      await user.type(row.getByLabelText('Name'), ' Wellness ')
      await user.clear(row.getByLabelText('Description'))
      await user.type(row.getByLabelText('Description'), 'Pharmacy, gym etc. ')
      await user.click(row.getByRole('button', { name: 'Save' }))

      expect(edited).toEqual({ id: 7, body: { name: 'Wellness', description: 'Pharmacy, gym etc.' } })
      expect(await screen.findByRole('status')).toHaveTextContent('Category updated.')
      expect(await listedRows()).toEqual([
        ['Groceries Built-in', 'All groceries.', '12', '3'],
        ['Other Built-in', "Costs that don't belong in any other category.", '1', '0'],
        ['Travel', 'All travel.', '0', '0'],
        ['Wellness', 'Pharmacy, gym etc.', '4', '2'],
      ])
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })

    it("edits only a Built-in Category's description, sending its name unchanged", async () => {
      let edited: unknown
      handleEditCategory = (_id, body) => {
        edited = body
        return Response.json({ ...categories[0], description: 'Food and drink.' })
      }
      const user = await openCategoriesPage()
      await listedRows()

      const row = await startEditing(user, /Groceries/)
      expect(row.queryByLabelText('Name')).not.toBeInTheDocument()
      expect(row.getByText('Groceries')).toBeInTheDocument()
      await user.clear(row.getByLabelText('Description'))
      await user.type(row.getByLabelText('Description'), 'Food and drink.')
      await user.click(row.getByRole('button', { name: 'Save' }))

      expect(edited).toEqual({ name: 'Groceries', description: 'Food and drink.' })
      expect(await screen.findByRole('status')).toHaveTextContent('Category updated.')
      expect(within(categoryRow(/Groceries/)).getByText('Food and drink.')).toBeInTheDocument()
    })

    it('cancels an edit and restores the row', async () => {
      categoriesServed = [health]
      const user = await openCategoriesPage()
      await screen.findByText('Pharmacy etc.')

      const row = await startEditing(user, /Health/)
      await user.type(row.getByLabelText('Name'), ' extra')
      await user.click(row.getByRole('button', { name: 'Cancel' }))

      expect(categoryRow(/Health/)).toHaveTextContent('HealthPharmacy etc.42')
      expect(fetchMock).not.toHaveBeenCalledWith('/api/categories/7', expect.anything())
    })

    it("shows the server's field errors on an edit and keeps the input", async () => {
      categoriesServed = [categories[0], health]
      handleEditCategory = () =>
        Response.json(
          {
            errors: {
              name: ["A category named 'Groceries' already exists."],
              description: ['Description is required.'],
            },
          },
          { status: 400 },
        )
      const user = await openCategoriesPage()
      await listedRows()

      const row = await startEditing(user, /Health/)
      await user.clear(row.getByLabelText('Name'))
      await user.type(row.getByLabelText('Name'), 'GROCERIES')
      await user.clear(row.getByLabelText('Description'))
      await user.click(row.getByRole('button', { name: 'Save' }))

      const nameError = await row.findByText("A category named 'Groceries' already exists.")
      expect(row.getByLabelText('Name')).toHaveAccessibleDescription(nameError.textContent!)
      expect(row.getByLabelText('Description')).toHaveAccessibleDescription('Description is required.')
      expect(row.getByLabelText('Name')).toHaveValue('GROCERIES')
    })

    it('shows a general error when an edit cannot reach the server', async () => {
      categoriesServed = [health]
      handleEditCategory = () => {
        throw new TypeError('Failed to fetch')
      }
      const user = await openCategoriesPage()
      await screen.findByText('Pharmacy etc.')

      const row = await startEditing(user, /Health/)
      await user.type(row.getByLabelText('Name'), ' extra')
      await user.click(row.getByRole('button', { name: 'Save' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.')
      expect(row.getByLabelText('Name')).toHaveValue('Health extra')
    })

    it("clears the add form's errors once an edit is saved", async () => {
      categoriesServed = [categories[0], health]
      handleAddCategory = () => Response.json({ errors: { name: ['Name is required.'] } }, { status: 400 })
      const user = await openCategoriesPage()
      await listedRows()
      await user.click(screen.getByRole('button', { name: 'Add category' }))
      await screen.findByText('Name is required.')

      const row = await startEditing(user, /Health/)
      await user.type(row.getByLabelText('Description'), ' and more')
      await user.click(row.getByRole('button', { name: 'Save' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Category updated.')
      expect(screen.queryByText('Name is required.')).not.toBeInTheDocument()
    })

    it('keeps a cancelled edit closed when its save then fails', async () => {
      categoriesServed = [health]
      let respond: (response: Response) => void = () => {}
      handleEditCategory = () => new Promise((resolve) => (respond = resolve))
      const user = await openCategoriesPage()
      await screen.findByText('Pharmacy etc.')

      const row = await startEditing(user, /Health/)
      await user.clear(row.getByLabelText('Name'))
      await user.click(row.getByRole('button', { name: 'Save' }))
      await user.click(row.getByRole('button', { name: 'Cancel' }))
      respond(Response.json({ errors: { name: ['Name is required.'] } }, { status: 400 }))

      // Delete is disabled while the save is in flight.
      await waitFor(() => expect(within(categoryRow(/Health/)).getByRole('button', { name: 'Delete' })).toBeEnabled())
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      expect(screen.queryByText('Name is required.')).not.toBeInTheDocument()
    })
  })
})

describe('Rules page', () => {
  async function openRulesPage() {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'Rules' }))
    await screen.findByRole('cell', { name: 'kiwi' })
    return user
  }

  it('opens from the header and lists the rules with their Category names', async () => {
    await openRulesPage()

    const rows = screen.getAllByRole('row').slice(1)
    expect(
      rows.map((row) => within(row).getAllByRole('cell').slice(0, 2).map((cell) => cell.textContent)),
    ).toEqual([
      ['kiwi', 'Groceries'],
      ['overføring mellom egne kontoer', 'Other'],
    ])
  })

  it('adds a rule and says how many transactions changed category', async () => {
    let posted: unknown
    handleAddRule = (body) => {
      posted = body
      return Response.json(
        { id: 3, keyword: 'rema', categoryId: 1, aiGenerated: false, isNew: false, transactionsChanged: 3 },
        { status: 201 },
      )
    }
    const user = await openRulesPage()

    await user.type(screen.getByLabelText('Keyword'), '  rema ')
    await user.selectOptions(screen.getByLabelText('Category'), 'Groceries')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))

    expect(posted).toEqual({ keyword: 'rema', categoryId: 1 })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Rule added. 3 transactions changed category.',
    )
    expect(screen.getByRole('cell', { name: 'rema' })).toBeInTheDocument()
    expect(screen.getByLabelText('Keyword')).toHaveValue('')
  })

  it("shows the server's field error and keeps the input", async () => {
    handleAddRule = () =>
      Response.json({ errors: { keyword: ["A rule for 'Kiwi' already exists."] } }, { status: 400 })
    const user = await openRulesPage()

    await user.type(screen.getByLabelText('Keyword'), 'KIWI')
    await user.selectOptions(screen.getByLabelText('Category'), 'Groceries')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))

    expect(await screen.findByText("A rule for 'Kiwi' already exists.")).toBeInTheDocument()
    expect(screen.getByLabelText('Keyword')).toHaveValue('KIWI')
  })

  it('shows a general error when the server cannot be reached', async () => {
    handleAddRule = () => {
      throw new TypeError('Failed to fetch')
    }
    const user = await openRulesPage()

    await user.type(screen.getByLabelText('Keyword'), 'rema')
    await user.selectOptions(screen.getByLabelText('Category'), 'Groceries')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.')
    expect(screen.getByLabelText('Keyword')).toHaveValue('rema')
  })

  it('says when the rules could not be loaded', async () => {
    rules = new Response(null, { status: 500 })
    const user = userEvent.setup()
    await renderApp()

    await user.click(screen.getByRole('button', { name: 'Rules' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the rules.')
  })

  it('clears an earlier field error when the next attempt fails for another reason', async () => {
    handleAddRule = () =>
      Response.json({ errors: { keyword: ["A rule for 'Kiwi' already exists."] } }, { status: 400 })
    const user = await openRulesPage()
    await user.type(screen.getByLabelText('Keyword'), 'kiwi')
    await user.selectOptions(screen.getByLabelText('Category'), 'Groceries')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    await screen.findByText("A rule for 'Kiwi' already exists.")

    handleAddRule = () => {
      throw new TypeError('Failed to fetch')
    }
    await user.click(screen.getByRole('button', { name: 'Add rule' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.')
    expect(screen.queryByText("A rule for 'Kiwi' already exists.")).not.toBeInTheDocument()
  })

  function ruleRow(keyword: string) {
    const row = screen.getByRole('cell', { name: keyword }).closest('tr')
    if (!row) throw new Error(`No row for ${keyword}`)
    return row
  }

  async function startEditingKiwi(user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(ruleRow('kiwi')).getByRole('button', { name: 'Edit' }))
    const row = screen.getByRole('button', { name: 'Save' }).closest('tr')!
    return within(row)
  }

  it('edits a rule inline and says how many transactions changed category', async () => {
    let edited: { id: number; body: unknown } | undefined
    handleEditRule = (id, body) => {
      edited = { id, body }
      return Response.json({
        id,
        keyword: 'kiwi minipris',
        categoryId: 13,
        aiGenerated: false,
        isNew: false,
        transactionsChanged: 1,
      })
    }
    const user = await openRulesPage()

    const row = await startEditingKiwi(user)
    expect(row.getByLabelText('Keyword')).toHaveValue('kiwi')
    expect(row.getByLabelText('Category')).toHaveValue('1')
    await user.clear(row.getByLabelText('Keyword'))
    await user.type(row.getByLabelText('Keyword'), ' kiwi minipris ')
    await user.selectOptions(row.getByLabelText('Category'), 'Other')
    await user.click(row.getByRole('button', { name: 'Save' }))

    expect(edited).toEqual({ id: 1, body: { keyword: 'kiwi minipris', categoryId: 13 } })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Rule updated. 1 transaction changed category.',
    )
    expect(ruleRow('kiwi minipris')).toHaveTextContent('kiwi miniprisOther')
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('cancels an edit and restores the row', async () => {
    const user = await openRulesPage()

    const row = await startEditingKiwi(user)
    await user.type(row.getByLabelText('Keyword'), ' extra')
    await user.selectOptions(row.getByLabelText('Category'), 'Other')
    await user.click(row.getByRole('button', { name: 'Cancel' }))

    expect(ruleRow('kiwi')).toHaveTextContent('kiwiGroceries')
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringMatching(/\/1$/), expect.anything())
  })

  it("shows the server's field error on an edit and keeps the input", async () => {
    handleEditRule = () =>
      Response.json(
        { errors: { keyword: ["A rule for 'overføring mellom egne kontoer' already exists."] } },
        { status: 400 },
      )
    const user = await openRulesPage()

    const row = await startEditingKiwi(user)
    await user.clear(row.getByLabelText('Keyword'))
    await user.type(row.getByLabelText('Keyword'), 'Overføring mellom egne kontoer')
    await user.click(row.getByRole('button', { name: 'Save' }))

    const error = await row.findByText("A rule for 'overføring mellom egne kontoer' already exists.")
    expect(row.getByLabelText('Keyword')).toHaveAccessibleDescription(error.textContent!)
    expect(row.getByLabelText('Keyword')).toHaveValue('Overføring mellom egne kontoer')
  })

  it('shows a general error when an edit cannot reach the server', async () => {
    handleEditRule = () => {
      throw new TypeError('Failed to fetch')
    }
    const user = await openRulesPage()

    const row = await startEditingKiwi(user)
    await user.type(row.getByLabelText('Keyword'), ' extra')
    await user.click(row.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.')
    expect(row.getByLabelText('Keyword')).toHaveValue('kiwi extra')
  })

  it('deletes a rule and says how many transactions changed category', async () => {
    let deletedId: number | undefined
    handleDeleteRule = (id) => {
      deletedId = id
      return Response.json({ transactionsChanged: 2 })
    }
    const user = await openRulesPage()

    await user.click(within(ruleRow('kiwi')).getByRole('button', { name: 'Delete' }))

    expect(deletedId).toBe(1)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Rule deleted. 2 transactions changed category.',
    )
    expect(screen.queryByRole('cell', { name: 'kiwi' })).not.toBeInTheDocument()
  })

  it('removes a rule that was already deleted elsewhere', async () => {
    handleDeleteRule = () => Response.json({ title: 'Not Found', status: 404 }, { status: 404 })
    const user = await openRulesPage()

    await user.click(within(ruleRow('kiwi')).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('status')).toHaveTextContent('The rule was already deleted.')
    expect(screen.queryByRole('cell', { name: 'kiwi' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a general error when a delete cannot reach the server', async () => {
    handleDeleteRule = () => {
      throw new TypeError('Failed to fetch')
    }
    const user = await openRulesPage()

    await user.click(within(ruleRow('kiwi')).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.')
    expect(screen.getByRole('cell', { name: 'kiwi' })).toBeInTheDocument()
  })
  function keywords() {
    return screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0].textContent)
  }

  it('shows an AI badge next to the keyword of AI-generated rules only, with no filter for them', async () => {
    rules = [
      { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: false },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
    ]
    await openRulesPage()

    expect(within(ruleRow('café løkka AI')).getByText('AI')).toBeInTheDocument()
    expect(within(ruleRow('kiwi')).queryByText('AI')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'AI only' })).not.toBeInTheDocument()
  })

  it('shows a New badge on rules added by the last upload, and can show only those', async () => {
    rules = [
      { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: true },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
      { id: 4, keyword: 'nille', categoryId: 13, aiGenerated: false, isNew: true },
    ]
    const user = await openRulesPage()

    expect(keywords()).toEqual(['café løkka AI New', 'kiwi', 'nille New'])

    await user.click(screen.getByRole('checkbox', { name: 'Show only new' }))

    expect(keywords()).toEqual(['café løkka AI New', 'nille New'])
  })

  it('disables Show only new when the last upload added no rules', async () => {
    await openRulesPage()

    expect(screen.getByRole('checkbox', { name: 'Show only new' })).toBeDisabled()
    expect(screen.getByText('Show only new').closest('label')).toHaveAttribute(
      'title',
      'The last upload added no rules',
    )
  })

  it('drops the AI badge once an AI-generated rule is saved, even unchanged', async () => {
    rules = [
      { id: 3, keyword: 'bakeriet', categoryId: 13, aiGenerated: true, isNew: false },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
      { id: 4, keyword: 'nille', categoryId: 13, aiGenerated: true, isNew: false },
    ]
    const user = await openRulesPage()

    await user.click(within(ruleRow('bakeriet AI')).getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('status')

    expect(keywords()).toEqual(['bakeriet', 'kiwi', 'nille AI'])
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

  it("shows an upload's progress, and still opens on the other ways while Upload transactions waits", async () => {
    let respond: (response: Response) => void = () => {}
    handleUpload = () => new Promise((resolve) => (respond = resolve))
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

describe('Transactions page', () => {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]

  const septemberTransactions = [
    {
      id: 5,
      date: '2026-09-24',
      description: 'Rema 1000',
      amount: -1249.9,
      note: null,
      categoryId: 1,
      locked: false,
      imported: true,
      bookmarked: false,
    },
    {
      id: 4,
      date: '2026-09-03',
      description: 'Lønn Fra: Testfirma AS',
      amount: 24500,
      note: null,
      categoryId: null,
      locked: false,
      imported: true,
      bookmarked: false,
    },
  ]

  const octoberTransaction = {
    id: 9,
    date: '2026-10-02',
    description: 'Kiwi',
    amount: -89.9,
    note: null,
    categoryId: 1,
    locked: false,
    imported: true,
    bookmarked: false,
  }

  // A month with a Transaction a rule put in Other, one the user put in Other (so Locked), and one a
  // rule put in another Category.
  const otherCategoryTransactions = [
    septemberTransactions[0],
    {
      id: 8,
      date: '2026-09-20',
      description: 'Vipps *Ola Nordmann',
      amount: -200,
      note: null,
      categoryId: 13,
      locked: false,
      imported: true,
      bookmarked: false,
    },
    {
      id: 7,
      date: '2026-09-12',
      description: 'Gave',
      amount: -500,
      note: null,
      categoryId: 13,
      locked: true,
      imported: true,
      bookmarked: false,
    },
  ]

  async function openTransactionsPage() {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'Transactions' }))
    return user
  }

  function requestedPeriods() {
    return fetchMock.mock.calls
      .map(([url]) => url)
      .filter((url) => url.startsWith('/api/transactions?'))
  }

  // Each row's cells as shown: a select shows its chosen option.
  function rowCells() {
    return screen
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => {
            const select = within(cell).queryByRole<HTMLSelectElement>('combobox')
            return select ? select.selectedOptions[0].textContent : cell.textContent
          }),
      )
  }

  function categorySelect(description: string) {
    return screen.getByRole<HTMLSelectElement>('combobox', { name: `Category for ${description}` })
  }

  function optionsOf(select: HTMLSelectElement) {
    return within(select)
      .getAllByRole<HTMLOptionElement>('option')
      .map((option) => ({ name: option.textContent, disabled: option.disabled }))
  }

  async function openSeptember() {
    months = [{ year: 2026, month: 9 }]
    handleListPeriod = () => Response.json(septemberTransactions)
    const user = await openTransactionsPage()
    await screen.findByRole('cell', { name: 'Rema 1000' })
    return user
  }

  it('opens on the newest month with Transactions and lists its rows', async () => {
    months = [
      { year: 2026, month: 9 },
      { year: 2026, month: 8 },
      { year: 2025, month: 12 },
    ]
    handleListPeriod = (year, month) =>
      Response.json(year === 2026 && month === 9 ? septemberTransactions : [])

    await openTransactionsPage()

    await screen.findByRole('cell', { name: 'Rema 1000' })
    expect(screen.getByLabelText('Year')).toHaveValue('2026')
    expect(screen.getByLabelText('Month')).toHaveValue('9')
    expect(requestedPeriods()).toEqual(['/api/transactions?year=2026&month=9'])
  })

  it('shows the date, Description, Category or Uncategorized, and the Amount in NOK', async () => {
    months = [{ year: 2026, month: 9 }]
    handleListPeriod = () => Response.json(septemberTransactions)

    await openTransactionsPage()

    await screen.findByRole('cell', { name: 'Rema 1000' })
    expect(rowCells()).toEqual([
      ['24.09.2026', 'Rema 1000', 'Groceries', '-1\u00a0249,90\u00a0kr', '', '', ''],
      ['03.09.2026', 'Lønn Fra: Testfirma AS', 'Uncategorized', '24\u00a0500,00\u00a0kr', '', '', ''],
    ])
  })

  it('offers the years with Transactions plus the current year, and all twelve months after All months', async () => {
    months = [
      { year: 2024, month: 3 },
      { year: 2022, month: 1 },
    ]

    await openTransactionsPage()

    const currentYear = new Date().getFullYear()
    const expectedYears = [...new Set([currentYear, 2024, 2022])].sort((a, b) => b - a).map(String)
    await waitFor(() => expect(screen.getByLabelText('Year')).toHaveValue('2024'))
    const yearOptions = within(screen.getByLabelText('Year')).getAllByRole('option')
    expect(yearOptions.map((option) => option.textContent)).toEqual(expectedYears)
    const monthOptions = within(screen.getByLabelText('Month')).getAllByRole('option')
    expect(monthOptions.map((option) => option.textContent)).toEqual(['All months', ...monthNames])
  })

  it("lists the whole year's Transactions when All months is chosen", async () => {
    months = [
      { year: 2026, month: 9 },
      { year: 2025, month: 3 },
    ]
    handleListPeriod = (year, month) =>
      Response.json(
        year !== 2026 ? [] : month === undefined ? [octoberTransaction, ...septemberTransactions] : septemberTransactions,
      )
    const user = await openTransactionsPage()
    await screen.findByRole('cell', { name: 'Rema 1000' })

    await user.selectOptions(screen.getByLabelText('Month'), 'All months')

    expect(await screen.findByRole('cell', { name: 'Kiwi' })).toBeInTheDocument()
    expect(rowCells().map((cells) => cells[1])).toEqual(['Kiwi', 'Rema 1000', 'Lønn Fra: Testfirma AS'])
    expect(requestedPeriods()).toEqual(['/api/transactions?year=2026&month=9', '/api/transactions?year=2026'])

    await user.selectOptions(screen.getByLabelText('Year'), '2025')
    expect(await screen.findByText('No transactions in 2025')).toBeInTheDocument()
    expect(screen.getByLabelText('Month')).toHaveValue('')
  })

  it('opens on the current month and says it is empty when there are no Transactions', async () => {
    await openTransactionsPage()

    const today = new Date()
    expect(
      await screen.findByText(`No transactions in ${monthNames[today.getMonth()]} ${today.getFullYear()}`),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Year')).toHaveValue(String(today.getFullYear()))
    expect(screen.getByLabelText('Month')).toHaveValue(String(today.getMonth() + 1))
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('reloads the list when the month or year changes', async () => {
    months = [
      { year: 2026, month: 9 },
      { year: 2025, month: 9 },
    ]
    handleListPeriod = (year, month) =>
      Response.json(year === 2026 && month === 9 ? septemberTransactions : [])
    const user = await openTransactionsPage()
    await screen.findByRole('cell', { name: 'Rema 1000' })

    await user.selectOptions(screen.getByLabelText('Month'), 'August')
    expect(await screen.findByText('No transactions in August 2026')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Year'), '2025')
    expect(await screen.findByText('No transactions in August 2025')).toBeInTheDocument()
    expect(requestedPeriods()).toEqual([
      '/api/transactions?year=2026&month=9',
      '/api/transactions?year=2026&month=8',
      '/api/transactions?year=2025&month=8',
    ])
  })

  it('filters the rows by Category, or to the Uncategorized ones', async () => {
    months = [{ year: 2026, month: 9 }]
    handleListPeriod = () => Response.json(otherCategoryTransactions.concat(septemberTransactions[1]))
    const user = await openTransactionsPage()
    await screen.findByRole('cell', { name: 'Rema 1000' })

    const filter = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Category' })
    expect(filter).toHaveValue('')
    expect(optionsOf(filter).map((option) => option.name)).toEqual([
      'All categories',
      'Groceries',
      'Other',
      'Uncategorized',
    ])

    await user.selectOptions(filter, 'Other')
    expect(rowCells().map((cells) => cells[1])).toEqual(['Vipps *Ola Nordmann', 'Gave'])

    await user.selectOptions(filter, 'Uncategorized')
    expect(rowCells().map((cells) => cells[1])).toEqual(['Lønn Fra: Testfirma AS'])

    await user.selectOptions(filter, 'All categories')
    expect(rowCells()).toHaveLength(4)
  })

  it('narrows the rows to matching descriptions as the search is typed, ignoring case and surrounding spaces', async () => {
    const bøker = { ...septemberTransactions[0], id: 10, description: 'Bøker Og Blader' }
    months = [{ year: 2026, month: 9 }]
    handleListPeriod = () => Response.json([...otherCategoryTransactions, bøker])
    const user = await openTransactionsPage()
    await screen.findByRole('cell', { name: 'Rema 1000' })
    const search = screen.getByRole('searchbox', { name: 'Search' })

    await user.type(search, 'g')
    expect(rowCells().map((cells) => cells[1])).toEqual(['Gave', 'Bøker Og Blader'])
    await user.type(search, 'a')
    expect(rowCells().map((cells) => cells[1])).toEqual(['Gave'])

    await user.clear(search)
    await user.type(search, '  OLA nord ')
    expect(rowCells().map((cells) => cells[1])).toEqual(['Vipps *Ola Nordmann'])

    await user.clear(search)
    await user.type(search, 'boker')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('searches only the descriptions, not the Note or the Amount', async () => {
    const invoice = { ...septemberTransactions[0], id: 11, description: 'Rørlegger', amount: -349, note: 'Kiwi-17' }
    months = [{ year: 2026, month: 9 }]
    handleListPeriod = () => Response.json([...septemberTransactions, invoice])
    const user = await openTransactionsPage()
    await screen.findByRole('cell', { name: 'Rema 1000' })
    const search = screen.getByRole('searchbox', { name: 'Search' })

    await user.type(search, 'kiwi')
    expect(screen.getByText('No transactions match')).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, '349')
    expect(screen.getByText('No transactions match')).toBeInTheDocument()
  })

  it('keeps the Category filter and search when the Period changes', async () => {
    months = [{ year: 2026, month: 9 }]
    handleListPeriod = (_year, month) =>
      Response.json(month === undefined ? [octoberTransaction, ...septemberTransactions] : septemberTransactions)
    const user = await openTransactionsPage()
    await screen.findByRole('cell', { name: 'Rema 1000' })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'Groceries')
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'i')
    await user.selectOptions(screen.getByLabelText('Month'), 'All months')

    expect(await screen.findByRole('cell', { name: 'Kiwi' })).toBeInTheDocument()
    expect(rowCells().map((cells) => cells[1])).toEqual(['Kiwi'])
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('1')
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('i')
  })

  it('drops a row from the filtered list once its Category is changed to one the filter leaves out', async () => {
    handleChangeCategory = () => Response.json({ ...septemberTransactions[1], categoryId: 1 })
    const user = await openSeptember()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'Uncategorized')

    await user.selectOptions(categorySelect('Lønn Fra: Testfirma AS'), 'Groceries')

    expect(await screen.findByRole('status')).toHaveTextContent('Category changed')
    expect(screen.queryByRole('cell', { name: 'Lønn Fra: Testfirma AS' })).not.toBeInTheDocument()
  })

  it('says no transactions match when the filters leave none', async () => {
    const user = await openSeptember()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'Other')
    expect(screen.getByText('No transactions match')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'All categories')
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'xyz')
    expect(screen.getByText('No transactions match')).toBeInTheDocument()
  })

  it('says when the Transactions could not be loaded', async () => {
    months = new Response(null, { status: 500 })

    await openTransactionsPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the transactions.')
  })

  it('offers every Category for each row, with a disabled Uncategorized placeholder only when Uncategorized', async () => {
    await openSeptember()

    expect(categorySelect('Rema 1000')).toHaveValue('1')
    expect(optionsOf(categorySelect('Rema 1000'))).toEqual([
      { name: 'Groceries', disabled: false },
      { name: 'Other', disabled: false },
    ])
    expect(categorySelect('Lønn Fra: Testfirma AS').selectedOptions[0]).toHaveTextContent('Uncategorized')
    expect(optionsOf(categorySelect('Lønn Fra: Testfirma AS'))).toEqual([
      { name: 'Uncategorized', disabled: true },
      { name: 'Groceries', disabled: false },
      { name: 'Other', disabled: false },
    ])
  })

  it('saves a chosen Category at once and says the Category changed', async () => {
    let changed: { id: number; body: unknown } | undefined
    handleChangeCategory = (id, body) => {
      changed = { id, body }
      return Response.json({ ...septemberTransactions[1], categoryId: 13 })
    }
    const user = await openSeptember()

    await user.selectOptions(categorySelect('Lønn Fra: Testfirma AS'), 'Other')

    expect(await screen.findByRole('status')).toHaveTextContent('Category changed')
    expect(changed).toEqual({ id: 4, body: { categoryId: 13 } })
    expect(categorySelect('Lønn Fra: Testfirma AS')).toHaveValue('13')
    expect(optionsOf(categorySelect('Lønn Fra: Testfirma AS')).map((option) => option.name)).toEqual([
      'Groceries',
      'Other',
    ])
  })

  it('goes back to the previous Category and shows an error when saving fails', async () => {
    handleChangeCategory = () => new Response(null, { status: 500 })
    const user = await openSeptember()

    await user.selectOptions(categorySelect('Rema 1000'), 'Other')

    expect(await screen.findByRole('alert')).toHaveTextContent('Saving failed (500).')
    expect(categorySelect('Rema 1000')).toHaveValue('1')
  })

  it('shows an error when changing a Category cannot reach the server', async () => {
    handleChangeCategory = () => Promise.reject(new TypeError('Failed to fetch'))
    const user = await openSeptember()

    await user.selectOptions(categorySelect('Lønn Fra: Testfirma AS'), 'Groceries')

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.')
    expect(categorySelect('Lønn Fra: Testfirma AS').selectedOptions[0]).toHaveTextContent('Uncategorized')
  })

  function transactionRow(description: string) {
    const row = screen.getByRole('cell', { name: description }).closest('tr')
    if (!row) throw new Error(`No row for ${description}`)
    return row
  }

  async function openOtherCategoryMonth() {
    months = [{ year: 2026, month: 9 }]
    handleListPeriod = () => Response.json(otherCategoryTransactions)
    const user = await openTransactionsPage()
    await screen.findByRole('cell', { name: 'Rema 1000' })
    return user
  }

  function lockMark(description: string) {
    return within(transactionRow(description)).queryByRole('img', { name: 'Locked' })
  }

  it('marks only Locked Transactions, not those a rule put in Other', async () => {
    await openOtherCategoryMonth()

    expect(lockMark('Gave')).toHaveAttribute('title', "Locked: rules won't change this Category")
    expect(lockMark('Vipps *Ola Nordmann')).not.toBeInTheDocument()
    expect(lockMark('Rema 1000')).not.toBeInTheDocument()
    expect(screen.queryByText('AI')).not.toBeInTheDocument()
  })

  it('marks a Transaction Locked once its Category is changed', async () => {
    handleChangeCategory = (_id, body) =>
      Response.json({ ...otherCategoryTransactions[1], ...(body as object), locked: true })
    const user = await openOtherCategoryMonth()

    await user.selectOptions(categorySelect('Vipps *Ola Nordmann'), 'Groceries')

    expect(await screen.findByRole('status')).toHaveTextContent('Category changed')
    expect(categorySelect('Vipps *Ola Nordmann')).toHaveValue('1')
    expect(lockMark('Vipps *Ola Nordmann')).toBeInTheDocument()
  })

  it('leaves a Transaction unmarked when changing its Category fails', async () => {
    handleChangeCategory = () => new Response(null, { status: 500 })
    const user = await openOtherCategoryMonth()

    await user.selectOptions(categorySelect('Vipps *Ola Nordmann'), 'Groceries')

    expect(await screen.findByRole('alert')).toHaveTextContent('Saving failed (500).')
    expect(categorySelect('Vipps *Ola Nordmann')).toHaveValue('13')
    expect(lockMark('Vipps *Ola Nordmann')).not.toBeInTheDocument()
  })

  describe('deleting', () => {
    const manualTransaction = {
      id: 6,
      date: '2026-09-15',
      description: 'Frisør',
      amount: -450,
      note: 'KVITT-7',
      categoryId: 13,
      locked: true,
      imported: false,
      bookmarked: false,
    }

    // getByText collapses the Amount's no-break space into a plain one.
    const confirmation = `Delete "Frisør" (-450,00 kr on 15.09.2026)? This can't be undone.`

    // Opens September 2026 listing the given Transactions, which include the manual one.
    async function openMonthWithManualTransaction(transactions = [septemberTransactions[0], manualTransaction]) {
      months = [{ year: 2026, month: 9 }]
      handleListPeriod = () => Response.json(transactions)
      const user = await openTransactionsPage()
      await screen.findByRole('cell', { name: 'Frisør' })
      return user
    }

    function deleteButton(description: string) {
      return within(transactionRow(description)).getByRole('button', { name: `Delete ${description}` })
    }

    it('offers delete on manually-entered Transactions, and explains why it is disabled on imported ones', async () => {
      await openMonthWithManualTransaction()

      expect(deleteButton('Frisør')).toBeEnabled()
      expect(deleteButton('Rema 1000')).toBeDisabled()
      expect(deleteButton('Rema 1000')).toHaveAttribute('title', "Imported Transactions can't be deleted")
    })

    it('asks for confirmation naming the Transaction, then deletes it and removes its row', async () => {
      let deletedId: number | undefined
      handleDeleteTransaction = (id) => {
        deletedId = id
        return new Response(null, { status: 204 })
      }
      const user = await openMonthWithManualTransaction()

      await user.click(deleteButton('Frisør'))

      expect(deletedId).toBeUndefined()
      expect(screen.getByText(confirmation)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Transaction deleted.')
      expect(deletedId).toBe(6)
      expect(screen.queryByRole('cell', { name: 'Frisør' })).not.toBeInTheDocument()
      expect(screen.queryByText(confirmation)).not.toBeInTheDocument()
      expect(screen.getByRole('cell', { name: 'Rema 1000' })).toBeInTheDocument()
    })

    it('keeps the Transaction when the confirmation is cancelled', async () => {
      let deleted = false
      handleDeleteTransaction = () => {
        deleted = true
        return new Response(null, { status: 204 })
      }
      const user = await openMonthWithManualTransaction()

      await user.click(deleteButton('Frisør'))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(deleted).toBe(false)
      expect(screen.queryByText(confirmation)).not.toBeInTheDocument()
      expect(screen.getByRole('cell', { name: 'Frisør' })).toBeInTheDocument()
    })

    it('asks about one Transaction at a time', async () => {
      const otherManual = { ...manualTransaction, id: 3, description: 'Parkering', date: '2026-09-02' }
      const user = await openMonthWithManualTransaction([manualTransaction, otherManual])

      await user.click(deleteButton('Frisør'))
      await user.click(deleteButton('Parkering'))

      expect(screen.queryByText(confirmation)).not.toBeInTheDocument()
      expect(screen.getByText(/^Delete "Parkering"/)).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'Confirm delete' })).toHaveLength(1)
    })

    it('stays on the month once its last Transaction is deleted, and reloads the months', async () => {
      const user = await openMonthWithManualTransaction([manualTransaction])
      const monthsRequests = () => fetchMock.mock.calls.filter(([url]) => url === '/api/transactions/months').length
      const before = monthsRequests()

      await user.click(deleteButton('Frisør'))
      months = []
      await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByText('No transactions in September 2026')).toBeInTheDocument()
      expect(screen.getByLabelText('Month')).toHaveValue('9')
      expect(monthsRequests()).toBe(before + 1)
    })

    it("keeps the year chosen once the last of that year's Transactions is deleted", async () => {
      const lastOf2024 = { ...manualTransaction, date: '2024-03-15' }
      months = [{ year: 2024, month: 3 }]
      handleListPeriod = (year) => Response.json(year === 2024 ? [lastOf2024] : [])
      const user = await openTransactionsPage()
      await screen.findByRole('cell', { name: 'Frisør' })

      await user.click(deleteButton('Frisør'))
      months = []
      await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByText('No transactions in March 2024')).toBeInTheDocument()
      expect(screen.getByLabelText('Year')).toHaveValue('2024')
    })

    it('closes the confirmation when the Period, Category filter or search changes', async () => {
      const user = await openMonthWithManualTransaction()

      await user.click(deleteButton('Frisør'))
      await user.type(screen.getByLabelText('Search'), 'x')
      await user.clear(screen.getByLabelText('Search'))
      expect(screen.queryByText(confirmation)).not.toBeInTheDocument()

      await user.click(deleteButton('Frisør'))
      await user.selectOptions(screen.getByLabelText('Category'), 'Groceries')
      await user.selectOptions(screen.getByLabelText('Category'), 'All categories')
      expect(screen.queryByText(confirmation)).not.toBeInTheDocument()

      await user.click(deleteButton('Frisør'))
      await user.selectOptions(screen.getByLabelText('Month'), 'August')
      await user.selectOptions(screen.getByLabelText('Month'), 'September')
      await screen.findByRole('cell', { name: 'Frisør' })
      expect(screen.queryByText(confirmation)).not.toBeInTheDocument()
    })

    it("shows the server's reason and keeps the row when the delete is refused", async () => {
      handleDeleteTransaction = () =>
        Response.json({ detail: "Imported Transactions can't be deleted." }, { status: 409 })
      const user = await openMonthWithManualTransaction()

      await user.click(deleteButton('Frisør'))
      await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByRole('alert')).toHaveTextContent("Imported Transactions can't be deleted.")
      expect(screen.getByRole('cell', { name: 'Frisør' })).toBeInTheDocument()
    })

    it('removes a Transaction that was already deleted elsewhere', async () => {
      handleDeleteTransaction = () => new Response(null, { status: 404 })
      const user = await openMonthWithManualTransaction()

      await user.click(deleteButton('Frisør'))
      await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByRole('status')).toHaveTextContent('The transaction was already deleted.')
      expect(screen.queryByRole('cell', { name: 'Frisør' })).not.toBeInTheDocument()
    })

    it('keeps the Transaction and shows an error when the delete fails', async () => {
      handleDeleteTransaction = () => new Response(null, { status: 500 })
      const user = await openMonthWithManualTransaction()

      await user.click(deleteButton('Frisør'))
      await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Deleting failed (500).')
      expect(screen.getByRole('cell', { name: 'Frisør' })).toBeInTheDocument()
    })

    it('shows an error when a delete cannot reach the server', async () => {
      handleDeleteTransaction = () => Promise.reject(new TypeError('Failed to fetch'))
      const user = await openMonthWithManualTransaction()

      await user.click(deleteButton('Frisør'))
      await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.')
      expect(screen.getByRole('cell', { name: 'Frisør' })).toBeInTheDocument()
    })
  })

  describe('bookmarking with the star', () => {
    // A request kept waiting until the test answers it.
    function waitingAnswer() {
      let answer!: (response: Response) => void
      const response = new Promise<Response>((resolve) => {
        answer = resolve
      })
      return { response, answer }
    }

    it('bookmarks a Transaction with its empty star, which fills at once and waits for the save', async () => {
      const added = waitingAnswer()
      const bookmarkedIds: number[] = []
      handleAddBookmark = (id) => {
        bookmarkedIds.push(id)
        return added.response
      }
      const user = await openSeptember()
      const star = within(transactionRow('Rema 1000')).getByRole('button', { name: 'Bookmark Rema 1000' })
      expect(star).toHaveAttribute('aria-pressed', 'false')

      await user.click(star)

      const filled = screen.getByRole('button', { name: 'Remove bookmark for Rema 1000' })
      expect(filled).toHaveAttribute('aria-pressed', 'true')
      expect(filled).toBeDisabled()
      expect(bookmarkedIds).toEqual([5])

      added.answer(Response.json({ folderId: null }))
      await waitFor(() => expect(filled).toBeEnabled())
      expect(filled).toHaveAttribute('aria-pressed', 'true')
    })

    // September with Rema 1000 bookmarked.
    async function openSeptemberWithABookmark() {
      months = [{ year: 2026, month: 9 }]
      handleListPeriod = () =>
        Response.json([{ ...septemberTransactions[0], bookmarked: true }, septemberTransactions[1]])
      const user = await openTransactionsPage()
      await screen.findByRole('cell', { name: 'Rema 1000' })
      return user
    }

    it('removes the Bookmark with a filled star, which empties at once, with no popup', async () => {
      const removed = waitingAnswer()
      const removedIds: number[] = []
      handleRemoveBookmark = (id) => {
        removedIds.push(id)
        return removed.response
      }
      const user = await openSeptemberWithABookmark()
      const star = within(transactionRow('Rema 1000')).getByRole('button', { name: 'Remove bookmark for Rema 1000' })
      expect(star).toHaveAttribute('aria-pressed', 'true')

      await user.click(star)

      const empty = screen.getByRole('button', { name: 'Bookmark Rema 1000' })
      expect(empty).toHaveAttribute('aria-pressed', 'false')
      expect(empty).toBeDisabled()
      expect(removedIds).toEqual([5])

      removed.answer(new Response(null, { status: 204 }))
      await waitFor(() => expect(empty).toBeEnabled())
      expect(empty).toHaveAttribute('aria-pressed', 'false')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('empties the star again and says so when adding the Bookmark fails', async () => {
      handleAddBookmark = () => new Response(null, { status: 500 })
      const user = await openSeptember()

      await user.click(screen.getByRole('button', { name: 'Bookmark Rema 1000' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not add the bookmark.')
      expect(screen.getByRole('button', { name: 'Bookmark Rema 1000' })).toHaveAttribute('aria-pressed', 'false')
    })

    it('fills the star again and says so when removing the Bookmark fails', async () => {
      handleRemoveBookmark = () => new Response(null, { status: 500 })
      const user = await openSeptemberWithABookmark()

      await user.click(screen.getByRole('button', { name: 'Remove bookmark for Rema 1000' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove the bookmark.')
      expect(screen.getByRole('button', { name: 'Remove bookmark for Rema 1000' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('says the same when the server cannot be reached', async () => {
      handleAddBookmark = () => Promise.reject(new TypeError('Failed to fetch'))
      handleRemoveBookmark = () => Promise.reject(new TypeError('Failed to fetch'))
      const user = await openSeptemberWithABookmark()

      await user.click(screen.getByRole('button', { name: 'Bookmark Lønn Fra: Testfirma AS' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not add the bookmark.')

      await user.click(screen.getByRole('button', { name: 'Remove bookmark for Rema 1000' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove the bookmark.')
      expect(screen.getByRole('button', { name: 'Bookmark Lønn Fra: Testfirma AS' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Remove bookmark for Rema 1000' })).toBeEnabled()
    })

    describe('"Bookmark added" popup', () => {
      function popup() {
        return screen.getByRole('dialog', { name: 'Bookmark added' })
      }

      function popupFolderSelect() {
        return within(popup()).getByLabelText<HTMLSelectElement>('Folder')
      }

      function popupFolderOptions() {
        return within(popupFolderSelect())
          .getAllByRole('option')
          .map((option) => option.textContent)
      }

      it('opens in the row once its empty star has added the Bookmark, with focus on its Folder', async () => {
        const added = waitingAnswer()
        handleAddBookmark = () => added.response
        const user = await openSeptember()

        await user.click(screen.getByRole('button', { name: 'Bookmark Rema 1000' }))
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        added.answer(Response.json({ folderId: null }))

        const dialog = await screen.findByRole('dialog', { name: 'Bookmark added' })
        expect(transactionRow('Rema 1000')).toContainElement(dialog)
        await waitFor(() => expect(popupFolderSelect()).toHaveFocus())
        expect(popupFolderSelect()).toHaveDisplayValue('Bookmarks')
        expect(within(dialog).getByRole('button', { name: 'Done' })).toBeInTheDocument()
        expect(within(dialog).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
      })

      describe('Folder', () => {
        beforeEach(() => {
          folders = [
            { id: 20, name: 'Tax deductible' },
            { id: 21, name: 'Warranty' },
          ]
        })

        // The popup open on Rema 1000, bookmarked in the Folder adding answered with, once the Folders
        // are loaded.
        async function openPopupIn(folderId: number | null) {
          handleAddBookmark = () => Response.json({ folderId })
          const user = await openSeptember()
          await user.click(screen.getByRole('button', { name: 'Bookmark Rema 1000' }))
          await within(await screen.findByRole('dialog')).findByRole('option', { name: 'Warranty' })
          return user
        }

        it('shows the Folder the Bookmark went into, among "Bookmarks", the Folders A–Z and "New folder…" last', async () => {
          await openPopupIn(21)

          expect(popupFolderSelect()).toHaveDisplayValue('Warranty')
          expect(popupFolderOptions()).toEqual(['Bookmarks', 'Tax deductible', 'Warranty', 'New folder…'])
          expect(popupFolderSelect()).toHaveFocus()
        })

        it('files the Bookmark in the chosen Folder at once, disabled while saving', async () => {
          const filed = waitingAnswer()
          const filings: [number, unknown][] = []
          handleFileBookmark = (id, body) => {
            filings.push([id, body])
            return filed.response
          }
          const user = await openPopupIn(null)

          await user.selectOptions(popupFolderSelect(), 'Tax deductible')

          expect(filings).toEqual([[5, { folderId: 20 }]])
          expect(popupFolderSelect()).toHaveDisplayValue('Tax deductible')
          expect(popupFolderSelect()).toBeDisabled()

          filed.answer(Response.json({ folderId: 20 }))

          await waitFor(() => expect(popupFolderSelect()).toBeEnabled())
          expect(popupFolderSelect()).toHaveDisplayValue('Tax deductible')
          expect(within(popup()).queryByRole('alert')).not.toBeInTheDocument()

          await user.selectOptions(popupFolderSelect(), 'Bookmarks')

          await waitFor(() => expect(popupFolderSelect()).toBeEnabled())
          expect(filings).toEqual([
            [5, { folderId: 20 }],
            [5, { folderId: null }],
          ])
          expect(popupFolderSelect()).toHaveDisplayValue('Bookmarks')
        })

        it('stays open on Escape while the filing is being saved', async () => {
          const filed = waitingAnswer()
          handleFileBookmark = () => filed.response
          const user = await openPopupIn(null)
          await user.selectOptions(popupFolderSelect(), 'Warranty')

          await user.keyboard('{Escape}')

          expect(popup()).toBeInTheDocument()
          filed.answer(Response.json({ folderId: 21 }))
          await waitFor(() => expect(popupFolderSelect()).toBeEnabled())

          await user.keyboard('{Escape}')

          expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        })

        it('goes back to the Folder the Bookmark is in, saying so, when filing fails', async () => {
          handleFileBookmark = () => new Response(null, { status: 500 })
          const user = await openPopupIn(21)

          await user.selectOptions(popupFolderSelect(), 'Tax deductible')

          expect(await within(popup()).findByRole('alert')).toHaveTextContent('Could not move the bookmark.')
          expect(popupFolderSelect()).toHaveDisplayValue('Warranty')
          expect(popupFolderSelect()).toBeEnabled()
          expect(screen.getByRole('button', { name: 'Remove bookmark for Rema 1000' })).toHaveAttribute('aria-pressed', 'true')
        })

        it('says when the chosen Folder no longer exists', async () => {
          handleFileBookmark = () =>
            Response.json({ errors: { folderId: ['The folder no longer exists.'] } }, { status: 400 })
          const user = await openPopupIn(null)

          await user.selectOptions(popupFolderSelect(), 'Warranty')

          expect(await within(popup()).findByRole('alert')).toHaveTextContent('The folder no longer exists.')
          expect(popupFolderSelect()).toHaveDisplayValue('Bookmarks')
        })

        it('offers only the chosen option, disabled, until the Folders are loaded', async () => {
          const loaded = waitingAnswer()
          folders = loaded.response
          handleAddBookmark = () => Response.json({ folderId: 21 })
          const user = await openSeptember()

          await user.click(screen.getByRole('button', { name: 'Bookmark Rema 1000' }))
          await screen.findByRole('dialog')

          expect(popupFolderSelect()).toBeDisabled()
          expect(popupFolderOptions()).toEqual(['Loading…'])

          loaded.answer(Response.json([{ id: 21, name: 'Warranty' }]))

          await waitFor(() => expect(popupFolderSelect()).toBeEnabled())
          expect(popupFolderSelect()).toHaveDisplayValue('Warranty')
          expect(popupFolderSelect()).toHaveFocus()
        })

        it('loads the Folders once for both the popup and Bookmarks', async () => {
          const user = await openPopupIn(null)
          await user.click(within(popup()).getByRole('button', { name: 'Done' }))
          await user.click(screen.getByRole('button', { name: 'Bookmark Lønn Fra: Testfirma AS' }))
          await within(await screen.findByRole('dialog')).findByRole('option', { name: 'Warranty' })
          await user.click(within(popup()).getByRole('button', { name: 'Done' }))

          await user.click(screen.getByRole('button', { name: 'Bookmarks' }))

          expect(await screen.findByRole('option', { name: 'Warranty' })).toBeInTheDocument()
          expect(fetchMock.mock.calls.filter(([url]) => url === '/api/folders')).toHaveLength(1)
        })

        describe('creating a Folder', () => {
          function nameField() {
            return within(popup()).getByRole('textbox', { name: 'Folder name' })
          }

          it('swaps the dropdown for a name field, then files the Bookmark in the new Folder, offered in Bookmarks too', async () => {
            const created: unknown[] = []
            const filings: [number, unknown][] = []
            handleAddFolder = (body) => {
              created.push(body)
              return Response.json({ id: 30, name: 'Kvitteringer' }, { status: 201 })
            }
            handleFileBookmark = (id, body) => {
              filings.push([id, body])
              return Response.json(body)
            }
            const user = await openPopupIn(null)

            await user.selectOptions(popupFolderSelect(), 'New folder…')

            expect(within(popup()).queryByLabelText('Folder')).not.toBeInTheDocument()
            expect(nameField()).toHaveFocus()

            await user.type(nameField(), 'Kvitteringer')
            await user.click(within(popup()).getByRole('button', { name: 'Create' }))

            await waitFor(() => expect(popupFolderSelect()).toHaveDisplayValue('Kvitteringer'))
            expect(created).toEqual([{ name: 'Kvitteringer' }])
            expect(filings).toEqual([[5, { folderId: 30 }]])
            expect(popupFolderOptions()).toEqual(['Bookmarks', 'Kvitteringer', 'Tax deductible', 'Warranty', 'New folder…'])
            expect(popupFolderSelect()).toHaveFocus()

            await user.click(within(popup()).getByRole('button', { name: 'Done' }))
            await user.click(screen.getByRole('button', { name: 'Bookmarks' }))

            expect(await screen.findByRole('option', { name: 'Kvitteringer' })).toBeInTheDocument()
            expect(
              within(screen.getByLabelText('Folder'))
                .getAllByRole('option')
                .map((option) => option.textContent),
            ).toEqual(['Bookmarks', 'Kvitteringer', 'Tax deductible', 'Warranty', 'New folder…'])
          })

          it('hides Remove and Done while the new Folder is named, and brings them back on Cancel', async () => {
            const user = await openPopupIn(21)

            await user.selectOptions(popupFolderSelect(), 'New folder…')

            expect(within(popup()).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
            expect(within(popup()).queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()

            await user.click(within(popup()).getByRole('button', { name: 'Cancel' }))

            expect(within(popup()).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
            expect(within(popup()).getByRole('button', { name: 'Done' })).toBeInTheDocument()
          })

          it('brings back the dropdown with the Bookmark\'s Folder on Cancel', async () => {
            const user = await openPopupIn(21)
            await user.selectOptions(popupFolderSelect(), 'New folder…')
            await user.type(nameField(), 'Kvitteringer')

            await user.click(within(popup()).getByRole('button', { name: 'Cancel' }))

            expect(popupFolderSelect()).toHaveDisplayValue('Warranty')
            expect(popupFolderOptions()).toEqual(['Bookmarks', 'Tax deductible', 'Warranty', 'New folder…'])
            expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/folders' && init?.method === 'POST')).toEqual([])
            expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toEqual([])
          })

          it('shows a field error under the name field and keeps the input', async () => {
            handleAddFolder = () =>
              Response.json({ errors: { name: ["A folder named 'Warranty' already exists."] } }, { status: 400 })
            const user = await openPopupIn(null)
            await user.selectOptions(popupFolderSelect(), 'New folder…')
            await user.type(nameField(), 'warranty')

            await user.click(within(popup()).getByRole('button', { name: 'Create' }))

            expect(await within(popup()).findByText("A folder named 'Warranty' already exists.")).toBeInTheDocument()
            expect(nameField()).toHaveAccessibleDescription("A folder named 'Warranty' already exists.")
            expect(nameField()).toHaveValue('warranty')
            expect(within(popup()).queryByRole('alert')).not.toBeInTheDocument()
          })

          it('says so in the popup, keeping the input, when the Folder could not be created', async () => {
            handleAddFolder = () => new Response(null, { status: 500 })
            const user = await openPopupIn(null)
            await user.selectOptions(popupFolderSelect(), 'New folder…')
            await user.type(nameField(), 'Kvitteringer')

            await user.click(within(popup()).getByRole('button', { name: 'Create' }))

            expect(await within(popup()).findByRole('alert')).toHaveTextContent('Saving failed (500).')
            expect(nameField()).toHaveValue('Kvitteringer')
          })

          it('keeps the new Folder, with the dropdown back on the Bookmark\'s Folder, when filing in it fails', async () => {
            handleAddFolder = () => Response.json({ id: 30, name: 'Kvitteringer' }, { status: 201 })
            handleFileBookmark = () => new Response(null, { status: 500 })
            const user = await openPopupIn(21)
            await user.selectOptions(popupFolderSelect(), 'New folder…')
            await user.type(nameField(), 'Kvitteringer')

            await user.click(within(popup()).getByRole('button', { name: 'Create' }))

            expect(await within(popup()).findByRole('alert')).toHaveTextContent('Could not move the bookmark.')
            expect(popupFolderSelect()).toHaveDisplayValue('Warranty')
            expect(popupFolderOptions()).toEqual(['Bookmarks', 'Kvitteringer', 'Tax deductible', 'Warranty', 'New folder…'])
          })
        })
      })

      it('opens nothing when adding the Bookmark fails', async () => {
        handleAddBookmark = () => new Response(null, { status: 500 })
        const user = await openSeptember()

        await user.click(screen.getByRole('button', { name: 'Bookmark Rema 1000' }))

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not add the bookmark.')
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      it('closes on Done, leaving the Bookmark, with focus back on the star', async () => {
        const user = await openSeptember()
        await user.click(screen.getByRole('button', { name: 'Bookmark Rema 1000' }))

        await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Done' }))

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        const star = screen.getByRole('button', { name: 'Remove bookmark for Rema 1000' })
        expect(star).toHaveAttribute('aria-pressed', 'true')
        expect(star).toHaveFocus()
      })

      it('closes on Escape or a click outside it, leaving the Bookmark', async () => {
        const user = await openSeptember()
        await user.click(screen.getByRole('button', { name: 'Bookmark Rema 1000' }))
        await screen.findByRole('dialog')

        await user.keyboard('{Escape}')

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Remove bookmark for Rema 1000' })).toHaveFocus()

        await user.click(screen.getByRole('button', { name: 'Bookmark Lønn Fra: Testfirma AS' }))
        await screen.findByRole('dialog')
        await user.click(screen.getByRole('heading', { name: 'Transactions' }))

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        for (const description of ['Rema 1000', 'Lønn Fra: Testfirma AS']) {
          expect(screen.getByRole('button', { name: `Remove bookmark for ${description}` })).toHaveAttribute('aria-pressed', 'true')
        }
      })

      it('removes the Bookmark with Remove, emptying the star and closing', async () => {
        const removedIds: number[] = []
        handleRemoveBookmark = (id) => {
          removedIds.push(id)
          return new Response(null, { status: 204 })
        }
        const user = await openSeptember()
        await user.click(screen.getByRole('button', { name: 'Bookmark Rema 1000' }))

        await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }))

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(removedIds).toEqual([5])
        const star = screen.getByRole('button', { name: 'Bookmark Rema 1000' })
        expect(star).toHaveAttribute('aria-pressed', 'false')
        expect(star).toHaveFocus()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      })

      it('stays open, saying so, with the star filled, when Remove fails', async () => {
        handleRemoveBookmark = () => new Response(null, { status: 500 })
        const user = await openSeptember()
        await user.click(screen.getByRole('button', { name: 'Bookmark Rema 1000' }))

        await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }))

        expect(await within(popup()).findByRole('alert')).toHaveTextContent('Could not remove the bookmark.')
        expect(screen.getByRole('button', { name: 'Remove bookmark for Rema 1000' })).toHaveAttribute('aria-pressed', 'true')
      })

      it("closes when another row's star opens its own, so only one is open at a time", async () => {
        const user = await openSeptember()
        await user.click(screen.getByRole('button', { name: 'Bookmark Rema 1000' }))
        await screen.findByRole('dialog')

        // From the keyboard, so nothing is clicked outside the first popup.
        act(() => screen.getByRole('button', { name: 'Bookmark Lønn Fra: Testfirma AS' }).focus())
        await user.keyboard('{Enter}')

        await waitFor(() => expect(transactionRow('Lønn Fra: Testfirma AS')).toContainElement(popup()))
        expect(screen.getAllByRole('dialog')).toHaveLength(1)
      })

      it('closes when its own star, filled now, removes the Bookmark from the keyboard', async () => {
        const user = await openSeptember()
        await user.click(screen.getByRole('button', { name: 'Bookmark Rema 1000' }))
        await waitFor(() => expect(within(screen.getByRole('dialog')).getByLabelText('Folder')).toHaveFocus())

        await user.tab({ shift: true })
        expect(screen.getByRole('button', { name: 'Remove bookmark for Rema 1000' })).toHaveFocus()
        await user.keyboard('{Enter}')

        await waitFor(() => expect(screen.getByRole('button', { name: 'Bookmark Rema 1000' })).toBeEnabled())
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      // From the keyboard, so nothing is clicked outside the popup.
      it('closes when switching between All and Bookmarks, or searching', async () => {
        const user = await openSeptember()
        await user.click(screen.getByRole('button', { name: 'Bookmark Rema 1000' }))
        await screen.findByRole('dialog')

        act(() => screen.getByRole('button', { name: 'Bookmarks' }).focus())
        await user.keyboard('{Enter}')
        await screen.findByText('No bookmarks')
        act(() => screen.getByRole('button', { name: 'All' }).focus())
        await user.keyboard('{Enter}')

        expect(screen.getByRole('cell', { name: 'Rema 1000' })).toBeInTheDocument()
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Bookmark Lønn Fra: Testfirma AS' }))
        await screen.findByRole('dialog')
        act(() => screen.getByLabelText('Search').focus())
        await user.keyboard('Lønn')

        expect(screen.getByRole('cell', { name: 'Lønn Fra: Testfirma AS' })).toBeInTheDocument()
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      it('opens when adding a Bookmark back in Bookmarks, whose Remove keeps the row with an empty star', async () => {
        handleListBookmarks = () => Response.json([{ ...septemberTransactions[0], bookmarked: true }])
        const user = await openSeptember()
        await user.click(screen.getByRole('button', { name: 'Bookmarks' }))
        await user.click(await screen.findByRole('button', { name: 'Remove bookmark for Rema 1000' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Bookmark Rema 1000' })).toBeEnabled())
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Bookmark Rema 1000' }))

        expect(transactionRow('Rema 1000')).toContainElement(await screen.findByRole('dialog', { name: 'Bookmark added' }))

        await user.click(within(popup()).getByRole('button', { name: 'Remove' }))

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(screen.getByRole('button', { name: 'Bookmark Rema 1000' })).toHaveAttribute('aria-pressed', 'false')
      })
    })
  })

  describe('All | Bookmarks switch', () => {
    // Bookmarked Transactions from any date, newest first, as the bookmarks endpoint lists them.
    const bookmarks = [
      { ...septemberTransactions[0], bookmarked: true },
      {
        id: 2,
        date: '2024-05-17',
        description: 'Elkjøp',
        amount: -4990,
        note: 'Warranty until 2027',
        categoryId: 13,
        locked: true,
        imported: false,
        bookmarked: true,
      },
    ]

    function switchButton(name: 'All' | 'Bookmarks') {
      return within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name })
    }

    function listedDescriptions() {
      return rowCells().map((cells) => cells[1])
    }

    function bookmarksRequests() {
      return fetchMock.mock.calls.filter(([url]) => url === '/api/bookmarks').length
    }

    async function showBookmarks(user: ReturnType<typeof userEvent.setup>) {
      await user.click(switchButton('Bookmarks'))
    }

    it('opens on All, with no Bookmarks entry in the header', async () => {
      await openSeptember()

      expect(switchButton('All')).toHaveAttribute('aria-pressed', 'true')
      expect(switchButton('Bookmarks')).toHaveAttribute('aria-pressed', 'false')
      expect(within(screen.getByRole('navigation')).queryByRole('button', { name: /bookmark/i })).not.toBeInTheDocument()
      expect(bookmarksRequests()).toBe(0)
    })

    it('lists the bookmarks from any date in place of the Year, Month, Category and Search', async () => {
      handleListBookmarks = () => Response.json(bookmarks)
      const user = await openSeptember()

      await showBookmarks(user)

      expect(await screen.findByRole('cell', { name: 'Elkjøp' })).toBeInTheDocument()
      expect(switchButton('Bookmarks')).toHaveAttribute('aria-pressed', 'true')
      expect(switchButton('All')).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByLabelText('Folder')).toHaveDisplayValue('Bookmarks')
      for (const field of ['Year', 'Month', 'Category', 'Search']) {
        expect(screen.queryByLabelText(field)).not.toBeInTheDocument()
      }
      expect(rowCells()).toEqual([
        ['24.09.2026', 'Rema 1000', 'Groceries', '-1 249,90 kr', '', '', ''],
        ['17.05.2024', 'Elkjøp', 'Other', '-4 990,00 kr', '', '', ''],
      ])
      expect(screen.getByRole('button', { name: 'Remove bookmark for Elkjøp' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('says when there are no bookmarks', async () => {
      const user = await openSeptember()

      await showBookmarks(user)

      expect(await screen.findByText('No bookmarks')).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })

    it('says when the bookmarks could not be loaded', async () => {
      handleListBookmarks = () => new Response(null, { status: 500 })
      const user = await openSeptember()

      await showBookmarks(user)

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the bookmarks.')
      expect(screen.queryByText('No bookmarks')).not.toBeInTheDocument()
    })

    it('restores the Year, Month, Category, Search and listed Transactions when switching back to All', async () => {
      months = [
        { year: 2026, month: 9 },
        { year: 2025, month: 3 },
      ]
      handleListPeriod = (_year, month) =>
        Response.json(month === undefined ? [octoberTransaction, ...septemberTransactions] : septemberTransactions)
      handleListBookmarks = () => Response.json(bookmarks)
      const user = await openTransactionsPage()
      await screen.findByRole('cell', { name: 'Rema 1000' })
      await user.selectOptions(screen.getByLabelText('Month'), 'All months')
      await screen.findByRole('cell', { name: 'Kiwi' })
      await user.selectOptions(screen.getByLabelText('Category'), 'Groceries')
      await user.type(screen.getByLabelText('Search'), 'i')
      await showBookmarks(user)
      await screen.findByRole('cell', { name: 'Elkjøp' })
      const periodsRequested = requestedPeriods().length

      await user.click(switchButton('All'))

      expect(switchButton('All')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByLabelText('Year')).toHaveValue('2026')
      expect(screen.getByLabelText('Month')).toHaveValue('')
      expect(screen.getByLabelText('Category')).toHaveValue('1')
      expect(screen.getByLabelText('Search')).toHaveValue('i')
      expect(listedDescriptions()).toEqual(['Kiwi'])
      expect(screen.queryByLabelText('Folder')).not.toBeInTheDocument()
      expect(requestedPeriods()).toHaveLength(periodsRequested)
    })

    it('opens on All again after leaving the page', async () => {
      const user = await openSeptember()
      await showBookmarks(user)
      await screen.findByText('No bookmarks')

      await user.click(screen.getByRole('button', { name: 'Categories' }))
      await user.click(screen.getByRole('button', { name: 'Transactions' }))

      expect(await screen.findByRole('cell', { name: 'Rema 1000' })).toBeInTheDocument()
      expect(switchButton('All')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByLabelText('Month')).toHaveValue('9')
    })

    it('closes an open Note editor or delete confirmation when switching', async () => {
      handleListBookmarks = () => Response.json(bookmarks)
      const user = await openSeptember()
      await user.click(screen.getByRole('button', { name: 'Add note for Rema 1000' }))
      expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument()

      await showBookmarks(user)
      await screen.findByRole('cell', { name: 'Elkjøp' })
      expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Delete Elkjøp' }))
      expect(screen.getByText(/^Delete "Elkjøp"/)).toBeInTheDocument()
      await user.click(switchButton('All'))
      await showBookmarks(user)
      await screen.findByRole('cell', { name: 'Elkjøp' })
      expect(screen.queryByText(/^Delete "Elkjøp"/)).not.toBeInTheDocument()
    })

    it('keeps a row whose Bookmark is removed, with an empty star, until All is shown, and can bookmark it again', async () => {
      const addedIds: number[] = []
      handleAddBookmark = (id) => {
        addedIds.push(id)
        return Response.json({ folderId: null })
      }
      handleListBookmarks = () => Response.json(bookmarks)
      const user = await openSeptember()
      await showBookmarks(user)
      await screen.findByRole('cell', { name: 'Elkjøp' })

      await user.click(screen.getByRole('button', { name: 'Remove bookmark for Elkjøp' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Bookmark Elkjøp' })).toBeEnabled())
      expect(listedDescriptions()).toEqual(['Rema 1000', 'Elkjøp'])

      await user.click(screen.getByRole('button', { name: 'Bookmark Elkjøp' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Remove bookmark for Elkjøp' })).toBeEnabled())
      expect(addedIds).toEqual([2])

      await user.click(screen.getByRole('button', { name: 'Remove bookmark for Elkjøp' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Bookmark Elkjøp' })).toBeEnabled())
      handleListBookmarks = () => Response.json([bookmarks[0]])
      await user.click(switchButton('All'))
      await showBookmarks(user)

      expect(await screen.findByRole('cell', { name: 'Rema 1000' })).toBeInTheDocument()
      expect(listedDescriptions()).toEqual(['Rema 1000'])
    })

    it('shows a star changed in Bookmarks the same in All', async () => {
      months = [{ year: 2026, month: 9 }]
      handleListPeriod = () => Response.json([bookmarks[0], septemberTransactions[1]])
      handleListBookmarks = () => Response.json(bookmarks)
      const user = await openTransactionsPage()
      await screen.findByRole('cell', { name: 'Rema 1000' })
      await showBookmarks(user)
      await screen.findByRole('cell', { name: 'Elkjøp' })

      await user.click(screen.getByRole('button', { name: 'Remove bookmark for Rema 1000' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Bookmark Rema 1000' })).toBeEnabled())
      await user.click(switchButton('All'))

      expect(screen.getByRole('button', { name: 'Bookmark Rema 1000' })).toHaveAttribute('aria-pressed', 'false')
    })

    it("changes a bookmarked Transaction's Category and Note in Bookmarks", async () => {
      handleListBookmarks = () => Response.json(bookmarks)
      handleChangeCategory = (_id, body) => Response.json({ ...bookmarks[1], ...(body as object) })
      handleChangeNote = (_id, body) => Response.json({ ...bookmarks[1], ...(body as object) })
      const user = await openSeptember()
      await showBookmarks(user)
      await screen.findByRole('cell', { name: 'Elkjøp' })

      await user.selectOptions(categorySelect('Elkjøp'), 'Groceries')

      expect(await screen.findByRole('status')).toHaveTextContent('Category changed')
      expect(categorySelect('Elkjøp')).toHaveValue('1')

      await user.click(screen.getByRole('button', { name: 'Edit note for Elkjøp' }))
      const note = screen.getByRole('textbox', { name: 'Note' })
      await user.clear(note)
      await user.type(note, 'Warranty until 2028')
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(await screen.findByText('Note saved.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Edit note for Elkjøp' })).toHaveAttribute('title', 'Warranty until 2028')
      expect(listedDescriptions()).toEqual(['Rema 1000', 'Elkjøp'])
    })

    it('deletes a bookmarked Transaction in Bookmarks, and loads the Period and months again once All is shown', async () => {
      let deletedId: number | undefined
      handleDeleteTransaction = (id) => {
        deletedId = id
        return new Response(null, { status: 204 })
      }
      handleListBookmarks = () => Response.json(bookmarks)
      const monthsRequests = () => fetchMock.mock.calls.filter(([url]) => url === '/api/transactions/months').length
      const user = await openSeptember()
      await showBookmarks(user)
      await screen.findByRole('cell', { name: 'Elkjøp' })
      const periodsRequested = requestedPeriods().length
      const monthsRequested = monthsRequests()

      await user.click(screen.getByRole('button', { name: 'Delete Elkjøp' }))
      await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Transaction deleted.')
      expect(deletedId).toBe(2)
      expect(listedDescriptions()).toEqual(['Rema 1000'])
      expect(monthsRequests()).toBe(monthsRequested)

      await user.click(switchButton('All'))

      expect(await screen.findByRole('cell', { name: 'Lønn Fra: Testfirma AS' })).toBeInTheDocument()
      expect(requestedPeriods()).toHaveLength(periodsRequested + 1)
      expect(requestedPeriods().at(-1)).toBe('/api/transactions?year=2026&month=9')
      expect(monthsRequests()).toBe(monthsRequested + 1)
    })

    describe('Folders', () => {
      // The bookmarks filed in the Warranty Folder, which has id 21.
      const warrantyBookmarks = [
        {
          id: 3,
          date: '2025-11-28',
          description: 'Power',
          amount: -12990,
          note: null,
          categoryId: 13,
          locked: true,
          imported: false,
          bookmarked: true,
        },
      ]

      beforeEach(() => {
        folders = [
          { id: 20, name: 'Tax deductible' },
          { id: 21, name: 'Warranty' },
        ]
        handleListBookmarks = () => Response.json(bookmarks)
        handleListFolderBookmarks = (folderId) => Response.json(folderId === 21 ? warrantyBookmarks : [])
      })

      function folderSelect() {
        return screen.getByLabelText<HTMLSelectElement>('Folder')
      }

      function folderOptions() {
        return within(folderSelect())
          .getAllByRole('option')
          .map((option) => option.textContent)
      }

      function foldersRequests() {
        return fetchMock.mock.calls.filter(([url]) => url === '/api/folders').length
      }

      // Bookmarks shown, with the Folders loaded into the dropdown.
      async function showBookmarksWithFolders() {
        const user = await openSeptember()
        await showBookmarks(user)
        await screen.findByRole('option', { name: 'Warranty' })
        await screen.findByRole('cell', { name: 'Elkjøp' })
        return user
      }

      it('offers "Bookmarks", then the Folders A–Z, then "New folder…" last, with "Bookmarks" chosen', async () => {
        await showBookmarksWithFolders()

        expect(folderOptions()).toEqual(['Bookmarks', 'Tax deductible', 'Warranty', 'New folder…'])
        expect(folderSelect()).toHaveDisplayValue('Bookmarks')
        expect(listedDescriptions()).toEqual(['Rema 1000', 'Elkjøp'])
      })

      it('lists the chosen Folder\'s bookmarks', async () => {
        const user = await showBookmarksWithFolders()

        await user.selectOptions(folderSelect(), 'Warranty')

        expect(await screen.findByRole('cell', { name: 'Power' })).toBeInTheDocument()
        expect(folderSelect()).toHaveDisplayValue('Warranty')
        expect(listedDescriptions()).toEqual(['Power'])
      })

      it('clears rows whose Bookmark was removed once another option is chosen', async () => {
        const user = await showBookmarksWithFolders()
        await user.selectOptions(folderSelect(), 'Warranty')
        await user.click(await screen.findByRole('button', { name: 'Remove bookmark for Power' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Bookmark Power' })).toBeEnabled())
        expect(listedDescriptions()).toEqual(['Power'])
        handleListFolderBookmarks = () => Response.json([])

        await user.selectOptions(folderSelect(), 'Bookmarks')
        await screen.findByRole('cell', { name: 'Elkjøp' })
        await user.selectOptions(folderSelect(), 'Warranty')

        expect(await screen.findByText('No bookmarks in Warranty')).toBeInTheDocument()
        expect(screen.queryByRole('table')).not.toBeInTheDocument()
      })

      it('says when a Folder has no bookmarks', async () => {
        const user = await showBookmarksWithFolders()

        await user.selectOptions(folderSelect(), 'Tax deductible')

        expect(await screen.findByText('No bookmarks in Tax deductible')).toBeInTheDocument()
        expect(screen.queryByText('No bookmarks')).not.toBeInTheDocument()
        expect(screen.queryByRole('table')).not.toBeInTheDocument()
      })

      it('always chooses "Bookmarks" when switching to Bookmarks', async () => {
        const user = await showBookmarksWithFolders()
        await user.selectOptions(folderSelect(), 'Warranty')
        await screen.findByRole('cell', { name: 'Power' })

        await user.click(switchButton('All'))
        await showBookmarks(user)

        expect(await screen.findByRole('cell', { name: 'Elkjøp' })).toBeInTheDocument()
        expect(folderSelect()).toHaveDisplayValue('Bookmarks')
        expect(listedDescriptions()).toEqual(['Rema 1000', 'Elkjøp'])
      })

      it('loads the Folders once per visit to the page, the first time Bookmarks is shown', async () => {
        const user = await openSeptember()
        expect(foldersRequests()).toBe(0)

        await showBookmarks(user)
        await screen.findByRole('option', { name: 'Warranty' })
        await user.click(switchButton('All'))
        await showBookmarks(user)
        await screen.findByRole('cell', { name: 'Elkjøp' })
        expect(foldersRequests()).toBe(1)

        await user.click(screen.getByRole('button', { name: 'Categories' }))
        await user.click(screen.getByRole('button', { name: 'Transactions' }))
        await screen.findByRole('cell', { name: 'Rema 1000' })
        await showBookmarks(user)
        await screen.findByRole('option', { name: 'Warranty' })
        expect(foldersRequests()).toBe(2)
      })

      it('says when the Folders could not be loaded, still listing the bookmarks in no Folder', async () => {
        folders = new Response(null, { status: 500 })
        const user = await openSeptember()

        await showBookmarks(user)

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the folders.')
        expect(await screen.findByRole('cell', { name: 'Elkjøp' })).toBeInTheDocument()
        expect(folderSelect()).toBeDisabled()
      })

      describe('creating a Folder', () => {
        function nameField() {
          return screen.getByRole('textbox', { name: 'Folder name' })
        }

        it('swaps the dropdown for a name field, and shows the new Folder, empty, in its place A–Z', async () => {
          const created: unknown[] = []
          handleAddFolder = (body) => {
            created.push(body)
            return Response.json({ id: 30, name: 'kvitteringer' }, { status: 201 })
          }
          const user = await showBookmarksWithFolders()

          await user.selectOptions(folderSelect(), 'New folder…')

          expect(screen.queryByLabelText('Folder')).not.toBeInTheDocument()
          expect(nameField()).toHaveValue('')
          expect(nameField()).toHaveFocus()
          expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

          await user.type(nameField(), 'kvitteringer')
          await user.click(screen.getByRole('button', { name: 'Create' }))

          expect(await screen.findByRole('status')).toHaveTextContent('Folder created')
          expect(created).toEqual([{ name: 'kvitteringer' }])
          expect(folderSelect()).toHaveDisplayValue('kvitteringer')
          expect(folderOptions()).toEqual(['Bookmarks', 'kvitteringer', 'Tax deductible', 'Warranty', 'New folder…'])
          expect(await screen.findByText('No bookmarks in kvitteringer')).toBeInTheDocument()
          expect(screen.queryByRole('textbox', { name: 'Folder name' })).not.toBeInTheDocument()
        })

        it('goes back to the Folder being viewed on Cancel', async () => {
          const user = await showBookmarksWithFolders()
          await user.selectOptions(folderSelect(), 'Warranty')
          await screen.findByRole('cell', { name: 'Power' })

          await user.selectOptions(folderSelect(), 'New folder…')
          await user.type(nameField(), 'Receipts')
          await user.click(screen.getByRole('button', { name: 'Cancel' }))

          expect(folderSelect()).toHaveDisplayValue('Warranty')
          expect(listedDescriptions()).toEqual(['Power'])
          expect(folderOptions()).toEqual(['Bookmarks', 'Tax deductible', 'Warranty', 'New folder…'])
          expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toEqual([])
        })

        it('shows a field error under the name field and keeps the input', async () => {
          handleAddFolder = () =>
            Response.json({ errors: { name: ["A folder can't be named 'Bookmarks'."] } }, { status: 400 })
          const user = await showBookmarksWithFolders()
          await user.selectOptions(folderSelect(), 'New folder…')
          await user.type(nameField(), 'bookmarks')

          await user.click(screen.getByRole('button', { name: 'Create' }))

          expect(await screen.findByText("A folder can't be named 'Bookmarks'.")).toBeInTheDocument()
          expect(nameField()).toHaveAccessibleDescription("A folder can't be named 'Bookmarks'.")
          expect(nameField()).toHaveValue('bookmarks')
          expect(screen.queryByLabelText('Folder')).not.toBeInTheDocument()
          expect(screen.queryByText('Folder created')).not.toBeInTheDocument()
          expect(listedDescriptions()).toEqual(['Rema 1000', 'Elkjøp'])
        })

        it('says so, keeping the input, when the Folder could not be created', async () => {
          handleAddFolder = () => new Response(null, { status: 500 })
          const user = await showBookmarksWithFolders()
          await user.selectOptions(folderSelect(), 'New folder…')
          await user.type(nameField(), 'Receipts')

          await user.click(screen.getByRole('button', { name: 'Create' }))

          expect(await screen.findByRole('alert')).toHaveTextContent('Saving failed (500).')
          expect(nameField()).toHaveValue('Receipts')
        })
      })

      it('offers Rename and Delete only while a Folder is chosen', async () => {
        const user = await showBookmarksWithFolders()
        expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()

        await user.selectOptions(folderSelect(), 'Warranty')
        await screen.findByRole('cell', { name: 'Power' })

        expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()

        await user.selectOptions(folderSelect(), 'Bookmarks')
        await screen.findByRole('cell', { name: 'Elkjøp' })

        expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
      })

      // Bookmarks shown, with the Warranty Folder chosen and its bookmarks listed.
      async function showWarranty() {
        const user = await showBookmarksWithFolders()
        await user.selectOptions(folderSelect(), 'Warranty')
        await screen.findByRole('cell', { name: 'Power' })
        return user
      }

      it('closes the open popup, Note editor or delete confirmation when Rename or Delete opens', async () => {
        const user = await showWarranty()
        const folderDeleteQuestion = "Delete 'Warranty' and its bookmarks?"
        await user.click(screen.getByRole('button', { name: 'Remove bookmark for Power' }))
        await user.click(await screen.findByRole('button', { name: 'Bookmark Power' }))
        await screen.findByRole('dialog', { name: 'Bookmark added' })

        await user.click(screen.getByRole('button', { name: 'Delete' }))

        expect(screen.queryByRole('dialog', { name: 'Bookmark added' })).not.toBeInTheDocument()
        expect(screen.getByText(folderDeleteQuestion)).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Add note for Power' }))

        expect(screen.queryByText(folderDeleteQuestion)).not.toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Delete' }))

        expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Delete Power' }))
        await user.click(screen.getByRole('button', { name: 'Delete' }))

        expect(screen.queryByText(/Delete "Power"/)).not.toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Rename' }))

        expect(screen.queryByText(folderDeleteQuestion)).not.toBeInTheDocument()
        expect(screen.getByRole('textbox', { name: 'Folder name' })).toHaveValue('Warranty')
      })

      it('keeps a row moved to another Folder from the popup, star filled, until another option is chosen', async () => {
        // Added back into the last used folder, Warranty.
        handleAddBookmark = () => Response.json({ folderId: 21 })
        const user = await showWarranty()
        await user.click(screen.getByRole('button', { name: 'Remove bookmark for Power' }))
        await user.click(await screen.findByRole('button', { name: 'Bookmark Power' }))
        const popupFolder = within(await screen.findByRole('dialog', { name: 'Bookmark added' })).getByLabelText('Folder')
        expect(popupFolder).toHaveDisplayValue('Warranty')

        await user.selectOptions(popupFolder, 'Tax deductible')
        await waitFor(() => expect(popupFolder).toBeEnabled())
        await user.click(screen.getByRole('button', { name: 'Done' }))

        expect(listedDescriptions()).toEqual(['Power'])
        expect(screen.getByRole('button', { name: 'Remove bookmark for Power' })).toHaveAttribute('aria-pressed', 'true')
        expect(folderSelect()).toHaveDisplayValue('Warranty')

        handleListFolderBookmarks = (folderId) => Response.json(folderId === 20 ? warrantyBookmarks : [])
        await user.selectOptions(folderSelect(), 'Tax deductible')
        expect(await screen.findByRole('cell', { name: 'Power' })).toBeInTheDocument()
        await user.selectOptions(folderSelect(), 'Warranty')

        expect(await screen.findByText('No bookmarks in Warranty')).toBeInTheDocument()
        expect(screen.queryByRole('table')).not.toBeInTheDocument()
      })

      it('closes Rename or Delete when another option is chosen or All is shown', async () => {
        const user = await showWarranty()
        await user.click(screen.getByRole('button', { name: 'Delete' }))

        await user.selectOptions(folderSelect(), 'Tax deductible')

        expect(await screen.findByText('No bookmarks in Tax deductible')).toBeInTheDocument()
        expect(screen.queryByText(/and its bookmarks\?/)).not.toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Rename' }))
        await user.click(switchButton('All'))
        await showBookmarks(user)
        await screen.findByRole('cell', { name: 'Elkjøp' })
        await user.selectOptions(folderSelect(), 'Tax deductible')

        expect(await screen.findByText('No bookmarks in Tax deductible')).toBeInTheDocument()
        expect(screen.queryByRole('textbox', { name: 'Folder name' })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument()
      })

      describe('renaming a Folder', () => {
        function nameField() {
          return screen.getByRole('textbox', { name: 'Folder name' })
        }

        it('swaps the dropdown for the name, and moves the renamed Folder to its place A–Z, still chosen', async () => {
          const renamed: [number, unknown][] = []
          handleRenameFolder = (id, body) => {
            renamed.push([id, body])
            return Response.json({ id, name: 'Abonnement' })
          }
          const user = await showWarranty()

          await user.click(screen.getByRole('button', { name: 'Rename' }))

          expect(screen.queryByLabelText('Folder')).not.toBeInTheDocument()
          expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
          expect(nameField()).toHaveValue('Warranty')
          expect(nameField()).toHaveFocus()
          expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

          await user.clear(nameField())
          await user.type(nameField(), ' Abonnement ')
          await user.click(screen.getByRole('button', { name: 'Save' }))

          expect(await screen.findByRole('status')).toHaveTextContent('Folder renamed')
          expect(renamed).toEqual([[21, { name: 'Abonnement' }]])
          expect(folderSelect()).toHaveDisplayValue('Abonnement')
          expect(folderOptions()).toEqual(['Bookmarks', 'Abonnement', 'Tax deductible', 'New folder…'])
          expect(listedDescriptions()).toEqual(['Power'])
          expect(screen.queryByRole('textbox', { name: 'Folder name' })).not.toBeInTheDocument()
        })

        it('shows a field error under the name field and keeps the input', async () => {
          handleRenameFolder = () =>
            Response.json({ errors: { name: ["A folder named 'Tax deductible' already exists."] } }, { status: 400 })
          const user = await showWarranty()
          await user.click(screen.getByRole('button', { name: 'Rename' }))
          await user.clear(nameField())
          await user.type(nameField(), 'tax deductible')

          await user.click(screen.getByRole('button', { name: 'Save' }))

          expect(await screen.findByText("A folder named 'Tax deductible' already exists.")).toBeInTheDocument()
          expect(nameField()).toHaveAccessibleDescription("A folder named 'Tax deductible' already exists.")
          expect(nameField()).toHaveValue('tax deductible')
          expect(screen.queryByLabelText('Folder')).not.toBeInTheDocument()
          expect(screen.queryByText('Folder renamed')).not.toBeInTheDocument()
        })

        it('puts the name back on Cancel', async () => {
          const user = await showWarranty()
          await user.click(screen.getByRole('button', { name: 'Rename' }))
          await user.clear(nameField())
          await user.type(nameField(), 'Abonnement')

          await user.click(screen.getByRole('button', { name: 'Cancel' }))

          expect(folderSelect()).toHaveDisplayValue('Warranty')
          expect(folderOptions()).toEqual(['Bookmarks', 'Tax deductible', 'Warranty', 'New folder…'])
          expect(listedDescriptions()).toEqual(['Power'])
          expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toEqual([])

          await user.click(screen.getByRole('button', { name: 'Rename' }))

          expect(nameField()).toHaveValue('Warranty')
        })
      })

      describe('deleting a Folder', () => {
        it('asks first, then deletes the Folder and shows "Bookmarks"', async () => {
          const deleted: number[] = []
          handleDeleteFolder = (id) => {
            deleted.push(id)
            return new Response(null, { status: 204 })
          }
          const user = await showWarranty()

          await user.click(screen.getByRole('button', { name: 'Delete' }))

          expect(screen.getByText("Delete 'Warranty' and its bookmarks?")).toBeInTheDocument()
          expect(deleted).toEqual([])

          await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

          expect(await screen.findByRole('status')).toHaveTextContent('Folder deleted')
          expect(deleted).toEqual([21])
          expect(folderSelect()).toHaveDisplayValue('Bookmarks')
          expect(folderOptions()).toEqual(['Bookmarks', 'Tax deductible', 'New folder…'])
          expect(await screen.findByRole('cell', { name: 'Elkjøp' })).toBeInTheDocument()
          expect(listedDescriptions()).toEqual(['Rema 1000', 'Elkjøp'])
          expect(screen.queryByText("Delete 'Warranty' and its bookmarks?")).not.toBeInTheDocument()
          expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument()
        })

        it('keeps the Folder on Cancel', async () => {
          const user = await showWarranty()
          await user.click(screen.getByRole('button', { name: 'Delete' }))

          await user.click(screen.getByRole('button', { name: 'Cancel' }))

          expect(screen.queryByText("Delete 'Warranty' and its bookmarks?")).not.toBeInTheDocument()
          expect(folderSelect()).toHaveDisplayValue('Warranty')
          expect(folderOptions()).toEqual(['Bookmarks', 'Tax deductible', 'Warranty', 'New folder…'])
          expect(listedDescriptions()).toEqual(['Power'])
          expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toEqual([])
        })

        it('says so, keeping the Folder, when it could not be deleted', async () => {
          handleDeleteFolder = () => new Response(null, { status: 500 })
          const user = await showWarranty()
          await user.click(screen.getByRole('button', { name: 'Delete' }))

          await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

          expect(await screen.findByRole('alert')).toHaveTextContent('Deleting failed (500).')
          expect(folderSelect()).toHaveDisplayValue('Warranty')
          expect(folderOptions()).toEqual(['Bookmarks', 'Tax deductible', 'Warranty', 'New folder…'])
          expect(listedDescriptions()).toEqual(['Power'])
        })

        it('says so when the Folder was already deleted, and shows "Bookmarks"', async () => {
          handleDeleteFolder = () => new Response(null, { status: 404 })
          const user = await showWarranty()
          await user.click(screen.getByRole('button', { name: 'Delete' }))

          await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

          expect(await screen.findByRole('status')).toHaveTextContent('The folder was already deleted.')
          expect(folderSelect()).toHaveDisplayValue('Bookmarks')
          expect(folderOptions()).toEqual(['Bookmarks', 'Tax deductible', 'New folder…'])
        })

        it('shows the stars of its bookmarks empty once All is shown again', async () => {
          // Power, filed in Warranty, is in the Period All shows too.
          let powerBookmarked = true
          months = [{ year: 2026, month: 9 }]
          handleListPeriod = () =>
            Response.json([{ ...warrantyBookmarks[0], date: '2026-09-10', bookmarked: powerBookmarked }])
          handleDeleteFolder = () => {
            powerBookmarked = false
            return new Response(null, { status: 204 })
          }
          const user = await openTransactionsPage()
          await screen.findByRole('button', { name: 'Remove bookmark for Power' })
          await showBookmarks(user)
          await screen.findByRole('option', { name: 'Warranty' })
          await user.selectOptions(folderSelect(), 'Warranty')
          await screen.findByRole('cell', { name: 'Power' })
          await user.click(screen.getByRole('button', { name: 'Delete' }))
          await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
          await screen.findByText('Folder deleted')

          await user.click(switchButton('All'))

          expect(await screen.findByRole('button', { name: 'Bookmark Power' })).toHaveAttribute('aria-pressed', 'false')
        })
      })
    })
  })
})

describe('Dashboard', () => {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]

  const septemberSpending = {
    total: 1570.5,
    slices: [
      { categoryId: 13, amount: 1000 },
      { categoryId: null, amount: 450.5 },
      { categoryId: 1, amount: 120 },
    ],
  }

  function dashboard() {
    return screen.getByRole('region', { name: 'Spending' })
  }

  function centreTotal() {
    return within(dashboard()).getByText('Total').parentElement?.textContent
  }

  // Each legend row as shown: Category, amount and percentage.
  function legendRows() {
    return within(dashboard())
      .queryAllByRole('row')
      .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))
  }

  function monthOptions() {
    return within(screen.getByLabelText('Period'))
      .getAllByRole('option')
      .map((option) => option.textContent)
  }

  function requestedSpending() {
    return fetchMock.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/spending?'))
  }

  // The Transactions page's requests for a month or a year.
  function requestedPeriods() {
    return fetchMock.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/transactions?'))
  }

  function listedDescriptions() {
    return screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[1].textContent)
  }

  // The Transactions page's Year, Month and Category as shown.
  function chosenFilters() {
    return ['Year', 'Month', 'Category'].map(
      (label) => (screen.getByLabelText(label) as HTMLSelectElement).selectedOptions[0].textContent,
    )
  }

  // Serves the Transactions of the requested year or month out of `transactions`.
  function serveTransactions(transactions: { date: string }[]) {
    handleListPeriod = (year, month) =>
      Response.json(
        transactions.filter(
          (t) => monthOfDate(t.date).year === year && (month === undefined || monthOfDate(t.date).month === month),
        ),
      )
  }

  it("opens on the latest month with Transactions and shows its Spending by Category, largest first", async () => {
    months = [
      { year: 2026, month: 9 },
      { year: 2026, month: 8 },
      { year: 2025, month: 12 },
    ]
    handleSpending = (year, month) =>
      Response.json(year === 2026 && month === 9 ? septemberSpending : { total: 0, slices: [] })

    await renderApp()

    await waitFor(() => expect(legendRows()).toHaveLength(3))
    expect(legendRows()).toEqual([
      ['Other', '1 000,00 kr', '63,7 %'],
      ['Uncategorized', '450,50 kr', '28,7 %'],
      ['Groceries', '120,00 kr', '7,6 %'],
    ])
    expect(centreTotal()).toBe('Total 1 570,50 kr')
    expect(screen.getByLabelText('Period')).toHaveValue('2026-9')
    expect(monthOptions()).toEqual(['September 2026', 'August 2026', 'December 2025'])
    expect(requestedSpending()).toEqual(['/api/spending?year=2026&month=9'])
  })

  it('sits below the upload and Add transaction buttons', async () => {
    await renderApp()

    const addTransaction = screen.getByRole('button', { name: 'Add transaction' })
    expect(addTransaction.compareDocumentPosition(dashboard())).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    await waitFor(() => expect(centreTotal()).toBe('Total 0,00 kr'))
  })

  it('opens on the current month with an empty chart and a total of 0 when there are no Transactions', async () => {
    await renderApp()

    await waitFor(() => expect(centreTotal()).toBe('Total 0,00 kr'))
    const today = new Date()
    expect(monthOptions()).toEqual([`${monthNames[today.getMonth()]} ${today.getFullYear()}`])
    expect(requestedSpending()).toEqual([
      `/api/spending?year=${today.getFullYear()}&month=${today.getMonth() + 1}`,
    ])
    expect(legendRows()).toEqual([])
    expect(within(dashboard()).queryByRole('alert')).not.toBeInTheDocument()
  })

  it("shows the chosen month's Spending", async () => {
    months = [
      { year: 2026, month: 9 },
      { year: 2026, month: 8 },
    ]
    handleSpending = (_year, month) =>
      Response.json(month === 8 ? { total: 80, slices: [{ categoryId: 1, amount: 80 }] } : septemberSpending)
    const user = userEvent.setup()
    await renderApp()
    await waitFor(() => expect(legendRows()).toHaveLength(3))

    await user.selectOptions(screen.getByLabelText('Period'), 'August 2026')

    await waitFor(() => expect(legendRows()).toEqual([['Groceries', '80,00 kr', '100,0 %']]))
    expect(centreTotal()).toBe('Total 80,00 kr')
    expect(requestedSpending()).toEqual(['/api/spending?year=2026&month=9', '/api/spending?year=2026&month=8'])
  })

  // The legend swatch of the named slice, as a CSS colour.
  function swatchColour(name: string) {
    const row = within(dashboard()).getByRole('row', { name: new RegExp(`^${name}`) })
    return (row.querySelector('[aria-hidden="true"]') as HTMLElement).style.backgroundColor
  }

  it('shows Uncategorized in grey and keeps each Category in its colour across months', async () => {
    months = [
      { year: 2026, month: 9 },
      { year: 2026, month: 8 },
    ]
    handleSpending = (_year, month) =>
      Response.json(month === 8 ? { total: 80, slices: [{ categoryId: 1, amount: 80 }] } : septemberSpending)
    const user = userEvent.setup()
    await renderApp()
    await waitFor(() => expect(legendRows()).toHaveLength(3))
    const groceries = swatchColour('Groceries')

    expect(swatchColour('Uncategorized')).toBe('rgb(148, 163, 184)')
    expect(groceries).not.toBe(swatchColour('Other'))

    await user.selectOptions(screen.getByLabelText('Period'), 'August 2026')
    await waitFor(() => expect(legendRows()).toHaveLength(1))
    expect(swatchColour('Groceries')).toBe(groceries)
  })

  it('draws each Category in the colour the API gives it', async () => {
    categoriesServed = [{ ...categories[0], colour: '#123456' }, { ...categories[1], colour: '#abcdef' }]
    months = [{ year: 2026, month: 9 }]
    handleSpending = () => Response.json(septemberSpending)
    await renderApp()
    await waitFor(() => expect(legendRows()).toHaveLength(3))

    expect(swatchColour('Groceries')).toBe('rgb(18, 52, 86)')
    expect(swatchColour('Other')).toBe('rgb(171, 205, 239)')
    expect(swatchColour('Uncategorized')).toBe('rgb(148, 163, 184)')
  })

  it('adds a Transfers slice, counted in the total and percentages, while Include transfers is on', async () => {
    categoriesServed = [...categories, { id: 12, name: 'Transfers' }]
    months = [{ year: 2026, month: 9 }]
    handleSpending = (_year, _month, _quarter, includeTransfers) =>
      Response.json(
        includeTransfers
          ? {
              total: 2000,
              slices: [
                { categoryId: 12, amount: 1500 },
                { categoryId: 1, amount: 500 },
              ],
            }
          : { total: 500, slices: [{ categoryId: 1, amount: 500 }] },
      )
    const user = userEvent.setup()
    await renderApp()
    await waitFor(() => expect(legendRows()).toEqual([['Groceries', '500,00 kr', '100,0 %']]))
    const toggle = within(dashboard()).getByRole('checkbox', { name: 'Include transfers' })
    expect(toggle).not.toBeChecked()

    await user.click(toggle)

    await waitFor(() =>
      expect(legendRows()).toEqual([
        ['Transfers', '1 500,00 kr', '75,0 %'],
        ['Groceries', '500,00 kr', '25,0 %'],
      ]),
    )
    expect(centreTotal()).toBe('Total 2 000,00 kr')

    await user.click(toggle)

    await waitFor(() => expect(legendRows()).toEqual([['Groceries', '500,00 kr', '100,0 %']]))
    expect(centreTotal()).toBe('Total 500,00 kr')
    expect(requestedSpending()).toEqual([
      '/api/spending?year=2026&month=9',
      '/api/spending?year=2026&month=9&includeTransfers=true',
      '/api/spending?year=2026&month=9',
    ])
  })

  it('shows an empty chart with a total of 0 and no hint when the Period has only Transfers', async () => {
    categoriesServed = [...categories, { id: 12, name: 'Transfers' }]
    months = [{ year: 2026, month: 9 }]
    handleSpending = (_year, _month, _quarter, includeTransfers) =>
      Response.json(
        includeTransfers
          ? { total: 1500, slices: [{ categoryId: 12, amount: 1500 }] }
          : { total: 0, slices: [] },
      )

    await renderApp()

    await waitFor(() => expect(centreTotal()).toBe('Total 0,00 kr'))
    expect(legendRows()).toEqual([])
    expect(within(dashboard()).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(dashboard()).queryByText(/transfer/i, { ignore: 'label, option' })).toBeNull()
  })

  it('says when the Spending could not be loaded', async () => {
    handleSpending = () => new Response(null, { status: 500 })

    await renderApp()

    expect(await within(dashboard()).findByRole('alert')).toHaveTextContent('Could not load the Spending.')
  })

  it('says when the months could not be loaded', async () => {
    months = new Response(null, { status: 500 })

    await renderApp()

    expect(await within(dashboard()).findByRole('alert')).toHaveTextContent('Could not load the Spending.')
  })

  it('reloads after a Bank Statement is uploaded', async () => {
    const user = userEvent.setup()
    await renderApp()
    await waitFor(() => expect(centreTotal()).toBe('Total 0,00 kr'))
    months = [{ year: 2026, month: 9 }]
    handleSpending = () => Response.json(septemberSpending)

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    await waitFor(() => expect(centreTotal()).toBe('Total 1 570,50 kr'))
    expect(screen.getByLabelText('Period')).toHaveValue('2026-9')
  })

  it('keeps the Period and Include transfers when reloading after an upload', async () => {
    months = [
      { year: 2026, month: 9 },
      { year: 2026, month: 8 },
    ]
    const user = userEvent.setup()
    await renderApp()
    await waitFor(() => expect(centreTotal()).toBe('Total 0,00 kr'))
    await user.selectOptions(screen.getByLabelText('Period'), 'August 2026')
    await user.click(within(dashboard()).getByRole('checkbox', { name: 'Include transfers' }))
    handleSpending = () => Response.json(septemberSpending)

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    await waitFor(() => expect(centreTotal()).toBe('Total 1 570,50 kr'))
    expect(screen.getByLabelText('Period')).toHaveValue('2026-8')
    expect(within(dashboard()).getByRole('checkbox', { name: 'Include transfers' })).toBeChecked()
    expect(requestedSpending().at(-1)).toBe('/api/spending?year=2026&month=8&includeTransfers=true')
  })

  it('reloads after a Transaction is added', async () => {
    const user = await openModal()
    await waitFor(() => expect(centreTotal()).toBe('Total 0,00 kr'))
    await fillValidForm(user)
    months = [{ year: 2026, month: 9 }]
    handleSpending = () => Response.json(septemberSpending)

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(centreTotal()).toBe('Total 1 570,50 kr'))
  })

  describe('coming back to the home view', () => {
    it('keeps the Granularity, Period and Include transfers, and fetches the Spending again', async () => {
      months = [
        { year: 2026, month: 9 },
        { year: 2026, month: 8 },
        { year: 2026, month: 3 },
      ]
      const user = userEvent.setup()
      await renderApp()
      await waitFor(() => expect(centreTotal()).toBe('Total 0,00 kr'))
      await user.selectOptions(within(dashboard()).getByLabelText('Granularity'), 'Quarter')
      await user.selectOptions(screen.getByLabelText('Period'), 'Q1 2026')
      await user.click(within(dashboard()).getByRole('checkbox', { name: 'Include transfers' }))
      await user.click(screen.getByRole('button', { name: 'Transactions' }))
      const requestsBefore = requestedSpending().length
      handleSpending = () => Response.json(septemberSpending)

      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

      await waitFor(() => expect(centreTotal()).toBe('Total 1 570,50 kr'))
      expect(within(dashboard()).getByLabelText('Granularity')).toHaveDisplayValue('Quarter')
      expect(screen.getByLabelText('Period')).toHaveValue('2026-Q1')
      expect(within(dashboard()).getByRole('checkbox', { name: 'Include transfers' })).toBeChecked()
      expect(requestedSpending().slice(requestsBefore)).toEqual([
        '/api/spending?year=2026&quarter=1&includeTransfers=true',
      ])
    })

    it('keeps the Granularity, Period and Include transfers after a visit to the User page', async () => {
      months = [
        { year: 2026, month: 9 },
        { year: 2026, month: 3 },
      ]
      const user = userEvent.setup()
      await renderApp()
      await waitFor(() => expect(centreTotal()).toBe('Total 0,00 kr'))
      await user.selectOptions(within(dashboard()).getByLabelText('Granularity'), 'Quarter')
      await user.selectOptions(screen.getByLabelText('Period'), 'Q1 2026')
      await user.click(within(dashboard()).getByRole('checkbox', { name: 'Include transfers' }))
      await user.click(screen.getByRole('button', { name: 'User' }))

      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

      expect(within(dashboard()).getByLabelText('Granularity')).toHaveDisplayValue('Quarter')
      expect(screen.getByLabelText('Period')).toHaveValue('2026-Q1')
      expect(within(dashboard()).getByRole('checkbox', { name: 'Include transfers' })).toBeChecked()
      await waitFor(() =>
        expect(requestedSpending().at(-1)).toBe('/api/spending?year=2026&quarter=1&includeTransfers=true'),
      )
    })

    it('drops a load error once the Spending loads on return', async () => {
      months = [{ year: 2026, month: 9 }]
      handleSpending = () => new Response(null, { status: 500 })
      const user = userEvent.setup()
      await renderApp()
      expect(await within(dashboard()).findByRole('alert')).toHaveTextContent('Could not load the Spending.')
      await user.click(screen.getByRole('button', { name: 'Transactions' }))
      handleSpending = () => Response.json(septemberSpending)

      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

      await waitFor(() => expect(centreTotal()).toBe('Total 1 570,50 kr'))
      expect(within(dashboard()).queryByRole('alert')).toBeNull()
    })

    it('shows a Transaction recategorized on the Transactions page', async () => {
      months = [{ year: 2026, month: 9 }]
      let uncategorizedAmount = 450.5
      handleSpending = () =>
        Response.json(
          uncategorizedAmount > 0
            ? septemberSpending
            : { total: 1570.5, slices: [{ categoryId: 13, amount: 1000 }, { categoryId: 1, amount: 570.5 }] },
        )
      const transaction = {
        id: 4,
        date: '2026-09-03',
        description: 'Rema 1000',
        amount: -450.5,
        note: null,
        categoryId: null,
        locked: false,
        imported: true,
        bookmarked: false,
      }
      handleListPeriod = () => Response.json([transaction])
      handleChangeCategory = () => {
        uncategorizedAmount = 0
        return Response.json({ ...transaction, categoryId: 1, locked: true })
      }
      const user = userEvent.setup()
      await renderApp()
      await waitFor(() => expect(legendRows()).toHaveLength(3))
      await user.click(screen.getByRole('button', { name: 'Transactions' }))
      await user.selectOptions(await screen.findByRole('combobox', { name: 'Category for Rema 1000' }), 'Groceries')
      expect(await screen.findByRole('status')).toHaveTextContent('Category changed')

      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

      await waitFor(() =>
        expect(legendRows()).toEqual([
          ['Other', '1 000,00 kr', '63,7 %'],
          ['Groceries', '570,50 kr', '36,3 %'],
        ]),
      )
    })

    it('falls back to the latest month when the kept Period no longer has Transactions', async () => {
      months = [
        { year: 2026, month: 9 },
        { year: 2026, month: 8 },
        { year: 2025, month: 3 },
      ]
      const user = userEvent.setup()
      await renderApp()
      await waitFor(() => expect(centreTotal()).toBe('Total 0,00 kr'))
      await user.selectOptions(within(dashboard()).getByLabelText('Granularity'), 'Year')
      await user.selectOptions(screen.getByLabelText('Period'), '2025')
      await user.click(within(dashboard()).getByRole('checkbox', { name: 'Include transfers' }))
      await user.click(screen.getByRole('button', { name: 'Transactions' }))
      months = [
        { year: 2026, month: 9 },
        { year: 2026, month: 8 },
      ]

      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

      await waitFor(() => expect(screen.getByLabelText('Period')).toHaveValue('2026-9'))
      expect(within(dashboard()).getByLabelText('Granularity')).toHaveDisplayValue('Month')
      expect(monthOptions()).toEqual(['September 2026', 'August 2026'])
      expect(within(dashboard()).getByRole('checkbox', { name: 'Include transfers' })).toBeChecked()
      await waitFor(() =>
        expect(requestedSpending().at(-1)).toBe('/api/spending?year=2026&month=9&includeTransfers=true'),
      )
    })
  })

  describe('Periods', () => {
    const monthsWithTransactions = [
      { year: 2026, month: 9 },
      { year: 2026, month: 8 },
      { year: 2026, month: 4 },
      { year: 2025, month: 12 },
      { year: 2025, month: 11 },
      { year: 2025, month: 2 },
      { year: 2025, month: 1 },
    ]

    function chooseGranularity(user: ReturnType<typeof userEvent.setup>, granularity: string) {
      return user.selectOptions(within(dashboard()).getByLabelText('Granularity'), granularity)
    }

    function choosePeriod(user: ReturnType<typeof userEvent.setup>, period: string) {
      return user.selectOptions(screen.getByLabelText('Period'), period)
    }

    async function openDashboard() {
      months = monthsWithTransactions
      const user = userEvent.setup()
      await renderApp()
      await waitFor(() => expect(requestedSpending()).toEqual(['/api/spending?year=2026&month=9']))
      return user
    }

    it('opens on the Month granularity', async () => {
      await openDashboard()

      expect(within(dashboard()).getByLabelText('Granularity')).toHaveDisplayValue('Month')
      expect(
        within(within(dashboard()).getByLabelText('Granularity'))
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['Year', 'Quarter', 'Month'])
    })

    it('offers only the quarters and years with Transactions, newest first', async () => {
      const user = await openDashboard()

      await chooseGranularity(user, 'Quarter')
      expect(monthOptions()).toEqual(['Q3 2026', 'Q2 2026', 'Q4 2025', 'Q1 2025'])

      await chooseGranularity(user, 'Year')
      expect(monthOptions()).toEqual(['2026', '2025'])

      await chooseGranularity(user, 'Month')
      expect(monthOptions()).toEqual([
        'September 2026',
        'August 2026',
        'April 2026',
        'December 2025',
        'November 2025',
        'February 2025',
        'January 2025',
      ])
    })

    it("shows a quarter's Spending", async () => {
      handleSpending = (_year, _month, quarter) =>
        Response.json(quarter === 3 ? { total: 80, slices: [{ categoryId: 1, amount: 80 }] } : septemberSpending)
      const user = await openDashboard()

      await chooseGranularity(user, 'Quarter')

      await waitFor(() => expect(legendRows()).toEqual([['Groceries', '80,00 kr', '100,0 %']]))
      expect(centreTotal()).toBe('Total 80,00 kr')
    })

    it('keeps the Period that contains the current one when switching to a coarser granularity', async () => {
      const user = await openDashboard()
      await choosePeriod(user, 'April 2026')

      await chooseGranularity(user, 'Quarter')
      expect(screen.getByLabelText('Period')).toHaveDisplayValue('Q2 2026')

      await chooseGranularity(user, 'Year')
      expect(screen.getByLabelText('Period')).toHaveDisplayValue('2026')

      await waitFor(() =>
        expect(requestedSpending()).toEqual([
          '/api/spending?year=2026&month=9',
          '/api/spending?year=2026&month=4',
          '/api/spending?year=2026&quarter=2',
          '/api/spending?year=2026',
        ]),
      )
    })

    it('goes to the latest Period with Transactions inside the current one when switching to a finer granularity', async () => {
      const user = await openDashboard()
      await chooseGranularity(user, 'Year')
      await choosePeriod(user, '2025')

      await chooseGranularity(user, 'Quarter')
      expect(screen.getByLabelText('Period')).toHaveDisplayValue('Q4 2025')

      await choosePeriod(user, 'Q1 2025')
      await chooseGranularity(user, 'Month')
      expect(screen.getByLabelText('Period')).toHaveDisplayValue('February 2025')

      await chooseGranularity(user, 'Year')
      await chooseGranularity(user, 'Month')
      expect(screen.getByLabelText('Period')).toHaveDisplayValue('December 2025')

      await waitFor(() =>
        expect(requestedSpending()).toEqual([
          '/api/spending?year=2026&month=9',
          '/api/spending?year=2026',
          '/api/spending?year=2025',
          '/api/spending?year=2025&quarter=4',
          '/api/spending?year=2025&quarter=1',
          '/api/spending?year=2025&month=2',
          '/api/spending?year=2025',
          '/api/spending?year=2025&month=12',
        ]),
      )
    })

    it('keeps Include transfers on when the Period or granularity changes', async () => {
      const user = await openDashboard()
      await user.click(within(dashboard()).getByRole('checkbox', { name: 'Include transfers' }))

      await choosePeriod(user, 'April 2026')
      await chooseGranularity(user, 'Quarter')

      expect(within(dashboard()).getByRole('checkbox', { name: 'Include transfers' })).toBeChecked()
      await waitFor(() =>
        expect(requestedSpending()).toEqual([
          '/api/spending?year=2026&month=9',
          '/api/spending?year=2026&month=9&includeTransfers=true',
          '/api/spending?year=2026&month=4&includeTransfers=true',
          '/api/spending?year=2026&quarter=2&includeTransfers=true',
        ]),
      )
    })
  })

  describe('Drilling down', () => {
    const groceriesAndUncategorized = [
      {
        id: 5,
        date: '2026-09-24',
        description: 'Rema 1000',
        amount: -120,
        note: null,
        categoryId: 1,
        locked: false,
        imported: true,
        bookmarked: false,
      },
      {
        id: 4,
        date: '2026-09-03',
        description: 'Ukjent butikk',
        amount: -450.5,
        note: null,
        categoryId: null,
        locked: false,
        imported: true,
        bookmarked: false,
      },
    ]

    // Waits for the Spending, which may still be loading for a Period just chosen.
    function legendButton(name: string) {
      return within(dashboard()).findByRole('button', { name })
    }

    async function openDashboard() {
      months = [
        { year: 2026, month: 9 },
        { year: 2025, month: 12 },
      ]
      handleSpending = () => Response.json(septemberSpending)
      handleListPeriod = () => Response.json(groceriesAndUncategorized)
      const user = userEvent.setup()
      await renderApp()
      await waitFor(() => expect(legendRows()).toHaveLength(3))
      return user
    }

    it("opens the Transactions page on the Period's month, filtered to the clicked Category", async () => {
      const user = await openDashboard()
      await user.selectOptions(screen.getByLabelText('Period'), 'December 2025')

      await user.click(await legendButton('Groceries'))

      expect(await screen.findByRole('cell', { name: 'Rema 1000' })).toBeInTheDocument()
      expect(listedDescriptions()).toEqual(['Rema 1000'])
      expect(chosenFilters()).toEqual(['2025', 'December', 'Groceries'])
      expect(requestedPeriods()).toEqual(['/api/transactions?year=2025&month=12'])
    })

    it('opens the whole year for a year Period', async () => {
      const user = await openDashboard()
      await user.selectOptions(within(dashboard()).getByLabelText('Granularity'), 'Year')
      await user.selectOptions(screen.getByLabelText('Period'), '2025')

      await user.click(await legendButton('Groceries'))

      expect(await screen.findByRole('cell', { name: 'Rema 1000' })).toBeInTheDocument()
      expect(chosenFilters()).toEqual(['2025', 'All months', 'Groceries'])
      expect(requestedPeriods()).toEqual(['/api/transactions?year=2025'])
    })

    it('opens the Uncategorized filter from the Uncategorized row, using the keyboard', async () => {
      const user = await openDashboard()
      ;(await legendButton('Uncategorized')).focus()

      await user.keyboard('{Enter}')

      expect(await screen.findByRole('cell', { name: 'Ukjent butikk' })).toBeInTheDocument()
      expect(listedDescriptions()).toEqual(['Ukjent butikk'])
      expect(screen.getByLabelText('Category')).toHaveDisplayValue('Uncategorized')
    })

    it('arrives with the search empty, even after searching before', async () => {
      const user = await openDashboard()
      await user.click(screen.getByRole('button', { name: 'Transactions' }))
      await user.type(await screen.findByLabelText('Search'), 'rema')
      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

      await user.click(await legendButton('Uncategorized'))

      expect(await screen.findByRole('cell', { name: 'Ukjent butikk' })).toBeInTheDocument()
      expect(screen.getByLabelText('Search')).toHaveValue('')
    })

    // The donut's slice in the Category's colour. The chart has a fixed size, so recharts draws its
    // slices in jsdom without any size to measure.
    function slice(colour: string) {
      const sectors = [...dashboard().querySelectorAll('.recharts-pie-sector path')]
      return sectors.find((sector) => sector.getAttribute('fill') === colour)!
    }

    it('opens the same Transactions from a donut slice, which shows a pointer, as from its legend row', async () => {
      const user = await openDashboard()
      await user.selectOptions(screen.getByLabelText('Period'), 'December 2025')
      await legendButton('Groceries')
      expect(slice('#2a78d6')).toHaveStyle({ cursor: 'pointer' })

      await user.click(slice('#2a78d6'))

      expect(await screen.findByRole('cell', { name: 'Rema 1000' })).toBeInTheDocument()
      expect(listedDescriptions()).toEqual(['Rema 1000'])
      expect(chosenFilters()).toEqual(['2025', 'December', 'Groceries'])
    })

    describe('a quarter', () => {
      // Q4 2025's Transactions: Other in October, Groceries in November, Uncategorized in December.
      const q4Transactions = [
        { id: 11, date: '2025-10-08', description: 'Elkjøp', categoryId: 13 },
        { id: 12, date: '2025-11-14', description: 'Kiwi', categoryId: 1 },
        { id: 13, date: '2025-12-02', description: 'Ukjent kiosk', categoryId: null },
      ].map((t) => ({ ...t, amount: -100, note: null, locked: false, imported: true }))

      async function openQuarter() {
        const user = await openDashboard()
        serveTransactions(q4Transactions)
        await user.selectOptions(within(dashboard()).getByLabelText('Granularity'), 'Quarter')
        await user.selectOptions(screen.getByLabelText('Period'), 'Q4 2025')
        return user
      }

      it("opens the quarter's first month when the Category has Transactions in it", async () => {
        const user = await openQuarter()

        await user.click(await legendButton('Other'))

        expect(await screen.findByRole('cell', { name: 'Elkjøp' })).toBeInTheDocument()
        expect(listedDescriptions()).toEqual(['Elkjøp'])
        expect(chosenFilters()).toEqual(['2025', 'October', 'Other'])
        expect(requestedPeriods()).toEqual(['/api/transactions?year=2025', '/api/transactions?year=2025&month=10'])
      })

      it('opens the first month where the Category has Transactions, past empty ones', async () => {
        const user = await openQuarter()

        await user.click(await legendButton('Groceries'))

        expect(await screen.findByRole('cell', { name: 'Kiwi' })).toBeInTheDocument()
        expect(chosenFilters()).toEqual(['2025', 'November', 'Groceries'])
      })

      it('opens the first month with Uncategorized Transactions for the Uncategorized row', async () => {
        const user = await openQuarter()

        await user.click(await legendButton('Uncategorized'))

        expect(await screen.findByRole('cell', { name: 'Ukjent kiosk' })).toBeInTheDocument()
        expect(chosenFilters()).toEqual(['2025', 'December', 'Uncategorized'])
      })

      it("opens the quarter's first month when the Category's Transactions are gone", async () => {
        const user = await openQuarter()
        serveTransactions(q4Transactions.filter((t) => t.categoryId !== 1))

        await user.click(await legendButton('Groceries'))

        expect(await screen.findByText('No transactions match')).toBeInTheDocument()
        expect(chosenFilters()).toEqual(['2025', 'October', 'Groceries'])
      })

      it('says the Transactions could not load when finding the month fails', async () => {
        const user = await openQuarter()
        handleListPeriod = () => new Response(null, { status: 500 })

        await user.click(await legendButton('Groceries'))

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the transactions.')
        expect(requestedPeriods()).toEqual(['/api/transactions?year=2025'])
      })

      it('stays on the page chosen while the month was being found', async () => {
        const user = await openQuarter()
        let finishLoading = () => {}
        handleListPeriod = () =>
          new Promise<Response>((resolve) => {
            finishLoading = () => resolve(Response.json(q4Transactions))
          })
        await user.click(await legendButton('Groceries'))
        await waitFor(() => expect(requestedPeriods()).toEqual(['/api/transactions?year=2025']))

        await user.click(screen.getByRole('button', { name: 'Categories' }))
        await act(async () => finishLoading())

        expect(screen.getByRole('button', { name: 'Categories' })).toHaveAttribute('aria-current', 'page')
        expect(screen.queryByLabelText('Month')).not.toBeInTheDocument()
        expect(requestedPeriods()).toEqual(['/api/transactions?year=2025'])
      })

      it('opens the same month from a donut slice, which shows a pointer', async () => {
        const user = await openQuarter()
        await legendButton('Groceries')
        expect(slice('#2a78d6')).toHaveStyle({ cursor: 'pointer' })

        await user.click(slice('#2a78d6'))

        expect(await screen.findByRole('cell', { name: 'Kiwi' })).toBeInTheDocument()
        expect(chosenFilters()).toEqual(['2025', 'November', 'Groceries'])
      })
    })

    it('opens the Transactions page on All, even after Bookmarks was shown there before', async () => {
      const user = await openDashboard()
      await user.click(screen.getByRole('button', { name: 'Transactions' }))
      const switchTo = (name: string) =>
        within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name })
      await user.click(switchTo('Bookmarks'))
      await screen.findByText('No bookmarks')
      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

      await user.click(await legendButton('Groceries'))

      expect(await screen.findByRole('cell', { name: 'Rema 1000' })).toBeInTheDocument()
      expect(switchTo('All')).toHaveAttribute('aria-pressed', 'true')
      expect(chosenFilters()).toEqual(['2026', 'September', 'Groceries'])
    })

    it('still opens on the latest month, all Categories and no search from the header', async () => {
      const user = await openDashboard()
      await user.selectOptions(screen.getByLabelText('Period'), 'December 2025')
      await user.click(await legendButton('Groceries'))
      await screen.findByRole('cell', { name: 'Rema 1000' })
      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

      await user.click(screen.getByRole('button', { name: 'Transactions' }))

      expect(await screen.findByRole('cell', { name: 'Ukjent butikk' })).toBeInTheDocument()
      expect(listedDescriptions()).toEqual(['Rema 1000', 'Ukjent butikk'])
      expect(chosenFilters()).toEqual(['2026', 'September', 'All categories'])
      expect(screen.getByLabelText('Search')).toHaveValue('')
      expect(requestedPeriods().at(-1)).toBe('/api/transactions?year=2026&month=9')
    })
  })

  describe('Trend', () => {
    function trend() {
      return screen.getByRole('region', { name: 'Spending trend' })
    }

    // The trend table as shown, header first: each row's cells.
    function trendTable() {
      return within(trend())
        .queryAllByRole('row')
        .map((row) => [...row.children].map((cell) => cell.textContent))
    }

    function spanOptions(label: 'From' | 'To') {
      return within(within(trend()).getByLabelText(label))
        .getAllByRole('option')
        .map((option) => option.textContent)
    }

    function selectedMonth(label: 'From' | 'To') {
      return (within(trend()).getByLabelText(label) as HTMLSelectElement).selectedOptions[0].textContent
    }

    function requestedMonthlySpending() {
      return fetchMock.mock.calls
        .map(([url]) => url)
        .filter((url) => url.startsWith('/api/spending/monthly?'))
    }

    it('sits below the Spending by Category', async () => {
      months = [
        { year: 2026, month: 9 },
        { year: 2026, month: 8 },
      ]

      await renderApp()

      await waitFor(() => expect(trendTable()).toHaveLength(2))
      expect(dashboard().compareDocumentPosition(trend())).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    })

    it('opens on the 12 months ending at the latest month with Transactions, offering every month from the earliest', async () => {
      months = [
        { year: 2026, month: 9 },
        { year: 2026, month: 8 },
        { year: 2025, month: 4 },
        { year: 2025, month: 1 },
      ]
      handleMonthlySpending = (from, to) =>
        Response.json(
          monthlySpending(from, to, {
            '2025-10': [
              { categoryId: 1, amount: 600 },
              { categoryId: null, amount: 400 },
            ],
            '2026-9': [{ categoryId: 13, amount: 1123 }],
          }),
        )

      await renderApp()

      await waitFor(() =>
        expect(trendTable()).toEqual([
          ['', 'October 2025', 'September 2026', 'Change'],
          ['Total', '1 000,00 kr', '1 123,00 kr', '▲ +12,3 %'],
          ['Other', '0,00 kr', '1 123,00 kr', 'New'],
          ['Groceries', '600,00 kr', '0,00 kr', '−100 %'],
          ['Uncategorized', '400,00 kr', '0,00 kr', '−100 %'],
        ]),
      )
      expect(selectedMonth('From')).toBe('10.2025')
      expect(selectedMonth('To')).toBe('09.2026')
      const offered = [
        '01.2025', '02.2025', '03.2025', '04.2025', '05.2025', '06.2025', '07.2025',
        '08.2025', '09.2025', '10.2025', '11.2025', '12.2025', '01.2026', '02.2026',
        '03.2026', '04.2026', '05.2026', '06.2026', '07.2026', '08.2026', '09.2026',
      ]
      expect(spanOptions('From')).toEqual(offered)
      expect(spanOptions('To')).toEqual(offered)
      expect(requestedMonthlySpending()).toEqual([
        '/api/spending/monthly?fromYear=2025&fromMonth=10&toYear=2026&toMonth=9',
      ])
    })

    it('opens on all the months there are when there are fewer than 12', async () => {
      months = [
        { year: 2026, month: 9 },
        { year: 2026, month: 6 },
      ]

      await renderApp()

      await waitFor(() => expect(trendTable()).toHaveLength(2))
      expect(selectedMonth('From')).toBe('06.2026')
      expect(selectedMonth('To')).toBe('09.2026')
      expect(spanOptions('From')).toEqual(['06.2026', '07.2026', '08.2026', '09.2026'])
      expect(requestedMonthlySpending()).toEqual([
        '/api/spending/monthly?fromYear=2026&fromMonth=6&toYear=2026&toMonth=9',
      ])
    })

    it.each([
      ['no months', []],
      ['one month', [{ year: 2026, month: 9 }]],
    ])('says trends need at least two months with Transactions when there are %s', async (_case, offered) => {
      months = offered

      await renderApp()

      expect(await screen.findByText('Trends need at least two months with Transactions')).toBeVisible()
      expect(within(trend()).queryByLabelText('From')).toBeNull()
      expect(trendTable()).toEqual([])
      expect(requestedMonthlySpending()).toEqual([])
    })

    it.each([
      ['more Spending', 1000, 1123, '1 000,00 kr', '1 123,00 kr', '▲ +12,3 %'],
      ['less Spending', 1000, 920, '1 000,00 kr', '920,00 kr', '▼ −8,0 %'],
      ['the same Spending', 250, 250, '250,00 kr', '250,00 kr', '0,0 %'],
      ['Spending that is new', 0, 500, '0,00 kr', '500,00 kr', 'New'],
      ['Spending that stopped', 400, 0, '400,00 kr', '0,00 kr', '−100 %'],
      ['no Spending at either end', 0, 0, '0,00 kr', '0,00 kr', '–'],
    ])('shows the first and last monthly totals and the change for %s', async (_case, first, last, firstShown, lastShown, change) => {
      months = [
        { year: 2026, month: 3 },
        { year: 2026, month: 1 },
      ]
      handleMonthlySpending = (from, to) =>
        Response.json(
          monthlySpending(from, to, {
            '2026-1': first > 0 ? [{ categoryId: 1, amount: first }] : [],
            '2026-2': [{ categoryId: 1, amount: 9999 }],
            '2026-3': last > 0 ? [{ categoryId: 1, amount: last }] : [],
          }),
        )

      await renderApp()

      await waitFor(() =>
        expect(trendTable()).toEqual([
          ['', 'January 2026', 'March 2026', 'Change'],
          ['Total', firstShown, lastShown, change],
          ['Groceries', firstShown, lastShown, change],
        ]),
      )
    })

    describe('Span picker', () => {
      // Every month from January 2025 to September 2026 is offered.
      async function openTrend() {
        months = [
          { year: 2026, month: 9 },
          { year: 2025, month: 1 },
        ]
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(trendTable()).toHaveLength(2))
        return user
      }

      function chooseMonth(user: ReturnType<typeof userEvent.setup>, label: 'From' | 'To', month: string) {
        return user.selectOptions(within(trend()).getByLabelText(label), month)
      }

      it("shows the chosen Span's Spending", async () => {
        const user = await openTrend()
        handleMonthlySpending = (from, to) =>
          Response.json(
            monthlySpending(from, to, {
              '2025-3': [{ categoryId: 1, amount: 300 }],
              '2025-6': [{ categoryId: 1, amount: 600 }],
            }),
          )

        await chooseMonth(user, 'From', '03.2025')
        await chooseMonth(user, 'To', '06.2025')

        await waitFor(() =>
          expect(trendTable()).toEqual([
            ['', 'March 2025', 'June 2025', 'Change'],
            ['Total', '300,00 kr', '600,00 kr', '▲ +100,0 %'],
            ['Groceries', '300,00 kr', '600,00 kr', '▲ +100,0 %'],
          ]),
        )
        expect(requestedMonthlySpending()).toEqual([
          '/api/spending/monthly?fromYear=2025&fromMonth=10&toYear=2026&toMonth=9',
          '/api/spending/monthly?fromYear=2025&fromMonth=3&toYear=2026&toMonth=9',
          '/api/spending/monthly?fromYear=2025&fromMonth=3&toYear=2025&toMonth=6',
        ])
      })

      it('moves To to the month after a From that is not before it', async () => {
        const user = await openTrend()
        await chooseMonth(user, 'To', '02.2026')

        await chooseMonth(user, 'From', '05.2026')
        expect([selectedMonth('From'), selectedMonth('To')]).toEqual(['05.2026', '06.2026'])

        await chooseMonth(user, 'From', '06.2026')
        expect([selectedMonth('From'), selectedMonth('To')]).toEqual(['06.2026', '07.2026'])
        expect(within(trend()).queryByRole('alert')).toBeNull()
      })

      it('moves From back when the month after it would pass the latest month', async () => {
        const user = await openTrend()

        await chooseMonth(user, 'From', '09.2026')

        expect([selectedMonth('From'), selectedMonth('To')]).toEqual(['08.2026', '09.2026'])
        await waitFor(() =>
          expect(requestedMonthlySpending().at(-1)).toBe(
            '/api/spending/monthly?fromYear=2026&fromMonth=8&toYear=2026&toMonth=9',
          ),
        )
      })

      it('moves From to the month before a To that is not after it', async () => {
        const user = await openTrend()

        await chooseMonth(user, 'To', '03.2025')
        expect([selectedMonth('From'), selectedMonth('To')]).toEqual(['02.2025', '03.2025'])

        await chooseMonth(user, 'To', '02.2025')
        expect([selectedMonth('From'), selectedMonth('To')]).toEqual(['01.2025', '02.2025'])
      })

      it('moves To forward when the month before it would come before the earliest month', async () => {
        const user = await openTrend()

        await chooseMonth(user, 'To', '01.2025')

        expect([selectedMonth('From'), selectedMonth('To')]).toEqual(['01.2025', '02.2025'])
        expect(within(trend()).queryByRole('alert')).toBeNull()
      })
    })

    describe('Points', () => {
      // Every month from January 2023 to September 2026 is offered.
      async function openTrend() {
        months = [
          { year: 2026, month: 9 },
          { year: 2023, month: 1 },
        ]
        handleMonthlySpending = (from, to) =>
          Response.json(
            monthlySpending(from, to, {
              '2023-3': [{ categoryId: 1, amount: 400 }],
              '2023-9': [{ categoryId: 1, amount: 800 }],
              '2023-10': [{ categoryId: 1, amount: 400 }],
              '2025-2': [{ categoryId: 1, amount: 100 }],
              '2025-3': [{ categoryId: 1, amount: 500 }],
              '2025-9': [{ categoryId: 1, amount: 900 }],
              '2025-10': [{ categoryId: 1, amount: 1000 }],
              '2026-7': [
                { categoryId: 1, amount: 600 },
                { categoryId: null, amount: 400 },
              ],
              '2026-8': [{ categoryId: 13, amount: 500 }],
              '2026-9': [{ categoryId: 1, amount: 300 }],
            }),
          )
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(trendTable()[1]?.[0]).toBe('Total'))
        return user
      }

      it.each([
        ['a long Span by month', 'Month', '09.2023', '09.2026', 'September 2023', 'September 2026', '800,00 kr', '300,00 kr', '▼ −62,5 %'],
        ['by quarter, from a partial first quarter', 'Quarter', '09.2025', '09.2026', 'Q3 2025', 'Q3 2026', '900,00 kr', '600,00 kr', '▼ −33,3 %'],
        ['partial first and last quarters', 'Quarter', '02.2025', '08.2026', 'Q1 2025', 'Q3 2026', '300,00 kr', '750,00 kr', '▲ +150,0 %'],
        ['by year, from a partial first year to a partial last one', 'Year', '03.2023', '09.2026', '2023', '2026', '160,00 kr', '200,00 kr', '▲ +25,0 %'],
        ['by year, from three months of the first year', 'Year', '10.2023', '09.2026', '2023', '2026', '133,33 kr', '200,00 kr', '▲ +50,0 %'],
      ])(
        'shows %s, each point as its Spending divided by the months of the Span it covers',
        async (_case, granularity, from, to, firstLabel, lastLabel, first, last, change) => {
          const user = await openTrend()

          await user.selectOptions(within(trend()).getByLabelText('From'), from)
          await user.selectOptions(within(trend()).getByLabelText('To'), to)
          await user.selectOptions(within(trend()).getByLabelText('Granularity'), granularity)

          await waitFor(() =>
            expect(trendTable().slice(0, 2)).toEqual([
              ['', firstLabel, lastLabel, 'Change'],
              ['Total', first, last, change],
            ]),
          )
        },
      )

      it('divides each Category by the months of the Span its point covers, as for Total', async () => {
        const user = await openTrend()

        await user.selectOptions(within(trend()).getByLabelText('From'), '02.2025')
        await user.selectOptions(within(trend()).getByLabelText('To'), '08.2026')
        await user.selectOptions(within(trend()).getByLabelText('Granularity'), 'Quarter')

        await waitFor(() =>
          expect(trendTable()).toEqual([
            ['', 'Q1 2025', 'Q3 2026', 'Change'],
            ['Total', '300,00 kr', '750,00 kr', '▲ +150,0 %'],
            ['Groceries', '300,00 kr', '300,00 kr', '0,0 %'],
            ['Other', '0,00 kr', '250,00 kr', 'New'],
            ['Uncategorized', '0,00 kr', '200,00 kr', 'New'],
          ]),
        )
      })
    })

    describe('Granularity', () => {
      function selectedGranularity() {
        return (within(trend()).getByLabelText('Granularity') as HTMLSelectElement).selectedOptions[0].textContent
      }

      it('offers Year, Quarter and Month before From and To, opening on Month', async () => {
        months = [
          { year: 2026, month: 9 },
          { year: 2026, month: 8 },
        ]
        await renderApp()
        await waitFor(() => expect(trendTable()).toHaveLength(2))

        expect(
          within(trend())
            .getAllByRole('combobox')
            .map((select) => select.closest('label')!.firstChild!.textContent),
        ).toEqual(['Granularity', 'From', 'To'])
        expect(
          within(within(trend()).getByLabelText('Granularity'))
            .getAllByRole('option')
            .map((option) => option.textContent),
        ).toEqual(['Year', 'Quarter', 'Month'])
        expect(selectedGranularity()).toBe('Month')
      })

      // Every month from January 2023 to September 2026 is offered.
      it.each([
        ['moves To to the end of the next year when the Span falls in one year', [['From', '03.2024'], ['To', '08.2024'], ['Granularity', 'Year']], '03.2024', '12.2025'],
        ['moves From back to the start of the previous year when there is no next one', [['From', '03.2026'], ['To', '08.2026'], ['Granularity', 'Year']], '01.2025', '08.2026'],
        ["moves To to the end of the next quarter when From is chosen in To's quarter", [['Granularity', 'Quarter'], ['To', '06.2026'], ['From', '05.2026']], '05.2026', '09.2026'],
        ['moves From back to the start of the previous quarter when From is chosen in the latest quarter', [['Granularity', 'Quarter'], ['From', '08.2026']], '04.2026', '09.2026'],
        ["moves From back to the start of the previous quarter when To is chosen in From's quarter", [['Granularity', 'Quarter'], ['From', '02.2025'], ['To', '03.2025']], '10.2024', '03.2025'],
        ['moves To to the end of the next quarter when To is chosen in the earliest quarter', [['Granularity', 'Quarter'], ['From', '01.2023'], ['To', '02.2023']], '01.2023', '06.2023'],
        ['keeps a Span widened at Year when going back to Month', [['From', '03.2026'], ['To', '08.2026'], ['Granularity', 'Year'], ['Granularity', 'Month']], '01.2025', '08.2026'],
      ])('%s, so the Span touches at least two Periods', async (_case, choices, from, to) => {
        months = [
          { year: 2026, month: 9 },
          { year: 2023, month: 1 },
        ]
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(trendTable()).toHaveLength(2))

        for (const [label, value] of choices) {
          await user.selectOptions(within(trend()).getByLabelText(label), value)
        }

        expect(selectedMonth('From')).toBe(from)
        expect(selectedMonth('To')).toBe(to)
        expect(within(trend()).queryByRole('alert')).toBeNull()
      })

      it.each([
        ['From back no further than the earliest month', [{ year: 2026, month: 9 }, { year: 2025, month: 6 }], [['Granularity', 'Year'], ['From', '03.2026']], '06.2025', '09.2026'],
        ['To no further than the latest month', [{ year: 2026, month: 9 }, { year: 2025, month: 1 }], [['From', '02.2025'], ['To', '05.2025'], ['Granularity', 'Year']], '02.2025', '09.2026'],
      ])('moves %s', async (_case, offered, choices, from, to) => {
        months = offered
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(trendTable()).toHaveLength(2))

        for (const [label, value] of choices) {
          await user.selectOptions(within(trend()).getByLabelText(label), value)
        }

        expect(selectedMonth('From')).toBe(from)
        expect(selectedMonth('To')).toBe(to)
      })

      it('regroups the Spending already loaded when the Span is kept, without fetching it again', async () => {
        months = [
          { year: 2026, month: 9 },
          { year: 2025, month: 1 },
        ]
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(trendTable()[0]).toEqual(['', 'October 2025', 'September 2026', 'Change']))
        const requestsBefore = requestedMonthlySpending().length

        await user.selectOptions(within(trend()).getByLabelText('Granularity'), 'Quarter')

        expect(trendTable()[0]).toEqual(['', 'Q4 2025', 'Q3 2026', 'Change'])
        expect(requestedMonthlySpending()).toHaveLength(requestsBefore)
      })

      it.each([
        ['Year', [{ year: 2026, month: 9 }, { year: 2026, month: 1 }], 'Trends by Year need Transactions in at least two years'],
        ['Quarter', [{ year: 2026, month: 9 }, { year: 2026, month: 7 }], 'Trends by Quarter need Transactions in at least two quarters'],
      ])('says when the Transactions all fall in one Period at %s, and comes back at Month', async (granularity, offered, message) => {
        months = offered
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(trendTable()).toHaveLength(2))

        await user.selectOptions(within(trend()).getByLabelText('Granularity'), granularity)

        expect(trend()).toHaveTextContent(message)
        expect(within(trend()).queryByLabelText('From')).toBeNull()
        expect(trendTable()).toEqual([])

        await user.selectOptions(within(trend()).getByLabelText('Granularity'), 'Month')

        await waitFor(() => expect(trendTable()).toHaveLength(2))
        expect(selectedMonth('To')).toBe('09.2026')
      })

      it('keeps the Granularity after a Transaction is added', async () => {
        months = [
          { year: 2026, month: 9 },
          { year: 2025, month: 1 },
        ]
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(trendTable()).toHaveLength(2))
        await user.selectOptions(within(trend()).getByLabelText('Granularity'), 'Quarter')
        await waitFor(() => expect(trendTable()[0]).toEqual(['', 'Q4 2025', 'Q3 2026', 'Change']))
        const requestsBefore = requestedMonthlySpending().length
        await user.click(screen.getByRole('button', { name: 'Add transaction' }))
        await screen.findByRole('option', { name: 'Groceries' })
        await fillValidForm(user)

        await user.click(screen.getByRole('button', { name: /^save$/i }))

        await waitFor(() => expect(requestedMonthlySpending().length).toBeGreaterThan(requestsBefore))
        await waitFor(() => expect(trendTable()[0]).toEqual(['', 'Q4 2025', 'Q3 2026', 'Change']))
        expect(selectedGranularity()).toBe('Quarter')
      })
    })

    it('says when the trend could not be loaded, leaving the Spending by Category shown', async () => {
      months = [
        { year: 2026, month: 9 },
        { year: 2026, month: 8 },
      ]
      handleSpending = () => Response.json(septemberSpending)
      handleMonthlySpending = () => new Response(null, { status: 500 })

      await renderApp()

      await waitFor(() =>
        expect(within(trend()).getByRole('alert')).toHaveTextContent('Could not load the Spending trend.'),
      )
      await waitFor(() => expect(centreTotal()).toBe('Total 1 570,50 kr'))
      expect(within(dashboard()).queryByRole('alert')).toBeNull()
      expect(trendTable()).toEqual([])
    })

    it('still shows the trend when the Categories could not be loaded', async () => {
      months = [
        { year: 2026, month: 9 },
        { year: 2026, month: 8 },
      ]
      categoriesServed = new Response(null, { status: 500 })

      await renderApp()

      await waitFor(() =>
        expect(within(dashboard()).getByRole('alert')).toHaveTextContent('Could not load the Spending.'),
      )
      await waitFor(() => expect(trendTable()).toHaveLength(2))
      expect(within(trend()).queryByRole('alert')).toBeNull()
    })

    describe('Reloading', () => {
      // Every month from January 2025 to September 2026 is offered, with Groceries in March and June
      // 2025.
      beforeEach(() => {
        months = [
          { year: 2026, month: 9 },
          { year: 2025, month: 1 },
        ]
        handleMonthlySpending = (from, to) =>
          Response.json(
            monthlySpending(from, to, {
              '2025-3': [{ categoryId: 1, amount: 300 }],
              '2025-6': [{ categoryId: 1, amount: 600 }],
            }),
          )
      })

      // The names of the rows switched on, in table order.
      function switchedOn() {
        return within(within(trend()).getByRole('table'))
          .getAllByRole('checkbox')
          .filter((checkbox) => (checkbox as HTMLInputElement).checked)
          .map((checkbox) => checkbox.closest('tr')!.firstElementChild!.textContent)
      }

      // Waits for the trend, then chooses March to June 2025, Include transfers, and Groceries in
      // place of Total.
      async function chooseView(user: ReturnType<typeof userEvent.setup>) {
        await waitFor(() => expect(trendTable()).toHaveLength(2))
        await user.selectOptions(within(trend()).getByLabelText('From'), '03.2025')
        await user.selectOptions(within(trend()).getByLabelText('To'), '06.2025')
        await user.click(within(trend()).getByRole('checkbox', { name: 'Include transfers' }))
        await waitFor(() => expect(trendTable()).toHaveLength(3))
        await user.click(within(trend()).getByRole('checkbox', { name: 'Total' }))
        await user.click(within(trend()).getByRole('checkbox', { name: 'Groceries' }))
      }

      it('keeps the Span, Include transfers and switched-on lines after a Transaction is added, and fetches the Spending again', async () => {
        const user = userEvent.setup()
        await renderApp()
        await chooseView(user)
        const requestsBefore = requestedMonthlySpending().length
        await user.click(screen.getByRole('button', { name: 'Add transaction' }))
        await screen.findByRole('option', { name: 'Groceries' })
        await fillValidForm(user)
        handleMonthlySpending = (from, to) =>
          Response.json(
            monthlySpending(from, to, {
              '2025-3': [{ categoryId: 1, amount: 300 }],
              '2025-6': [
                { categoryId: 1, amount: 849.9 },
                { categoryId: 13, amount: 100 },
              ],
            }),
          )

        await user.click(screen.getByRole('button', { name: /^save$/i }))

        await waitFor(() =>
          expect(trendTable()).toEqual([
            ['', 'March 2025', 'June 2025', 'Change'],
            ['Total', '300,00 kr', '949,90 kr', '▲ +216,6 %'],
            ['Groceries', '300,00 kr', '849,90 kr', '▲ +183,3 %'],
            ['Other', '0,00 kr', '100,00 kr', 'New'],
          ]),
        )
        expect(selectedMonth('From')).toBe('03.2025')
        expect(selectedMonth('To')).toBe('06.2025')
        expect(within(trend()).getByRole('checkbox', { name: 'Include transfers' })).toBeChecked()
        expect(switchedOn()).toEqual(['Groceries'])
        expect(requestedMonthlySpending().slice(requestsBefore)).toEqual([
          '/api/spending/monthly?fromYear=2025&fromMonth=3&toYear=2025&toMonth=6&includeTransfers=true',
        ])
      })

      it('keeps the Span after a Bank Statement is uploaded, and fetches its Spending again', async () => {
        const user = userEvent.setup()
        await renderApp()
        await chooseView(user)
        const requestsBefore = requestedMonthlySpending().length
        handleMonthlySpending = (from, to) =>
          Response.json(monthlySpending(from, to, { '2025-6': [{ categoryId: 1, amount: 75 }] }))

        await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

        await waitFor(() => expect(trendTable()[1]).toEqual(['Total', '0,00 kr', '75,00 kr', 'New']))
        expect(selectedMonth('From')).toBe('03.2025')
        expect(selectedMonth('To')).toBe('06.2025')
        expect(requestedMonthlySpending().slice(requestsBefore)).toEqual([
          '/api/spending/monthly?fromYear=2025&fromMonth=3&toYear=2025&toMonth=6&includeTransfers=true',
        ])
      })

      it('keeps the default Span when it is still offered', async () => {
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(trendTable()).toHaveLength(2))
        months = [
          { year: 2026, month: 10 },
          { year: 2025, month: 1 },
        ]

        await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

        await waitFor(() => expect(spanOptions('To').at(-1)).toBe('10.2026'))
        await waitFor(() => expect(requestedMonthlySpending()).toHaveLength(2))
        expect(selectedMonth('From')).toBe('10.2025')
        expect(selectedMonth('To')).toBe('09.2026')
        expect(requestedMonthlySpending()[1]).toBe(
          '/api/spending/monthly?fromYear=2025&fromMonth=10&toYear=2026&toMonth=9',
        )
      })

      it('falls back to the 12 months ending at the latest month with Transactions when the Span is no longer offered', async () => {
        const user = userEvent.setup()
        await renderApp()
        await chooseView(user)
        months = [
          { year: 2026, month: 10 },
          { year: 2025, month: 4 },
        ]

        await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

        await waitFor(() => expect(trendTable()[0]).toEqual(['', 'November 2025', 'October 2026', 'Change']))
        expect(selectedMonth('From')).toBe('11.2025')
        expect(selectedMonth('To')).toBe('10.2026')
        expect(spanOptions('From')[0]).toBe('04.2025')
        expect(within(trend()).getByRole('checkbox', { name: 'Include transfers' })).toBeChecked()
        expect(requestedMonthlySpending().at(-1)).toBe(
          '/api/spending/monthly?fromYear=2025&fromMonth=11&toYear=2026&toMonth=10&includeTransfers=true',
        )
      })

      it('keeps the Granularity, Span, Include transfers and switched-on lines when coming back to the home view, and fetches the Spending again', async () => {
        const user = userEvent.setup()
        await renderApp()
        await chooseView(user)
        await user.selectOptions(within(trend()).getByLabelText('Granularity'), 'Quarter')
        await waitFor(() => expect(trendTable()[0]).toEqual(['', 'Q1 2025', 'Q2 2025', 'Change']))
        await user.click(screen.getByRole('button', { name: 'Transactions' }))
        const requestsBefore = requestedMonthlySpending().length
        handleMonthlySpending = (from, to) =>
          Response.json(
            monthlySpending(from, to, {
              '2025-3': [{ categoryId: 1, amount: 300 }],
              '2025-6': [{ categoryId: 1, amount: 150 }],
            }),
          )

        await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

        await waitFor(() =>
          expect(trendTable()).toEqual([
            ['', 'Q1 2025', 'Q2 2025', 'Change'],
            ['Total', '300,00 kr', '50,00 kr', '▼ −83,3 %'],
            ['Groceries', '300,00 kr', '50,00 kr', '▼ −83,3 %'],
          ]),
        )
        expect(within(trend()).getByLabelText('Granularity')).toHaveDisplayValue('Quarter')
        expect(selectedMonth('From')).toBe('03.2025')
        expect(selectedMonth('To')).toBe('06.2025')
        expect(within(trend()).getByRole('checkbox', { name: 'Include transfers' })).toBeChecked()
        expect(switchedOn()).toEqual(['Groceries'])
        expect(requestedMonthlySpending().slice(requestsBefore)).toEqual([
          '/api/spending/monthly?fromYear=2025&fromMonth=3&toYear=2025&toMonth=6&includeTransfers=true',
        ])
      })

      it('falls back to the months with Transactions when the kept Span ends on a month no longer offered', async () => {
        const user = userEvent.setup()
        await renderApp()
        await chooseView(user)
        await user.click(screen.getByRole('button', { name: 'Transactions' }))
        months = [
          { year: 2025, month: 5 },
          { year: 2025, month: 1 },
        ]

        await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

        await waitFor(() => expect(trendTable()[0]).toEqual(['', 'January 2025', 'May 2025', 'Change']))
        expect(selectedMonth('From')).toBe('01.2025')
        expect(selectedMonth('To')).toBe('05.2025')
        expect(within(trend()).getByRole('checkbox', { name: 'Include transfers' })).toBeChecked()
        expect(switchedOn()).toEqual(['Groceries'])
        expect(requestedMonthlySpending().at(-1)).toBe(
          '/api/spending/monthly?fromYear=2025&fromMonth=1&toYear=2025&toMonth=5&includeTransfers=true',
        )
      })
    })

    describe('Categories', () => {
      function toggle(name: string) {
        return within(trend()).getByRole('checkbox', { name }) as HTMLInputElement
      }

      // The names of the rows switched on, in table order.
      function switchedOn() {
        return within(within(trend()).getByRole('table'))
          .getAllByRole('checkbox')
          .filter((checkbox) => (checkbox as HTMLInputElement).checked)
          .map((checkbox) => checkbox.closest('tr')!.firstElementChild!.textContent)
      }

      it('lists Total, then each Category and Uncategorized with Spending in the Span, largest over the Span first', async () => {
        categoriesServed = [...categories, { id: 4, name: 'Transport' }, { id: 5, name: 'Restaurants' }]
        months = [
          { year: 2026, month: 3 },
          { year: 2026, month: 1 },
        ]
        handleMonthlySpending = (from, to) =>
          Response.json(
            monthlySpending(from, to, {
              '2026-1': [
                { categoryId: 1, amount: 100 },
                { categoryId: null, amount: 50 },
              ],
              '2026-2': [{ categoryId: 13, amount: 1000 }],
              '2026-3': [
                { categoryId: 1, amount: 150 },
                { categoryId: 4, amount: 40 },
              ],
            }),
          )

        await renderApp()

        await waitFor(() =>
          expect(trendTable()).toEqual([
            ['', 'January 2026', 'March 2026', 'Change'],
            ['Total', '150,00 kr', '190,00 kr', '▲ +26,7 %'],
            ['Other', '0,00 kr', '0,00 kr', '–'],
            ['Groceries', '100,00 kr', '150,00 kr', '▲ +50,0 %'],
            ['Uncategorized', '50,00 kr', '0,00 kr', '−100 %'],
            ['Transport', '0,00 kr', '40,00 kr', 'New'],
          ]),
        )
      })

      // The swatch in the named row of a table, as a CSS colour.
      function rowSwatch(region: HTMLElement, name: string) {
        const row = within(region).getByRole('row', { name: new RegExp(`^${name}`) })
        return (row.querySelector('[aria-hidden="true"]') as HTMLElement).style.backgroundColor
      }

      it('gives each Category and Uncategorized the colour it has in the donut, and Total dark slate', async () => {
        months = [
          { year: 2026, month: 9 },
          { year: 2026, month: 8 },
        ]
        handleSpending = () => Response.json(septemberSpending)
        handleMonthlySpending = (from, to) =>
          Response.json(monthlySpending(from, to, { '2026-9': septemberSpending.slices }))

        await renderApp()

        await waitFor(() => expect(trendTable()).toHaveLength(5))
        await waitFor(() => expect(legendRows()).toHaveLength(3))
        for (const name of ['Other', 'Uncategorized', 'Groceries']) {
          expect(rowSwatch(trend(), name)).toBe(rowSwatch(dashboard(), name))
        }
        expect(rowSwatch(trend(), 'Total')).toBe('rgb(30, 41, 59)')
      })

      it('draws each Category in the colour the API gives it', async () => {
        categoriesServed = [{ ...categories[0], colour: '#123456' }, { ...categories[1], colour: '#abcdef' }]
        months = [
          { year: 2026, month: 9 },
          { year: 2026, month: 8 },
        ]
        handleMonthlySpending = (from, to) =>
          Response.json(monthlySpending(from, to, { '2026-9': septemberSpending.slices }))

        await renderApp()

        await waitFor(() => expect(trendTable()).toHaveLength(5))
        expect(rowSwatch(trend(), 'Groceries')).toBe('rgb(18, 52, 86)')
        expect(rowSwatch(trend(), 'Other')).toBe('rgb(171, 205, 239)')
        expect(rowSwatch(trend(), 'Uncategorized')).toBe('rgb(148, 163, 184)')
      })

      it('opens with Total switched on and the Categories off, and switches any of them', async () => {
        months = [
          { year: 2026, month: 9 },
          { year: 2026, month: 8 },
        ]
        handleMonthlySpending = (from, to) =>
          Response.json(monthlySpending(from, to, { '2026-9': septemberSpending.slices }))
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(trendTable()).toHaveLength(5))
        expect(switchedOn()).toEqual(['Total'])

        await user.click(toggle('Total'))
        await user.click(toggle('Groceries'))
        await user.click(toggle('Uncategorized'))

        expect(switchedOn()).toEqual(['Uncategorized', 'Groceries'])
      })

      it('keeps rows switched on when the Span changes, including a Category that drops out and comes back', async () => {
        // Every month from January 2025 to September 2026 is offered.
        months = [
          { year: 2026, month: 9 },
          { year: 2025, month: 1 },
        ]
        handleMonthlySpending = (from, to) =>
          Response.json(
            monthlySpending(from, to, {
              '2025-3': [{ categoryId: 1, amount: 300 }],
              '2026-1': [{ categoryId: 13, amount: 500 }],
              '2026-9': [{ categoryId: 1, amount: 100 }],
            }),
          )
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(trendTable()).toHaveLength(4))
        await user.click(toggle('Total'))
        await user.click(toggle('Other'))

        await user.selectOptions(within(trend()).getByLabelText('From'), '02.2025')
        await waitFor(() => expect(trendTable()[0][1]).toBe('February 2025'))
        expect(switchedOn()).toEqual(['Other'])

        await user.selectOptions(within(trend()).getByLabelText('To'), '06.2025')
        await waitFor(() =>
          expect(trendTable()).toEqual([
            ['', 'February 2025', 'June 2025', 'Change'],
            ['Total', '0,00 kr', '0,00 kr', '–'],
            ['Groceries', '0,00 kr', '0,00 kr', '–'],
          ]),
        )
        expect(switchedOn()).toEqual([])

        await user.selectOptions(within(trend()).getByLabelText('To'), '09.2026')
        await waitFor(() => expect(trendTable()).toHaveLength(4))
        expect(switchedOn()).toEqual(['Other'])
      })

      it('keeps rows switched on when Include transfers changes', async () => {
        categoriesServed = [...categories, { id: 12, name: 'Transfers' }]
        months = [
          { year: 2026, month: 9 },
          { year: 2026, month: 8 },
        ]
        handleMonthlySpending = (from, to, includeTransfers) =>
          Response.json(
            monthlySpending(from, to, {
              '2026-8': [{ categoryId: 1, amount: 400 }],
              '2026-9': includeTransfers
                ? [
                    { categoryId: 12, amount: 1500 },
                    { categoryId: 1, amount: 500 },
                  ]
                : [{ categoryId: 1, amount: 500 }],
            }),
          )
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(trendTable()).toHaveLength(3))
        await user.click(toggle('Groceries'))

        await user.click(toggle('Include transfers'))
        await waitFor(() => expect(trendTable()).toHaveLength(4))
        expect(switchedOn()).toEqual(['Total', 'Groceries'])
        await user.click(toggle('Transfers'))

        await user.click(toggle('Include transfers'))
        await waitFor(() => expect(trendTable()).toHaveLength(3))
        expect(switchedOn()).toEqual(['Total', 'Groceries'])

        await user.click(toggle('Include transfers'))
        await waitFor(() => expect(trendTable()).toHaveLength(4))
        expect(switchedOn()).toEqual(['Total', 'Transfers', 'Groceries'])
      })
    })

    describe('Include transfers', () => {
      // August and September 2026, with Transfers in September that count only while included.
      beforeEach(() => {
        categoriesServed = [...categories, { id: 12, name: 'Transfers' }]
        months = [
          { year: 2026, month: 9 },
          { year: 2026, month: 8 },
        ]
        handleMonthlySpending = (from, to, includeTransfers) =>
          Response.json(
            monthlySpending(from, to, {
              '2026-8': [{ categoryId: 1, amount: 400 }],
              '2026-9': includeTransfers
                ? [
                    { categoryId: 12, amount: 1500 },
                    { categoryId: 1, amount: 500 },
                  ]
                : [{ categoryId: 1, amount: 500 }],
            }),
          )
      })

      function trendToggle() {
        return within(trend()).getByRole('checkbox', { name: 'Include transfers' })
      }

      function donutToggle() {
        return within(dashboard()).getByRole('checkbox', { name: 'Include transfers' })
      }

      it('counts Transfers in the Total for the same Span while ticked', async () => {
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(trendTable()[1]).toEqual(['Total', '400,00 kr', '500,00 kr', '▲ +25,0 %']))
        expect(trendToggle()).not.toBeChecked()

        await user.click(trendToggle())

        await waitFor(() => expect(trendTable()[1]).toEqual(['Total', '400,00 kr', '2 000,00 kr', '▲ +400,0 %']))
        expect(trendTable().map(([name]) => name)).toEqual(['', 'Total', 'Transfers', 'Groceries'])

        await user.click(trendToggle())

        await waitFor(() => expect(trendTable()[1]).toEqual(['Total', '400,00 kr', '500,00 kr', '▲ +25,0 %']))
        expect(requestedMonthlySpending()).toEqual([
          '/api/spending/monthly?fromYear=2026&fromMonth=8&toYear=2026&toMonth=9',
          '/api/spending/monthly?fromYear=2026&fromMonth=8&toYear=2026&toMonth=9&includeTransfers=true',
          '/api/spending/monthly?fromYear=2026&fromMonth=8&toYear=2026&toMonth=9',
        ])
      })

      it('keeps Include transfers when the Span changes', async () => {
        months = [
          { year: 2026, month: 9 },
          { year: 2026, month: 7 },
        ]
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(trendTable()).toHaveLength(3))
        await user.click(trendToggle())
        await waitFor(() => expect(trendTable()[1][2]).toBe('2 000,00 kr'))

        await user.selectOptions(within(trend()).getByLabelText('From'), '08.2026')

        await waitFor(() => expect(trendTable()[1]).toEqual(['Total', '400,00 kr', '2 000,00 kr', '▲ +400,0 %']))
        expect(trendToggle()).toBeChecked()
        expect(requestedMonthlySpending().at(-1)).toBe(
          '/api/spending/monthly?fromYear=2026&fromMonth=8&toYear=2026&toMonth=9&includeTransfers=true',
        )
      })

      it("is left alone by the donut's Include transfers", async () => {
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(trendTable()).toHaveLength(3))
        await waitFor(() => expect(requestedSpending()).toHaveLength(1))

        await user.click(donutToggle())

        await waitFor(() => expect(requestedSpending()).toHaveLength(2))
        expect(requestedSpending()[1]).toBe('/api/spending?year=2026&month=9&includeTransfers=true')
        expect(trendToggle()).not.toBeChecked()
        expect(trendTable()[1]).toEqual(['Total', '400,00 kr', '500,00 kr', '▲ +25,0 %'])
        expect(requestedMonthlySpending()).toEqual([
          '/api/spending/monthly?fromYear=2026&fromMonth=8&toYear=2026&toMonth=9',
        ])
      })

      it("leaves the donut's Include transfers alone", async () => {
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(trendTable()).toHaveLength(3))
        await waitFor(() => expect(requestedSpending()).toHaveLength(1))

        await user.click(trendToggle())

        await waitFor(() => expect(trendTable()[1][2]).toBe('2 000,00 kr'))
        expect(donutToggle()).not.toBeChecked()
        expect(requestedSpending()).toEqual(['/api/spending?year=2026&month=9'])
      })
    })

    describe('Drilling down', () => {
      // Every month from October 2025 to June 2026 is offered. Groceries has Transactions and Spending
      // in November, January and March, Uncategorized in February and Other in March.
      const transactions = [
        { id: 21, date: '2025-11-05', description: 'Rema 1000', categoryId: 1 },
        { id: 22, date: '2026-01-10', description: 'Kiwi', categoryId: 1 },
        { id: 23, date: '2026-02-14', description: 'Ukjent kiosk', categoryId: null },
        { id: 24, date: '2026-03-05', description: 'Meny', categoryId: 1 },
        { id: 25, date: '2026-03-20', description: 'Elkjøp', categoryId: 13 },
      ].map((t) => ({ ...t, amount: -100, note: null, locked: false, imported: true }))

      const GROCERIES_COLOUR = '#2a78d6'
      const UNCATEGORIZED_COLOUR = '#94a3b8'
      const TOTAL_COLOUR = '#1e293b'

      // The trend's chart is as wide as its container, which jsdom can't measure, so recharts draws
      // nothing without a size. The stubs are undone after each test: the global by the file's
      // afterEach.
      let measure: { mockRestore: () => void }
      beforeEach(() => {
        vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
        measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
          x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 280, width: 600, height: 280, toJSON: () => ({}),
        })
        months = [
          { year: 2026, month: 6 },
          { year: 2025, month: 10 },
        ]
        handleMonthlySpending = (from, to) =>
          Response.json(
            monthlySpending(from, to, {
              '2025-11': [{ categoryId: 1, amount: 100 }],
              '2026-1': [{ categoryId: 1, amount: 100 }],
              '2026-2': [{ categoryId: null, amount: 100 }],
              '2026-3': [
                { categoryId: 1, amount: 100 },
                { categoryId: 13, amount: 100 },
              ],
            }),
          )
        serveTransactions(transactions)
      })

      afterEach(() => measure.mockRestore())

      // The line's dots in the given colour, one per point in order.
      function dots(colour: string) {
        const all = [...trend().querySelectorAll('.recharts-line-dot')]
        return all.filter((dot) => dot.getAttribute('fill') === colour)
      }

      // Clicks the chart at the given spot, after moving the mouse there as a real click would.
      async function clickChart(clientX: number, clientY: number) {
        const wrapper = trend().querySelector('.recharts-wrapper')!
        await act(async () => {
          wrapper.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY }))
          await new Promise((resolve) => setTimeout(resolve, 100))
          wrapper.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }))
          await new Promise((resolve) => setTimeout(resolve, 100))
        })
      }

      // Clicks the chart `below` pixels under the dot.
      function clickNear(dot: Element, below = 0) {
        return clickChart(Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy')) + below)
      }

      // Waits for the trend, then switches the named lines on, or Total off.
      async function openTrend(...lines: string[]) {
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(trendTable()).toHaveLength(5))
        for (const line of lines) await user.click(within(trend()).getByRole('checkbox', { name: line }))
        return user
      }

      it("opens a Category's Transactions in the month of the dot clicked, and the chart shows a pointer", async () => {
        // Total is switched off, since it lies on the Groceries line in January and wins the click.
        await openTrend('Total', 'Groceries')
        await waitFor(() => expect(dots(GROCERIES_COLOUR)).toHaveLength(9))
        expect(trend().querySelector('.recharts-wrapper')).toHaveStyle({ cursor: 'pointer' })

        await clickNear(dots(GROCERIES_COLOUR)[3])

        expect(await screen.findByRole('cell', { name: 'Kiwi' })).toBeInTheDocument()
        expect(listedDescriptions()).toEqual(['Kiwi'])
        expect(chosenFilters()).toEqual(['2026', 'January', 'Groceries'])
        expect(requestedPeriods()).toEqual(['/api/transactions?year=2026&month=1'])
      })

      it("opens all Categories' Transactions from a dot on the Total line", async () => {
        await openTrend()
        await waitFor(() => expect(dots(TOTAL_COLOUR)).toHaveLength(9))

        await clickNear(dots(TOTAL_COLOUR)[5])

        expect(await screen.findByRole('cell', { name: 'Meny' })).toBeInTheDocument()
        expect(listedDescriptions()).toEqual(['Meny', 'Elkjøp'])
        expect(chosenFilters()).toEqual(['2026', 'March', 'All categories'])
      })

      it('opens the whole year from a year dot, though the Span covers only part of it', async () => {
        const user = await openTrend('Total', 'Groceries')
        await user.selectOptions(within(trend()).getByLabelText('Granularity'), 'Year')
        await waitFor(() => expect(dots(GROCERIES_COLOUR)).toHaveLength(2))

        await clickNear(dots(GROCERIES_COLOUR)[0])

        expect(await screen.findByRole('cell', { name: 'Rema 1000' })).toBeInTheDocument()
        expect(chosenFilters()).toEqual(['2025', 'All months', 'Groceries'])
        expect(requestedPeriods()).toEqual(['/api/transactions?year=2025'])
      })

      describe('a quarter dot', () => {
        // Waits for the trend, then shows it by Quarter over the Span from `from` to `to`.
        async function openQuarters(from: string, to: string) {
          const user = await openTrend('Groceries')
          await user.selectOptions(within(trend()).getByLabelText('From'), from)
          await user.selectOptions(within(trend()).getByLabelText('To'), to)
          await user.selectOptions(within(trend()).getByLabelText('Granularity'), 'Quarter')
          await waitFor(() => expect(dots(GROCERIES_COLOUR)).toHaveLength(2))
        }

        it('counts only the months inside the Span when it starts within the quarter', async () => {
          await openQuarters('02.2026', '06.2026')

          await clickNear(dots(GROCERIES_COLOUR)[0])

          expect(await screen.findByRole('cell', { name: 'Meny' })).toBeInTheDocument()
          expect(chosenFilters()).toEqual(['2026', 'March', 'Groceries'])
          expect(requestedPeriods()).toEqual(['/api/transactions?year=2026', '/api/transactions?year=2026&month=3'])
        })

        it('counts only the months inside the Span when it ends within the quarter', async () => {
          serveTransactions(transactions.filter((t) => t.description !== 'Kiwi'))
          await openQuarters('10.2025', '02.2026')

          await clickNear(dots(GROCERIES_COLOUR)[1])

          expect(await screen.findByText('No transactions match')).toBeInTheDocument()
          expect(chosenFilters()).toEqual(['2026', 'January', 'Groceries'])
        })

        it("opens the quarter's earliest month inside the Span when none has matching Transactions", async () => {
          serveTransactions(transactions.filter((t) => t.description !== 'Meny'))
          await openQuarters('02.2026', '06.2026')

          await clickNear(dots(GROCERIES_COLOUR)[0])

          expect(await screen.findByText('No transactions match')).toBeInTheDocument()
          expect(chosenFilters()).toEqual(['2026', 'February', 'Groceries'])
        })
      })

      it('opens the Category of the line whose dot is clicked, when several lines are on', async () => {
        await openTrend('Total', 'Groceries', 'Uncategorized')
        await waitFor(() => expect(dots(UNCATEGORIZED_COLOUR)).toHaveLength(9))

        await clickNear(dots(UNCATEGORIZED_COLOUR)[4])

        expect(await screen.findByRole('cell', { name: 'Ukjent kiosk' })).toBeInTheDocument()
        expect(listedDescriptions()).toEqual(['Ukjent kiosk'])
        expect(chosenFilters()).toEqual(['2026', 'February', 'Uncategorized'])
      })

      it.each([
        ['just below the Groceries line', GROCERIES_COLOUR, 12, 'Groceries'],
        ['just below the Total line', TOTAL_COLOUR, 12, 'All categories'],
      ])('opens the line nearest a click away from the dots, %s', async (_case, colour, below, category) => {
        await openTrend('Groceries')
        await waitFor(() => expect(dots(colour)).toHaveLength(9))

        await clickNear(dots(colour)[5], below)

        expect(await screen.findByRole('cell', { name: 'Meny' })).toBeInTheDocument()
        expect(chosenFilters()).toEqual(['2026', 'March', category])
      })
    })
  })
})

describe('Scan receipts', () => {
  const unavailable = { outcome: 'unavailable', date: null, description: null, amount: null, categoryId: null }

  // The file of each read-a-Receipt request, in the order they were sent.
  let readRequests: (FormDataEntryValue | null)[]
  // The antiforgery token sent with each read-a-Receipt request, in the order they were sent.
  let readTokens: (string | undefined)[]
  let handleReadReceipt: (body: FormData) => Response | Promise<Response>
  // The preview URLs released so far. Each is named after its Receipt's file.
  let releasedUrls: string[]

  beforeEach(() => {
    readRequests = []
    readTokens = []
    handleReadReceipt = () => Response.json(unavailable)
    releasedUrls = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/receipts/read' && init?.method === 'POST') {
          const body = init.body as FormData
          readRequests.push(body.get('file'))
          readTokens.push((init.headers as Record<string, string> | undefined)?.['X-CSRF-TOKEN'])
          return handleReadReceipt(body)
        }
        return fetchMock(url, init)
      }),
    )
    // jsdom has no object URLs.
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, {
        createObjectURL: (file: Blob) => `blob:${(file as File).name}`,
        revokeObjectURL: (url: string) => {
          releasedUrls.push(url)
        },
      }),
    )
  })

  function receipt(name: string, type = 'image/jpeg', size = 1024) {
    return new File([new Uint8Array(size)], name, { type })
  }

  const kiwi = receipt('kiwi.jpg')
  const rema = receipt('rema.png', 'image/png')
  const narvesen = receipt('narvesen.webp', 'image/webp')

  // The picker's accept list is ignored, as a browser's "All files" choice does, so that
  // wrong-type files can be picked too.
  async function scan(files: File[]) {
    const user = userEvent.setup({ applyAccept: false })
    await renderApp()
    await user.upload(screen.getByLabelText(/^receipts$/i), files)
    return user
  }

  async function scanUntilFormIsReady(files: File[]) {
    const user = await scan(files)
    await formIsReady()
    return user
  }

  // Once the Receipt has been read, its form starts over and loads the Categories again.
  async function formIsReady(name?: string) {
    const dialog = await screen.findByRole('dialog', name === undefined ? {} : { name })
    await waitFor(() => expect(within(dialog).queryByText('Reading…')).not.toBeInTheDocument())
    await within(dialog).findByRole('option', { name: 'Groceries' })
  }

  function monthsRequests() {
    return fetchMock.mock.calls.filter(([url]) => url === '/api/transactions/months').length
  }

  it('sits right after Add transaction, with a picker for several JPEG, PNG, WebP or GIF images', async () => {
    await renderApp()

    const buttons = addActions()
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(buttons).toEqual(['Upload transactions', 'Add transaction', 'Scan receipts'])
    const picker = screen.getByLabelText(/^receipts$/i)
    expect(picker).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,image/gif')
    expect(picker).toHaveAttribute('multiple')
  })

  it("opens on Receipt 1 of n with its image beside an empty form with today's date", async () => {
    await scanUntilFormIsReady([kiwi, rema, narvesen])

    const dialog = screen.getByRole('dialog', { name: 'Receipt 1 of 3' })
    expect(within(dialog).getByRole('img', { name: 'Receipt' })).toHaveAttribute('src', 'blob:kiwi.jpg')
    expect(within(dialog).getByLabelText(/date/i)).toHaveValue(todayIsoDate())
    expect(within(dialog).getByLabelText(/description/i)).toHaveValue('')
    expect(within(dialog).getByLabelText(/^in$/i)).toHaveValue(null)
    expect(within(dialog).getByLabelText(/^out$/i)).toHaveValue(null)
    expect(within(dialog).getByLabelText(/^note$/i)).toHaveValue('')
    expect(within(dialog).getByLabelText(/category/i)).toHaveValue('')
  })

  it('sends every Receipt to be read at once, one request each, before any has been answered', async () => {
    handleReadReceipt = () => new Promise(() => {})

    await scan([kiwi, rema, narvesen])

    await waitFor(() => expect(readRequests).toEqual([kiwi, rema, narvesen]))
    expect(screen.getByRole('dialog', { name: 'Receipt 1 of 3' })).toBeInTheDocument()
  })

  it('sends the antiforgery token with every Receipt, fetching it once for them all', async () => {
    await scan([kiwi, rema, narvesen])

    await waitFor(() => expect(readTokens).toEqual(['token-1', 'token-1', 'token-1']))
    expect(antiforgeryTokensGiven).toBe(1)
  })

  it('saves the entered values as a manually-entered Transaction and moves on to the next Receipt', async () => {
    const posted: unknown[] = []
    handlePost = (body) => {
      posted.push(body)
      return Response.json({ id: 1 }, { status: 201 })
    }
    const user = await scanUntilFormIsReady([kiwi, rema])
    await fillValidForm(user)
    await user.type(screen.getByLabelText(/^note$/i), 'Kontant')

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(posted).toEqual([
      { date: todayIsoDate(), description: 'Rema 1000', amount: -249.9, note: 'Kontant', categoryId: 1 },
    ])
    const dialog = await screen.findByRole('dialog', { name: 'Receipt 2 of 2' })
    expect(within(dialog).getByRole('img', { name: 'Receipt' })).toHaveAttribute('src', 'blob:rema.png')
    expect(within(dialog).getByLabelText(/description/i)).toHaveValue('')
  })

  it('starts the Bookmark of every Receipt at -, whatever the one before was saved with', async () => {
    folders = [{ id: 30, name: 'Tax deductible' }]
    const posted: unknown[] = []
    handlePost = (body) => {
      posted.push(body)
      return Response.json({ id: 1 }, { status: 201 })
    }
    const user = await scanUntilFormIsReady([kiwi, rema])
    await fillValidForm(user)
    await chooseBookmark(user, 'Tax deductible')

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(posted).toEqual([expect.objectContaining({ bookmark: { folderId: 30 } })])
    await formIsReady('Receipt 2 of 2')
    expect(screen.getByLabelText(/^bookmark/i)).toHaveValue('')
    expect(within(screen.getByLabelText(/^bookmark/i)).getByRole<HTMLOptionElement>('option', { name: '-' }).selected).toBe(true)
  })

  it('skips a Receipt without saving it', async () => {
    const posted: unknown[] = []
    handlePost = (body) => {
      posted.push(body)
      return Response.json({ id: 1 }, { status: 201 })
    }
    const user = await scanUntilFormIsReady([kiwi, rema])
    await user.type(screen.getByLabelText(/description/i), 'Kiwi')

    await user.click(screen.getByRole('button', { name: 'Skip' }))

    expect(screen.getByRole('dialog', { name: 'Receipt 2 of 2' })).toBeInTheDocument()
    expect(screen.getByLabelText(/description/i)).toHaveValue('')
    expect(posted).toEqual([])
  })

  it('has no Back', async () => {
    const user = await scanUntilFormIsReady([kiwi, rema])
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /back/i })).not.toBeInTheDocument()
  })

  it('shows the field errors of a refused Save and stays on the Receipt with the input kept', async () => {
    handlePost = () => Response.json({ errors: { description: ['Description is required.'] } }, { status: 400 })
    const user = await scanUntilFormIsReady([kiwi, rema])
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    const dialog = screen.getByRole('dialog', { name: 'Receipt 1 of 2' })
    expect(within(dialog).getByText('Description is required.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/^out$/i)).toHaveValue(249.9)
    expect(within(dialog).getByRole('img', { name: 'Receipt' })).toHaveAttribute('src', 'blob:kiwi.jpg')
  })

  it('closes after the last Receipt, reloads the Dashboard and says how many Transactions were saved', async () => {
    const user = await scanUntilFormIsReady([kiwi, rema, narvesen])
    const before = monthsRequests()
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await formIsReady('Receipt 2 of 3')
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await formIsReady('Receipt 3 of 3')
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('2 transactions saved')
    await waitFor(() => expect(monthsRequests()).toBeGreaterThan(before))
  })

  it('says one transaction in the singular', async () => {
    const user = await scanUntilFormIsReady([kiwi])
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/^1 transaction saved$/)
  })

  it('says none were saved, and leaves the Dashboard as it was, when every Receipt was skipped', async () => {
    const user = await scanUntilFormIsReady([kiwi, rema])
    const before = monthsRequests()

    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('No transactions saved')
    expect(monthsRequests()).toBe(before)
  })

  it('does not move on again when a Save finishes after its Receipt was skipped, but counts it', async () => {
    let respond: (response: Response) => void = () => {}
    handlePost = () => new Promise<Response>((resolve) => (respond = resolve)) as unknown as Response
    const user = await scanUntilFormIsReady([kiwi, rema, narvesen])
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.getByRole('dialog', { name: 'Receipt 2 of 3' })).toBeInTheDocument()
    await act(async () => respond(Response.json({ id: 1 }, { status: 201 })))

    expect(screen.getByRole('dialog', { name: 'Receipt 2 of 3' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 transaction saved')
  })

  it('counts a Save that finishes after the last Receipt was skipped', async () => {
    let respond: (response: Response) => void = () => {}
    handlePost = () => new Promise<Response>((resolve) => (respond = resolve)) as unknown as Response
    const user = await scanUntilFormIsReady([kiwi])
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.getByRole('status')).toHaveTextContent('No transactions saved')
    const before = monthsRequests()

    await act(async () => respond(Response.json({ id: 1 }, { status: 201 })))

    expect(screen.getByRole('status')).toHaveTextContent('1 transaction saved')
    await waitFor(() => expect(monthsRequests()).toBeGreaterThan(before))
  })

  it('leaves a later scan alone when a Save from an earlier one finishes after it was skipped', async () => {
    let respond: (response: Response) => void = () => {}
    handlePost = () => new Promise<Response>((resolve) => (respond = resolve)) as unknown as Response
    const user = await scanUntilFormIsReady([kiwi])
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    handlePost = () => Response.json({ id: 2 }, { status: 201 })
    await user.upload(screen.getByLabelText(/^receipts$/i), [rema, narvesen])
    await formIsReady('Receipt 1 of 2')

    await act(async () => respond(Response.json({ id: 1 }, { status: 201 })))

    expect(screen.getByRole('dialog', { name: 'Receipt 1 of 2' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.getByRole('status')).toHaveTextContent('No transactions saved')
  })

  it('releases each preview once its Receipt is saved or skipped', async () => {
    const user = await scanUntilFormIsReady([kiwi, rema])
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await screen.findByRole('dialog', { name: 'Receipt 2 of 2' })
    expect(releasedUrls).toEqual(['blob:kiwi.jpg'])

    await user.click(screen.getByRole('button', { name: 'Skip' }))

    expect(releasedUrls).toEqual(['blob:kiwi.jpg', 'blob:rema.png'])
  })

  it('rejects a pick of more than 10 files with only a message', async () => {
    const files = Array.from({ length: 11 }, (_, i) => receipt(`${i}.jpg`))

    await scan(files)

    expect(screen.getByRole('alert')).toHaveTextContent('Pick at most 10 receipts')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(readRequests).toEqual([])
  })

  it('leaves out a wrong-type and an over-10 MB file, naming each and why, and scans the rest', async () => {
    const pdf = receipt('faktura.pdf', 'application/pdf')
    const huge = receipt('stor.jpg', 'image/jpeg', 10 * 1024 * 1024 + 1)

    await scan([pdf, kiwi, huge, rema])

    const alert = screen.getByRole('alert')
    expect([...alert.children].map((line) => line.textContent)).toEqual([
      'faktura.pdf: The file is not a JPEG, PNG, WebP or GIF image.',
      'stor.jpg: The file is larger than 10 MB.',
    ])
    expect(screen.getByRole('dialog', { name: 'Receipt 1 of 2' })).toBeInTheDocument()
    await waitFor(() => expect(readRequests).toEqual([kiwi, rema]))
  })

  it('shows only the message when every file is left out', async () => {
    await scan([receipt('notes.txt', 'text/plain')])

    expect(screen.getByRole('alert')).toHaveTextContent('notes.txt: The file is not a JPEG, PNG, WebP or GIF image.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(readRequests).toEqual([])
  })

  it("still gives the form for a Receipt the server rejects or can't be reached for", async () => {
    let call = 0
    handleReadReceipt = () => {
      if (call++ === 0) {
        return Response.json({ errors: { file: ['The file is not a JPEG, PNG, WebP or GIF image.'] } }, { status: 400 })
      }
      throw new TypeError('Failed to fetch')
    }
    const user = await scanUntilFormIsReady([kiwi, rema])
    await waitFor(() => expect(readRequests).toHaveLength(2))

    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await formIsReady('Receipt 2 of 2')
    expect(screen.getByLabelText(/date/i)).toHaveValue(todayIsoDate())
  })

  it('scans the same Receipts again when they are picked again', async () => {
    const user = await scanUntilFormIsReady([kiwi])
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    await user.upload(screen.getByLabelText(/^receipts$/i), [kiwi])

    expect(screen.getByRole('dialog', { name: 'Receipt 1 of 1' })).toBeInTheDocument()
  })

  describe('pre-filled from what was read', () => {
    const kiwiRead = { outcome: 'read', date: '2026-10-12', description: 'Kiwi Majorstuen', amount: -249.9, categoryId: 1 }
    const remaRefund = { outcome: 'read', date: '2026-10-14', description: 'Rema 1000', amount: 89, categoryId: 13 }
    const unreadable = { outcome: 'unreadable', date: null, description: null, amount: null, categoryId: null }

    // Answers each Receipt with the suggestion given for its file name, or unavailable.
    function answer(suggestions: Record<string, unknown>) {
      handleReadReceipt = (body) => Response.json(suggestions[(body.get('file') as File).name] ?? unavailable)
    }

    function dialog() {
      return screen.getByRole('dialog')
    }

    it("fills the form with the Receipt's date, Description, Out and Category, and leaves Note empty", async () => {
      answer({ 'kiwi.jpg': kiwiRead })

      await scanUntilFormIsReady([kiwi, rema])

      expect(within(dialog()).getByLabelText(/date/i)).toHaveValue('2026-10-12')
      expect(within(dialog()).getByLabelText(/description/i)).toHaveValue('Kiwi Majorstuen')
      expect(within(dialog()).getByLabelText(/^in$/i)).toHaveValue(null)
      expect(within(dialog()).getByLabelText(/^out$/i)).toHaveValue(249.9)
      expect(within(dialog()).getByLabelText(/^note$/i)).toHaveValue('')
      expect(within(dialog()).getByLabelText(/category/i)).toHaveValue('1')
    })

    it('fills a refund into In', async () => {
      answer({ 'rema.png': remaRefund })

      await scanUntilFormIsReady([rema])

      expect(within(dialog()).getByLabelText(/^in$/i)).toHaveValue(89)
      expect(within(dialog()).getByLabelText(/^out$/i)).toHaveValue(null)
    })

    it('shows Reading… with the image and a disabled form until a slow read finishes, then the suggested values', async () => {
      let respond: (response: Response) => void = () => {}
      handleReadReceipt = () => new Promise<Response>((resolve) => (respond = resolve))

      await scan([kiwi])

      expect(within(dialog()).getByText('Reading…')).toBeInTheDocument()
      expect(within(dialog()).getByRole('img', { name: 'Receipt' })).toHaveAttribute('src', 'blob:kiwi.jpg')
      expect(within(dialog()).getByLabelText(/description/i)).toBeDisabled()
      expect(within(dialog()).getByRole('button', { name: /^save$/i })).toBeDisabled()
      expect(within(dialog()).getByRole('button', { name: 'Skip' })).toBeEnabled()

      await act(async () => respond(Response.json(kiwiRead)))

      await waitFor(() => expect(within(dialog()).queryByText('Reading…')).not.toBeInTheDocument())
      expect(within(dialog()).getByLabelText(/description/i)).toBeEnabled()
      expect(within(dialog()).getByLabelText(/description/i)).toHaveValue('Kiwi Majorstuen')
      await within(dialog()).findByRole('option', { name: 'Groceries' })
      expect(within(dialog()).getByRole('button', { name: /^save$/i })).toBeEnabled()
    })

    it('opens the first form as soon as the first Receipt is read, while the others are still being read', async () => {
      handleReadReceipt = (body) =>
        (body.get('file') as File).name === 'kiwi.jpg' ? Response.json(kiwiRead) : new Promise(() => {})

      const user = await scanUntilFormIsReady([kiwi, rema])

      expect(within(dialog()).getByLabelText(/description/i)).toHaveValue('Kiwi Majorstuen')
      await user.click(screen.getByRole('button', { name: 'Skip' }))
      expect(screen.getByRole('dialog', { name: 'Receipt 2 of 2' })).toHaveTextContent('Reading…')
    })

    it("fills each Receipt's form with what was read on that Receipt", async () => {
      answer({ 'kiwi.jpg': kiwiRead, 'rema.png': remaRefund })
      const user = await scanUntilFormIsReady([kiwi, rema])

      await user.click(screen.getByRole('button', { name: 'Skip' }))

      await formIsReady('Receipt 2 of 2')
      expect(within(dialog()).getByLabelText(/date/i)).toHaveValue('2026-10-14')
      expect(within(dialog()).getByLabelText(/description/i)).toHaveValue('Rema 1000')
      expect(within(dialog()).getByLabelText(/category/i)).toHaveValue('13')
    })

    it('saves the suggested values with the edits made to them', async () => {
      const posted: unknown[] = []
      handlePost = (body) => {
        posted.push(body)
        return Response.json({ id: 1 }, { status: 201 })
      }
      answer({ 'kiwi.jpg': kiwiRead })
      const user = await scanUntilFormIsReady([kiwi])
      await user.clear(screen.getByLabelText(/description/i))
      await user.type(screen.getByLabelText(/description/i), 'Kiwi')

      await user.click(screen.getByRole('button', { name: /^save$/i }))

      expect(posted).toEqual([{ date: '2026-10-12', description: 'Kiwi', amount: -249.9, note: null, categoryId: 1 }])
    })

    it("says Couldn't read this receipt above an empty form with today's date when it couldn't be read", async () => {
      answer({ 'kiwi.jpg': unreadable })

      await scanUntilFormIsReady([kiwi])

      expect(within(dialog()).getByText("Couldn't read this receipt")).toBeInTheDocument()
      expect(within(dialog()).getByLabelText(/date/i)).toHaveValue(todayIsoDate())
      expect(within(dialog()).getByLabelText(/description/i)).toHaveValue('')
      expect(within(dialog()).getByLabelText(/^out$/i)).toHaveValue(null)
      expect(within(dialog()).getByLabelText(/category/i)).toHaveValue('')
    })

    it("says Couldn't read this receipt when the server rejects it", async () => {
      handleReadReceipt = () =>
        Response.json({ errors: { file: ['The file is not a JPEG, PNG, WebP or GIF image.'] } }, { status: 400 })

      await scanUntilFormIsReady([kiwi])

      expect(within(dialog()).getByText("Couldn't read this receipt")).toBeInTheDocument()
    })

    it("says the daily AI limit is reached above an empty form with today's date when the limit was reached", async () => {
      answer({ 'kiwi.jpg': { outcome: 'limitReached', date: null, description: null, amount: null, categoryId: null } })

      await scanUntilFormIsReady([kiwi])

      expect(
        within(dialog()).getByText('Daily AI limit reached until midnight Norwegian time — enter this receipt by hand'),
      ).toBeInTheDocument()
      expect(within(dialog()).queryByText("Couldn't read this receipt")).not.toBeInTheDocument()
      expect(within(dialog()).getByLabelText(/date/i)).toHaveValue(todayIsoDate())
      expect(within(dialog()).getByLabelText(/description/i)).toHaveValue('')
      expect(within(dialog()).getByLabelText(/^out$/i)).toHaveValue(null)
      expect(within(dialog()).getByLabelText(/category/i)).toHaveValue('')
    })

    it('shows no notice when no receipt reader is configured', async () => {
      await scanUntilFormIsReady([kiwi])

      expect(within(dialog()).queryByText("Couldn't read this receipt")).not.toBeInTheDocument()
      expect(within(dialog()).queryByText(/Daily AI limit/)).not.toBeInTheDocument()
      expect(within(dialog()).queryByText('Reading…')).not.toBeInTheDocument()
    })
  })

  describe('leaving partway', () => {
    function confirmation() {
      return screen.queryByRole('alertdialog')
    }

    it('asks before discarding the remaining Receipts, and Keep going returns to the Receipt as it was', async () => {
      const user = await scanUntilFormIsReady([kiwi, rema, narvesen])
      await user.click(screen.getByRole('button', { name: 'Skip' }))
      await formIsReady('Receipt 2 of 3')
      await fillValidForm(user)

      await user.click(screen.getByRole('button', { name: 'Close' }))

      expect(screen.getByRole('alertdialog', { name: 'Discard the remaining 2 receipts?' })).toBeInTheDocument()
      expect(within(confirmation()!).getByRole('button', { name: 'Discard' })).toBeInTheDocument()

      await user.click(within(confirmation()!).getByRole('button', { name: 'Keep going' }))

      expect(confirmation()).not.toBeInTheDocument()
      const dialog = screen.getByRole('dialog', { name: 'Receipt 2 of 3' })
      expect(within(dialog).getByLabelText(/description/i)).toHaveValue('Rema 1000')
      expect(within(dialog).getByLabelText(/^out$/i)).toHaveValue(249.9)
      expect(within(dialog).getByLabelText(/category/i)).toHaveValue('1')
      expect(within(dialog).getByRole('img', { name: 'Receipt' })).toHaveAttribute('src', 'blob:rema.png')
    })

    it('discards the remaining Receipts, keeping and counting what was saved, with the Dashboard reloaded', async () => {
      const posted: unknown[] = []
      handlePost = (body) => {
        posted.push(body)
        return Response.json({ id: 1 }, { status: 201 })
      }
      const user = await scanUntilFormIsReady([kiwi, rema, narvesen])
      const before = monthsRequests()
      await fillValidForm(user)
      await user.click(screen.getByRole('button', { name: /^save$/i }))
      await formIsReady('Receipt 2 of 3')
      await user.type(screen.getByLabelText(/description/i), 'Rema')

      await user.click(screen.getByRole('button', { name: 'Close' }))
      await user.click(within(confirmation()!).getByRole('button', { name: 'Discard' }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(posted).toHaveLength(1)
      expect(screen.getByRole('status')).toHaveTextContent(/^1 transaction saved$/)
      await waitFor(() => expect(monthsRequests()).toBeGreaterThan(before))
      expect(releasedUrls).toEqual(['blob:kiwi.jpg', 'blob:rema.png', 'blob:narvesen.webp'])
    })

    it('says none were saved, and leaves the Dashboard as it was, when nothing was saved before Discard', async () => {
      const user = await scanUntilFormIsReady([kiwi, rema])
      const before = monthsRequests()

      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(screen.getByRole('alertdialog', { name: 'Discard the remaining 2 receipts?' })).toBeInTheDocument()
      await user.click(within(confirmation()!).getByRole('button', { name: 'Discard' }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('No transactions saved')
      expect(monthsRequests()).toBe(before)
      expect(releasedUrls).toEqual(['blob:kiwi.jpg', 'blob:rema.png'])
    })

    it('asks about the last Receipt in the singular', async () => {
      const user = await scanUntilFormIsReady([kiwi, rema])
      await user.click(screen.getByRole('button', { name: 'Skip' }))

      await user.click(screen.getByRole('button', { name: 'Close' }))

      expect(screen.getByRole('alertdialog', { name: 'Discard the remaining 1 receipt?' })).toBeInTheDocument()
    })

    it('counts a Save that finishes after the remaining Receipts were discarded', async () => {
      let respond: (response: Response) => void = () => {}
      handlePost = () => new Promise<Response>((resolve) => (respond = resolve)) as unknown as Response
      const user = await scanUntilFormIsReady([kiwi, rema])
      await fillValidForm(user)
      await user.click(screen.getByRole('button', { name: /^save$/i }))
      await user.click(screen.getByRole('button', { name: 'Close' }))
      await user.click(within(confirmation()!).getByRole('button', { name: 'Discard' }))
      expect(screen.getByRole('status')).toHaveTextContent('No transactions saved')

      await act(async () => respond(Response.json({ id: 1 }, { status: 201 })))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('1 transaction saved')
    })

    it('leaves a later scan alone when a Save from an earlier one finishes after it was discarded', async () => {
      let respond: (response: Response) => void = () => {}
      handlePost = () => new Promise<Response>((resolve) => (respond = resolve)) as unknown as Response
      const user = await scanUntilFormIsReady([kiwi])
      await fillValidForm(user)
      await user.click(screen.getByRole('button', { name: /^save$/i }))
      await user.click(screen.getByRole('button', { name: 'Close' }))
      await user.click(within(confirmation()!).getByRole('button', { name: 'Discard' }))
      await user.upload(screen.getByLabelText(/^receipts$/i), [rema, narvesen])
      await formIsReady('Receipt 1 of 2')

      await act(async () => respond(Response.json({ id: 1 }, { status: 201 })))

      expect(screen.getByRole('dialog', { name: 'Receipt 1 of 2' })).toBeInTheDocument()
    })
  })

  describe('seeing the Receipt full-screen', () => {
    function fullScreenView() {
      return screen.queryByRole('button', { name: 'Close the full-screen Receipt' })
    }

    it('opens on a click on the Receipt, showing the same preview, and closes on a click', async () => {
      const user = await scanUntilFormIsReady([kiwi, rema])

      await user.click(screen.getByRole('button', { name: 'Show the Receipt full-screen' }))

      expect(within(fullScreenView()!).getByRole('img', { name: 'Receipt' })).toHaveAttribute('src', 'blob:kiwi.jpg')

      await user.click(fullScreenView()!)

      expect(fullScreenView()).not.toBeInTheDocument()
      expect(screen.getByRole('dialog', { name: 'Receipt 1 of 2' })).toBeInTheDocument()
    })

    it('opens from the keyboard and closes on Escape, leaving the window on the Receipt as it was', async () => {
      const user = await scanUntilFormIsReady([kiwi, rema])
      await user.type(screen.getByLabelText(/description/i), 'Kiwi')
      screen.getByRole('button', { name: 'Show the Receipt full-screen' }).focus()

      await user.keyboard('{Enter}')
      expect(fullScreenView()).toBeInTheDocument()
      await user.keyboard('{Escape}')

      expect(fullScreenView()).not.toBeInTheDocument()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      const dialog = screen.getByRole('dialog', { name: 'Receipt 1 of 2' })
      expect(within(dialog).getByLabelText(/description/i)).toHaveValue('Kiwi')
      expect(screen.getByRole('button', { name: 'Show the Receipt full-screen' })).toHaveFocus()
    })

    it('keeps the keyboard on the full-screen view rather than the form behind it', async () => {
      const user = await scanUntilFormIsReady([kiwi])
      await user.click(screen.getByRole('button', { name: 'Show the Receipt full-screen' }))

      await user.tab()

      expect(fullScreenView()).toHaveFocus()
    })
  })

  describe('Possible duplicates', () => {
    type PossibleDuplicate = { id: number; date: string; description: string; amount: number }

    // What the Possible duplicate endpoint answers for a date and a signed Amount.
    let handlePossibleDuplicates: (date: string, amount: number) => Response

    // The form asks only once typing has paused, so the tests move the clock on past that pause.
    async function afterThePause() {
      await act(() => vi.advanceTimersByTimeAsync(1_000))
    }

    function notice() {
      return screen.queryByRole('region', { name: /possible duplicate/i })
    }

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      handlePossibleDuplicates = () => Response.json([])
      // The scan's fetch, which answers the read-a-Receipt requests.
      const scanFetch = globalThis.fetch
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          const possibleDuplicatesUrl = /^\/api\/transactions\/possible-duplicates\?(.*)$/.exec(url)
          if (!possibleDuplicatesUrl) return scanFetch(url, init)
          const query = new URLSearchParams(possibleDuplicatesUrl[1])
          return handlePossibleDuplicates(query.get('date')!, Number(query.get('amount')))
        }),
      )
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('shows the notice on a Receipt form, and Save still saves and moves on', async () => {
      const imported: PossibleDuplicate = { id: 5, date: '2026-10-14', description: 'REMA 1000 GRØNLAND', amount: -249.9 }
      handlePossibleDuplicates = (_date, amount) => Response.json(amount === -249.9 ? [imported] : [])
      const posted: unknown[] = []
      handlePost = (body) => {
        posted.push(body)
        return Response.json({ id: 1 }, { status: 201 })
      }
      const user = await scanUntilFormIsReady([kiwi, rema])
      await fillValidForm(user)
      await afterThePause()

      const dialog = screen.getByRole('dialog', { name: 'Receipt 1 of 2' })
      expect(await within(dialog).findByRole('region', { name: 'Possible duplicate' })).toHaveTextContent(
        'REMA 1000 GRØNLAND',
      )

      await user.click(screen.getByRole('button', { name: /^save$/i }))

      expect(posted).toHaveLength(1)
      await formIsReady('Receipt 2 of 2')
      expect(notice()).not.toBeInTheDocument()
    })

    it('lists the Transaction saved from an earlier Receipt of the scan on a later one with the same date and amount', async () => {
      // The Transactions saved so far, as the Possible duplicate endpoint answers with them.
      const savedTransactions: PossibleDuplicate[] = []
      handlePost = (body) => {
        const { date, description, amount } = body as Omit<PossibleDuplicate, 'id'>
        savedTransactions.push({ id: savedTransactions.length + 1, date, description, amount })
        return Response.json({ id: savedTransactions.length }, { status: 201 })
      }
      handlePossibleDuplicates = (date, amount) =>
        Response.json(
          savedTransactions.filter((transaction) => transaction.date === date && transaction.amount === amount),
        )
      // A second photo of the same Receipt.
      const kiwiAgain = receipt('kiwi-2.jpg')
      const user = await scanUntilFormIsReady([kiwi, kiwiAgain])
      await fillValidForm(user)
      await afterThePause()
      expect(notice()).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /^save$/i }))
      await formIsReady('Receipt 2 of 2')
      await user.type(screen.getByLabelText(/^out$/i), '249.90')
      await afterThePause()

      const items = within(await screen.findByRole('region', { name: 'Possible duplicate' })).getAllByRole('listitem')
      expect(items).toHaveLength(1)
      expect(items[0]).toHaveTextContent('Rema 1000')
      expect(items[0]).toHaveTextContent('-249,90 kr')
    })
  })
})

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
    currentUser = signedOut()
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
    currentUser = new Promise((resolve) => (respond = resolve))
    render(<App />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/user'))
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()

    respond(Response.json({ email: 'me@example.com', isGuest: false }))
    expect(await screen.findByRole('navigation')).toBeInTheDocument()
  })

  it('logs in and shows the app', async () => {
    currentUser = signedOut()
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
    currentUser = signedOut()
    handleSignIn = () => Response.json({ detail }, { status })
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
    currentUser = signedOut()
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
    currentUser = signedOut()
    const user = userEvent.setup()
    render(<App />)
    await landingPage()
    expect(screen.queryByLabelText(/^confirm password/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(await screen.findByLabelText(/^confirm password/i)).toHaveAttribute('autocomplete', 'new-password')
  })

  it("refuses to sign up, sending nothing, when the passwords don't match", async () => {
    currentUser = signedOut()
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
    currentUser = signedOut()
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
    currentUser = signedOut()
    handleSignUp = () =>
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
    currentUser = signedOut()
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
    currentUser = signedOut()
    handleContinueAsGuest = () => new Response(null, { status: 500 })
    const user = userEvent.setup()
    render(<App />)
    await landingPage()

    await user.click(screen.getByRole('button', { name: 'Continue as Guest' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Continuing as Guest failed (500).')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('keeps the email but not the errors when switching between Sign in and Sign up', async () => {
    currentUser = signedOut()
    handleSignIn = () => Response.json({ detail: 'Wrong email or password.' }, { status: 401 })
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
    currentUser = guest
    const user = userEvent.setup()
    await renderApp()

    await user.click(userButton())

    expect(screen.getByText(/signed in as/i)).toHaveTextContent('Signed in as Guest')
    expect(screen.queryByText(guest.email)).not.toBeInTheDocument()
  })

  it('signs out to the landing page, and signing in again starts afresh', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'Rules' }))

    await user.click(userButton())
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/user/sign-out', { method: 'POST' })

    await user.type(screen.getByLabelText(/^email/i), 'me@example.com')
    await user.type(screen.getByLabelText(/^password/i), 'my long passphrase')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('navigation')
    expect(screen.getByRole('button', { name: 'Rules' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'Add transaction' })).toBeVisible()
  })

  it('sends none of the remaining Bank Statements of an Upload after signing out', async () => {
    const responders: ((response: Response) => void)[] = []
    handleUpload = () => new Promise((resolve) => responders.push(resolve))
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
    handleSignOut = () => new Response(null, { status: 500 })
    const user = userEvent.setup()
    await renderApp()

    await user.click(userButton())
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Signing out failed. Try again.')
    expect(screen.getByRole('navigation')).toBeInTheDocument()
  })

  describe('Change password', () => {
    async function openForm(user: ReturnType<typeof userEvent.setup>) {
      await renderApp()
      await user.click(userButton())
      await user.click(screen.getByRole('button', { name: 'Change password' }))
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

    function changePasswordRequests() {
      return fetchMock.mock.calls.filter(([url]) => url === '/api/user/change-password')
    }

    it('opens a form with the current password, a new one and the confirm field, and changes the password', async () => {
      const user = userEvent.setup()
      await openForm(user)

      expect(screen.getByLabelText(/^current password/i)).toHaveAttribute('autocomplete', 'current-password')
      expect(screen.getByLabelText(/^new password/i)).toHaveAttribute('autocomplete', 'new-password')
      expect(screen.getByLabelText(/^confirm password/i)).toHaveAttribute('autocomplete', 'new-password')
      await fillIn(user, 'my long passphrase', 'my new passphrase')

      expect(await screen.findByRole('status')).toHaveTextContent('Password changed.')
      expect(screen.queryByLabelText(/^current password/i)).not.toBeInTheDocument()
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
      await openForm(user)

      await fillIn(user, 'my long passphrase', 'my new passphrase', 'my new passphrse')

      expect(screen.getByLabelText(/^confirm password/i).closest('label')).toHaveTextContent("Passwords don't match")
      expect(changePasswordRequests()).toHaveLength(0)
    })

    it('shows each field error of a refused change under its field, keeping the form open', async () => {
      handleChangePassword = () =>
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
      await openForm(user)

      await fillIn(user, 'wrong password', 'short')

      expect(await screen.findByText('Wrong password.')).toBeInTheDocument()
      expect(screen.getByLabelText(/^current password/i).closest('label')).toHaveTextContent('Wrong password.')
      expect(screen.getByLabelText(/^new password/i).closest('label')).toHaveTextContent(
        'Password must be at least 8 characters.',
      )
      expect(screen.getByRole('button', { name: 'Change password' })).toBeEnabled()
      expect(screen.getByRole('status')).toHaveTextContent('')
    })

    it('says so when the email is locked, with the message Sign in gives', async () => {
      const locked = 'Too many failed sign-ins, so this email is locked for a few minutes. Try again later.'
      handleChangePassword = () => Response.json({ detail: locked }, { status: 429 })
      const user = userEvent.setup()
      await openForm(user)

      await fillIn(user, 'my long passphrase', 'my new passphrase')

      expect(await screen.findByRole('alert')).toHaveTextContent(locked)
      expect(screen.getByLabelText(/^current password/i)).toBeInTheDocument()
    })

    it('shows Password changed. until the next action, and opens an empty form again', async () => {
      const user = userEvent.setup()
      await openForm(user)
      await fillIn(user, 'my long passphrase', 'my new passphrase')
      expect(await screen.findByRole('status')).toHaveTextContent('Password changed.')

      await user.click(screen.getByRole('button', { name: 'Change password' }))

      expect(screen.getByRole('status')).toHaveTextContent('')
      expect(screen.getByLabelText(/^current password/i)).toHaveValue('')
      expect(screen.getByLabelText(/^new password/i)).toHaveValue('')
      expect(screen.getByLabelText(/^confirm password/i)).toHaveValue('')
    })

    it('closes without sending anything on Cancel', async () => {
      const user = userEvent.setup()
      await openForm(user)
      await user.type(screen.getByLabelText(/^current password/i), 'my long passphrase')

      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByLabelText(/^current password/i)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Change password' })).toBeEnabled()
      expect(changePasswordRequests()).toHaveLength(0)
    })

    it('is disabled for the Guest', async () => {
      currentUser = guest
      const user = userEvent.setup()
      await renderApp()

      await user.click(userButton())

      expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled()
    })
  })
})

describe('Guest notice', () => {
  function guestNotice() {
    return screen.queryByRole('note', { name: 'Guest' })
  }

  it('tells the Guest to use only test data, on every page', async () => {
    currentUser = guest
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
    currentUser = guest
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

describe('Password reset', () => {
  const ANSWER = "Email sent. The link is active for 1 hour."

  async function renderLandingPage() {
    currentUser = new Response(null, { status: 401 })
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
    passwordResetAvailability = { available: true, linkHours: 1 }
    await renderLandingPage()

    expect(await screen.findByRole('button', { name: 'Forgot your password?' })).toBeInTheDocument()
  })

  it.each([
    ['unavailable', { available: false, linkHours: 1 }],
    ['unknown', new Response(null, { status: 500 })],
  ])('offers no "Forgot your password?" when Password reset is %s', async (_, availability) => {
    passwordResetAvailability = availability
    await renderLandingPage()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/user/password-reset/availability'))
    await act(async () => {})
    expect(passwordResetLink()).not.toBeInTheDocument()
  })

  it('offers "Forgot your password?" under Sign in only, not Sign up', async () => {
    passwordResetAvailability = { available: true, linkHours: 1 }
    const user = userEvent.setup()
    await renderLandingPage()
    await screen.findByRole('button', { name: 'Forgot your password?' })

    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(await screen.findByRole('heading', { name: 'Sign up' })).toBeInTheDocument()
    expect(passwordResetLink()).not.toBeInTheDocument()
  })

  it('asks for a link to the email typed into Sign in, and gives the same answer whatever the email', async () => {
    passwordResetAvailability = { available: true, linkHours: 1 }
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
    passwordResetAvailability = { available: true, linkHours: 2 }
    const user = userEvent.setup()
    await renderLandingPage()
    await user.click(await screen.findByRole('button', { name: 'Forgot your password?' }))

    await user.click(screen.getByRole('button', { name: 'Send link' }))

    expect(await screen.findByRole('status')).toHaveTextContent('The link is active for 2 hours.')
  })

  it('shows the field error of a refused request under the email', async () => {
    passwordResetAvailability = { available: true, linkHours: 1 }
    handleRequestPasswordReset = () => Response.json({ errors: { email: ['Email is required.'] } }, { status: 400 })
    const user = userEvent.setup()
    await renderLandingPage()
    await user.click(await screen.findByRole('button', { name: 'Forgot your password?' }))

    await user.click(screen.getByRole('button', { name: 'Send link' }))

    expect(await screen.findByText('Email is required.')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('goes back to Sign in with the email typed in', async () => {
    passwordResetAvailability = { available: true, linkHours: 1 }
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
    passwordResetAvailability = { available, linkHours: 1 }
    handleSignIn = () =>
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
    passwordResetAvailability = { available: true, linkHours: 1 }
    handleSignIn = () => Response.json({ detail: 'Wrong email or password.' }, { status: 401 })
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
      currentUser = signedIn
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
      currentUser = new Response(null, { status: 401 })
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
      handleChooseNewPassword = () =>
        Response.json({ errors: { password: ['Password must be at least 8 characters.'] } }, { status: 400 })
      const user = userEvent.setup()
      followLink()
      await choosePage()

      await choose(user, 'short')

      expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Set new password' })).toBeEnabled()
    })

    it('offers to send a new link to the email from an expired link, and sends it', async () => {
      passwordResetAvailability = { available: true, linkHours: 1 }
      handleChooseNewPassword = () => Response.json({ detail: EXPIRED }, { status: 410 })
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
      passwordResetAvailability = { available: true, linkHours: 1 }
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
      passwordResetAvailability = { available: true, linkHours: 1 }
      currentUser = new Response(null, { status: 401 })
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

describe('Signed out mid-session', () => {
  it('returns to the landing page when a call answers 401, and signing in again starts afresh', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'Rules' }))
    categoriesServed = new Response(null, { status: 401 })

    await user.click(screen.getByRole('button', { name: 'Categories' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()

    categoriesServed = categories
    await user.type(screen.getByLabelText(/^email/i), 'me@example.com')
    await user.type(screen.getByLabelText(/^password/i), 'my long passphrase')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('navigation')
    expect(screen.getByRole('button', { name: 'Categories' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'Add transaction' })).toBeVisible()
  })
})

describe('Antiforgery token', () => {
  // The antiforgery token sent with each request to the URL, in the order they were sent.
  function tokensSentTo(url: string) {
    return fetchMock.mock.calls
      .filter(([calledUrl]) => calledUrl === url)
      .map(([, init]) => (init?.headers as Record<string, string> | undefined)?.['X-CSRF-TOKEN'])
  }

  it('is fetched after signing in and sent with each Bank Statement of an Upload', async () => {
    const user = userEvent.setup()
    await renderApp()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/antiforgery-token', undefined)

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [statementPdf, statementPdf])

    await screen.findByRole('status')
    expect(tokensSentTo('/api/bank-statements')).toEqual(['token-1', 'token-1'])
    expect(antiforgeryTokensGiven).toBe(1)
  })

  it('is fetched afresh, and the Upload sent once more, when the server refuses it', async () => {
    let uploads = 0
    handleUpload = () =>
      ++uploads === 1 ? new Response(null, { status: 403 }) : Response.json(importedStatement, { status: 201 })
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    expect(await screen.findByRole('status')).toHaveTextContent('Imported 38 transactions')
    expect(tokensSentTo('/api/bank-statements')).toEqual(['token-1', 'token-2'])
  })

  it('sends the Upload only once more when the fresh token is refused too', async () => {
    handleUpload = () => new Response(null, { status: 403 })
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
