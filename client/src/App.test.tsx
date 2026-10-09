import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { todayIsoDate } from './lib/date'

const categories = [
  { id: 1, name: 'Groceries' },
  { id: 13, name: 'Other' },
]

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
let handleEditRule: (id: number, body: unknown) => Response
let handleDeleteRule: (id: number) => Response
let months: { year: number; month: number }[] | Response
let handleListMonth: (year: number, month: number) => Response
let handleChangeCategory: (id: number, body: unknown) => Response | Promise<Response>
// What the categories endpoint returns: `categories` unless a test adds to it or makes it fail.
let categoriesServed: { id: number; name: string }[] | Response
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

  it('shows a disabled Categorizing… button with a spinner while the upload is in progress', async () => {
    let respond: (response: Response) => void = () => {}
    handleUpload = () => new Promise((resolve) => (respond = resolve))
    const user = userEvent.setup()
    render(<App />)

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    const button = screen.getByRole('button', { name: 'Categorizing…' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')

    respond(Response.json(importedStatement, { status: 201 }))
    const idle = await screen.findByRole('button', { name: /upload transactions/i })
    expect(idle).toBeEnabled()
    expect(idle).not.toHaveAttribute('aria-busy', 'true')
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
      'The file is not a Sparebanken Norge Bank Statement.',
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
      'Statement for 1111.22.33333, 01.08.2026–31.08.2026 has already been imported.',
    )
  })

  it('shows a general error when the server cannot be reached', async () => {
    handleUpload = () => {
      throw new TypeError('Failed to fetch')
    }
    const user = userEvent.setup()
    render(<App />)

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.')
    expect(screen.getByRole('button', { name: /upload transactions/i })).toBeEnabled()
  })

  it('clears an upload error once a later upload succeeds', async () => {
    handleUpload = () => new Response(null, { status: 500 })
    const user = userEvent.setup()
    render(<App />)
    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)
    expect(await screen.findByRole('alert')).toHaveTextContent('Upload failed (500).')

    handleUpload = () => Response.json(importedStatement, { status: 201 })
    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Imported 38 transactions from statement 01.08.2026–31.08.2026',
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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

  it('shows an AI badge next to the keyword of AI-generated rules only', async () => {
    rules = [
      { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false },
    ]
    await openRulesPage()

    expect(within(ruleRow('café løkka AI')).getByText('AI')).toBeInTheDocument()
    expect(within(ruleRow('kiwi')).queryByText('AI')).not.toBeInTheDocument()
  })

  it('shows only AI-generated rules, still sorted by keyword, while AI only is on', async () => {
    rules = [
      { id: 3, keyword: 'bakeriet', categoryId: 13, aiGenerated: true },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false },
      { id: 4, keyword: 'nille', categoryId: 13, aiGenerated: true },
      { id: 2, keyword: 'overføring mellom egne kontoer', categoryId: 13, aiGenerated: false },
    ]
    const user = await openRulesPage()

    await user.click(screen.getByRole('checkbox', { name: 'AI only' }))
    expect(keywords()).toEqual(['bakeriet AI', 'nille AI'])

    await user.click(screen.getByRole('checkbox', { name: 'AI only' }))
    expect(keywords()).toEqual(['bakeriet AI', 'kiwi', 'nille AI', 'overføring mellom egne kontoer'])
  })

  it('drops the AI badge once an AI-generated rule is saved, even unchanged', async () => {
    rules = [
      { id: 3, keyword: 'bakeriet', categoryId: 13, aiGenerated: true },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false },
      { id: 4, keyword: 'nille', categoryId: 13, aiGenerated: true },
    ]
    const user = await openRulesPage()
    await user.click(screen.getByRole('checkbox', { name: 'AI only' }))

    await user.click(within(ruleRow('bakeriet AI')).getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('status')

    expect(keywords()).toEqual(['nille AI'])
    await user.click(screen.getByRole('checkbox', { name: 'AI only' }))
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

  it('shows Transactions then Rules, with no Back button', () => {
    render(<App />)

    expect(navItems().map((item) => item.textContent)).toEqual(['Transactions', 'Rules'])
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })

  it('highlights the page being shown', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(currentPage()).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Transactions' }))
    expect(currentPage()).toEqual(['Transactions'])

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
    { id: 5, date: '2026-09-24', description: 'Rema 1000', amount: -1249.9, reference: null, categoryId: 1 },
    { id: 4, date: '2026-09-03', description: 'Lønn Fra: Testfirma AS', amount: 24500, reference: null, categoryId: null },
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
      return user.selectOptions(screen.getByLabelText('Granularity'), granularity)
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

      expect(screen.getByLabelText('Granularity')).toHaveDisplayValue('Month')
      expect(
        within(screen.getByLabelText('Granularity'))
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
        ['12 months by month', '10.2025', '09.2026', 'October 2025', 'September 2026', '1 000,00 kr', '300,00 kr', '▼ −70,0 %'],
        ['13 months by quarter, from a partial first quarter', '09.2025', '09.2026', 'Q3 2025', 'Q3 2026', '900,00 kr', '600,00 kr', '▼ −33,3 %'],
        ['partial first and last quarters', '02.2025', '08.2026', 'Q1 2025', 'Q3 2026', '300,00 kr', '750,00 kr', '▲ +150,0 %'],
        ['36 months by quarter', '10.2023', '09.2026', 'Q4 2023', 'Q3 2026', '133,33 kr', '600,00 kr', '▲ +350,0 %'],
        ['37 months by half-year, from a partial first half-year', '09.2023', '09.2026', 'H2 2023', 'H2 2026', '300,00 kr', '600,00 kr', '▲ +100,0 %'],
        ['partial first and last half-years', '03.2023', '09.2026', 'H1 2023', 'H2 2026', '100,00 kr', '600,00 kr', '▲ +500,0 %'],
      ])(
        'shows %s, each point as its Spending divided by the months of the Span it covers',
        async (_case, from, to, firstLabel, lastLabel, first, last, change) => {
          const user = await openTrend()

          await user.selectOptions(within(trend()).getByLabelText('From'), from)
          await user.selectOptions(within(trend()).getByLabelText('To'), to)

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

    it('reloads after a Bank Statement is uploaded', async () => {
      months = [
        { year: 2026, month: 9 },
        { year: 2026, month: 8 },
      ]
      const user = userEvent.setup()
      render(<App />)
      await waitFor(() => expect(trendTable()).toHaveLength(2))
      handleMonthlySpending = (from, to) =>
        Response.json(monthlySpending(from, to, { '2026-9': [{ categoryId: 1, amount: 75 }] }))

      await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

      await waitFor(() => expect(trendTable()[1]).toEqual(['Total', '0,00 kr', '75,00 kr', 'New']))
      expect(requestedMonthlySpending()).toHaveLength(2)
    })

    describe('Categories', () => {
      function toggle(name: string) {
        return within(trend()).getByRole('checkbox', { name }) as HTMLInputElement
      }

      // The names of the rows switched on, in table order.
      function switchedOn() {
        return within(trend())
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
        // February 2025 to September 2026 is 20 months, so drawn per quarter.
        await waitFor(() => expect(trendTable()[0][1]).toBe('Q1 2025'))
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
