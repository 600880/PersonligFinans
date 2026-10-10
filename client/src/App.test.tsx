import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { todayIsoDate } from './lib/date'

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
let rules: { id: number; keyword: string; categoryId: number; aiGenerated: boolean }[] | Response
let handleAddRule: PostHandler
let handleAddCategory: PostHandler
let handleEditRule: (id: number, body: unknown) => Response
let handleDeleteRule: (id: number) => Response
// The query holds the delete's choice, e.g. the replacement Category.
let handleDeleteCategory: (id: number, query: URLSearchParams) => Response
let handleEditCategory: (id: number, body: unknown) => Response | Promise<Response>
let months: { year: number; month: number }[] | Response
let handleListMonth: (year: number, month: number) => Response
let handleChangeCategory: (id: number, body: unknown) => Response | Promise<Response>
// What the categories endpoint returns: `categories` unless a test adds to it or makes it fail.
let categoriesServed: ServedCategory[] | Response
// The month or quarter is undefined when the Spending of a whole year, or of a quarter, is asked for.
let handleSpending: (year: number, month: number | undefined, quarter: number | undefined, includeTransfers: boolean) => Response
// The Spending of each month of the Span from `from` to `to`.
let handleMonthlySpending: (from: Month, to: Month, includeTransfers: boolean) => Response
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
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
  const monthUrl = /^\/api\/transactions\?year=(\d+)&month=(\d+)$/.exec(url)
  if (monthUrl) return handleListMonth(Number(monthUrl[1]), Number(monthUrl[2]))
  const categoryUrl = /^\/api\/transactions\/(\d+)\/category$/.exec(url)
  if (categoryUrl && init?.method === 'PUT') {
    return handleChangeCategory(Number(categoryUrl[1]), JSON.parse(init.body as string))
  }
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
    { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false },
    { id: 2, keyword: 'overføring mellom egne kontoer', categoryId: 13, aiGenerated: false },
  ]
  handleAddRule = (body) =>
    Response.json({ id: 3, ...(body as object), aiGenerated: false, transactionsChanged: 0 }, { status: 201 })
  handleEditRule = (id, body) =>
    Response.json({ id, ...(body as object), aiGenerated: false, transactionsChanged: 0 })
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
  handleListMonth = () => Response.json([])
  handleChangeCategory = () => new Response(null, { status: 500 })
  handleSpending = () => Response.json({ total: 0, slices: [] })
  handleMonthlySpending = (from, to) => Response.json(monthlySpending(from, to))
  categoriesServed = categories
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
}

const statementPdf = new File(['%PDF-1.7'], 'kontoutskrift.pdf', { type: 'application/pdf' })

async function openModal() {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: /add transaction/i }))
  await screen.findByRole('option', { name: 'Groceries' })
  return user
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/description/i), 'Rema 1000')
  await user.type(screen.getByLabelText(/^out$/i), '249.90')
  await user.selectOptions(screen.getByLabelText(/category/i), 'Groceries')
}

describe('App', () => {
  it('shows the Add transaction button with no modal open', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /add transaction/i })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the modal with empty fields and no category chosen', async () => {
    await openModal()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText(/date/i)).toHaveValue(todayIsoDate())
    expect(screen.getByLabelText(/description/i)).toHaveValue('')
    expect(screen.getByLabelText(/^in$/i)).toHaveValue(null)
    expect(screen.getByLabelText(/^out$/i)).toHaveValue(null)
    expect(screen.getByLabelText(/reference/i)).toHaveValue('')
    expect(screen.getByLabelText(/category/i)).toHaveValue('')
  })

  it('offers the categories loaded from the API', async () => {
    await openModal()

    const options = within(screen.getByRole('dialog'))
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toEqual(['Choose…', 'Groceries', 'Other'])
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
      reference: null,
      categoryId: 1,
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Transaction saved')
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

    await user.click(screen.getByRole('button', { name: /add transaction/i }))
    expect(screen.getByLabelText(/description/i)).toHaveValue('')
  })

  it('shows Upload transactions to the left of Add transaction', () => {
    render(<App />)

    const buttons = within(screen.getByRole('main'))
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(buttons).toEqual(['Upload transactions', 'Add transaction'])
  })

  it('uploads the chosen PDF and shows how many transactions were imported and categorized', async () => {
    let uploaded: FormData | undefined
    handleUpload = (body) => {
      uploaded = body
      return Response.json(importedStatement, { status: 201 })
    }
    const user = userEvent.setup()
    render(<App />)

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
    render(<App />)

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(
      'Imported 38 transactions from statement 01.08.2026–31.08.2026: 31 categorized, 7 Uncategorized',
    )
    expect(status).toHaveTextContent('AI categorization unavailable — 7 rows left Uncategorized')
  })

  it('only accepts PDF files', () => {
    render(<App />)

    expect(screen.getByLabelText(/bank statement pdf/i)).toHaveAttribute('accept', 'application/pdf')
  })

  it('shows a disabled Categorizing… (0/1) button with a spinner while a single upload is in progress', async () => {
    let respond: (response: Response) => void = () => {}
    handleUpload = () => new Promise((resolve) => (respond = resolve))
    const user = userEvent.setup()
    render(<App />)

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    const button = screen.getByRole('button', { name: 'Categorizing… (0/1)' })
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
    render(<App />)

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [julyPdf, statementPdf, septemberPdf])

    const button = screen.getByRole('button', { name: 'Categorizing… (0/3)' })
    expect(button).toBeDisabled()
    expect(uploaded).toEqual([julyPdf])

    responders[0](Response.json(importedStatement, { status: 201 }))
    expect(await screen.findByRole('button', { name: 'Categorizing… (1/3)' })).toBeDisabled()
    await waitFor(() => expect(uploaded).toEqual([julyPdf, statementPdf]))

    responders[1](Response.json(importedStatement, { status: 201 }))
    expect(await screen.findByRole('button', { name: 'Categorizing… (2/3)' })).toBeDisabled()
    await waitFor(() => expect(uploaded).toEqual([julyPdf, statementPdf, septemberPdf]))

    responders[2](Response.json(importedStatement, { status: 201 }))
    expect(await screen.findByRole('button', { name: /upload transactions/i })).toBeEnabled()
  })

  it('reloads the Dashboard after each imported statement, while the rest are still uploading', async () => {
    const responders: ((response: Response) => void)[] = []
    handleUpload = () => new Promise((resolve) => responders.push(resolve))
    const monthsRequests = () => fetchMock.mock.calls.filter(([url]) => url === '/api/transactions/months').length
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(monthsRequests()).toBe(1))

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [statementPdf, statementPdf])
    responders[0](Response.json(importedStatement, { status: 201 }))

    await waitFor(() => expect(monthsRequests()).toBe(2))
    expect(screen.getByRole('button', { name: 'Categorizing… (1/2)' })).toBeDisabled()

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
    render(<App />)

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
    render(<App />)

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [statementPdf, statementPdf])

    expect(await screen.findByRole('status')).toHaveTextContent(
      /AI categorization unavailable for 1 Bank Statement$/,
    )
  })

  it('says nothing about AI categorization when it was available for every imported statement', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [statementPdf, statementPdf])

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Imported 2 Bank Statements, 76 transactions: 62 categorized, 14 Uncategorized')
    expect(status).not.toHaveTextContent('AI categorization')
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
    render(<App />)

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [julyPdf, scanPdf, septemberPdf])
    responders[0](Response.json(importedStatement, { status: 201 }))
    await waitFor(() => expect(responders).toHaveLength(2))
    responders[1](Response.json({ errors: { file: ['The PDF could not be read. It may be damaged.'] } }, { status: 400 }))

    expect(await screen.findByRole('button', { name: 'Categorizing… (2/3)' })).toBeDisabled()
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
    render(<App />)

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
    render(<App />)

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
    render(<App />)

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
    render(<App />)

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
    render(<App />)

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    expect(await screen.findByRole('alert')).toHaveTextContent('kontoutskrift.pdf: Could not reach the server.')
    expect(screen.getByRole('button', { name: /upload transactions/i })).toBeEnabled()
  })

  it('clears an upload error once a later upload succeeds', async () => {
    handleUpload = () => new Response(null, { status: 500 })
    const user = userEvent.setup()
    render(<App />)
    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)
    expect(await screen.findByRole('alert')).toHaveTextContent('kontoutskrift.pdf: Upload failed (500).')

    handleUpload = () => Response.json(importedStatement, { status: 201 })
    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Imported 38 transactions from statement 01.08.2026–31.08.2026',
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Categories page', () => {
  async function openCategoriesPage() {
    const user = userEvent.setup()
    render(<App />)
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

    it('offers delete only on Categories that are not Built-in', async () => {
      categoriesServed = [categories[0], health, categories[1]]
      await openCategoriesPage()
      await listedRows()

      expect(within(categoryRow('Health')).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
      expect(within(categoryRow('Groceries')).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
      expect(within(categoryRow('Other')).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
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
    render(<App />)
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
        { id: 3, keyword: 'rema', categoryId: 1, aiGenerated: false, transactionsChanged: 3 },
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
    render(<App />)

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
      { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false },
    ]
    await openRulesPage()

    expect(within(ruleRow('café løkka AI')).getByText('AI')).toBeInTheDocument()
    expect(within(ruleRow('kiwi')).queryByText('AI')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'AI only' })).not.toBeInTheDocument()
  })

  it('drops the AI badge once an AI-generated rule is saved, even unchanged', async () => {
    rules = [
      { id: 3, keyword: 'bakeriet', categoryId: 13, aiGenerated: true },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false },
      { id: 4, keyword: 'nille', categoryId: 13, aiGenerated: true },
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

  it('shows Transactions, Categories then Rules, with no Back button', () => {
    render(<App />)

    expect(navItems().map((item) => item.textContent)).toEqual(['Transactions', 'Categories', 'Rules'])
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })

  it('highlights the page being shown', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(currentPage()).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Transactions' }))
    expect(currentPage()).toEqual(['Transactions'])

    await user.click(screen.getByRole('button', { name: 'Categories' }))
    expect(currentPage()).toEqual(['Categories'])

    await user.click(screen.getByRole('button', { name: 'Rules' }))
    expect(currentPage()).toEqual(['Rules'])
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })

  it('goes to the home page when the app name is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Rules' }))

    await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

    expect(screen.getByRole('button', { name: /add transaction/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /upload transactions/i })).toBeInTheDocument()
    expect(currentPage()).toEqual([])
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
      reference: null,
      categoryId: 1,
      aiPlacedInOther: false,
    },
    {
      id: 4,
      date: '2026-09-03',
      description: 'Lønn Fra: Testfirma AS',
      amount: 24500,
      reference: null,
      categoryId: null,
      aiPlacedInOther: false,
    },
  ]

  // A month with a Transaction AI-placed in Other, one the user put in Other, and one in another Category.
  const aiPlacedTransactions = [
    septemberTransactions[0],
    {
      id: 8,
      date: '2026-09-20',
      description: 'Vipps *Ola Nordmann',
      amount: -200,
      reference: null,
      categoryId: 13,
      aiPlacedInOther: true,
    },
    {
      id: 7,
      date: '2026-09-12',
      description: 'Gave',
      amount: -500,
      reference: null,
      categoryId: 13,
      aiPlacedInOther: false,
    },
  ]

  async function openTransactionsPage() {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Transactions' }))
    return user
  }

  function requestedMonths() {
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
    handleListMonth = () => Response.json(septemberTransactions)
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
    handleListMonth = (year, month) =>
      Response.json(year === 2026 && month === 9 ? septemberTransactions : [])

    await openTransactionsPage()

    await screen.findByRole('cell', { name: 'Rema 1000' })
    expect(screen.getByLabelText('Year')).toHaveValue('2026')
    expect(screen.getByLabelText('Month')).toHaveValue('9')
    expect(requestedMonths()).toEqual(['/api/transactions?year=2026&month=9'])
  })

  it('shows the date, Description, Category or Uncategorized, and the Amount in NOK', async () => {
    months = [{ year: 2026, month: 9 }]
    handleListMonth = () => Response.json(septemberTransactions)

    await openTransactionsPage()

    await screen.findByRole('cell', { name: 'Rema 1000' })
    expect(rowCells()).toEqual([
      ['24.09.2026', 'Rema 1000', 'Groceries', '-1\u00a0249,90\u00a0kr'],
      ['03.09.2026', 'Lønn Fra: Testfirma AS', 'Uncategorized', '24\u00a0500,00\u00a0kr'],
    ])
  })

  it('offers the years with Transactions plus the current year, and all twelve months', async () => {
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
    expect(monthOptions.map((option) => option.textContent)).toEqual(monthNames)
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
    handleListMonth = (year, month) =>
      Response.json(year === 2026 && month === 9 ? septemberTransactions : [])
    const user = await openTransactionsPage()
    await screen.findByRole('cell', { name: 'Rema 1000' })

    await user.selectOptions(screen.getByLabelText('Month'), 'August')
    expect(await screen.findByText('No transactions in August 2026')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Year'), '2025')
    expect(await screen.findByText('No transactions in August 2025')).toBeInTheDocument()
    expect(requestedMonths()).toEqual([
      '/api/transactions?year=2026&month=9',
      '/api/transactions?year=2026&month=8',
      '/api/transactions?year=2025&month=8',
    ])
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

  async function openAiPlacedMonth() {
    months = [{ year: 2026, month: 9 }]
    handleListMonth = () => Response.json(aiPlacedTransactions)
    const user = await openTransactionsPage()
    await screen.findByRole('cell', { name: 'Rema 1000' })
    return user
  }

  it('shows an AI marker next to Other only for Transactions AI-placed in Other, with no filter for them', async () => {
    await openAiPlacedMonth()

    expect(categorySelect('Vipps *Ola Nordmann')).toHaveValue('13')
    expect(within(transactionRow('Vipps *Ola Nordmann')).getByText('AI')).toBeInTheDocument()
    expect(within(transactionRow('Gave')).queryByText('AI')).not.toBeInTheDocument()
    expect(within(transactionRow('Rema 1000')).queryByText('AI')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'AI-placed only' })).not.toBeInTheDocument()
  })

  it('drops the AI marker once the Category of a Transaction AI-placed in Other is changed', async () => {
    handleChangeCategory = (_id, body) =>
      Response.json({ ...aiPlacedTransactions[1], ...(body as object), aiPlacedInOther: false })
    const user = await openAiPlacedMonth()

    await user.selectOptions(categorySelect('Vipps *Ola Nordmann'), 'Groceries')

    expect(await screen.findByRole('status')).toHaveTextContent('Category changed')
    expect(categorySelect('Vipps *Ola Nordmann')).toHaveValue('1')
    expect(within(transactionRow('Vipps *Ola Nordmann')).queryByText('AI')).not.toBeInTheDocument()
  })

  it('keeps the AI marker when changing the Category of a Transaction AI-placed in Other fails', async () => {
    handleChangeCategory = () => new Response(null, { status: 500 })
    const user = await openAiPlacedMonth()

    await user.selectOptions(categorySelect('Vipps *Ola Nordmann'), 'Groceries')

    expect(await screen.findByRole('alert')).toHaveTextContent('Saving failed (500).')
    expect(categorySelect('Vipps *Ola Nordmann')).toHaveValue('13')
    expect(within(transactionRow('Vipps *Ola Nordmann')).getByText('AI')).toBeInTheDocument()
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

  it("opens on the latest month with Transactions and shows its Spending by Category, largest first", async () => {
    months = [
      { year: 2026, month: 9 },
      { year: 2026, month: 8 },
      { year: 2025, month: 12 },
    ]
    handleSpending = (year, month) =>
      Response.json(year === 2026 && month === 9 ? septemberSpending : { total: 0, slices: [] })

    render(<App />)

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
    render(<App />)

    const addTransaction = screen.getByRole('button', { name: /add transaction/i })
    expect(addTransaction.compareDocumentPosition(dashboard())).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    await waitFor(() => expect(centreTotal()).toBe('Total 0,00 kr'))
  })

  it('opens on the current month with an empty chart and a total of 0 when there are no Transactions', async () => {
    render(<App />)

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
    render(<App />)
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
    render(<App />)
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
    render(<App />)
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
    render(<App />)
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

    render(<App />)

    await waitFor(() => expect(centreTotal()).toBe('Total 0,00 kr'))
    expect(legendRows()).toEqual([])
    expect(within(dashboard()).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(dashboard()).queryByText(/transfer/i, { ignore: 'label, option' })).toBeNull()
  })

  it('says when the Spending could not be loaded', async () => {
    handleSpending = () => new Response(null, { status: 500 })

    render(<App />)

    expect(await within(dashboard()).findByRole('alert')).toHaveTextContent('Could not load the Spending.')
  })

  it('says when the months could not be loaded', async () => {
    months = new Response(null, { status: 500 })

    render(<App />)

    expect(await within(dashboard()).findByRole('alert')).toHaveTextContent('Could not load the Spending.')
  })

  it('reloads after a Bank Statement is uploaded', async () => {
    const user = userEvent.setup()
    render(<App />)
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
    render(<App />)
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

  it('loads afresh, on the latest month, when coming back to the home view', async () => {
    months = [
      { year: 2026, month: 9 },
      { year: 2026, month: 8 },
    ]
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(centreTotal()).toBe('Total 0,00 kr'))
    await user.selectOptions(screen.getByLabelText('Period'), 'August 2026')
    await user.click(screen.getByRole('button', { name: 'Transactions' }))
    handleSpending = () => Response.json(septemberSpending)

    await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

    await waitFor(() => expect(centreTotal()).toBe('Total 1 570,50 kr'))
    expect(screen.getByLabelText('Period')).toHaveValue('2026-9')
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
      render(<App />)
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

      render(<App />)

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

      render(<App />)

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

      render(<App />)

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

      render(<App />)

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

      render(<App />)

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
        render(<App />)
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
        render(<App />)
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
        render(<App />)
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
        render(<App />)
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
        render(<App />)
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
        render(<App />)
        await waitFor(() => expect(trendTable()[0]).toEqual(['', 'October 2025', 'September 2026', 'Change']))
        const requestsBefore = requestedMonthlySpending().length

        await user.selectOptions(within(trend()).getByLabelText('Granularity'), 'Quarter')

        expect(trendTable()[0]).toEqual(['', 'Q4 2025', 'Q3 2026', 'Change'])
        expect(requestedMonthlySpending()).toHaveLength(requestsBefore)
      })

      it('opens on Month again after leaving the home view and coming back', async () => {
        months = [
          { year: 2026, month: 9 },
          { year: 2025, month: 1 },
        ]
        const user = userEvent.setup()
        render(<App />)
        await waitFor(() => expect(trendTable()).toHaveLength(2))
        await user.selectOptions(within(trend()).getByLabelText('Granularity'), 'Quarter')

        await user.click(screen.getByRole('button', { name: 'Transactions' }))
        await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

        await waitFor(() => expect(trendTable()[0]).toEqual(['', 'October 2025', 'September 2026', 'Change']))
        expect(selectedGranularity()).toBe('Month')
      })

      it.each([
        ['Year', [{ year: 2026, month: 9 }, { year: 2026, month: 1 }], 'Trends by Year need Transactions in at least two years'],
        ['Quarter', [{ year: 2026, month: 9 }, { year: 2026, month: 7 }], 'Trends by Quarter need Transactions in at least two quarters'],
      ])('says when the Transactions all fall in one Period at %s, and comes back at Month', async (granularity, offered, message) => {
        months = offered
        const user = userEvent.setup()
        render(<App />)
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
        render(<App />)
        await waitFor(() => expect(trendTable()).toHaveLength(2))
        await user.selectOptions(within(trend()).getByLabelText('Granularity'), 'Quarter')
        await waitFor(() => expect(trendTable()[0]).toEqual(['', 'Q4 2025', 'Q3 2026', 'Change']))
        const requestsBefore = requestedMonthlySpending().length
        await user.click(screen.getByRole('button', { name: /add transaction/i }))
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

      render(<App />)

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

      render(<App />)

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
        render(<App />)
        await chooseView(user)
        const requestsBefore = requestedMonthlySpending().length
        await user.click(screen.getByRole('button', { name: /add transaction/i }))
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
        render(<App />)
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
        render(<App />)
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
        render(<App />)
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

      it('opens afresh, on the default Span, when coming back to the home view', async () => {
        const user = userEvent.setup()
        render(<App />)
        await chooseView(user)
        await user.click(screen.getByRole('button', { name: 'Transactions' }))

        await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

        await waitFor(() => expect(trendTable()).toHaveLength(2))
        expect(selectedMonth('From')).toBe('10.2025')
        expect(selectedMonth('To')).toBe('09.2026')
        expect(within(trend()).getByRole('checkbox', { name: 'Include transfers' })).not.toBeChecked()
        expect(switchedOn()).toEqual(['Total'])
        expect(requestedMonthlySpending().at(-1)).toBe(
          '/api/spending/monthly?fromYear=2025&fromMonth=10&toYear=2026&toMonth=9',
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

        render(<App />)

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

        render(<App />)

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

        render(<App />)

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
        render(<App />)
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
        render(<App />)
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
        render(<App />)
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
        render(<App />)
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
        render(<App />)
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
        render(<App />)
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
        render(<App />)
        await waitFor(() => expect(trendTable()).toHaveLength(3))
        await waitFor(() => expect(requestedSpending()).toHaveLength(1))

        await user.click(trendToggle())

        await waitFor(() => expect(trendTable()[1][2]).toBe('2 000,00 kr'))
        expect(donutToggle()).not.toBeChecked()
        expect(requestedSpending()).toEqual(['/api/spending?year=2026&month=9'])
      })
    })
  })
})
