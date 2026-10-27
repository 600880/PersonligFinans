import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import App from './App'
import { todayIsoDate } from './lib/date'
import { monthOfDate } from './lib/month'
import { reduceReceipt } from './lib/reduceReceipt'

// jsdom can't decode images, so the Receipt scan tests say what reducing each Receipt gives.
vi.mock('./lib/reduceReceipt', () => ({ reduceReceipt: vi.fn() }))

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

type Slice = { categoryId: number | null; amount: number }

// Every month from `from` to `to`, both included, as the monthly Spending endpoint returns them:
// with the slices, and the Savings and Income beside them, given for "year-month", and none for the
// other months.
function monthlySpending(
  from: Month,
  to: Month,
  slices: Record<string, Slice[]> = {},
  besides: Record<string, { savings?: Slice; income?: Slice }> = {},
) {
  const entries = []
  // Steps through calendar months with Date, rather than the month arithmetic the app uses.
  const last = new Date(to.year, to.month - 1)
  for (const date = new Date(from.year, from.month - 1); date <= last; date.setMonth(date.getMonth() + 1)) {
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const key = `${year}-${month}`
    entries.push({
      year,
      month,
      slices: slices[key] ?? [],
      savings: besides[key]?.savings ?? null,
      income: besides[key]?.income ?? null,
    })
  }
  return entries
}

type PostHandler = (body: unknown) => Response
type UploadHandler = (body: FormData) => Response | Promise<Response>
// A Bank Statement as the list of the User's Bank Statements serves it.
type ListedBankStatement = {
  id: number
  accountNumber: string
  periodStart: string
  periodEnd: string
  importedOn: string
  transactionCount: number
}

let handlePost: PostHandler
let handleUpload: UploadHandler
// The User's Bank Statements as the list endpoint returns them, and the delete of a set of them.
let bankStatements: ListedBankStatement[] | Response
let handleDeleteBankStatements: (body: { ids: number[] }) => Response | Promise<Response>
// The counts the User page's confirm dialogs ask with. Those a test leaves out are served as 0.
let deleteCounts:
  | Partial<{ transactionCount: number; ruleCount: number; ruleCategorizedTransactionCount: number }>
  | Response
  | Promise<Response>
let handleDeleteAllTransactions: () => Response | Promise<Response>
let handleDeleteAllRules: () => Response | Promise<Response>
// A rule's transactionCount is 0 unless given.
let rules:
  | { id: number; keyword: string; categoryId: number; aiGenerated: boolean; isNew: boolean; transactionCount?: number }[]
  | Response
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
let handleChangeNote: (id: number, body: unknown) => Response | Promise<Response>
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
// The colours a Category can be given, as the palette endpoint serves them: a few of the real ones.
let palette: string[] | Response
// How many Transactions the Uncategorized count endpoint says are Uncategorized.
let uncategorizedCount: number | Response
// The month or quarter is undefined when the Spending of a whole year, or of a quarter, is asked for.
let handleSpending: (year: number, month: number | undefined, quarter: number | undefined, includeSavings: boolean) => Response
// The Spending of each month of the Span from `from` to `to`.
let handleMonthlySpending: (from: Month, to: Month) => Response
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
let handleDeleteYourUser: PostHandler
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
  if (url === '/api/user/delete' && init?.method === 'POST') return handleDeleteYourUser(JSON.parse(init.body as string))
  if (url === '/api/antiforgery-token') return Response.json({ token: `token-${++antiforgeryTokensGiven}` })
  const monthlyUrl =
    /^\/api\/spending\/monthly\?fromYear=(\d+)&fromMonth=(\d+)&toYear=(\d+)&toMonth=(\d+)$/.exec(url)
  if (monthlyUrl) {
    const [, fromYear, fromMonth, toYear, toMonth] = monthlyUrl
    return handleMonthlySpending(
      { year: Number(fromYear), month: Number(fromMonth) },
      { year: Number(toYear), month: Number(toMonth) },
    )
  }
  const spendingUrl = /^\/api\/spending\?year=(\d+)(?:&quarter=(\d+))?(?:&month=(\d+))?(&includeSavings=true)?$/.exec(url)
  if (spendingUrl) {
    const [, year, quarter, month, savings] = spendingUrl
    return handleSpending(
      Number(year),
      month ? Number(month) : undefined,
      quarter ? Number(quarter) : undefined,
      savings !== undefined,
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
  if (url === '/api/transactions' && init?.method === 'DELETE') return handleDeleteAllTransactions()
  if (url === '/api/user/delete-counts') {
    return deleteCounts instanceof Response || deleteCounts instanceof Promise
      ? deleteCounts
      : Response.json({ transactionCount: 0, ruleCount: 0, ruleCategorizedTransactionCount: 0, ...deleteCounts })
  }
  if (url === '/api/transactions/months') {
    return months instanceof Response ? months : Response.json(months)
  }
  const ruleUrl = /^\/api\/categorization-rules\/(\d+)$/.exec(url)
  if (ruleUrl && init?.method === 'PUT') {
    return handleEditRule(Number(ruleUrl[1]), JSON.parse(init.body as string))
  }
  if (ruleUrl && init?.method === 'DELETE') return handleDeleteRule(Number(ruleUrl[1]))
  if (url === '/api/categories/palette') return palette instanceof Response ? palette : Response.json(palette)
  if (url === '/api/categories/uncategorized-count') {
    return uncategorizedCount instanceof Response ? uncategorizedCount : Response.json({ count: uncategorizedCount })
  }
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
  if (url === '/api/bank-statements') {
    return bankStatements instanceof Response ? bankStatements : Response.json(bankStatements)
  }
  if (url === '/api/bank-statements/delete' && init?.method === 'POST') {
    return handleDeleteBankStatements(JSON.parse(init.body as string))
  }
  if (url === '/api/categorization-rules' && init?.method === 'POST') {
    return handleAddRule(JSON.parse(init.body as string))
  }
  if (url === '/api/categorization-rules' && init?.method === 'DELETE') return handleDeleteAllRules()
  if (url === '/api/categorization-rules') {
    return rules instanceof Response ? rules : Response.json(rules.map((rule) => ({ transactionCount: 0, ...rule })))
  }
  return new Response(null, { status: 404 })
})

beforeEach(() => {
  handlePost = () => Response.json({ id: 1 }, { status: 201 })
  handleUpload = () => Response.json(importedStatement, { status: 201 })
  bankStatements = []
  handleDeleteBankStatements = ({ ids }) => Response.json({ bankStatementsDeleted: ids.length, transactionsDeleted: 0 })
  deleteCounts = { transactionCount: 0 }
  handleDeleteAllTransactions = () => Response.json({ transactionsDeleted: 0 })
  handleDeleteAllRules = () => Response.json({ rulesDeleted: 0 })
  rules = [
    { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
    { id: 2, keyword: 'overføring mellom egne kontoer', categoryId: 13, aiGenerated: false, isNew: false },
  ]
  handleAddRule = (body) =>
    Response.json(
      { id: 3, ...(body as object), aiGenerated: false, isNew: false, transactionCount: 0, transactionsChanged: 0 },
      { status: 201 },
    )
  handleEditRule = (id, body) =>
    Response.json({ id, ...(body as object), aiGenerated: false, isNew: false, transactionCount: 0, transactionsChanged: 0 })
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
  palette = ['#2a78d6', '#eb6834', '#9085e9', '#1baf7a']
  uncategorizedCount = 0
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
  handleDeleteYourUser = () => new Response(null, { status: 204 })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  fetchMock.mockClear()
  vi.unstubAllGlobals()
  // The Appearance picked is remembered in the browser, so each test starts as a fresh browser.
  localStorage.clear()
  document.documentElement.classList.remove('dark')
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

// The device's light or dark setting, which System follows and can be changed while the app is open.
function deviceSetting(dark: boolean) {
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

  it('offers no Keep the receipt, since a Receipt only ever comes from a Receipt scan', async () => {
    await openModal()

    expect(screen.queryByRole('checkbox', { name: 'Keep the receipt' })).not.toBeInTheDocument()
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

  it('moves the focus into the modal when it opens', async () => {
    await openModal()

    expect(screen.getByRole('dialog', { name: 'Add transaction' })).toContainElement(document.activeElement as HTMLElement)
  })

  it('closes and discards input on Escape, as Cancel does', async () => {
    const user = await openModal()
    await user.type(screen.getByLabelText(/description/i), 'Groceries')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add transaction' }))
    expect(screen.getByLabelText(/description/i)).toHaveValue('')
  })

  it('gives the focus back to Add transaction once closed, by Cancel or by Escape', async () => {
    const user = await openModal()
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.getByRole('button', { name: 'Add transaction' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Add transaction' }))
    await user.type(screen.getByLabelText(/description/i), 'Rema')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Add transaction' })).toHaveFocus()
  })

  it('gives the focus back to Add transaction once saved', async () => {
    const user = await openModal()
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Add transaction' })).toHaveFocus()
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

  // Opens the dialog for adding a Category, with the Add category button above the list.
  async function openAddDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Add category' }))
    return within(screen.getByRole('dialog', { name: 'Add category' }))
  }

  // Each listed Category's cells, in the order shown, as their text reads.
  async function listedRows() {
    await screen.findByText('All groceries.')
    return screen
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .slice(0, 4)
          .map((cell) => cell.textContent.trim()),
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
      ['Groceries Built-in', 'All groceries.', '12 transactions', '3 rules'],
      ['Health', 'Pharmacy etc.', '0 transactions', '2 rules'],
      ['Other Built-in', "Costs that don't belong in any other category.", '1 transaction', '0 rules'],
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

  // The swatch in the named Category's row, found by its accessible name.
  function swatch(name: string) {
    const row = screen.getByRole('row', { name: new RegExp(`\\b${name}\\b`) })
    return within(row).getByRole('img', { name: `${name} colour` })
  }

  it('shows each Category in the colour the Dashboard draws it in, as a swatch beside its name', async () => {
    categoriesServed = [
      { ...categories[0], colour: '#123456' },
      { id: 7, name: 'Health', description: 'Pharmacy etc.', colour: '#abcdef', builtIn: false, transactionCount: 0, ruleCount: 0 },
    ]
    await openCategoriesPage()
    await listedRows()

    expect(swatch('Groceries')).toHaveStyle({ backgroundColor: 'rgb(18, 52, 86)' })
    expect(swatch('Health')).toHaveStyle({ backgroundColor: 'rgb(171, 205, 239)' })
  })

  it('draws a swatch lighter in Dark, just as the Dashboard draws its Category', async () => {
    localStorage.setItem('appearance', 'dark')
    categoriesServed = [{ ...categories[0], colour: '#104281' }, categories[1]]
    months = [{ year: 2026, month: 9 }]
    handleSpending = () => Response.json({ total: 120, slices: [{ categoryId: 1, amount: 120 }] })
    const user = userEvent.setup()
    await renderApp()
    const legendRow = await within(screen.getByRole('region', { name: 'Spending' })).findByRole('row', {
      name: /Groceries/,
    })
    const onDashboard = (legendRow.querySelector('[aria-hidden="true"]') as HTMLElement).style.backgroundColor

    await user.click(screen.getByRole('button', { name: 'Categories' }))
    await listedRows()

    // The sum of its red, green and blue.
    const brightness = (colour: string) => colour.match(/\d+/g)!.reduce((sum, channel) => sum + Number(channel), 0)
    expect(swatch('Groceries').style.backgroundColor).toBe(onDashboard)
    expect(brightness(onDashboard)).toBeGreaterThan(brightness('rgb(16, 66, 129)'))
  })

  it('lays each Category out as a stacked card on a phone, with its counts named and its actions, never scrolling sideways', async () => {
    await openCategoriesPage()
    await listedRows()

    const table = screen.getByRole('table')
    expect(table).toHaveClass('max-sm:block')
    expect(within(table).getAllByRole('rowgroup')[0]).toHaveClass('max-sm:hidden')
    for (const row of within(table).getAllByRole('row').slice(1)) {
      // Wrapping, so large counts push the actions onto a line of their own rather than off the screen.
      expect(row).toHaveClass('max-sm:flex', 'max-sm:flex-wrap')
      // With the column headers hidden, the counts say what they count.
      expect(within(row).getByText(/^transactions?$/)).not.toHaveClass('sr-only')
      expect(within(row).getByText('rules')).not.toHaveClass('sr-only')
      expect(within(row).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    }
    const page = screen.getByRole('heading', { name: 'Categories' }).closest('section')!
    expect(page.querySelector('[class*="overflow-x-auto"], [class*="min-w-"]:not([class*="min-w-0"])')).toBeNull()
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
    // Nothing to fill in on the page itself: the button opens the dialog.
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()

    const dialog = await openAddDialog(user)
    expect(dialog.getByLabelText('Name')).toHaveValue('')
    expect(dialog.getByLabelText('Name')).toHaveFocus()
    expect(dialog.getByLabelText('Description')).toHaveValue('')
    await user.type(dialog.getByLabelText('Name'), '  Fitness ')
    await user.type(dialog.getByLabelText('Description'), ' Gym and sports.  ')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    // With the first colour no Category has, as the picker starts on.
    expect(posted).toEqual({ name: 'Fitness', description: 'Gym and sports.', colour: '#eb6834' })
    expect(await screen.findByRole('status')).toHaveTextContent('Category added.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add category' })).toHaveFocus()
    expect(await listedRows()).toEqual([
      ['Groceries Built-in', 'All groceries.', '12 transactions', '3 rules'],
      ['Other Built-in', "Costs that don't belong in any other category.", '1 transaction', '0 rules'],
      ['Fitness', 'Gym and sports.', '0 transactions', '0 rules'],
      ['Health', 'Pharmacy etc.', '0 transactions', '0 rules'],
    ])

    // The next Category starts from empty fields again.
    const next = await openAddDialog(user)
    expect(next.getByLabelText('Name')).toHaveValue('')
    expect(next.getByLabelText('Description')).toHaveValue('')
    await user.click(next.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Rules' }))
    expect(await within(screen.getByLabelText('Category')).findByRole('option', { name: 'Fitness' })).toBeInTheDocument()
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

    const dialog = await openAddDialog(user)
    await user.type(dialog.getByLabelText('Name'), 'Ære')
    await user.type(dialog.getByLabelText('Description'), 'Gifts.')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Category added.')
    expect((await listedRows()).map((cells) => cells[0])).toEqual([
      'Groceries Built-in',
      'Other Built-in',
      'Health',
      'Ære',
      'Årlig',
    ])
  })

  it("shows the server's field errors beside their fields, keeping the dialog open with the input", async () => {
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

    const dialog = await openAddDialog(user)
    await user.type(dialog.getByLabelText('Name'), 'groceries')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    const nameError = await dialog.findByText("A category named 'Groceries' already exists.")
    expect(dialog.getByLabelText('Name')).toHaveAccessibleDescription(nameError.textContent!)
    expect(dialog.getByLabelText('Description')).toHaveAccessibleDescription('Description is required.')
    expect(dialog.getByLabelText('Name')).toHaveValue('groceries')
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('shows a general error in the dialog when the server cannot be reached', async () => {
    handleAddCategory = () => {
      throw new TypeError('Failed to fetch')
    }
    const user = await openCategoriesPage()
    await listedRows()

    const dialog = await openAddDialog(user)
    await user.type(dialog.getByLabelText('Name'), 'Hobby')
    await user.type(dialog.getByLabelText('Description'), 'Hobby supplies.')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent('Could not reach the server.')
    expect(dialog.getByLabelText('Name')).toHaveValue('Hobby')
  })

  it('discards what was typed, and any errors, when the dialog is closed by Cancel or by Escape', async () => {
    handleAddCategory = () => Response.json({ errors: { name: ['Name is required.'] } }, { status: 400 })
    const user = await openCategoriesPage()
    await listedRows()

    let dialog = await openAddDialog(user)
    await user.type(dialog.getByLabelText('Description'), 'Hobby supplies.')
    await user.click(dialog.getByRole('button', { name: 'Save' }))
    await dialog.findByText('Name is required.')
    await user.click(dialog.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add category' })).toHaveFocus()

    dialog = await openAddDialog(user)
    expect(dialog.getByLabelText('Description')).toHaveValue('')
    expect(dialog.queryByText('Name is required.')).not.toBeInTheDocument()
    await user.type(dialog.getByLabelText('Name'), 'Hobby')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add category' })).toHaveFocus()

    dialog = await openAddDialog(user)
    expect(dialog.getByLabelText('Name')).toHaveValue('')
    expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/categories' && init?.method === 'POST')).toHaveLength(1)
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('says when the Categories could not be loaded', async () => {
    categoriesServed = new Response(null, { status: 500 })
    await openCategoriesPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the categories.')
  })

  describe('Uncategorized line', () => {
    it('says under the list, never as a row in it, how many transactions are Uncategorized', async () => {
      uncategorizedCount = 1032
      await openCategoriesPage()
      await listedRows()

      // The thousands apart as nb-NO writes them, with a non-breaking space.
      const line = await screen.findByRole('button', { name: '1 032 transactions are Uncategorized' })
      expect(screen.getByRole('table')).not.toContainElement(line)
      expect(screen.getByRole('table').compareDocumentPosition(line)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(screen.queryByRole('row', { name: /Uncategorized/ })).not.toBeInTheDocument()
    })

    it('says is for a single Uncategorized transaction', async () => {
      uncategorizedCount = 1
      await openCategoriesPage()

      expect(await screen.findByRole('button', { name: '1 transaction is Uncategorized' })).toBeInTheDocument()
    })

    it('is hidden when no transaction is Uncategorized', async () => {
      await openCategoriesPage()
      await listedRows()

      expect(fetchMock).toHaveBeenCalledWith('/api/categories/uncategorized-count', undefined)
      expect(screen.queryByText(/Uncategorized/)).not.toBeInTheDocument()
    })

    it('is hidden, saying nothing, when the count could not be loaded', async () => {
      uncategorizedCount = new Response(null, { status: 500 })
      await openCategoriesPage()
      await listedRows()

      expect(screen.queryByText(/Uncategorized/)).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('deleting', () => {
    const health = { id: 7, name: 'Health', description: 'Pharmacy etc.', builtIn: false, transactionCount: 0, ruleCount: 0 }

    function categoryRow(name: string) {
      return screen.getByRole('row', { name: new RegExp(`\\b${name}\\b`) })
    }

    // Opens the named Category's delete dialog from its row's Delete button.
    async function openDeleteDialog(user: ReturnType<typeof userEvent.setup>, name: string) {
      await user.click(within(categoryRow(name)).getByRole('button', { name: 'Delete' }))
      return within(screen.getByRole('dialog', { name: `Delete ${name}?` }))
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

    it('asks for confirmation in a dialog, then deletes the Category and removes its row', async () => {
      categoriesServed = [categories[0], health]
      let deletedId: number | undefined
      handleDeleteCategory = (id) => {
        deletedId = id
        return Response.json({ transactionsChanged: 0 })
      }
      const user = await openCategoriesPage()
      await listedRows()

      const dialog = await openDeleteDialog(user, 'Health')

      expect(deletedId).toBeUndefined()
      // Nothing uses it, so there is nothing to choose.
      expect(dialog.queryByRole('radio')).not.toBeInTheDocument()
      expect(dialog.queryByRole('combobox')).not.toBeInTheDocument()
      expect(within(categoryRow('Health')).queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument()

      await user.click(dialog.getByRole('button', { name: 'Confirm delete' }))

      expect(deletedId).toBe(7)
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Category deleted. 0 transactions changed category.',
      )
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByRole('row', { name: /Health/ })).not.toBeInTheDocument()
    })

    it('says how many transactions and rules a Category in use has, as the question its choices answer', async () => {
      categoriesServed = [
        categories[0],
        { ...health, transactionCount: 1032, ruleCount: 1 },
        { ...health, id: 8, name: 'Hobby', transactionCount: 0, ruleCount: 2 },
      ]
      const user = await openCategoriesPage()
      await listedRows()

      let dialog = await openDeleteDialog(user, 'Health')
      // The thousands apart as nb-NO writes them, with a non-breaking space.
      const choices = dialog.getByRole('group', { name: 'Health has 1 032 transactions and 1 rule.' })
      expect(within(choices).getAllByRole('radio')).toHaveLength(2)
      await user.click(dialog.getByRole('button', { name: 'Cancel' }))

      dialog = await openDeleteDialog(user, 'Hobby')
      expect(dialog.getByRole('group', { name: 'Hobby has 0 transactions and 2 rules.' })).toBeInTheDocument()
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

      const dialog = await openDeleteDialog(user, 'Health')

      // Every other Category, never the one being deleted.
      const replacement = dialog.getByRole('combobox', { name: 'Move its transactions and rules to' })
      expect(within(replacement).getAllByRole('option').map((option) => option.textContent)).toEqual([
        'Choose a category',
        'Groceries',
        'Other',
      ])
      const confirm = dialog.getByRole('button', { name: 'Confirm delete' })
      expect(confirm).toBeDisabled()

      await user.selectOptions(replacement, 'Other')
      expect(dialog.getByRole('radio', { name: 'Move its transactions and rules to' })).toBeChecked()
      await user.click(confirm)

      expect(deleted).toEqual({ id: 7, query: 'replacementCategoryId=13' })
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Category deleted. 3 transactions changed category.',
      )
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(await listedRows()).toEqual([
        ['Groceries Built-in', 'All groceries.', '12 transactions', '3 rules'],
        ['Other Built-in', "Costs that don't belong in any other category.", '4 transactions', '2 rules'],
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

      const dialog = await openDeleteDialog(user, 'Health')

      const move = dialog.getByRole('radio', { name: 'Move its transactions and rules to' })
      const deleteRules = dialog.getByRole('radio', {
        name: 'Delete its rules and leave its transactions Uncategorized unless another rule matches them',
      })
      const confirm = dialog.getByRole('button', { name: 'Confirm delete' })
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
          ['Groceries Built-in', 'All groceries.', '13 transactions', '3 rules'],
          ['Other Built-in', "Costs that don't belong in any other category.", '1 transaction', '0 rules'],
        ]),
      )
    })

    it('counts the Uncategorized transactions again after deleting its rules, showing the line once there are some', async () => {
      categoriesServed = [categories[0], { ...health, transactionCount: 2, ruleCount: 1 }, categories[1]]
      handleDeleteCategory = () => {
        // A remaining Groceries rule picked up one of its Transactions; the other is Uncategorized.
        categoriesServed = [{ ...categories[0], transactionCount: 13 }, categories[1]]
        uncategorizedCount = 1
        return Response.json({ transactionsChanged: 2 })
      }
      const user = await openCategoriesPage()
      await listedRows()
      expect(screen.queryByText(/is Uncategorized/)).not.toBeInTheDocument()

      const dialog = await openDeleteDialog(user, 'Health')
      await user.click(
        dialog.getByRole('radio', {
          name: 'Delete its rules and leave its transactions Uncategorized unless another rule matches them',
        }),
      )
      await user.click(dialog.getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByRole('button', { name: '1 transaction is Uncategorized' })).toBeInTheDocument()
    })

    it("shows the server's reason in the dialog when the replacement is refused, keeping the choice to change", async () => {
      categoriesServed = [categories[0], { ...health, ruleCount: 1 }, categories[1]]
      const replacements: string[] = []
      handleDeleteCategory = (_id, query) => {
        replacements.push(query.get('replacementCategoryId')!)
        return replacements.length === 1
          ? Response.json(
              { status: 400, errors: { replacementCategoryId: ['The replacement Category does not exist.'] } },
              { status: 400 },
            )
          : Response.json({ transactionsChanged: 0 })
      }
      const user = await openCategoriesPage()
      await listedRows()

      const dialog = await openDeleteDialog(user, 'Health')
      await user.selectOptions(dialog.getByRole('combobox'), 'Groceries')
      await user.click(dialog.getByRole('button', { name: 'Confirm delete' }))

      expect(await dialog.findByRole('alert')).toHaveTextContent('The replacement Category does not exist.')
      expect(dialog.getByRole('combobox')).toHaveDisplayValue('Groceries')
      expect(categoryRow('Health')).toBeInTheDocument()

      await user.selectOptions(dialog.getByRole('combobox'), 'Other')
      await user.click(dialog.getByRole('button', { name: 'Confirm delete' }))

      expect(replacements).toEqual(['1', '13'])
      expect(await screen.findByRole('status')).toHaveTextContent('Category deleted. 0 transactions changed category.')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('keeps the Category when the dialog is closed by Cancel or by Escape, giving the focus back to Delete', async () => {
      categoriesServed = [categories[0], health]
      let deleted = false
      handleDeleteCategory = () => {
        deleted = true
        return Response.json({ transactionsChanged: 0 })
      }
      const user = await openCategoriesPage()
      await listedRows()

      const dialog = await openDeleteDialog(user, 'Health')
      await user.click(dialog.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(within(categoryRow('Health')).getByRole('button', { name: 'Delete' })).toHaveFocus()

      await openDeleteDialog(user, 'Health')
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(within(categoryRow('Health')).getByRole('button', { name: 'Delete' })).toHaveFocus()

      expect(deleted).toBe(false)
    })

    it("shows the server's reason in the dialog and keeps the row when the delete is refused", async () => {
      // Listed as unused, but something started using it since.
      categoriesServed = [categories[0], health]
      handleDeleteCategory = () =>
        Response.json(
          { status: 400, errors: { category: ["Health is in use, so it can't be deleted."] } },
          { status: 400 },
        )
      const user = await openCategoriesPage()
      await listedRows()

      const dialog = await openDeleteDialog(user, 'Health')
      await user.click(dialog.getByRole('button', { name: 'Confirm delete' }))

      expect(await dialog.findByRole('alert')).toHaveTextContent("Health is in use, so it can't be deleted.")
      await user.click(dialog.getByRole('button', { name: 'Cancel' }))
      expect(within(categoryRow('Health')).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('removes a Category that was already deleted elsewhere', async () => {
      categoriesServed = [categories[0], health]
      handleDeleteCategory = () => Response.json({ title: 'Not Found', status: 404 }, { status: 404 })
      const user = await openCategoriesPage()
      await listedRows()

      const dialog = await openDeleteDialog(user, 'Health')
      await user.click(dialog.getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByRole('status')).toHaveTextContent('The category was already deleted.')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByRole('row', { name: /Health/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('opens afresh each time, with no choice made, no earlier error and no earlier message', async () => {
      categoriesServed = [categories[0], { ...health, ruleCount: 1 }, { ...health, id: 8, name: 'Hobby' }]
      handleDeleteCategory = (id) =>
        id === 8
          ? Response.json({ transactionsChanged: 0 })
          : Response.json(
              { status: 400, errors: { replacementCategoryId: ['The replacement Category does not exist.'] } },
              { status: 400 },
            )
      const user = await openCategoriesPage()
      await listedRows()

      // A message about an earlier delete goes once another starts.
      let dialog = await openDeleteDialog(user, 'Hobby')
      await user.click(dialog.getByRole('button', { name: 'Confirm delete' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Category deleted.')

      dialog = await openDeleteDialog(user, 'Health')
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
      await user.click(dialog.getByRole('radio', { name: /^Delete its rules/ }))
      await user.selectOptions(dialog.getByRole('combobox'), 'Groceries')
      await user.click(dialog.getByRole('button', { name: 'Confirm delete' }))
      await dialog.findByRole('alert')
      await user.click(dialog.getByRole('button', { name: 'Cancel' }))

      dialog = await openDeleteDialog(user, 'Health')
      expect(dialog.queryByRole('alert')).not.toBeInTheDocument()
      expect(dialog.getByRole('combobox')).toHaveValue('')
      for (const radio of dialog.getAllByRole('radio')) expect(radio).not.toBeChecked()
      expect(dialog.getByRole('button', { name: 'Confirm delete' })).toBeDisabled()
    })

    it('shows a general error in the dialog when a delete cannot reach the server', async () => {
      categoriesServed = [categories[0], health]
      handleDeleteCategory = () => {
        throw new TypeError('Failed to fetch')
      }
      const user = await openCategoriesPage()
      await listedRows()

      const dialog = await openDeleteDialog(user, 'Health')
      await user.click(dialog.getByRole('button', { name: 'Confirm delete' }))

      expect(await dialog.findByRole('alert')).toHaveTextContent('Could not reach the server.')
      expect(dialog.getByRole('button', { name: 'Confirm delete' })).toBeEnabled()
      expect(categoryRow('Health')).toBeInTheDocument()
    })
  })

  describe('editing', () => {
    const health = { id: 7, name: 'Health', description: 'Pharmacy etc.', builtIn: false, transactionCount: 4, ruleCount: 2 }

    function categoryRow(name: RegExp) {
      return screen.getByRole('row', { name })
    }

    async function openEditDialog(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
      await user.click(within(categoryRow(name)).getByRole('button', { name: 'Edit' }))
      return within(screen.getByRole('dialog', { name: 'Edit category' }))
    }

    it('edits a Category in the dialog, filled in, and keeps it sorted by name after the Built-in Categories', async () => {
      const travel = { id: 10, name: 'Travel', description: 'All travel.', builtIn: false, transactionCount: 0, ruleCount: 0 }
      categoriesServed = [...categories, health, travel]
      let edited: { id: number; body: unknown } | undefined
      handleEditCategory = (id, body) => {
        edited = { id, body }
        return Response.json({ ...health, name: 'Wellness', description: 'Pharmacy, gym etc.' })
      }
      const user = await openCategoriesPage()
      await listedRows()

      const dialog = await openEditDialog(user, /Health/)
      // Nothing is edited inside the row.
      expect(within(categoryRow(/Health/)).queryByRole('textbox')).not.toBeInTheDocument()
      expect(dialog.getByLabelText('Name')).toHaveValue('Health')
      expect(dialog.getByLabelText('Name')).toHaveFocus()
      expect(dialog.getByLabelText('Description')).toHaveValue('Pharmacy etc.')
      await user.clear(dialog.getByLabelText('Name'))
      await user.type(dialog.getByLabelText('Name'), ' Wellness ')
      await user.clear(dialog.getByLabelText('Description'))
      await user.type(dialog.getByLabelText('Description'), 'Pharmacy, gym etc. ')
      await user.click(dialog.getByRole('button', { name: 'Save' }))

      expect(edited).toEqual({ id: 7, body: { name: 'Wellness', description: 'Pharmacy, gym etc.' } })
      expect(await screen.findByRole('status')).toHaveTextContent('Category updated.')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(within(categoryRow(/Wellness/)).getByRole('button', { name: 'Edit' })).toHaveFocus()
      expect(await listedRows()).toEqual([
        ['Groceries Built-in', 'All groceries.', '12 transactions', '3 rules'],
        ['Other Built-in', "Costs that don't belong in any other category.", '1 transaction', '0 rules'],
        ['Travel', 'All travel.', '0 transactions', '0 rules'],
        ['Wellness', 'Pharmacy, gym etc.', '4 transactions', '2 rules'],
      ])
    })

    it("shows a Built-in Category's name but can't change it, editing only its description", async () => {
      let edited: unknown
      handleEditCategory = (_id, body) => {
        edited = body
        return Response.json({ ...categories[0], description: 'Food and drink.' })
      }
      const user = await openCategoriesPage()
      await listedRows()

      const dialog = await openEditDialog(user, /Groceries/)
      const name = dialog.getByLabelText('Name')
      expect(name).toHaveValue('Groceries')
      expect(name).toHaveAttribute('readonly')
      expect(name).toHaveAccessibleDescription("Built-in Categories can't be renamed.")
      expect(dialog.getByLabelText('Description')).toHaveFocus()
      await user.type(name, 'Food')
      expect(name).toHaveValue('Groceries')
      await user.clear(dialog.getByLabelText('Description'))
      await user.type(dialog.getByLabelText('Description'), 'Food and drink.')
      await user.click(dialog.getByRole('button', { name: 'Save' }))

      expect(edited).toEqual({ name: 'Groceries', description: 'Food and drink.', colour: '#2a78d6' })
      expect(await screen.findByRole('status')).toHaveTextContent('Category updated.')
      expect(within(categoryRow(/Groceries/)).getByText('Food and drink.')).toBeInTheDocument()
    })

    it('closes without saving on Cancel or Escape, and opens filled in from the Category again', async () => {
      categoriesServed = [health]
      const user = await openCategoriesPage()
      await screen.findByText('Pharmacy etc.')

      let dialog = await openEditDialog(user, /Health/)
      await user.type(dialog.getByLabelText('Name'), ' extra')
      await user.click(dialog.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(within(categoryRow(/Health/)).getByRole('button', { name: 'Edit' })).toHaveFocus()

      dialog = await openEditDialog(user, /Health/)
      expect(dialog.getByLabelText('Name')).toHaveValue('Health')
      await user.clear(dialog.getByLabelText('Description'))
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(within(categoryRow(/Health/)).getByRole('button', { name: 'Edit' })).toHaveFocus()

      dialog = await openEditDialog(user, /Health/)
      expect(dialog.getByLabelText('Description')).toHaveValue('Pharmacy etc.')
      expect(categoryRow(/Health/)).toHaveTextContent('HealthPharmacy etc.4 transactions2 rules')
      expect(fetchMock).not.toHaveBeenCalledWith('/api/categories/7', expect.anything())
    })

    it("shows the server's field errors beside their fields, keeping the dialog open with the input", async () => {
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

      const dialog = await openEditDialog(user, /Health/)
      await user.clear(dialog.getByLabelText('Name'))
      await user.type(dialog.getByLabelText('Name'), 'GROCERIES')
      await user.clear(dialog.getByLabelText('Description'))
      await user.click(dialog.getByRole('button', { name: 'Save' }))

      const nameError = await dialog.findByText("A category named 'Groceries' already exists.")
      expect(dialog.getByLabelText('Name')).toHaveAccessibleDescription(nameError.textContent!)
      expect(dialog.getByLabelText('Description')).toHaveAccessibleDescription('Description is required.')
      expect(dialog.getByLabelText('Name')).toHaveValue('GROCERIES')
      expect(categoryRow(/Health/)).toHaveTextContent('HealthPharmacy etc.')
    })

    it('shows a general error in the dialog when an edit cannot reach the server', async () => {
      categoriesServed = [health]
      handleEditCategory = () => {
        throw new TypeError('Failed to fetch')
      }
      const user = await openCategoriesPage()
      await screen.findByText('Pharmacy etc.')

      const dialog = await openEditDialog(user, /Health/)
      await user.type(dialog.getByLabelText('Name'), ' extra')
      await user.click(dialog.getByRole('button', { name: 'Save' }))

      expect(await dialog.findByRole('alert')).toHaveTextContent('Could not reach the server.')
      expect(dialog.getByLabelText('Name')).toHaveValue('Health extra')
    })

    it('keeps a cancelled edit closed when its save then fails', async () => {
      categoriesServed = [health]
      let respond: (response: Response) => void = () => {}
      handleEditCategory = () => new Promise((resolve) => (respond = resolve))
      const user = await openCategoriesPage()
      await screen.findByText('Pharmacy etc.')

      const dialog = await openEditDialog(user, /Health/)
      await user.clear(dialog.getByLabelText('Name'))
      await user.click(dialog.getByRole('button', { name: 'Save' }))
      expect(dialog.getByRole('button', { name: 'Saving…' })).toBeDisabled()
      await user.click(dialog.getByRole('button', { name: 'Cancel' }))
      await act(async () => respond(Response.json({ errors: { name: ['Name is required.'] } }, { status: 400 })))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByText('Name is required.')).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(categoryRow(/Health/)).toHaveTextContent('HealthPharmacy etc.')
    })

    it('lists an edit saved after its dialog was cancelled, leaving a dialog opened since alone', async () => {
      categoriesServed = [health]
      let respond: (response: Response) => void = () => {}
      handleEditCategory = () => new Promise((resolve) => (respond = resolve))
      const user = await openCategoriesPage()
      await screen.findByText('Pharmacy etc.')

      const dialog = await openEditDialog(user, /Health/)
      await user.clear(dialog.getByLabelText('Name'))
      await user.type(dialog.getByLabelText('Name'), 'Wellness')
      await user.click(dialog.getByRole('button', { name: 'Save' }))
      await user.click(dialog.getByRole('button', { name: 'Cancel' }))
      await openAddDialog(user)
      await act(async () => respond(Response.json({ ...health, name: 'Wellness' })))

      expect(await screen.findByRole('status')).toHaveTextContent('Category updated.')
      expect(categoryRow(/Wellness/)).toHaveTextContent('WellnessPharmacy etc.')
      expect(screen.getByRole('dialog', { name: 'Add category' })).toBeInTheDocument()
    })
  })

  describe('colour', () => {
    const health = { id: 7, name: 'Health', description: 'Pharmacy etc.', builtIn: false, transactionCount: 0, ruleCount: 0 }

    // The dialog's colour picker.
    function colourPicker(dialog: ReturnType<typeof within>) {
      return within(dialog.getByRole('radiogroup', { name: 'Colour' }))
    }

    // The picker's colours, each named by its place in the palette and the Categories that have it.
    function expectColours(picker: ReturnType<typeof within>, names: string[]) {
      expect(picker.getAllByRole('radio')).toEqual(names.map((name) => picker.getByRole('radio', { name })))
    }

    it('offers the palette in order, marking each colour another Category has with its name, and starts a new Category on the first unused one', async () => {
      categoriesServed = [categories[0], categories[1], { ...health, colour: '#2a78d6' }]
      let posted: unknown
      handleAddCategory = (body) => {
        posted = body
        return Response.json(
          { id: 20, ...(body as object), builtIn: false, transactionCount: 0, ruleCount: 0 },
          { status: 201 },
        )
      }
      const user = await openCategoriesPage()
      await listedRows()

      const dialog = await openAddDialog(user)
      const picker = colourPicker(dialog)
      expectColours(picker, [
        'Colour 1, used by Groceries and Health',
        'Colour 2',
        'Colour 3, used by Other',
        'Colour 4',
      ])
      expect(picker.getByRole('radio', { checked: true })).toBe(picker.getByRole('radio', { name: 'Colour 2' }))

      // A colour in use can still be chosen.
      await user.click(picker.getByRole('radio', { name: 'Colour 3, used by Other' }))
      expect(picker.getByRole('radio', { name: 'Colour 3, used by Other' })).toBeChecked()
      await user.type(dialog.getByLabelText('Name'), 'Fitness')
      await user.type(dialog.getByLabelText('Description'), 'Gym and sports.')
      await user.click(dialog.getByRole('button', { name: 'Save' }))

      expect(posted).toEqual({ name: 'Fitness', description: 'Gym and sports.', colour: '#9085e9' })
      expect(await screen.findByRole('status')).toHaveTextContent('Category added.')
      expect(swatch('Fitness')).toHaveStyle({ backgroundColor: 'rgb(144, 133, 233)' })
    })

    it('starts a new Category on no colour once every one is taken, and leaves its colour to the server', async () => {
      palette = ['#2a78d6', '#9085e9']
      let posted: unknown
      handleAddCategory = (body) => {
        posted = body
        return Response.json(
          { id: 20, ...(body as object), colour: '#475569', builtIn: false, transactionCount: 0, ruleCount: 0 },
          { status: 201 },
        )
      }
      const user = await openCategoriesPage()
      await listedRows()

      const dialog = await openAddDialog(user)
      const picker = colourPicker(dialog)
      expectColours(picker, ['Colour 1, used by Groceries', 'Colour 2, used by Other'])
      expect(picker.queryByRole('radio', { checked: true })).not.toBeInTheDocument()
      await user.type(dialog.getByLabelText('Name'), 'Fitness')
      await user.type(dialog.getByLabelText('Description'), 'Gym and sports.')
      await user.click(dialog.getByRole('button', { name: 'Save' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Category added.')
      expect(posted).toStrictEqual({ name: 'Fitness', description: 'Gym and sports.' })
    })

    it("starts an edit on the Category's own colour, and recolours a Built-in Category in its row and on the Dashboard", async () => {
      categoriesServed = [...categories]
      let edited: unknown
      handleEditCategory = (_id, body) => {
        edited = body
        const recoloured = { ...categories[0], ...(body as object) }
        categoriesServed = [recoloured, categories[1]]
        return Response.json(recoloured)
      }
      months = [{ year: 2026, month: 9 }]
      handleSpending = () => Response.json({ total: 120, slices: [{ categoryId: 1, amount: 120 }] })
      const user = await openCategoriesPage()
      await listedRows()

      await user.click(within(screen.getByRole('row', { name: /Groceries/ })).getByRole('button', { name: 'Edit' }))
      const dialog = within(screen.getByRole('dialog', { name: 'Edit category' }))
      const picker = colourPicker(dialog)
      // Its own colour isn't marked as another Category's.
      expectColours(picker, ['Colour 1', 'Colour 2', 'Colour 3, used by Other', 'Colour 4'])
      expect(picker.getByRole('radio', { checked: true })).toBe(picker.getByRole('radio', { name: 'Colour 1' }))
      await user.click(picker.getByRole('radio', { name: 'Colour 2' }))
      await user.click(dialog.getByRole('button', { name: 'Save' }))

      expect(edited).toEqual({ name: 'Groceries', description: 'All groceries.', colour: '#eb6834' })
      expect(await screen.findByRole('status')).toHaveTextContent('Category updated.')
      expect(swatch('Groceries')).toHaveStyle({ backgroundColor: 'rgb(235, 104, 52)' })

      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))
      const legendRow = await within(screen.getByRole('region', { name: 'Spending' })).findByRole('row', {
        name: /Groceries/,
      })
      expect(legendRow.querySelector('[aria-hidden="true"]')).toHaveStyle({ backgroundColor: 'rgb(235, 104, 52)' })
    })

    it('starts a Category on the slate fallback with no colour chosen, and keeps its colour when saved without one', async () => {
      const slate = { ...health, colour: '#475569' }
      categoriesServed = [...categories, slate]
      let edited: unknown
      handleEditCategory = (_id, body) => {
        edited = body
        return Response.json({ ...slate, ...(body as object) })
      }
      const user = await openCategoriesPage()
      await listedRows()
      expect(swatch('Health')).toHaveStyle({ backgroundColor: 'rgb(71, 85, 105)' })

      await user.click(within(screen.getByRole('row', { name: /Health/ })).getByRole('button', { name: 'Edit' }))
      const dialog = within(screen.getByRole('dialog', { name: 'Edit category' }))
      expect(colourPicker(dialog).queryByRole('radio', { checked: true })).not.toBeInTheDocument()
      await user.type(dialog.getByLabelText('Description'), ' And gym.')
      await user.click(dialog.getByRole('button', { name: 'Save' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Category updated.')
      expect(edited).toStrictEqual({ name: 'Health', description: 'Pharmacy etc. And gym.' })
      expect(swatch('Health')).toHaveStyle({ backgroundColor: 'rgb(71, 85, 105)' })
    })

    it('forgets a chosen colour when the dialog is closed without saving', async () => {
      const user = await openCategoriesPage()
      await listedRows()

      let picker = colourPicker(await openAddDialog(user))
      await user.click(picker.getByRole('radio', { name: 'Colour 4' }))
      await user.keyboard('{Escape}')

      picker = colourPicker(await openAddDialog(user))
      expect(picker.getByRole('radio', { checked: true })).toBe(picker.getByRole('radio', { name: 'Colour 2' }))
    })

    it("shows the server's colour error beside the picker", async () => {
      handleAddCategory = () =>
        Response.json({ errors: { colour: ["Colour must be one of the palette's colours."] } }, { status: 400 })
      const user = await openCategoriesPage()
      await listedRows()

      const dialog = await openAddDialog(user)
      await user.type(dialog.getByLabelText('Name'), 'Fitness')
      await user.type(dialog.getByLabelText('Description'), 'Gym and sports.')
      await user.click(dialog.getByRole('button', { name: 'Save' }))

      await dialog.findByText("Colour must be one of the palette's colours.")
      expect(dialog.getByRole('radiogroup', { name: 'Colour' })).toHaveAccessibleDescription(
        "Colour must be one of the palette's colours.",
      )
    })

    it('says when the colours could not be loaded, and still saves without one', async () => {
      palette = new Response(null, { status: 500 })
      let posted: unknown
      handleAddCategory = (body) => {
        posted = body
        return Response.json(
          { id: 20, ...(body as object), colour: '#eb6834', builtIn: false, transactionCount: 0, ruleCount: 0 },
          { status: 201 },
        )
      }
      const user = await openCategoriesPage()
      await listedRows()

      const dialog = await openAddDialog(user)
      expect(dialog.getByText('Could not load the colours.')).toBeInTheDocument()
      expect(dialog.queryByRole('radio')).not.toBeInTheDocument()
      await user.type(dialog.getByLabelText('Name'), 'Fitness')
      await user.type(dialog.getByLabelText('Description'), 'Gym and sports.')
      await user.click(dialog.getByRole('button', { name: 'Save' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Category added.')
      expect(posted).toStrictEqual({ name: 'Fitness', description: 'Gym and sports.' })
    })

    it('draws the colours lighter in Dark, as a Category in them is drawn', async () => {
      localStorage.setItem('appearance', 'dark')
      const user = await openCategoriesPage()
      await listedRows()

      const picker = colourPicker(await openAddDialog(user))
      const colour = picker.getByRole('radio', { name: 'Colour 1, used by Groceries' }).closest('label')!
      expect(colour.querySelector('[aria-hidden="true"]')).toHaveStyle({
        backgroundColor: swatch('Groceries').style.backgroundColor,
      })
      expect(swatch('Groceries')).not.toHaveStyle({ backgroundColor: 'rgb(42, 120, 214)' })
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
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Keyword',
      'Category',
      'Transactions',
      'Actions',
    ])
  })

  it('shows how many transactions each rule categorizes', async () => {
    rules = [
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false, transactionCount: 1032 },
      { id: 2, keyword: 'rema', categoryId: 1, aiGenerated: false, isNew: false, transactionCount: 1 },
      { id: 3, keyword: 'zara', categoryId: 13, aiGenerated: false, isNew: false, transactionCount: 0 },
    ]
    await openRulesPage()

    expect(screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[2].textContent)).toEqual([
      '1 032 transactions',
      '1 transaction',
      '0 transactions',
    ])
  })

  // The count shown in a rule's row.
  function ruleCount(keyword: string) {
    return within(ruleRow(keyword)).getAllByRole('cell')[2].textContent
  }

  it("counts the other rules again after adding, editing or deleting one, since a longer keyword takes another's transactions", async () => {
    const kiwi = { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false, transactionCount: 5 }
    const rema = { id: 2, keyword: 'rema', categoryId: 1, aiGenerated: false, isNew: false, transactionCount: 2 }
    const kiwiButikk = { id: 3, keyword: 'kiwi butikk', categoryId: 1, aiGenerated: false, isNew: false, transactionCount: 3 }
    const kiwiPluss = { ...kiwiButikk, keyword: 'kiwi pluss', transactionCount: 0 }
    rules = [kiwi, rema]
    handleAddRule = () => {
      rules = [{ ...kiwi, transactionCount: 2 }, rema, kiwiButikk]
      return Response.json({ ...kiwiButikk, transactionsChanged: 0 }, { status: 201 })
    }
    const user = await openRulesPage()

    await user.type(screen.getByLabelText('Keyword'), 'kiwi butikk')
    await user.selectOptions(screen.getByLabelText('Category'), 'Groceries')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))

    await waitFor(() => expect(ruleCount('kiwi')).toBe('2 transactions'))
    expect(ruleCount('kiwi butikk')).toBe('3 transactions')

    handleEditRule = () => {
      rules = [kiwi, rema, kiwiPluss]
      return Response.json({ ...kiwiPluss, transactionsChanged: 0 })
    }
    await user.click(within(ruleRow('kiwi butikk')).getByRole('button', { name: 'Edit' }))
    const editing = within(screen.getByRole('button', { name: 'Save' }).closest('tr')!)
    await user.clear(editing.getByLabelText('Keyword'))
    await user.type(editing.getByLabelText('Keyword'), 'kiwi pluss')
    await user.click(editing.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(ruleCount('kiwi')).toBe('5 transactions'))

    handleDeleteRule = () => {
      rules = [kiwi, { ...rema, transactionCount: 0 }]
      return Response.json({ transactionsChanged: 0 })
    }
    await user.click(within(ruleRow('kiwi pluss')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(ruleCount('rema')).toBe('0 transactions'))
  })

  // The swatch beside a rule's Category, as a CSS colour.
  function categorySwatch(keyword: string, category: string) {
    return within(ruleRow(keyword)).getByRole('img', { name: `${category} colour` }).style.backgroundColor
  }

  it("shows each rule's Category with a swatch in the Category's colour", async () => {
    categoriesServed = [{ ...categories[0], colour: '#123456' }, { ...categories[1], colour: '#abcdef' }]
    await openRulesPage()

    expect(categorySwatch('kiwi', 'Groceries')).toBe('rgb(18, 52, 86)')
    expect(categorySwatch('overføring mellom egne kontoer', 'Other')).toBe('rgb(171, 205, 239)')
  })

  it('draws a dark Category lighter in Dark, in the same colour as the Dashboard draws it', async () => {
    localStorage.setItem('appearance', 'dark')
    categoriesServed = [{ ...categories[0], colour: '#104281' }, categories[1]]
    months = [{ year: 2026, month: 9 }]
    handleSpending = () => Response.json({ total: 120, slices: [{ categoryId: 1, amount: 120 }] })
    const user = userEvent.setup()
    await renderApp()
    const legendRow = await within(screen.getByRole('region', { name: 'Spending' })).findByRole('row', {
      name: /^Groceries/,
    })
    const onDashboard = (legendRow.querySelector('[aria-hidden="true"]') as HTMLElement).style.backgroundColor

    await user.click(screen.getByRole('button', { name: 'Rules' }))
    await screen.findByRole('cell', { name: 'kiwi' })

    const brightness = (colour: string) => colour.match(/\d+/g)!.reduce((sum, channel) => sum + Number(channel), 0)
    expect(brightness(categorySwatch('kiwi', 'Groceries'))).toBeGreaterThan(brightness('rgb(16, 66, 129)'))
    expect(categorySwatch('kiwi', 'Groceries')).toBe(onDashboard)
  })

  it('lists the rules by keyword in the Norwegian alphabet, whatever the browser language', async () => {
    // An English browser, which would put Å with A and Ø with O.
    const localeCompare = String.prototype.localeCompare
    const english = vi
      .spyOn(String.prototype, 'localeCompare')
      .mockImplementation(function (
        this: string,
        that: string,
        locales?: Intl.LocalesArgument,
        options?: Intl.CollatorOptions,
      ) {
        return localeCompare.call(this, that, locales ?? 'en', options)
      })
    onTestFinished(() => english.mockRestore())
    rules = [
      { id: 5, keyword: 'zara', categoryId: 1, aiGenerated: false, isNew: false },
      { id: 2, keyword: 'ørn', categoryId: 13, aiGenerated: false, isNew: false },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
      { id: 4, keyword: 'åpent', categoryId: 13, aiGenerated: false, isNew: false },
    ]
    const user = await openRulesPage()

    expect(keywords()).toEqual(['kiwi', 'zara', 'ørn', 'åpent'])

    await user.type(screen.getByLabelText('Keyword'), 'ark')
    await user.selectOptions(screen.getByLabelText('Category'), 'Groceries')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    await screen.findByRole('status')

    expect(keywords()).toEqual(['ark', 'kiwi', 'zara', 'ørn', 'åpent'])

    const row = await startEditingKiwi(user)
    await user.clear(row.getByLabelText('Keyword'))
    await user.type(row.getByLabelText('Keyword'), 'æble')
    await user.click(row.getByRole('button', { name: 'Save' }))
    await screen.findByRole('cell', { name: 'æble' })

    expect(keywords()).toEqual(['ark', 'zara', 'æble', 'ørn', 'åpent'])
  })

  it('stacks each rule as a phone shows its card: keyword and badges, then its Category, then its count, then its actions', async () => {
    rules = [{ id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: true, transactionCount: 4 }]
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'Rules' }))
    const card = await screen.findByRole('row', { name: /^café løkka/ })

    // On a phone the cells stack as a card in the order they come in.
    const [keyword, category, count, actions] = within(card).getAllByRole('cell')
    expect(keyword).toHaveTextContent('café løkka AI New')
    expect(within(category).getByRole('img', { name: 'Other colour' })).toBeInTheDocument()
    expect(category).toHaveTextContent('Other')
    // With the column headers hidden, the count says what it counts.
    expect(count).toHaveTextContent('4 transactions')
    expect(within(count).getByText('transactions')).not.toHaveClass('sr-only')
    expect(within(actions).getAllByRole('button').map((button) => button.textContent)).toEqual(['Keep', 'Edit', 'Delete'])

    // jsdom applies no media queries, so the phone layout is checked by its classes: the table, its
    // body and each row become blocks and a stacked card, with the column headers hidden.
    const table = screen.getByRole('table')
    const [head, body] = within(table).getAllByRole('rowgroup')
    expect(table).toHaveClass('max-sm:block')
    expect(head).toHaveClass('max-sm:hidden')
    expect(body).toHaveClass('max-sm:block')
    expect(card).toHaveClass('max-sm:flex', 'max-sm:flex-col')
    for (const cell of [keyword, category, count]) expect(cell).toHaveClass('max-sm:block')
    // Nothing on the page is wider than the screen or scrolls sideways.
    const page = screen.getByRole('heading', { name: 'Categorization Rules' }).closest('section')!
    expect(page.querySelector('[class*="overflow-x-auto"], [class*="min-w-"]:not([class*="min-w-0"])')).toBeNull()
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

  it('shows an AI badge next to the keyword of AI-generated rules only', async () => {
    rules = [
      { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: false },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
    ]
    await openRulesPage()

    expect(within(ruleRow('café løkka AI')).getByText('AI')).toBeInTheDocument()
    expect(within(ruleRow('kiwi')).queryByText('AI')).not.toBeInTheDocument()
  })

  it('can show only the AI-generated rules, however old, with the AI-generated chip', async () => {
    rules = [
      { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: false },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
      { id: 4, keyword: 'nille', categoryId: 13, aiGenerated: true, isNew: true },
      { id: 5, keyword: 'rema', categoryId: 1, aiGenerated: false, isNew: true },
    ]
    const user = await openRulesPage()
    const chip = screen.getByRole('button', { name: 'AI-generated' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')

    await user.click(chip)

    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(keywords()).toEqual(['café løkka AI', 'nille AI New'])

    await user.click(chip)

    expect(chip).toHaveAttribute('aria-pressed', 'false')
    expect(keywords()).toEqual(['café løkka AI', 'kiwi', 'nille AI New', 'rema New'])
  })

  it('shows a New badge on rules added by the last upload, and can show only those', async () => {
    rules = [
      { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: true },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
      { id: 4, keyword: 'nille', categoryId: 13, aiGenerated: false, isNew: true },
    ]
    const user = await openRulesPage()

    expect(keywords()).toEqual(['café løkka AI New', 'kiwi', 'nille New'])
    const chip = screen.getByRole('button', { name: 'New' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')

    await user.click(chip)

    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(keywords()).toEqual(['café løkka AI New', 'nille New'])

    await user.click(chip)

    expect(chip).toHaveAttribute('aria-pressed', 'false')
    expect(keywords()).toEqual(['café løkka AI New', 'kiwi', 'nille New'])
  })

  it('disables the New chip, saying why, when the last upload added no rules', async () => {
    await openRulesPage()

    const chip = screen.getByRole('button', { name: 'New' })
    expect(chip).toBeDisabled()
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    expect(chip).toHaveAttribute('title', 'The last upload added no rules')
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

  describe('keeping an AI-generated rule', () => {
    it('offers Keep on AI-generated rules only', async () => {
      rules = [
        { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: true },
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 4, keyword: 'nille', categoryId: 13, aiGenerated: false, isNew: true },
        { id: 5, keyword: 'rema', categoryId: 1, aiGenerated: true, isNew: false },
      ]
      await openRulesPage()

      expect(within(ruleRow('café løkka AI New')).getByRole('button', { name: 'Keep' })).toBeInTheDocument()
      expect(within(ruleRow('rema AI')).getByRole('button', { name: 'Keep' })).toBeInTheDocument()
      expect(within(ruleRow('kiwi')).queryByRole('button', { name: 'Keep' })).not.toBeInTheDocument()
      expect(within(ruleRow('nille New')).queryByRole('button', { name: 'Keep' })).not.toBeInTheDocument()
    })

    it('saves the rule unchanged in one click, after which it keeps its New badge but has no AI badge', async () => {
      rules = [
        { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: true, transactionCount: 4 },
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
      ]
      let edited: { id: number; body: unknown } | undefined
      handleEditRule = (id, body) => {
        edited = { id, body }
        return Response.json({ id, ...(body as object), aiGenerated: false, isNew: true, transactionCount: 4, transactionsChanged: 0 })
      }
      const user = await openRulesPage()

      await user.click(within(ruleRow('café løkka AI New')).getByRole('button', { name: 'Keep' }))

      expect(edited).toEqual({ id: 3, body: { keyword: 'café løkka', categoryId: 13 } })
      expect(await screen.findByRole('status')).toHaveTextContent('Rule kept.')
      expect(keywords()).toEqual(['café løkka New', 'kiwi'])
      expect(ruleRow('café løkka New')).toHaveTextContent('café løkka NewOther4 transactions')
      expect(within(ruleRow('café løkka New')).queryByRole('button', { name: 'Keep' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })

    it('drops a kept rule from the list while the AI-generated chip is on, leaving what is left to review', async () => {
      rules = [
        { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: true },
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 4, keyword: 'nille', categoryId: 13, aiGenerated: true, isNew: true },
      ]
      handleEditRule = (id, body) =>
        Response.json({ id, ...(body as object), aiGenerated: false, isNew: true, transactionCount: 0, transactionsChanged: 0 })
      const user = await openRulesPage()
      await user.click(screen.getByRole('button', { name: 'AI-generated' }))

      await user.click(within(ruleRow('café løkka AI New')).getByRole('button', { name: 'Keep' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Rule kept.')
      expect(keywords()).toEqual(['nille AI New'])
    })

    it('shows a general error when Keep cannot reach the server, leaving the rule AI-generated', async () => {
      rules = [
        { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: true },
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
      ]
      handleEditRule = () => {
        throw new TypeError('Failed to fetch')
      }
      const user = await openRulesPage()

      await user.click(within(ruleRow('café løkka AI New')).getByRole('button', { name: 'Keep' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.')
      expect(keywords()).toEqual(['café løkka AI New', 'kiwi'])
    })

    it("shows the server's error when the rule can't be kept as it is, as when its Category was deleted elsewhere", async () => {
      rules = [
        { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: true },
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
      ]
      handleEditRule = () => Response.json({ errors: { categoryId: ['Category does not exist.'] } }, { status: 400 })
      const user = await openRulesPage()

      await user.click(within(ruleRow('café løkka AI New')).getByRole('button', { name: 'Keep' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Category does not exist.')
      expect(keywords()).toEqual(['café løkka AI New', 'kiwi'])
    })
  })

  describe('searching', () => {
    it('narrows the rules to matching keywords as the search is typed, ignoring case and surrounding spaces', async () => {
      rules = [
        { id: 3, keyword: 'bøker og blader', categoryId: 13, aiGenerated: false, isNew: false },
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 4, keyword: 'rema 1000', categoryId: 1, aiGenerated: false, isNew: false },
      ]
      const user = await openRulesPage()
      const search = screen.getByRole('searchbox', { name: 'Search' })

      await user.type(search, 'e')
      expect(keywords()).toEqual(['bøker og blader', 'rema 1000'])
      await user.type(search, 'm')
      expect(keywords()).toEqual(['rema 1000'])

      await user.clear(search)
      await user.type(search, '  KIWI ')
      expect(keywords()).toEqual(['kiwi'])

      await user.clear(search)
      await user.type(search, 'boker')
      expect(screen.getByText('No rules match')).toBeInTheDocument()

      await user.clear(search)
      await user.type(search, 'groceries')
      expect(screen.queryByRole('cell', { name: 'kiwi' })).not.toBeInTheDocument()
      expect(screen.queryByRole('cell', { name: 'rema 1000' })).not.toBeInTheDocument()
    })

    it('leaves out a rule added with a keyword the search leaves out, still saying it was added', async () => {
      handleAddRule = () =>
        Response.json(
          { id: 3, keyword: 'rema', categoryId: 1, aiGenerated: false, isNew: false, transactionsChanged: 2 },
          { status: 201 },
        )
      const user = await openRulesPage()
      await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'kiwi')

      await user.type(screen.getByLabelText('Keyword'), 'rema')
      await user.selectOptions(screen.getByLabelText('Category'), 'Groceries')
      await user.click(screen.getByRole('button', { name: 'Add rule' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Rule added. 2 transactions changed category.')
      expect(keywords()).toEqual(['kiwi'])
    })

    it('shows only the new rules that match when the New chip is also on', async () => {
      rules = [
        { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: true },
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 5, keyword: 'kiwi minipris', categoryId: 1, aiGenerated: false, isNew: true },
      ]
      const user = await openRulesPage()

      await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'kiwi')
      await user.click(screen.getByRole('button', { name: 'New' }))

      expect(keywords()).toEqual(['kiwi minipris New'])
    })

    it('cancels an open edit once the search changes, even when the rule still matches', async () => {
      const user = await openRulesPage()

      const row = await startEditingKiwi(user)
      await user.type(row.getByLabelText('Keyword'), ' extra')
      await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'k')

      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      expect(ruleRow('kiwi')).toHaveTextContent('kiwiGroceries')
    })

    it('drops a rule from the list once it is saved with a keyword the search leaves out', async () => {
      rules = [
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 5, keyword: 'kiwi minipris', categoryId: 1, aiGenerated: false, isNew: false },
      ]
      handleEditRule = (id) =>
        Response.json({ id, keyword: 'meny', categoryId: 1, aiGenerated: false, isNew: false, transactionsChanged: 0 })
      const user = await openRulesPage()
      await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'kiwi')

      const row = await startEditingKiwi(user)
      await user.clear(row.getByLabelText('Keyword'))
      await user.type(row.getByLabelText('Keyword'), 'meny')
      await user.click(row.getByRole('button', { name: 'Save' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Rule updated. 0 transactions changed category.')
      expect(keywords()).toEqual(['kiwi minipris'])
    })

    it('says no rules match when the search leaves none', async () => {
      const user = await openRulesPage()

      await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'xyz')

      expect(screen.getByText('No rules match')).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })
  })

  describe('filtering', () => {
    it("narrows the rules to one Category's, and shows them all again with All categories", async () => {
      rules = [
        { id: 3, keyword: 'apotek', categoryId: 13, aiGenerated: false, isNew: false },
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 4, keyword: 'rema', categoryId: 1, aiGenerated: false, isNew: false },
      ]
      const user = await openRulesPage()
      const filter = screen.getByRole('combobox', { name: 'Filter by category' })

      expect(filter).toHaveDisplayValue('All categories')

      await user.selectOptions(filter, 'Groceries')
      expect(keywords()).toEqual(['kiwi', 'rema'])

      await user.selectOptions(filter, 'Other')
      expect(keywords()).toEqual(['apotek'])

      await user.selectOptions(filter, 'All categories')
      expect(keywords()).toEqual(['apotek', 'kiwi', 'rema'])
    })

    it('shows the rules that are both New and AI-generated with both chips on', async () => {
      rules = [
        { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: false },
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 4, keyword: 'nille', categoryId: 13, aiGenerated: true, isNew: true },
        { id: 5, keyword: 'rema', categoryId: 1, aiGenerated: false, isNew: true },
      ]
      const user = await openRulesPage()

      await user.click(screen.getByRole('button', { name: 'New' }))
      await user.click(screen.getByRole('button', { name: 'AI-generated' }))

      expect(keywords()).toEqual(['nille AI New'])
    })

    it('shows only the rules every filter lets through: search, Category and both chips', async () => {
      rules = [
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 2, keyword: 'kiwi butikk', categoryId: 1, aiGenerated: true, isNew: true },
        { id: 3, keyword: 'kiwi kafé', categoryId: 13, aiGenerated: true, isNew: true },
        { id: 4, keyword: 'kiwi pluss', categoryId: 1, aiGenerated: true, isNew: false },
        { id: 5, keyword: 'kiwi senter', categoryId: 1, aiGenerated: false, isNew: true },
        { id: 6, keyword: 'meny butikk', categoryId: 1, aiGenerated: true, isNew: true },
      ]
      const user = await openRulesPage()

      await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'kiwi')
      await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by category' }), 'Groceries')
      expect(keywords()).toEqual(['kiwi', 'kiwi butikk AI New', 'kiwi pluss AI', 'kiwi senter New'])

      await user.click(screen.getByRole('button', { name: 'New' }))
      expect(keywords()).toEqual(['kiwi butikk AI New', 'kiwi senter New'])

      await user.click(screen.getByRole('button', { name: 'AI-generated' }))
      expect(keywords()).toEqual(['kiwi butikk AI New'])
    })

    it('says no rules match when the Category filter or a chip leaves none', async () => {
      rules = [
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: false },
      ]
      const user = await openRulesPage()

      await user.click(screen.getByRole('button', { name: 'AI-generated' }))
      await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by category' }), 'Groceries')

      expect(screen.getByText('No rules match')).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'AI-generated' }))

      expect(keywords()).toEqual(['kiwi'])
    })

    it('cancels an open edit once the Category filter or a chip changes, even when the rule still shows', async () => {
      rules = [
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 2, keyword: 'kiwi butikk', categoryId: 1, aiGenerated: true, isNew: true },
      ]
      const user = await openRulesPage()

      // Each change leaves kiwi butikk in the list, so only the change itself closes the edit.
      for (const changeFilter of [
        () => user.selectOptions(screen.getByRole('combobox', { name: 'Filter by category' }), 'Groceries'),
        () => user.click(screen.getByRole('button', { name: 'New' })),
        () => user.click(screen.getByRole('button', { name: 'AI-generated' })),
      ]) {
        await user.click(within(ruleRow('kiwi butikk AI New')).getByRole('button', { name: 'Edit' }))
        const editing = within(screen.getByRole('button', { name: 'Save' }).closest('tr')!)
        await user.type(editing.getByLabelText('Keyword'), ' extra')

        await changeFilter()

        expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
        expect(ruleRow('kiwi butikk AI New')).toHaveTextContent('kiwi butikk AI NewGroceries')
      }
      expect(fetchMock).not.toHaveBeenCalledWith(expect.stringMatching(/\/2$/), expect.anything())
    })
  })

  describe('sorting', () => {
    // How each column heading says the table is sorted by it.
    function sortStates() {
      return Object.fromEntries(
        screen
          .getAllByRole('columnheader')
          .slice(0, 3)
          .map((header) => [header.textContent, header.getAttribute('aria-sort')]),
      )
    }

    // Clicks the column heading, rather than the page of the same name in the header.
    async function sortBy(user: ReturnType<typeof userEvent.setup>, heading: string) {
      await user.click(within(screen.getByRole('table')).getByRole('button', { name: heading }))
    }

    it('sorts by keyword A–Å by default, and Å–A once Keyword is clicked, and back again', async () => {
      rules = [
        { id: 5, keyword: 'zara', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 2, keyword: 'ørn', categoryId: 13, aiGenerated: false, isNew: false },
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 4, keyword: 'åpent', categoryId: 13, aiGenerated: false, isNew: false },
      ]
      const user = await openRulesPage()

      expect(keywords()).toEqual(['kiwi', 'zara', 'ørn', 'åpent'])
      expect(sortStates()).toEqual({ Keyword: 'ascending', Category: 'none', Transactions: 'none' })

      await sortBy(user, 'Keyword')

      expect(keywords()).toEqual(['åpent', 'ørn', 'zara', 'kiwi'])
      expect(sortStates()).toEqual({ Keyword: 'descending', Category: 'none', Transactions: 'none' })

      await sortBy(user, 'Keyword')

      expect(keywords()).toEqual(['kiwi', 'zara', 'ørn', 'åpent'])
      expect(sortStates()).toEqual({ Keyword: 'ascending', Category: 'none', Transactions: 'none' })
    })

    it('sorts by Category name in the Norwegian alphabet, either way, keeping keyword A–Å within a Category', async () => {
      categoriesServed = [...categories, { id: 20, name: 'Ørsta Sport' }]
      rules = [
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 2, keyword: 'anorakk', categoryId: 20, aiGenerated: false, isNew: false },
        { id: 3, keyword: 'zara', categoryId: 13, aiGenerated: false, isNew: false },
        { id: 4, keyword: 'bunnpris', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 5, keyword: 'apotek', categoryId: 13, aiGenerated: false, isNew: false },
      ]
      const user = await openRulesPage()

      await sortBy(user, 'Category')

      expect(keywords()).toEqual(['bunnpris', 'kiwi', 'apotek', 'zara', 'anorakk'])
      expect(sortStates()).toEqual({ Keyword: 'none', Category: 'ascending', Transactions: 'none' })

      await sortBy(user, 'Category')

      expect(keywords()).toEqual(['anorakk', 'apotek', 'zara', 'bunnpris', 'kiwi'])
      expect(sortStates()).toEqual({ Keyword: 'none', Category: 'descending', Transactions: 'none' })
    })

    it('sorts by Transactions count, lowest or highest first, keeping keyword A–Å between equal counts', async () => {
      rules = [
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false, transactionCount: 12 },
        { id: 2, keyword: 'rema', categoryId: 1, aiGenerated: false, isNew: false, transactionCount: 0 },
        { id: 3, keyword: 'zara', categoryId: 13, aiGenerated: false, isNew: false, transactionCount: 3 },
        { id: 4, keyword: 'apotek', categoryId: 13, aiGenerated: false, isNew: false, transactionCount: 0 },
        { id: 5, keyword: 'meny', categoryId: 1, aiGenerated: false, isNew: false, transactionCount: 120 },
      ]
      const user = await openRulesPage()

      await sortBy(user, 'Transactions')

      expect(keywords()).toEqual(['apotek', 'rema', 'zara', 'kiwi', 'meny'])
      expect(sortStates()).toEqual({ Keyword: 'none', Category: 'none', Transactions: 'ascending' })

      await sortBy(user, 'Transactions')

      expect(keywords()).toEqual(['meny', 'kiwi', 'zara', 'apotek', 'rema'])
      expect(sortStates()).toEqual({ Keyword: 'none', Category: 'none', Transactions: 'descending' })
    })

    it('places a rule added or edited where the current sort puts it, by the count it then has', async () => {
      const kiwi = { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false, transactionCount: 12 }
      const zara = { id: 2, keyword: 'zara', categoryId: 13, aiGenerated: false, isNew: false, transactionCount: 3 }
      const rema = { id: 3, keyword: 'rema', categoryId: 1, aiGenerated: false, isNew: false, transactionCount: 5 }
      const editedKiwi = { ...kiwi, categoryId: 13, transactionCount: 1 }
      rules = [kiwi, zara]
      handleAddRule = () => {
        rules = [kiwi, zara, rema]
        return Response.json({ ...rema, transactionsChanged: 5 }, { status: 201 })
      }
      handleEditRule = () => {
        rules = [editedKiwi, zara, rema]
        return Response.json({ ...editedKiwi, transactionsChanged: 0 })
      }
      const user = await openRulesPage()
      await sortBy(user, 'Transactions')
      await sortBy(user, 'Transactions')

      await user.type(screen.getByLabelText('Keyword'), 'rema')
      await user.selectOptions(screen.getByLabelText('Category'), 'Groceries')
      await user.click(screen.getByRole('button', { name: 'Add rule' }))
      await screen.findByRole('status')

      expect(keywords()).toEqual(['kiwi', 'rema', 'zara'])
      expect(within(ruleRow('rema')).getAllByRole('cell')[2]).toHaveTextContent('5 transactions')

      const row = await startEditingKiwi(user)
      await user.selectOptions(row.getByLabelText('Category'), 'Other')
      await user.click(row.getByRole('button', { name: 'Save' }))
      await screen.findByText('Rule updated. 0 transactions changed category.')

      expect(keywords()).toEqual(['rema', 'zara', 'kiwi'])
      expect(sortStates()).toEqual({ Keyword: 'none', Category: 'none', Transactions: 'descending' })
    })

    it('cancels an open edit once the sort changes', async () => {
      const user = await openRulesPage()

      const row = await startEditingKiwi(user)
      await user.type(row.getByLabelText('Keyword'), ' extra')
      await sortBy(user, 'Category')

      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      expect(ruleRow('kiwi')).toHaveTextContent('kiwiGroceries')
      expect(fetchMock).not.toHaveBeenCalledWith(expect.stringMatching(/\/1$/), expect.anything())
    })
  })

  describe('previewing an added rule', () => {
    type RulePreview = {
      changedCount: number
      lockedCount: number
      changes: {
        id: number
        date: string
        description: string
        amount: number
        fromCategoryId: number | null
        toCategoryId: number | null
      }[]
    }

    // What the add preview answers for a request, and every request it was asked.
    let handlePreview: (body: { keyword: string; categoryId: number }) => Response | Promise<Response>
    let asked: unknown[]

    const butikkSentrum = {
      id: 7,
      date: '2026-08-14',
      description: 'Butikk Sentrum',
      amount: -249.9,
      fromCategoryId: null,
      toCategoryId: 1,
    }
    const butikkKafe = {
      id: 5,
      date: '2026-08-03',
      description: 'Butikk Kafé',
      amount: -54,
      fromCategoryId: 13,
      toCategoryId: 1,
    }

    function answer(preview: RulePreview) {
      return Response.json(preview)
    }

    // The form asks only once typing has paused, so the tests move the clock on past that pause.
    async function afterThePause() {
      await act(() => vi.advanceTimersByTimeAsync(1_000))
    }

    function preview() {
      return screen.queryByRole('region', { name: 'Preview' })
    }

    function findPreview() {
      return screen.findByRole('region', { name: 'Preview' })
    }

    async function fillAddForm(user: ReturnType<typeof userEvent.setup>, keyword: string, category: string) {
      await user.type(screen.getByLabelText('Keyword'), keyword)
      await user.selectOptions(screen.getByLabelText('Category'), category)
    }

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      handlePreview = () => answer({ changedCount: 0, lockedCount: 0, changes: [] })
      asked = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          if (url !== '/api/categorization-rules/preview' || init?.method !== 'POST') return fetchMock(url, init)
          const body = JSON.parse(init.body as string) as { keyword: string; categoryId: number }
          asked.push(body)
          return handlePreview(body)
        }),
      )
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('says how many transactions adding the rule would change, and how many Locked ones it leaves, once typing pauses', async () => {
      handlePreview = () => answer({ changedCount: 14, lockedCount: 3, changes: [butikkSentrum, butikkKafe] })
      const user = await openRulesPage()

      await fillAddForm(user, '  butikk ', 'Groceries')
      await afterThePause()

      expect(await findPreview()).toHaveTextContent("Would change 14 transactions · 3 Locked won't change")
      expect(asked).toEqual([{ keyword: 'butikk', categoryId: 1 }])
    })

    it("expands into the transactions it would change, each with its date, description, Amount and old → new Category", async () => {
      handlePreview = () => answer({ changedCount: 2, lockedCount: 0, changes: [butikkSentrum, butikkKafe] })
      const user = await openRulesPage()
      await fillAddForm(user, 'butikk', 'Groceries')
      await afterThePause()
      const shown = within(await findPreview())
      expect(shown.getByText('Would change 2 transactions')).toBeInTheDocument()
      const toggle = shown.getByRole('button', { name: 'Show transactions' })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(shown.queryByRole('list')).not.toBeInTheDocument()

      await user.click(toggle)

      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      const items = shown.getAllByRole('listitem')
      expect(items.map((item) => item.textContent)).toEqual([
        '14.08.2026Butikk Sentrum-249,90 krUncategorized → Groceries',
        '03.08.2026Butikk Kafé-54,00 krOther → Groceries',
      ])

      await user.click(toggle)

      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(shown.queryByRole('list')).not.toBeInTheDocument()
    })

    it('says how many of the transactions it would change the list leaves out', async () => {
      const changes = Array.from({ length: 10 }, (_, i) => ({ ...butikkSentrum, id: 100 + i }))
      handlePreview = () => answer({ changedCount: 14, lockedCount: 0, changes })
      const user = await openRulesPage()
      await fillAddForm(user, 'butikk', 'Groceries')
      await afterThePause()
      const shown = within(await findPreview())

      await user.click(shown.getByRole('button', { name: 'Show transactions' }))

      expect(shown.getAllByRole('listitem')).toHaveLength(10)
      expect(shown.getByText('The 10 newest of 14.')).toBeInTheDocument()
    })

    it('says when adding the rule would change nothing', async () => {
      handlePreview = () => answer({ changedCount: 0, lockedCount: 0, changes: [] })
      const user = await openRulesPage()

      await fillAddForm(user, 'butikk', 'Groceries')
      await afterThePause()

      const shown = await findPreview()
      expect(shown).toHaveTextContent(/^Nothing would change$/)
      expect(within(shown).queryByRole('button')).not.toBeInTheDocument()
    })

    it("says when nothing would change but Locked transactions match", async () => {
      handlePreview = () => answer({ changedCount: 0, lockedCount: 1, changes: [] })
      const user = await openRulesPage()

      await fillAddForm(user, 'butikk', 'Groceries')
      await afterThePause()

      expect(await findPreview()).toHaveTextContent("Nothing would change · 1 Locked won't change")
    })

    it("asks nothing and shows no preview while the keyword is too short or another rule's, or no Category is chosen", async () => {
      handlePreview = () => answer({ changedCount: 1, lockedCount: 0, changes: [butikkSentrum] })
      const user = await openRulesPage()
      const keyword = screen.getByLabelText('Keyword')

      await user.type(keyword, 'butikk')
      await afterThePause()
      expect(asked).toEqual([])

      await user.clear(keyword)
      await fillAddForm(user, ' b ', 'Groceries')
      await afterThePause()
      expect(asked).toEqual([])

      // Another rule's keyword, ignoring case.
      await user.clear(keyword)
      await user.type(keyword, 'KIWI')
      await afterThePause()
      expect(asked).toEqual([])
      expect(preview()).not.toBeInTheDocument()
    })

    it("shows no preview when the server refuses the rule, and the server's field error only once it is saved", async () => {
      const refused = () => Response.json({ errors: { categoryId: ['Category does not exist.'] } }, { status: 400 })
      handlePreview = refused
      handleAddRule = refused
      const user = await openRulesPage()

      await fillAddForm(user, 'butikk', 'Groceries')
      await afterThePause()
      await waitFor(() => expect(asked).toHaveLength(1))

      expect(preview()).not.toBeInTheDocument()
      expect(screen.queryByText('Category does not exist.')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Add rule' }))

      expect(await screen.findByText('Category does not exist.')).toBeInTheDocument()
      expect(preview()).not.toBeInTheDocument()
    })

    it('shows no preview when it cannot be had', async () => {
      handlePreview = () => new Response(null, { status: 500 })
      const user = await openRulesPage()

      await fillAddForm(user, 'butikk', 'Groceries')
      await afterThePause()
      await waitFor(() => expect(asked).toHaveLength(1))

      expect(preview()).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('asks once typing pauses rather than at every keystroke, and follows the keyword and Category', async () => {
      handlePreview = ({ keyword, categoryId }) =>
        answer({ changedCount: keyword.length + categoryId, lockedCount: 0, changes: [] })
      const user = await openRulesPage()
      await user.selectOptions(screen.getByLabelText('Category'), 'Groceries')

      await user.type(screen.getByLabelText('Keyword'), 'butikk')
      await afterThePause()

      expect(await findPreview()).toHaveTextContent('Would change 7 transactions')
      expect(asked).toEqual([{ keyword: 'butikk', categoryId: 1 }])

      await user.type(screen.getByLabelText('Keyword'), ' sentrum')
      await afterThePause()

      await waitFor(() => expect(preview()).toHaveTextContent('Would change 15 transactions'))
      expect(asked).toEqual([
        { keyword: 'butikk', categoryId: 1 },
        { keyword: 'butikk sentrum', categoryId: 1 },
      ])

      await user.selectOptions(screen.getByLabelText('Category'), 'Other')
      await afterThePause()

      await waitFor(() => expect(preview()).toHaveTextContent('Would change 27 transactions'))
      expect(asked).toHaveLength(3)
    })

    it('ignores a reply that arrives after the keyword has changed', async () => {
      let answerLate: (response: Response) => void = () => {}
      handlePreview = ({ keyword }) =>
        keyword === 'rema'
          ? new Promise((resolve) => (answerLate = resolve))
          : answer({ changedCount: 2, lockedCount: 0, changes: [] })
      const user = await openRulesPage()

      await fillAddForm(user, 'rema', 'Groceries')
      await afterThePause()
      await user.type(screen.getByLabelText('Keyword'), ' 1000')
      await afterThePause()
      expect(await findPreview()).toHaveTextContent('Would change 2 transactions')
      await act(async () => answerLate(answer({ changedCount: 99, lockedCount: 0, changes: [] })))

      expect(preview()).toHaveTextContent('Would change 2 transactions')
      expect(asked).toEqual([
        { keyword: 'rema', categoryId: 1 },
        { keyword: 'rema 1000', categoryId: 1 },
      ])
    })

    it('ignores a reply that arrives after the keyword has become too short', async () => {
      let answerLate: (response: Response) => void = () => {}
      handlePreview = () => new Promise((resolve) => (answerLate = resolve))
      const user = await openRulesPage()

      await fillAddForm(user, 'rema', 'Groceries')
      await afterThePause()
      await waitFor(() => expect(asked).toHaveLength(1))
      await user.clear(screen.getByLabelText('Keyword'))
      await user.type(screen.getByLabelText('Keyword'), 'r')
      await act(async () => answerLate(answer({ changedCount: 99, lockedCount: 0, changes: [] })))
      await afterThePause()

      expect(preview()).not.toBeInTheDocument()
    })

    it('goes once the rule is added, with the same message after saving as without it', async () => {
      handlePreview = () => answer({ changedCount: 3, lockedCount: 0, changes: [] })
      handleAddRule = () =>
        Response.json(
          { id: 3, keyword: 'rema', categoryId: 1, aiGenerated: false, isNew: false, transactionCount: 3, transactionsChanged: 3 },
          { status: 201 },
        )
      const user = await openRulesPage()
      await fillAddForm(user, 'rema', 'Groceries')
      await afterThePause()
      await findPreview()

      await user.click(screen.getByRole('button', { name: 'Add rule' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Rule added. 3 transactions changed category.')
      expect(preview()).not.toBeInTheDocument()
      await afterThePause()
      expect(asked).toHaveLength(1)
    })
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

  describe('a kept Receipt', () => {
    // A manually-entered Transaction saved from a Receipt scan with its Receipt kept, one with a Note
    // and no Receipt, and one with neither.
    const keptReceiptTransactions = [
      {
        id: 31,
        date: '2026-09-18',
        description: 'Kiwi Bryggen',
        amount: -312.5,
        note: null,
        categoryId: 1,
        locked: true,
        imported: false,
        bookmarked: false,
        hasReceipt: true,
      },
      { ...septemberTransactions[0], note: 'Kontant', hasReceipt: false },
      { ...septemberTransactions[1], hasReceipt: false },
    ]

    async function openKeptReceiptMonth() {
      months = [{ year: 2026, month: 9 }]
      handleListPeriod = () => Response.json(keptReceiptTransactions)
      const user = await openTransactionsPage()
      await screen.findByRole('cell', { name: 'Kiwi Bryggen' })
      return user
    }

    // How a Note button's icon looks, which is what tells a lit button from a greyed-out one.
    function noteIconLook(name: string) {
      return screen.getByRole('button', { name }).querySelector('svg')!.getAttribute('class')
    }

    it('lights the Note button of a Transaction with a Receipt and no Note, keeping its label and having no tooltip', async () => {
      await openKeptReceiptMonth()

      const litLook = noteIconLook('Edit note for Rema 1000')
      expect(noteIconLook('Add note for Kiwi Bryggen')).toBe(litLook)
      expect(noteIconLook('Add note for Lønn Fra: Testfirma AS')).not.toBe(litLook)
      expect(screen.getByRole('button', { name: 'Add note for Kiwi Bryggen' })).not.toHaveAttribute('title')
    })

    it('shows the Receipt, served for that Transaction, in the Note editor only once it opens', async () => {
      const user = await openKeptReceiptMonth()
      expect(screen.queryByRole('img', { name: 'Receipt' })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Add note for Kiwi Bryggen' }))

      const thumbnail = screen.getByRole('button', { name: 'Show the Receipt full-screen' })
      expect(within(thumbnail).getByRole('img', { name: 'Receipt' })).toHaveAttribute('src', '/api/transactions/31/receipt')
      expect(screen.getByRole('textbox', { name: 'Note' })).toHaveAttribute('placeholder', 'Add a note…')
    })

    it('shows no Receipt in the Note editor of a Transaction without one', async () => {
      const user = await openKeptReceiptMonth()

      await user.click(screen.getByRole('button', { name: 'Edit note for Rema 1000' }))

      expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Kontant')
      expect(screen.queryByRole('img', { name: 'Receipt' })).not.toBeInTheDocument()
    })

    describe('full-screen', () => {
      function fullScreenView() {
        return screen.queryByRole('button', { name: 'Close the full-screen Receipt' })
      }

      it('opens on a click on the Receipt and closes on a click, leaving the Note editor with its draft', async () => {
        const user = await openKeptReceiptMonth()
        await user.click(screen.getByRole('button', { name: 'Add note for Kiwi Bryggen' }))
        await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Kontant')

        await user.click(screen.getByRole('button', { name: 'Show the Receipt full-screen' }))

        expect(within(fullScreenView()!).getByRole('img', { name: 'Receipt' })).toHaveAttribute(
          'src',
          '/api/transactions/31/receipt',
        )

        await user.click(fullScreenView()!)

        expect(fullScreenView()).not.toBeInTheDocument()
        expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Kontant')
      })

      it('closes on Escape, leaving the Note editor with its draft and focus back on the Receipt', async () => {
        const user = await openKeptReceiptMonth()
        await user.click(screen.getByRole('button', { name: 'Add note for Kiwi Bryggen' }))
        await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Kontant')
        await user.click(screen.getByRole('button', { name: 'Show the Receipt full-screen' }))

        await user.tab()
        expect(fullScreenView()).toHaveFocus()
        await user.keyboard('{Escape}')

        expect(fullScreenView()).not.toBeInTheDocument()
        expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Kontant')
        expect(screen.getByRole('button', { name: 'Show the Receipt full-screen' })).toHaveFocus()
      })
    })

    it('saves a first Note for a Transaction with a Receipt as before, keeping the button lit', async () => {
      const changes: { id: number; body: unknown }[] = []
      handleChangeNote = (id, body) => {
        changes.push({ id, body })
        return Response.json({ ...keptReceiptTransactions[0], ...(body as object) })
      }
      const user = await openKeptReceiptMonth()
      await user.click(screen.getByRole('button', { name: 'Add note for Kiwi Bryggen' }))
      await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Kontant')

      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(await screen.findByText('Note saved.')).toBeInTheDocument()
      expect(changes).toEqual([{ id: 31, body: { note: 'Kontant' } }])
      expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument()
      const button = screen.getByRole('button', { name: 'Edit note for Kiwi Bryggen' })
      expect(button).toHaveAttribute('title', 'Kontant')
      expect(noteIconLook('Edit note for Kiwi Bryggen')).toBe(noteIconLook('Edit note for Rema 1000'))
    })

    it('cancels the Note editor of a Transaction with a Receipt as before, saving nothing', async () => {
      const user = await openKeptReceiptMonth()
      await user.click(screen.getByRole('button', { name: 'Add note for Kiwi Bryggen' }))
      await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Kontant')

      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument()
      expect(screen.queryByRole('img', { name: 'Receipt' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add note for Kiwi Bryggen' })).not.toHaveAttribute('title')
      expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/note'))).toBe(false)
    })

    it('shows the Receipt in the Note editor in Bookmarks and in a Folder too', async () => {
      folders = [{ id: 21, name: 'Warranty' }]
      handleListBookmarks = () => Response.json([{ ...keptReceiptTransactions[0], bookmarked: true }])
      handleListFolderBookmarks = () =>
        Response.json([{ ...keptReceiptTransactions[0], id: 3, description: 'Power', bookmarked: true }])
      const user = await openKeptReceiptMonth()
      await user.click(within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: 'Bookmarks' }))
      await screen.findByRole('option', { name: 'Warranty' })

      await user.click(screen.getByRole('button', { name: 'Add note for Kiwi Bryggen' }))

      const thumbnail = screen.getByRole('button', { name: 'Show the Receipt full-screen' })
      expect(within(thumbnail).getByRole('img', { name: 'Receipt' })).toHaveAttribute('src', '/api/transactions/31/receipt')

      await user.selectOptions(screen.getByLabelText('Folder'), 'Warranty')
      await screen.findByRole('cell', { name: 'Power' })
      await user.click(screen.getByRole('button', { name: 'Add note for Power' }))

      const folderThumbnail = screen.getByRole('button', { name: 'Show the Receipt full-screen' })
      expect(within(folderThumbnail).getByRole('img', { name: 'Receipt' })).toHaveAttribute('src', '/api/transactions/3/receipt')
    })
  })

  describe('the Note button', () => {
    async function openSeptember() {
      months = [{ year: 2026, month: 9 }]
      handleListPeriod = () => Response.json(septemberTransactions)
      const user = await openTransactionsPage()
      await screen.findByRole('cell', { name: 'Rema 1000' })
      return user
    }

    it('closes its open Note editor when clicked again, discarding the draft and saving nothing', async () => {
      const user = await openSeptember()
      const button = screen.getByRole('button', { name: 'Add note for Rema 1000' })
      expect(button).toHaveAttribute('aria-expanded', 'false')

      await user.click(button)
      expect(button).toHaveAttribute('aria-expanded', 'true')
      await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Kontant')
      await user.click(button)

      expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument()
      expect(button).toHaveAttribute('aria-expanded', 'false')
      expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/note'))).toBe(false)

      await user.click(button)
      expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('')
    })

    it("opens another Transaction's Note editor in place of the open one", async () => {
      const user = await openSeptember()
      await user.click(screen.getByRole('button', { name: 'Add note for Rema 1000' }))

      await user.click(screen.getByRole('button', { name: 'Add note for Lønn Fra: Testfirma AS' }))

      expect(screen.getAllByRole('textbox', { name: 'Note' })).toHaveLength(1)
      expect(screen.getByRole('button', { name: 'Add note for Rema 1000' })).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByRole('button', { name: 'Add note for Lønn Fra: Testfirma AS' })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
    })

    it('is disabled while its Note saves, so the editor stays open until the save is done', async () => {
      let respond: (response: Response) => void = () => {}
      handleChangeNote = () => new Promise((resolve) => (respond = resolve))
      const user = await openSeptember()
      const button = screen.getByRole('button', { name: 'Add note for Rema 1000' })
      await user.click(button)
      await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Kontant')

      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(button).toBeDisabled()
      await user.click(button)
      expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument()

      respond(Response.json({ ...septemberTransactions[0], note: 'Kontant' }))
      expect(await screen.findByText('Note saved.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Edit note for Rema 1000' })).toBeEnabled()
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

describe("Transactions page from a Category's Transactions count", () => {
  const health = { id: 7, name: 'Health', description: 'Pharmacy etc.', builtIn: false, transactionCount: 0, ruleCount: 2 }

  // Groceries in 2026, Other last in 2024 and Uncategorized in 2025, while the latest month with
  // Transactions is in 2026.
  const transactions = [
    { id: 21, date: '2026-03-12', description: 'Rema 1000', categoryId: 1 },
    { id: 22, date: '2026-01-05', description: 'Kiwi', categoryId: 1 },
    { id: 23, date: '2025-11-20', description: 'Ukjent butikk', categoryId: null },
    { id: 24, date: '2024-05-08', description: 'Elkjøp', categoryId: 13 },
    { id: 25, date: '2023-02-14', description: 'Clas Ohlson', categoryId: 13 },
  ].map((t) => ({ ...t, amount: -100, note: null, locked: false, imported: true, bookmarked: false }))

  beforeEach(() => {
    categoriesServed = [categories[0], health, categories[1]]
    months = [
      { year: 2026, month: 3 },
      { year: 2026, month: 1 },
      { year: 2025, month: 11 },
      { year: 2024, month: 5 },
      { year: 2023, month: 2 },
    ]
    handleListPeriod = (year, month) =>
      Response.json(
        transactions.filter(
          (t) => monthOfDate(t.date).year === year && (month === undefined || monthOfDate(t.date).month === month),
        ),
      )
  })

  async function openCategoriesPage() {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'Categories' }))
    await screen.findByText('All groceries.')
    return user
  }

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

  it('links each nonzero count, and shows a zero count as plain text', async () => {
    await openCategoriesPage()

    expect(screen.getByRole('button', { name: 'Show transactions in Groceries (12)' })).toHaveTextContent('12')
    expect(screen.getByRole('button', { name: 'Show transactions in Other (1)' })).toHaveTextContent('1')
    const healthRow = screen.getByRole('row', { name: /Health/ })
    expect(within(healthRow).queryByRole('button', { name: /Show transactions/ })).not.toBeInTheDocument()
    expect(within(healthRow).getAllByRole('cell')[2]).toHaveTextContent('0')
  })

  it("opens Transactions filtered to the Category, on the latest year with its Transactions", async () => {
    const user = await openCategoriesPage()

    await user.click(screen.getByRole('button', { name: 'Show transactions in Groceries (12)' }))

    expect(await screen.findByRole('cell', { name: 'Rema 1000' })).toBeInTheDocument()
    expect(listedDescriptions()).toEqual(['Rema 1000', 'Kiwi'])
    expect(chosenFilters()).toEqual(['2026', 'All months', 'Groceries'])
    expect(screen.getByRole('button', { name: 'Transactions' })).toHaveAttribute('aria-current', 'page')
  })

  it("opens an earlier year than the latest with Transactions when that is the Category's latest, looking no further back", async () => {
    const user = await openCategoriesPage()

    await user.click(screen.getByRole('button', { name: 'Show transactions in Other (1)' }))

    expect(await screen.findByRole('cell', { name: 'Elkjøp' })).toBeInTheDocument()
    expect(listedDescriptions()).toEqual(['Elkjøp'])
    expect(chosenFilters()).toEqual(['2024', 'All months', 'Other'])
    expect(requestedPeriods()).not.toContain('/api/transactions?year=2023')
  })

  it('opens Transactions filtered to Uncategorized, on the latest year with Uncategorized Transactions, from the line under the list', async () => {
    uncategorizedCount = 1
    const user = await openCategoriesPage()

    await user.click(await screen.findByRole('button', { name: '1 transaction is Uncategorized' }))

    expect(await screen.findByRole('cell', { name: 'Ukjent butikk' })).toBeInTheDocument()
    expect(listedDescriptions()).toEqual(['Ukjent butikk'])
    expect(chosenFilters()).toEqual(['2025', 'All months', 'Uncategorized'])
    expect(requestedPeriods()).not.toContain('/api/transactions?year=2024')
    expect(screen.getByRole('button', { name: 'Transactions' })).toHaveAttribute('aria-current', 'page')
  })

  it('opens from the header on the latest month with all Categories, after following a count', async () => {
    const user = await openCategoriesPage()
    await user.click(screen.getByRole('button', { name: 'Show transactions in Other (1)' }))
    await screen.findByRole('cell', { name: 'Elkjøp' })

    await user.click(screen.getByRole('button', { name: 'Categories' }))
    await screen.findByText('All groceries.')
    await user.click(screen.getByRole('button', { name: 'Transactions' }))

    expect(await screen.findByRole('cell', { name: 'Rema 1000' })).toBeInTheDocument()
    expect(chosenFilters()).toEqual(['2026', 'March', 'All categories'])
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

  it('adds a Savings slice, counted in the total and percentages, while Include savings is on', async () => {
    categoriesServed = [...categories, { id: 12, name: 'Savings' }]
    months = [{ year: 2026, month: 9 }]
    handleSpending = (_year, _month, _quarter, includeSavings) =>
      Response.json(
        includeSavings
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
    const toggle = within(dashboard()).getByRole('checkbox', { name: 'Include savings' })
    expect(toggle).not.toBeChecked()

    await user.click(toggle)

    await waitFor(() =>
      expect(legendRows()).toEqual([
        ['Savings', '1 500,00 kr', '75,0 %'],
        ['Groceries', '500,00 kr', '25,0 %'],
      ]),
    )
    expect(centreTotal()).toBe('Total 2 000,00 kr')

    await user.click(toggle)

    await waitFor(() => expect(legendRows()).toEqual([['Groceries', '500,00 kr', '100,0 %']]))
    expect(centreTotal()).toBe('Total 500,00 kr')
    expect(requestedSpending()).toEqual([
      '/api/spending?year=2026&month=9',
      '/api/spending?year=2026&month=9&includeSavings=true',
      '/api/spending?year=2026&month=9',
    ])
  })

  it('shows an empty chart with a total of 0 and no hint when the Period has only Savings', async () => {
    categoriesServed = [...categories, { id: 12, name: 'Savings' }]
    months = [{ year: 2026, month: 9 }]
    handleSpending = (_year, _month, _quarter, includeSavings) =>
      Response.json(
        includeSavings
          ? { total: 1500, slices: [{ categoryId: 12, amount: 1500 }] }
          : { total: 0, slices: [] },
      )

    await renderApp()

    await waitFor(() => expect(centreTotal()).toBe('Total 0,00 kr'))
    expect(legendRows()).toEqual([])
    expect(within(dashboard()).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(dashboard()).queryByText(/savings/i, { ignore: 'label, option' })).toBeNull()
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

  it('keeps the Period and Include savings when reloading after an upload', async () => {
    months = [
      { year: 2026, month: 9 },
      { year: 2026, month: 8 },
    ]
    const user = userEvent.setup()
    await renderApp()
    await waitFor(() => expect(centreTotal()).toBe('Total 0,00 kr'))
    await user.selectOptions(screen.getByLabelText('Period'), 'August 2026')
    await user.click(within(dashboard()).getByRole('checkbox', { name: 'Include savings' }))
    handleSpending = () => Response.json(septemberSpending)

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    await waitFor(() => expect(centreTotal()).toBe('Total 1 570,50 kr'))
    expect(screen.getByLabelText('Period')).toHaveValue('2026-8')
    expect(within(dashboard()).getByRole('checkbox', { name: 'Include savings' })).toBeChecked()
    expect(requestedSpending().at(-1)).toBe('/api/spending?year=2026&month=8&includeSavings=true')
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
    it('keeps the Granularity, Period and Include savings, and fetches the Spending again', async () => {
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
      await user.click(within(dashboard()).getByRole('checkbox', { name: 'Include savings' }))
      await user.click(screen.getByRole('button', { name: 'Transactions' }))
      const requestsBefore = requestedSpending().length
      handleSpending = () => Response.json(septemberSpending)

      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

      await waitFor(() => expect(centreTotal()).toBe('Total 1 570,50 kr'))
      expect(within(dashboard()).getByLabelText('Granularity')).toHaveDisplayValue('Quarter')
      expect(screen.getByLabelText('Period')).toHaveValue('2026-Q1')
      expect(within(dashboard()).getByRole('checkbox', { name: 'Include savings' })).toBeChecked()
      expect(requestedSpending().slice(requestsBefore)).toEqual([
        '/api/spending?year=2026&quarter=1&includeSavings=true',
      ])
    })

    it('keeps the Granularity, Period and Include savings after a visit to the User page', async () => {
      months = [
        { year: 2026, month: 9 },
        { year: 2026, month: 3 },
      ]
      const user = userEvent.setup()
      await renderApp()
      await waitFor(() => expect(centreTotal()).toBe('Total 0,00 kr'))
      await user.selectOptions(within(dashboard()).getByLabelText('Granularity'), 'Quarter')
      await user.selectOptions(screen.getByLabelText('Period'), 'Q1 2026')
      await user.click(within(dashboard()).getByRole('checkbox', { name: 'Include savings' }))
      await user.click(screen.getByRole('button', { name: 'User' }))

      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

      expect(within(dashboard()).getByLabelText('Granularity')).toHaveDisplayValue('Quarter')
      expect(screen.getByLabelText('Period')).toHaveValue('2026-Q1')
      expect(within(dashboard()).getByRole('checkbox', { name: 'Include savings' })).toBeChecked()
      await waitFor(() =>
        expect(requestedSpending().at(-1)).toBe('/api/spending?year=2026&quarter=1&includeSavings=true'),
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
      await user.click(within(dashboard()).getByRole('checkbox', { name: 'Include savings' }))
      await user.click(screen.getByRole('button', { name: 'Transactions' }))
      months = [
        { year: 2026, month: 9 },
        { year: 2026, month: 8 },
      ]

      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

      await waitFor(() => expect(screen.getByLabelText('Period')).toHaveValue('2026-9'))
      expect(within(dashboard()).getByLabelText('Granularity')).toHaveDisplayValue('Month')
      expect(monthOptions()).toEqual(['September 2026', 'August 2026'])
      expect(within(dashboard()).getByRole('checkbox', { name: 'Include savings' })).toBeChecked()
      await waitFor(() =>
        expect(requestedSpending().at(-1)).toBe('/api/spending?year=2026&month=9&includeSavings=true'),
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

    it('keeps Include savings on when the Period or granularity changes', async () => {
      const user = await openDashboard()
      await user.click(within(dashboard()).getByRole('checkbox', { name: 'Include savings' }))

      await choosePeriod(user, 'April 2026')
      await chooseGranularity(user, 'Quarter')

      expect(within(dashboard()).getByRole('checkbox', { name: 'Include savings' })).toBeChecked()
      await waitFor(() =>
        expect(requestedSpending()).toEqual([
          '/api/spending?year=2026&month=9',
          '/api/spending?year=2026&month=9&includeSavings=true',
          '/api/spending?year=2026&month=4&includeSavings=true',
          '/api/spending?year=2026&quarter=2&includeSavings=true',
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

      // Waits for the trend, then chooses March to June 2025, and Groceries in place of Total.
      async function chooseView(user: ReturnType<typeof userEvent.setup>) {
        await waitFor(() => expect(trendTable()).toHaveLength(2))
        await user.selectOptions(within(trend()).getByLabelText('From'), '03.2025')
        await user.selectOptions(within(trend()).getByLabelText('To'), '06.2025')
        await waitFor(() => expect(trendTable()).toHaveLength(3))
        await user.click(within(trend()).getByRole('checkbox', { name: 'Total' }))
        await user.click(within(trend()).getByRole('checkbox', { name: 'Groceries' }))
      }

      it('keeps the Span and switched-on lines after a Transaction is added, and fetches the Spending again', async () => {
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
        expect(switchedOn()).toEqual(['Groceries'])
        expect(requestedMonthlySpending().slice(requestsBefore)).toEqual([
          '/api/spending/monthly?fromYear=2025&fromMonth=3&toYear=2025&toMonth=6',
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
          '/api/spending/monthly?fromYear=2025&fromMonth=3&toYear=2025&toMonth=6',
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
        expect(requestedMonthlySpending().at(-1)).toBe(
          '/api/spending/monthly?fromYear=2025&fromMonth=11&toYear=2026&toMonth=10',
        )
      })

      it('keeps the Granularity, Span and switched-on lines when coming back to the home view, and fetches the Spending again', async () => {
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
        expect(switchedOn()).toEqual(['Groceries'])
        expect(requestedMonthlySpending().slice(requestsBefore)).toEqual([
          '/api/spending/monthly?fromYear=2025&fromMonth=3&toYear=2025&toMonth=6',
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
        expect(switchedOn()).toEqual(['Groceries'])
        expect(requestedMonthlySpending().at(-1)).toBe(
          '/api/spending/monthly?fromYear=2025&fromMonth=1&toYear=2025&toMonth=5',
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

      // How bright a CSS colour is, as the sum of its red, green and blue.
      function brightness(colour: string) {
        return colour.match(/\d+/g)!.reduce((sum, channel) => sum + Number(channel), 0)
      }

      // The colours of the donut's slices, as CSS colours like the swatches.
      function sliceColours() {
        return [...dashboard().querySelectorAll('.recharts-pie-sector path')].map((sector) => {
          const swatch = document.createElement('span')
          swatch.style.backgroundColor = sector.getAttribute('fill')!
          return swatch.style.backgroundColor
        })
      }

      it('draws a dark Category lighter in Dark, in the same colour in the donut, its legend and the trend', async () => {
        localStorage.setItem('appearance', 'dark')
        categoriesServed = [{ ...categories[0], colour: '#104281' }, categories[1]]
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
        const groceries = rowSwatch(dashboard(), 'Groceries')
        expect(brightness(groceries)).toBeGreaterThan(brightness('rgb(16, 66, 129)'))
        expect(sliceColours()).toContain(groceries)
        for (const name of ['Other', 'Uncategorized', 'Groceries']) {
          expect(rowSwatch(trend(), name)).toBe(rowSwatch(dashboard(), name))
        }
        expect(brightness(rowSwatch(trend(), 'Total'))).toBeGreaterThan(brightness('rgb(30, 41, 59)'))
      })

      it('redraws the colours when the Appearance changes while the Dashboard is open', async () => {
        localStorage.setItem('appearance', 'system')
        const device = deviceSetting(false)
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
        expect(rowSwatch(dashboard(), 'Groceries')).toBe('rgb(42, 120, 214)')

        device.change(true)

        const groceries = rowSwatch(dashboard(), 'Groceries')
        expect(brightness(groceries)).toBeGreaterThan(brightness('rgb(42, 120, 214)'))
        expect(sliceColours()).toContain(groceries)
        expect(rowSwatch(trend(), 'Groceries')).toBe(groceries)
        expect(rowSwatch(trend(), 'Total')).not.toBe('rgb(30, 41, 59)')

        device.change(false)

        expect(rowSwatch(dashboard(), 'Groceries')).toBe('rgb(42, 120, 214)')
        expect(rowSwatch(trend(), 'Groceries')).toBe('rgb(42, 120, 214)')
        expect(rowSwatch(trend(), 'Total')).toBe('rgb(30, 41, 59)')
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
    })

    describe('Savings and Income', () => {
      // August and September 2026, with Groceries and Income in both, and Savings in September.
      beforeEach(() => {
        categoriesServed = [...categories, { id: 12, name: 'Savings' }, { id: 14, name: 'Income' }]
        months = [
          { year: 2026, month: 9 },
          { year: 2026, month: 8 },
        ]
        handleMonthlySpending = (from, to) =>
          Response.json(
            monthlySpending(
              from,
              to,
              {
                '2026-8': [{ categoryId: 1, amount: 400 }],
                '2026-9': [{ categoryId: 1, amount: 500 }],
              },
              {
                '2026-8': { income: { categoryId: 14, amount: 30000 } },
                '2026-9': { savings: { categoryId: 12, amount: 1500 }, income: { categoryId: 14, amount: 31000 } },
              },
            ),
          )
      })

      function toggle(name: string) {
        return within(trend()).getByRole('checkbox', { name }) as HTMLInputElement
      }

      it('lists Savings, then Income, after the Categories with Spending, switched off and never in Total', async () => {
        await renderApp()

        await waitFor(() =>
          expect(trendTable()).toEqual([
            ['', 'August 2026', 'September 2026', 'Change'],
            ['Total', '400,00 kr', '500,00 kr', '▲ +25,0 %'],
            ['Groceries', '400,00 kr', '500,00 kr', '▲ +25,0 %'],
            ['Savings', '0,00 kr', '1 500,00 kr', 'New'],
            ['Income', '30 000,00 kr', '31 000,00 kr', '▲ +3,3 %'],
          ]),
        )
        expect(toggle('Savings')).not.toBeChecked()
        expect(toggle('Income')).not.toBeChecked()
      })

      it('leaves out Savings and Income when they have no figure in the Span', async () => {
        handleMonthlySpending = (from, to) =>
          Response.json(monthlySpending(from, to, { '2026-9': [{ categoryId: 1, amount: 500 }] }))

        await renderApp()

        await waitFor(() => expect(trendTable().map(([name]) => name)).toEqual(['', 'Total', 'Groceries']))
      })

      it("has no Include savings of its own, and is left alone by the donut's", async () => {
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(trendTable()).toHaveLength(5))
        await waitFor(() => expect(requestedSpending()).toHaveLength(1))
        expect(within(trend()).queryByRole('checkbox', { name: 'Include savings' })).toBeNull()

        await user.click(within(dashboard()).getByRole('checkbox', { name: 'Include savings' }))

        await waitFor(() => expect(requestedSpending()).toHaveLength(2))
        expect(requestedSpending()[1]).toBe('/api/spending?year=2026&month=9&includeSavings=true')
        expect(trendTable()[1]).toEqual(['Total', '400,00 kr', '500,00 kr', '▲ +25,0 %'])
        expect(requestedMonthlySpending()).toEqual([
          '/api/spending/monthly?fromYear=2026&fromMonth=8&toYear=2026&toMonth=9',
        ])
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

  // The name of the file in each read-a-Receipt request, in the order they were sent.
  let readRequests: string[]
  // The antiforgery token sent with each read-a-Receipt request, in the order they were sent.
  let readTokens: (string | undefined)[]
  let handleReadReceipt: (body: FormData) => Response | Promise<Response>
  // The preview URLs released so far. Each is named after its Receipt's file.
  let releasedUrls: string[]
  // The picked files the browser can't decode.
  let undecodable: File[]
  // The Receipt and the antiforgery token sent with each create with a Receipt, in the order they
  // were sent. Its transaction field holds the JSON create's request, so handlePost answers both
  // creates, and only these tell them apart.
  let keptReceipts: File[]
  let keptTokens: (string | undefined)[]

  beforeEach(() => {
    readRequests = []
    readTokens = []
    keptReceipts = []
    keptTokens = []
    handleReadReceipt = () => Response.json(unavailable)
    releasedUrls = []
    undecodable = []
    // Each picked file is reduced to a JPEG named after it, so the tests can tell the two apart.
    vi.mocked(reduceReceipt).mockImplementation(async (file) =>
      undecodable.includes(file)
        ? { ok: false }
        : { ok: true, jpeg: new File([`reduced ${file.name}`], `reduced-${file.name}`, { type: 'image/jpeg' }) },
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/receipts/read' && init?.method === 'POST') {
          const body = init.body as FormData
          readRequests.push((body.get('file') as File).name)
          readTokens.push((init.headers as Record<string, string> | undefined)?.['X-CSRF-TOKEN'])
          return handleReadReceipt(body)
        }
        if (url === '/api/transactions/with-receipt' && init?.method === 'POST') {
          const body = init.body as FormData
          keptReceipts.push(body.get('receipt') as File)
          keptTokens.push((init.headers as Record<string, string> | undefined)?.['X-CSRF-TOKEN'])
          return handlePost(JSON.parse(body.get('transaction') as string))
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
    expect(within(dialog).getByRole('img', { name: 'Receipt' })).toHaveAttribute('src', 'blob:reduced-kiwi.jpg')
    expect(within(dialog).getByLabelText(/date/i)).toHaveValue(todayIsoDate())
    expect(within(dialog).getByLabelText(/description/i)).toHaveValue('')
    expect(within(dialog).getByLabelText(/^in$/i)).toHaveValue(null)
    expect(within(dialog).getByLabelText(/^out$/i)).toHaveValue(null)
    expect(within(dialog).getByLabelText(/^note$/i)).toHaveValue('')
    expect(within(dialog).getByLabelText(/category/i)).toHaveValue('')
  })

  it('moves the focus into the window when it opens', async () => {
    await scan([kiwi])

    expect(await screen.findByRole('dialog', { name: 'Receipt 1 of 1' })).toContainElement(
      document.activeElement as HTMLElement,
    )
  })

  it('sends every Receipt to be read at once, one request each, before any has been answered', async () => {
    handleReadReceipt = () => new Promise(() => {})

    await scan([kiwi, rema, narvesen])

    await waitFor(() => expect(readRequests).toEqual(['reduced-kiwi.jpg', 'reduced-rema.png', 'reduced-narvesen.webp']))
    expect(screen.getByRole('dialog', { name: 'Receipt 1 of 3' })).toBeInTheDocument()
  })

  it('sends the reduced Receipt to be read, as a JPEG, not the picked file', async () => {
    const sent: File[] = []
    handleReadReceipt = (body) => {
      sent.push(body.get('file') as File)
      return Response.json(unavailable)
    }

    await scan([rema])

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].type).toBe('image/jpeg')
    expect(await sent[0].text()).toBe('reduced rema.png')
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
    expect(within(dialog).getByRole('img', { name: 'Receipt' })).toHaveAttribute('src', 'blob:reduced-rema.png')
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
    expect(within(dialog).getByRole('img', { name: 'Receipt' })).toHaveAttribute('src', 'blob:reduced-kiwi.jpg')
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
    expect(releasedUrls).toEqual(['blob:reduced-kiwi.jpg'])

    await user.click(screen.getByRole('button', { name: 'Skip' }))

    expect(releasedUrls).toEqual(['blob:reduced-kiwi.jpg', 'blob:reduced-rema.png'])
  })

  it('rejects a pick of more than 10 files with only a message', async () => {
    const files = Array.from({ length: 11 }, (_, i) => receipt(`${i}.jpg`))

    await scan(files)

    expect(screen.getByRole('alert')).toHaveTextContent('Pick at most 10 receipts')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(readRequests).toEqual([])
  })

  it('leaves out a wrong-type and an over-25 MB file, naming each and why, and scans the rest', async () => {
    const pdf = receipt('faktura.pdf', 'application/pdf')
    const huge = receipt('stor.jpg', 'image/jpeg', 25 * 1024 * 1024 + 1)

    await scan([pdf, kiwi, huge, rema])

    const alert = await screen.findByRole('alert')
    expect([...alert.children].map((line) => line.textContent)).toEqual([
      'faktura.pdf: The file is not a JPEG, PNG, WebP or GIF image.',
      'stor.jpg: The file is larger than 25 MB.',
    ])
    expect(await screen.findByRole('dialog', { name: 'Receipt 1 of 2' })).toBeInTheDocument()
    await waitFor(() => expect(readRequests).toEqual(['reduced-kiwi.jpg', 'reduced-rema.png']))
  })

  it('scans a file between 10 and 25 MB, since it is reduced before it is sent', async () => {
    const large = receipt('stor.jpg', 'image/jpeg', 10 * 1024 * 1024 + 1)

    await scan([large])

    expect(await screen.findByRole('dialog', { name: 'Receipt 1 of 1' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(readRequests).toEqual(['reduced-stor.jpg']))
  })

  it("leaves out an image the browser can't decode with the type message, and scans the rest in pick order", async () => {
    const broken = receipt('ødelagt.jpg')
    undecodable = [broken]

    await scan([kiwi, broken, rema])

    expect(await screen.findByRole('alert')).toHaveTextContent('ødelagt.jpg: The file is not a JPEG, PNG, WebP or GIF image.')
    expect(await screen.findByRole('dialog', { name: 'Receipt 1 of 2' })).toBeInTheDocument()
    await waitFor(() => expect(readRequests).toEqual(['reduced-kiwi.jpg', 'reduced-rema.png']))
  })

  it('shows only the message when no picked image can be decoded', async () => {
    undecodable = [kiwi]

    await scan([kiwi])

    expect(await screen.findByRole('alert')).toHaveTextContent('kiwi.jpg: The file is not a JPEG, PNG, WebP or GIF image.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(readRequests).toEqual([])
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

  it('never starts the scan of a pick replaced while it was being reduced, even by a rejected pick', async () => {
    let finishReducing: () => void = () => {}
    vi.mocked(reduceReceipt).mockImplementationOnce(
      (file) =>
        new Promise((resolve) => {
          finishReducing = () => resolve({ ok: true, jpeg: file })
        }),
    )
    const user = await scan([kiwi])

    await user.upload(
      screen.getByLabelText(/^receipts$/i),
      Array.from({ length: 11 }, (_, i) => receipt(`${i}.jpg`)),
    )
    await act(async () => finishReducing())

    expect(screen.getByRole('alert')).toHaveTextContent('Pick at most 10 receipts')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(readRequests).toEqual([])
  })

  it('scans the same Receipts again when they are picked again', async () => {
    const user = await scanUntilFormIsReady([kiwi])
    await user.click(screen.getByRole('button', { name: 'Skip' }))

    await user.upload(screen.getByLabelText(/^receipts$/i), [kiwi])

    expect(screen.getByRole('dialog', { name: 'Receipt 1 of 1' })).toBeInTheDocument()
  })

  describe('keeping the Receipt', () => {
    function keepTheReceipt() {
      return within(screen.getByRole('dialog')).getByRole('checkbox', { name: 'Keep the receipt' })
    }

    it.each(['read', 'unreadable', 'unavailable', 'limitReached'])(
      'offers Keep the receipt, ticked, when the Receipt was answered %s',
      async (outcome) => {
        handleReadReceipt = () =>
          Response.json(
            outcome === 'read'
              ? { outcome, date: '2026-10-12', description: 'Kiwi', amount: -249.9, categoryId: 1 }
              : { ...unavailable, outcome },
          )

        await scanUntilFormIsReady([kiwi])

        expect(keepTheReceipt()).toBeChecked()
      },
    )

    it('starts every Receipt ticked, even after the one before was unticked', async () => {
      const user = await scanUntilFormIsReady([kiwi, rema, narvesen])
      await user.click(keepTheReceipt())
      expect(keepTheReceipt()).not.toBeChecked()

      await user.click(screen.getByRole('button', { name: 'Skip' }))
      await formIsReady('Receipt 2 of 3')
      expect(keepTheReceipt()).toBeChecked()

      await user.click(keepTheReceipt())
      await fillValidForm(user)
      await user.click(screen.getByRole('button', { name: /^save$/i }))
      await formIsReady('Receipt 3 of 3')
      expect(keepTheReceipt()).toBeChecked()
    })

    it('saves the Transaction with its reduced Receipt when ticked, in one create with the antiforgery token', async () => {
      const posted: unknown[] = []
      handlePost = (body) => {
        posted.push(body)
        return Response.json({ id: 1 }, { status: 201 })
      }
      const user = await scanUntilFormIsReady([rema])
      await fillValidForm(user)

      await user.click(screen.getByRole('button', { name: /^save$/i }))

      expect(posted).toEqual([
        { date: todayIsoDate(), description: 'Rema 1000', amount: -249.9, note: null, categoryId: 1 },
      ])
      expect(keptReceipts).toHaveLength(1)
      expect(keptReceipts[0].type).toBe('image/jpeg')
      expect(await keptReceipts[0].text()).toBe('reduced rema.png')
      expect(keptTokens).toEqual(['token-1'])
      expect(screen.getByRole('status')).toHaveTextContent('1 transaction saved')
    })

    it('saves only the Transaction, with the create Add transaction uses, when unticked', async () => {
      const posted: unknown[] = []
      handlePost = (body) => {
        posted.push(body)
        return Response.json({ id: 1 }, { status: 201 })
      }
      const user = await scanUntilFormIsReady([kiwi])
      await fillValidForm(user)
      await user.click(keepTheReceipt())

      await user.click(screen.getByRole('button', { name: /^save$/i }))

      expect(posted).toEqual([
        { date: todayIsoDate(), description: 'Rema 1000', amount: -249.9, note: null, categoryId: 1 },
      ])
      expect(keptReceipts).toEqual([])
      expect(screen.getByRole('status')).toHaveTextContent('1 transaction saved')
    })

    it('keeps nothing when the Receipt is skipped, ticked or not', async () => {
      const user = await scanUntilFormIsReady([kiwi])
      await fillValidForm(user)

      await user.click(screen.getByRole('button', { name: 'Skip' }))

      expect(keptReceipts).toEqual([])
      expect(screen.getByRole('status')).toHaveTextContent('No transactions saved')
    })

    it.each([true, false])('keeps the box as it was left after a refused Save, ticked: %s', async (ticked) => {
      handlePost = () => Response.json({ errors: { description: ['Description is required.'] } }, { status: 400 })
      const user = await scanUntilFormIsReady([kiwi, rema])
      await fillValidForm(user)
      if (!ticked) await user.click(keepTheReceipt())

      await user.click(screen.getByRole('button', { name: /^save$/i }))

      expect(await within(screen.getByRole('dialog')).findByText('Description is required.')).toBeInTheDocument()
      expect(screen.getByRole('dialog', { name: 'Receipt 1 of 2' })).toBeInTheDocument()
      if (ticked) expect(keepTheReceipt()).toBeChecked()
      else expect(keepTheReceipt()).not.toBeChecked()
    })

    it('shows a refused Receipt as an error for the whole form, keeping the input', async () => {
      handlePost = () => Response.json({ errors: { receipt: ['The Receipt is not a JPEG image.'] } }, { status: 400 })
      const user = await scanUntilFormIsReady([kiwi])
      await fillValidForm(user)

      await user.click(screen.getByRole('button', { name: /^save$/i }))

      const dialog = screen.getByRole('dialog', { name: 'Receipt 1 of 1' })
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('The Receipt is not a JPEG image.')
      expect(within(dialog).getByLabelText(/^out$/i)).toHaveValue(249.9)
      expect(keepTheReceipt()).toBeChecked()
    })
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
      answer({ 'reduced-kiwi.jpg': kiwiRead })

      await scanUntilFormIsReady([kiwi, rema])

      expect(within(dialog()).getByLabelText(/date/i)).toHaveValue('2026-10-12')
      expect(within(dialog()).getByLabelText(/description/i)).toHaveValue('Kiwi Majorstuen')
      expect(within(dialog()).getByLabelText(/^in$/i)).toHaveValue(null)
      expect(within(dialog()).getByLabelText(/^out$/i)).toHaveValue(249.9)
      expect(within(dialog()).getByLabelText(/^note$/i)).toHaveValue('')
      expect(within(dialog()).getByLabelText(/category/i)).toHaveValue('1')
    })

    it('fills a refund into In', async () => {
      answer({ 'reduced-rema.png': remaRefund })

      await scanUntilFormIsReady([rema])

      expect(within(dialog()).getByLabelText(/^in$/i)).toHaveValue(89)
      expect(within(dialog()).getByLabelText(/^out$/i)).toHaveValue(null)
    })

    it('shows Reading… with the image and a disabled form until a slow read finishes, then the suggested values', async () => {
      let respond: (response: Response) => void = () => {}
      handleReadReceipt = () => new Promise<Response>((resolve) => (respond = resolve))

      await scan([kiwi])

      expect(within(dialog()).getByText('Reading…')).toBeInTheDocument()
      expect(within(dialog()).getByRole('img', { name: 'Receipt' })).toHaveAttribute('src', 'blob:reduced-kiwi.jpg')
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
        (body.get('file') as File).name === 'reduced-kiwi.jpg' ? Response.json(kiwiRead) : new Promise(() => {})

      const user = await scanUntilFormIsReady([kiwi, rema])

      expect(within(dialog()).getByLabelText(/description/i)).toHaveValue('Kiwi Majorstuen')
      await user.click(screen.getByRole('button', { name: 'Skip' }))
      expect(screen.getByRole('dialog', { name: 'Receipt 2 of 2' })).toHaveTextContent('Reading…')
    })

    it("fills each Receipt's form with what was read on that Receipt", async () => {
      answer({ 'reduced-kiwi.jpg': kiwiRead, 'reduced-rema.png': remaRefund })
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
      answer({ 'reduced-kiwi.jpg': kiwiRead })
      const user = await scanUntilFormIsReady([kiwi])
      await user.clear(screen.getByLabelText(/description/i))
      await user.type(screen.getByLabelText(/description/i), 'Kiwi')

      await user.click(screen.getByRole('button', { name: /^save$/i }))

      expect(posted).toEqual([{ date: '2026-10-12', description: 'Kiwi', amount: -249.9, note: null, categoryId: 1 }])
    })

    it("says Couldn't read this receipt above an empty form with today's date when it couldn't be read", async () => {
      answer({ 'reduced-kiwi.jpg': unreadable })

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
      answer({ 'reduced-kiwi.jpg': { outcome: 'limitReached', date: null, description: null, amount: null, categoryId: null } })

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
      expect(within(dialog).getByRole('img', { name: 'Receipt' })).toHaveAttribute('src', 'blob:reduced-rema.png')
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
      expect(releasedUrls).toEqual(['blob:reduced-kiwi.jpg', 'blob:reduced-rema.png', 'blob:reduced-narvesen.webp'])
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
      expect(releasedUrls).toEqual(['blob:reduced-kiwi.jpg', 'blob:reduced-rema.png'])
    })

    it('asks on Escape too, and a second Escape keeps going with the Receipt as it was', async () => {
      const user = await scanUntilFormIsReady([kiwi, rema])
      await user.type(screen.getByLabelText(/description/i), 'Kiwi')

      await user.keyboard('{Escape}')
      expect(screen.getByRole('alertdialog', { name: 'Discard the remaining 2 receipts?' })).toBeInTheDocument()

      await user.keyboard('{Escape}')
      expect(confirmation()).not.toBeInTheDocument()
      const dialog = screen.getByRole('dialog', { name: 'Receipt 1 of 2' })
      expect(within(dialog).getByLabelText(/description/i)).toHaveValue('Kiwi')
      expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus()
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

      expect(within(fullScreenView()!).getByRole('img', { name: 'Receipt' })).toHaveAttribute('src', 'blob:reduced-kiwi.jpg')

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
      handleChangePassword = () => Response.json({ detail: locked }, { status: 429 })
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
      currentUser = guest
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
      currentUser = new Response(null, { status: 401 })
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
    bankStatements = [august, july]
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
    bankStatements = [august, july]
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
    bankStatements = [august, july]
    handleDeleteBankStatements = () => {
      bankStatements = [august]
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
    bankStatements = [july]
    await openUserPage()
    await bankStatementsToggle()

    expect(deleteSelected()).toBeDisabled()
    expect(deleteAllTransactions()).toBeInTheDocument()
  })

  it('lists the Bank Statements as served, with account number, period, import date and Transactions', async () => {
    bankStatements = [august, augustOfSavings, july]
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
    bankStatements = new Response(null, { status: 500 })
    await openUserPage()

    expect(await transactionsCard().findByRole('alert')).toHaveTextContent('Could not load the Bank Statements.')
    expect(transactionsCard().queryByRole('button', { name: /^Bank Statements/ })).not.toBeInTheDocument()
    expect(transactionsCard().queryByText('There are no Bank Statements.')).not.toBeInTheDocument()
  })

  it('keeps Delete selected disabled until a Bank Statement is ticked', async () => {
    bankStatements = [august, july]
    const user = await openBankStatementList()
    expect(deleteSelected()).toBeDisabled()

    await user.click(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ }))
    expect(deleteSelected()).toBeEnabled()

    await user.click(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ }))
    expect(deleteSelected()).toBeDisabled()
  })

  it('asks with the counts, then deletes the ticked Bank Statements, says so and lists those left', async () => {
    bankStatements = [august, augustOfSavings, july]
    let deleted: number[] | undefined
    handleDeleteBankStatements = ({ ids }) => {
      deleted = ids
      bankStatements = [july]
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
    bankStatements = [august, july]
    const user = await openBankStatementList()

    await user.click(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ }))
    await user.click(deleteSelected())

    expect(transactionsCard().getByText('Delete 1 Bank Statement and its 1 Transaction?')).toBeInTheDocument()
  })

  it('deletes nothing when the question is cancelled, keeping the ticks', async () => {
    bankStatements = [august, july]
    let deleted = false
    handleDeleteBankStatements = () => {
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
    bankStatements = [august, july]
    handleDeleteBankStatements = () => new Response(null, { status: 500 })
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
    bankStatements = [august, july]
    handleDeleteBankStatements = () => {
      // Deleted meanwhile in another browser, as by another visitor using the Guest.
      bankStatements = [august]
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
    bankStatements = [august, augustOfSavings]
    deleteCounts = { transactionCount: 1032 }
    let deleted = false
    handleDeleteAllTransactions = () => {
      deleted = true
      bankStatements = []
      deleteCounts = { transactionCount: 0 }
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
    deleteCounts = { transactionCount: 1 }
    handleDeleteAllTransactions = () => Response.json({ transactionsDeleted: 1 })
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
    bankStatements = [july]
    deleteCounts = { transactionCount: 1001 }
    handleDeleteBankStatements = () => {
      deleteCounts = new Response(null, { status: 500 })
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
    bankStatements = [august, july]
    deleteCounts = { transactionCount: 1001 }
    handleDeleteBankStatements = () => {
      bankStatements = [august]
      deleteCounts = { transactionCount: 1000 }
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
    bankStatements = [july]
    deleteCounts = { transactionCount: 1 }
    handleDeleteAllTransactions = () => new Response(null, { status: 500 })
    const user = await openBankStatementList()
    await waitFor(() => expect(deleteAllTransactions()).toBeEnabled())

    await user.click(deleteAllTransactions())
    await user.click(deleteData().getByRole('button', { name: 'Confirm delete' }))

    expect(await deleteData().findByRole('alert')).toHaveTextContent('Deleting failed (500).')
    expect(await listedBankStatements()).toHaveLength(1)
    expect(deleteAllTransactions()).toBeEnabled()
  })

  it('asks with the counts of rules and of the Transactions they categorized, then deletes them all and says how many', async () => {
    deleteCounts = { ruleCount: 1148, ruleCategorizedTransactionCount: 1310 }
    let deleted = false
    handleDeleteAllRules = () => {
      deleted = true
      deleteCounts = { ruleCount: 0, ruleCategorizedTransactionCount: 0 }
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
    deleteCounts = { ruleCount: 1, ruleCategorizedTransactionCount: 1 }
    handleDeleteAllRules = () => Response.json({ rulesDeleted: 1 })
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
    deleteCounts = { ruleCount: 2, ruleCategorizedTransactionCount: 0 }
    const user = await openUserPage()
    await waitFor(() => expect(deleteAllRules()).toBeEnabled())

    await user.click(deleteAllRules())

    // The whole question, with no sentence saying 0 will become Uncategorized.
    expect(deleteData().getByText('Delete all 2 Categorization Rules?')).toBeInTheDocument()
  })

  it('keeps Delete all Categorization Rules disabled after another delete until the rules are counted again', async () => {
    deleteCounts = { transactionCount: 5, ruleCount: 3, ruleCategorizedTransactionCount: 2 }
    let respond: (response: Response) => void = () => {}
    handleDeleteAllTransactions = () => {
      deleteCounts = new Promise((resolve) => (respond = resolve))
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
    deleteCounts = { transactionCount: 1 }
    await openUserPage()

    await waitFor(() => expect(deleteAllTransactions()).toBeEnabled())
    expect(deleteAllRules()).toBeDisabled()
  })

  it('keeps Delete all Categorization Rules disabled, saying so, when counting them fails', async () => {
    deleteCounts = new Response(null, { status: 500 })
    await openUserPage()

    expect(await deleteData().findByText('Could not count the Categorization Rules.')).toBeInTheDocument()
    expect(deleteAllRules()).toBeDisabled()
  })

  it('disables deleting while an Upload is in progress, saying why, and enables it once it finishes', async () => {
    bankStatements = [july]
    deleteCounts = { ruleCount: 148 }
    let respond: (response: Response) => void = () => {}
    handleUpload = () => new Promise((resolve) => (respond = resolve))
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
    bankStatements = [august, july]
    deleteCounts = { transactionCount: 1001, ruleCount: 148 }
    respond(Response.json(importedStatement, { status: 201 }))

    await waitFor(() => expect(deleteSelected()).toBeEnabled())
    await waitFor(() => expect(deleteAllTransactions()).toBeEnabled())
    await waitFor(() => expect(deleteAllRules()).toBeEnabled())
    expect(deleteData().queryByText('Deleting waits for the Upload in progress to finish.')).not.toBeInTheDocument()
    await waitFor(async () => expect(await listedBankStatements()).toHaveLength(2))
    expect(transactionsCard().getByRole('checkbox', { name: /01\.07\.2026/ })).toBeChecked()
  })

  it('shows what is left on the Dashboard and the Transactions page after a delete', async () => {
    bankStatements = [july]
    months = [{ year: 2026, month: 7 }]
    handleSpending = () => Response.json({ total: 250, slices: [{ categoryId: 1, amount: 250 }] })
    handleListPeriod = () =>
      Response.json([
        { id: 9, date: '2026-07-04', description: 'Rema 1000', amount: -250, categoryId: 1, note: null, locked: false, imported: true, bookmarked: false },
      ])
    handleDeleteBankStatements = () => {
      months = []
      handleSpending = () => Response.json({ total: 0, slices: [] })
      handleListPeriod = () => Response.json([])
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

  it('shows a wrong password under the field, keeping the dialog open and the User signed in', async () => {
    handleDeleteYourUser = () => Response.json({ errors: { password: ['Wrong password.'] } }, { status: 400 })
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
    handleDeleteYourUser = () => Response.json({ detail: locked }, { status: 429 })
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
    currentUser = guest
    await openUserPage()

    expect(deleteYourUser()).toBeDisabled()
  })

  it('is disabled while an Upload is in progress, and enabled once it finishes', async () => {
    let respond: (response: Response) => void = () => {}
    handleUpload = () => new Promise((resolve) => (respond = resolve))
    const user = userEvent.setup()
    await renderApp()
    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)
    await user.click(screen.getByRole('button', { name: 'User' }))

    expect(deleteYourUser()).toBeDisabled()

    respond(Response.json(importedStatement, { status: 201 }))
    await waitFor(() => expect(deleteYourUser()).toBeEnabled())
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
