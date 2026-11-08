// The fake API every App test runs against: what each endpoint serves, which a test changes through
// `api` to serve something else. Importing this module installs the fake for the test file, resetting
// it before each test.

import { afterEach, beforeEach, vi } from 'vitest'

export const categories = [
  {
    id: 1,
    name: 'Groceries',
    description: 'All groceries.',
    colour: '#2a78d6',
    builtIn: true,
    budget: 0,
    transactionCount: 12,
    ruleCount: 3,
  },
  {
    id: 13,
    name: 'Other',
    description: "Costs that don't belong in any other category.",
    colour: '#9085e9',
    builtIn: true,
    budget: 0,
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
export function monthlySpending(
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

// What the fake API serves. beforeEach sets each to the endpoint's usual answer.
export const api = {} as {
  handlePost: PostHandler
  handleUpload: UploadHandler
  // The User's Bank Statements as the list endpoint returns them, and the delete of a set of them.
  bankStatements: ListedBankStatement[] | Response
  handleDeleteBankStatements: (body: { ids: number[] }) => Response | Promise<Response>
  // The counts the User page's confirm dialogs ask with. Those a test leaves out are served as 0.
  deleteCounts:
    | Partial<{ transactionCount: number; ruleCount: number; ruleCategorizedTransactionCount: number }>
    | Response
    | Promise<Response>
  handleDeleteAllTransactions: () => Response | Promise<Response>
  handleDeleteAllRules: () => Response | Promise<Response>
  rules: { id: number; keyword: string; categoryId: number; aiGenerated: boolean; isNew: boolean }[] | Response
  handleAddRule: PostHandler
  handleAddCategory: PostHandler
  handleEditRule: (id: number, body: unknown) => Response
  handleDeleteRule: (id: number) => Response
  // The query holds the delete's choice, e.g. the replacement Category.
  handleDeleteCategory: (id: number, query: URLSearchParams) => Response
  handleEditCategory: (id: number, body: unknown) => Response | Promise<Response>
  months: { year: number; month: number }[] | Response
  // month is undefined for a whole year.
  handleListPeriod: (year: number, month: number | undefined) => Response | Promise<Response>
  handleChangeCategory: (id: number, body: unknown) => Response | Promise<Response>
  handleChangeNote: (id: number, body: unknown) => Response | Promise<Response>
  handleDeleteTransaction: (id: number) => Response | Promise<Response>
  handleAddBookmark: (id: number) => Response | Promise<Response>
  handleRemoveBookmark: (id: number) => Response | Promise<Response>
  handleFileBookmark: (id: number, body: unknown) => Response | Promise<Response>
  handleListBookmarks: () => Response | Promise<Response>
  // The bookmarks in one Folder, and the User's Folders as the folders endpoint lists them.
  handleListFolderBookmarks: (folderId: number) => Response | Promise<Response>
  folders: { id: number; name: string }[] | Response | Promise<Response>
  handleAddFolder: PostHandler
  handleRenameFolder: (id: number, body: unknown) => Response | Promise<Response>
  handleDeleteFolder: (id: number) => Response | Promise<Response>
  // What the categories endpoint returns: `categories` unless a test adds to it, makes it fail or keeps
  // it waiting.
  categoriesServed: ServedCategory[] | Response | Promise<Response>
  // Saving the Budgets. Unless a test says otherwise, it serves the Categories with the Budgets sent.
  handleSaveBudgets: (body: { categoryId: number; budget: number }[]) => Response | Promise<Response>
  // The colours a Category can be given, as the palette endpoint serves them: a few of the real ones.
  palette: string[] | Response
  // How many Transactions the Uncategorized count endpoint says are Uncategorized.
  uncategorizedCount: number | Response
  // The month or quarter is undefined when the Spending of a whole year, or of a quarter, is asked for.
  handleSpending: (year: number, month: number | undefined, quarter: number | undefined, includeSavings: boolean) => Response
  // The Spending of each month of the Span from `from` to `to`.
  handleMonthlySpending: (from: Month, to: Month) => Response
  // Who is signed in: signed in as a User unless a test signs out, or keeps the answer waiting.
  currentUser: { email: string; isGuest: boolean } | Response | Promise<Response>
  handleSignIn: PostHandler
  handleSignUp: PostHandler
  handleContinueAsGuest: () => Response
  handleSignOut: () => Response
  // Whether Password reset is available, meaning the server has an email sender: not unless a test
  // says so, as when developing locally.
  passwordResetAvailability: { available: boolean; linkHours: number } | Response
  handleRequestPasswordReset: PostHandler
  handleChooseNewPassword: PostHandler
  handleChangePassword: PostHandler
  handleDeleteYourUser: PostHandler
  // How many antiforgery tokens the server has given. Each is new: token-1, token-2 and so on.
  antiforgeryTokensGiven: number
}

export const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url === '/api/user') {
    return api.currentUser instanceof Response || api.currentUser instanceof Promise ? api.currentUser : Response.json(api.currentUser)
  }
  if (url === '/api/user/sign-in' && init?.method === 'POST') return api.handleSignIn(JSON.parse(init.body as string))
  if (url === '/api/user/sign-up' && init?.method === 'POST') return api.handleSignUp(JSON.parse(init.body as string))
  if (url === '/api/user/continue-as-guest' && init?.method === 'POST') return api.handleContinueAsGuest()
  if (url === '/api/user/sign-out' && init?.method === 'POST') return api.handleSignOut()
  if (url === '/api/user/password-reset/availability') {
    return api.passwordResetAvailability instanceof Response ? api.passwordResetAvailability : Response.json(api.passwordResetAvailability)
  }
  if (url === '/api/user/password-reset/request' && init?.method === 'POST') {
    return api.handleRequestPasswordReset(JSON.parse(init.body as string))
  }
  if (url === '/api/user/password-reset/new-password' && init?.method === 'POST') {
    return api.handleChooseNewPassword(JSON.parse(init.body as string))
  }
  if (url === '/api/user/change-password' && init?.method === 'POST') {
    return api.handleChangePassword(JSON.parse(init.body as string))
  }
  if (url === '/api/user/delete' && init?.method === 'POST') return api.handleDeleteYourUser(JSON.parse(init.body as string))
  if (url === '/api/antiforgery-token') return Response.json({ token: `token-${++api.antiforgeryTokensGiven}` })
  const monthlyUrl =
    /^\/api\/spending\/monthly\?fromYear=(\d+)&fromMonth=(\d+)&toYear=(\d+)&toMonth=(\d+)$/.exec(url)
  if (monthlyUrl) {
    const [, fromYear, fromMonth, toYear, toMonth] = monthlyUrl
    return api.handleMonthlySpending(
      { year: Number(fromYear), month: Number(fromMonth) },
      { year: Number(toYear), month: Number(toMonth) },
    )
  }
  const spendingUrl = /^\/api\/spending\?year=(\d+)(?:&quarter=(\d+))?(?:&month=(\d+))?(&includeSavings=true)?$/.exec(url)
  if (spendingUrl) {
    const [, year, quarter, month, savings] = spendingUrl
    return api.handleSpending(
      Number(year),
      month ? Number(month) : undefined,
      quarter ? Number(quarter) : undefined,
      savings !== undefined,
    )
  }
  const periodUrl = /^\/api\/transactions\?year=(\d+)(?:&month=(\d+))?$/.exec(url)
  if (periodUrl) return api.handleListPeriod(Number(periodUrl[1]), periodUrl[2] ? Number(periodUrl[2]) : undefined)
  const categoryUrl = /^\/api\/transactions\/(\d+)\/category$/.exec(url)
  if (categoryUrl && init?.method === 'PUT') {
    return api.handleChangeCategory(Number(categoryUrl[1]), JSON.parse(init.body as string))
  }
  const noteUrl = /^\/api\/transactions\/(\d+)\/note$/.exec(url)
  if (noteUrl && init?.method === 'PUT') return api.handleChangeNote(Number(noteUrl[1]), JSON.parse(init.body as string))
  const bookmarkUrl = /^\/api\/transactions\/(\d+)\/bookmark$/.exec(url)
  if (bookmarkUrl && init?.method === 'POST') return api.handleAddBookmark(Number(bookmarkUrl[1]))
  if (bookmarkUrl && init?.method === 'DELETE') return api.handleRemoveBookmark(Number(bookmarkUrl[1]))
  if (bookmarkUrl && init?.method === 'PUT') return api.handleFileBookmark(Number(bookmarkUrl[1]), JSON.parse(init.body as string))
  if (url === '/api/bookmarks') return api.handleListBookmarks()
  const folderBookmarksUrl = /^\/api\/bookmarks\?folderId=(\d+)$/.exec(url)
  if (folderBookmarksUrl) return api.handleListFolderBookmarks(Number(folderBookmarksUrl[1]))
  if (url === '/api/folders' && init?.method === 'POST') return api.handleAddFolder(JSON.parse(init.body as string))
  if (url === '/api/folders') {
    return api.folders instanceof Response || api.folders instanceof Promise ? api.folders : Response.json(api.folders)
  }
  const folderUrl = /^\/api\/folders\/(\d+)$/.exec(url)
  if (folderUrl && init?.method === 'PUT') return api.handleRenameFolder(Number(folderUrl[1]), JSON.parse(init.body as string))
  if (folderUrl && init?.method === 'DELETE') return api.handleDeleteFolder(Number(folderUrl[1]))
  const transactionUrl = /^\/api\/transactions\/(\d+)$/.exec(url)
  if (transactionUrl && init?.method === 'DELETE') return api.handleDeleteTransaction(Number(transactionUrl[1]))
  if (url === '/api/transactions' && init?.method === 'DELETE') return api.handleDeleteAllTransactions()
  if (url === '/api/user/delete-counts') {
    return api.deleteCounts instanceof Response || api.deleteCounts instanceof Promise
      ? api.deleteCounts
      : Response.json({ transactionCount: 0, ruleCount: 0, ruleCategorizedTransactionCount: 0, ...api.deleteCounts })
  }
  if (url === '/api/transactions/months') {
    return api.months instanceof Response ? api.months : Response.json(api.months)
  }
  const ruleUrl = /^\/api\/categorization-rules\/(\d+)$/.exec(url)
  if (ruleUrl && init?.method === 'PUT') {
    return api.handleEditRule(Number(ruleUrl[1]), JSON.parse(init.body as string))
  }
  if (ruleUrl && init?.method === 'DELETE') return api.handleDeleteRule(Number(ruleUrl[1]))
  if (url === '/api/categories/palette') return api.palette instanceof Response ? api.palette : Response.json(api.palette)
  if (url === '/api/categories/uncategorized-count') {
    return api.uncategorizedCount instanceof Response ? api.uncategorizedCount : Response.json({ count: api.uncategorizedCount })
  }
  const categoryUrlMatch = /^\/api\/categories\/(\d+)(?:\?(.*))?$/.exec(url)
  if (categoryUrlMatch && init?.method === 'PUT') {
    return api.handleEditCategory(Number(categoryUrlMatch[1]), JSON.parse(init.body as string))
  }
  if (categoryUrlMatch && init?.method === 'DELETE') {
    return api.handleDeleteCategory(Number(categoryUrlMatch[1]), new URLSearchParams(categoryUrlMatch[2]))
  }
  if (url === '/api/categories' && init?.method === 'POST') {
    return api.handleAddCategory(JSON.parse(init.body as string))
  }
  if (url === '/api/categories/budgets' && init?.method === 'PUT') {
    return api.handleSaveBudgets(JSON.parse(init.body as string))
  }
  if (url === '/api/categories') {
    return api.categoriesServed instanceof Response || api.categoriesServed instanceof Promise
      ? api.categoriesServed
      : Response.json(api.categoriesServed)
  }
  if (url === '/api/transactions' && init?.method === 'POST') {
    return api.handlePost(JSON.parse(init.body as string))
  }
  if (url === '/api/bank-statements' && init?.method === 'POST') {
    return api.handleUpload(init.body as FormData)
  }
  if (url === '/api/bank-statements') {
    return api.bankStatements instanceof Response ? api.bankStatements : Response.json(api.bankStatements)
  }
  if (url === '/api/bank-statements/delete' && init?.method === 'POST') {
    return api.handleDeleteBankStatements(JSON.parse(init.body as string))
  }
  if (url === '/api/categorization-rules' && init?.method === 'POST') {
    return api.handleAddRule(JSON.parse(init.body as string))
  }
  if (url === '/api/categorization-rules' && init?.method === 'DELETE') return api.handleDeleteAllRules()
  if (url === '/api/categorization-rules') {
    return api.rules instanceof Response ? api.rules : Response.json(api.rules)
  }
  return new Response(null, { status: 404 })
})

beforeEach(() => {
  api.handlePost = () => Response.json({ id: 1 }, { status: 201 })
  api.handleUpload = () => Response.json(importedStatement, { status: 201 })
  api.bankStatements = []
  api.handleDeleteBankStatements = ({ ids }) => Response.json({ bankStatementsDeleted: ids.length, transactionsDeleted: 0 })
  api.deleteCounts = { transactionCount: 0 }
  api.handleDeleteAllTransactions = () => Response.json({ transactionsDeleted: 0 })
  api.handleDeleteAllRules = () => Response.json({ rulesDeleted: 0 })
  api.rules = [
    { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
    { id: 2, keyword: 'overføring mellom egne kontoer', categoryId: 13, aiGenerated: false, isNew: false },
  ]
  api.handleAddRule = (body) =>
    Response.json(
      { id: 3, ...(body as object), aiGenerated: false, isNew: false, transactionsChanged: 0 },
      { status: 201 },
    )
  api.handleEditRule = (id, body) =>
    Response.json({ id, ...(body as object), aiGenerated: false, isNew: false, transactionsChanged: 0 })
  api.handleDeleteRule = () => Response.json({ transactionsChanged: 0 })
  api.handleDeleteCategory = () => Response.json({ transactionsChanged: 0 })
  api.handleEditCategory = (id, body) => {
    const category = categories.find((c) => c.id === id)
    return Response.json({ ...category, id, ...(body as object) })
  }
  api.handleAddCategory = (body) =>
    Response.json(
      { id: 20, ...(body as object), colour: '#0891b2', builtIn: false, transactionCount: 0, ruleCount: 0 },
      { status: 201 },
    )
  api.months = []
  api.handleListPeriod = () => Response.json([])
  api.handleChangeCategory = () => new Response(null, { status: 500 })
  api.handleChangeNote = () => new Response(null, { status: 500 })
  api.handleDeleteTransaction = () => new Response(null, { status: 204 })
  api.handleAddBookmark = () => Response.json({ folderId: null })
  api.handleRemoveBookmark = () => new Response(null, { status: 204 })
  api.handleFileBookmark = (_id, body) => Response.json(body)
  api.handleListBookmarks = () => Response.json([])
  api.handleListFolderBookmarks = () => Response.json([])
  api.folders = []
  api.handleAddFolder = (body) => Response.json({ id: 30, ...(body as object) }, { status: 201 })
  api.handleRenameFolder = (id, body) => Response.json({ id, ...(body as object) })
  api.handleDeleteFolder = () => new Response(null, { status: 204 })
  api.handleSpending = () => Response.json({ total: 0, slices: [] })
  api.handleMonthlySpending = (from, to) => Response.json(monthlySpending(from, to))
  api.categoriesServed = categories
  api.handleSaveBudgets = (body) => {
    const served = Array.isArray(api.categoriesServed) ? api.categoriesServed : categories
    return Response.json(
      served.map((c) => ({ ...c, budget: body.find((b) => b.categoryId === c.id)?.budget ?? c.budget })),
    )
  }
  api.palette = ['#2a78d6', '#eb6834', '#9085e9', '#1baf7a']
  api.uncategorizedCount = 0
  api.currentUser = { email: 'me@example.com', isGuest: false }
  api.handleSignIn = (body) => Response.json({ email: (body as { email: string }).email, isGuest: false })
  api.handleSignUp = (body) => Response.json({ email: (body as { email: string }).email, isGuest: false })
  api.handleContinueAsGuest = () => Response.json(guest)
  api.handleSignOut = () => new Response(null, { status: 204 })
  api.antiforgeryTokensGiven = 0
  api.passwordResetAvailability = { available: false, linkHours: 1 }
  api.handleRequestPasswordReset = () => new Response(null, { status: 204 })
  api.handleChooseNewPassword = (body) => Response.json({ email: (body as { email: string }).email, isGuest: false })
  api.handleChangePassword = () => new Response(null, { status: 204 })
  api.handleDeleteYourUser = () => new Response(null, { status: 204 })
  vi.stubGlobal('fetch', fetchMock)
  // The tab title index.html gives the page before the app loads, so each test starts as a fresh tab,
  // whatever page the last one left named.
  document.title = 'PersonligFinans'
})

afterEach(() => {
  fetchMock.mockClear()
  vi.unstubAllGlobals()
  // The Appearance picked is remembered in the browser, so each test starts as a fresh browser.
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  // Each page has its own address, so each test starts at the Dashboard's, whichever page the last
  // one was left on.
  window.history.replaceState(null, '', '/')
})

export const importedStatement = {
  id: 7,
  accountNumber: '1111.22.33333',
  periodStart: '2026-08-01',
  periodEnd: '2026-08-31',
  transactionCount: 38,
  uncategorizedCount: 7,
  aiCategorizationUnavailable: false,
  dailyAiLimitReached: false,
}

// The Guest as the API reports it.
export const guest = { email: 'guest@personligfinans.invalid', isGuest: true }
