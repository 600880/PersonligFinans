import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { todayIsoDate } from './lib/date'

const categories = [
  { id: 1, name: 'Groceries' },
  { id: 13, name: 'Other' },
]

type PostHandler = (body: unknown) => Response
type UploadHandler = (body: FormData) => Response | Promise<Response>

let handlePost: PostHandler
let handleUpload: UploadHandler
let rules: { id: number; keyword: string; categoryId: number; aiGenerated: boolean }[] | Response
let handleAddRule: PostHandler
let handleEditRule: (id: number, body: unknown) => Response
let handleDeleteRule: (id: number) => Response
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const ruleUrl = /^\/api\/categorization-rules\/(\d+)$/.exec(url)
  if (ruleUrl && init?.method === 'PUT') {
    return handleEditRule(Number(ruleUrl[1]), JSON.parse(init.body as string))
  }
  if (ruleUrl && init?.method === 'DELETE') return handleDeleteRule(Number(ruleUrl[1]))
  if (url === '/api/categories') return Response.json(categories)
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

    const options = screen.getAllByRole('option').map((option) => option.textContent)
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

  it('goes back to the transactions view', async () => {
    const user = await openRulesPage()

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(screen.getByRole('button', { name: /add transaction/i })).toBeInTheDocument()
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
    handleEditRule = (id, body) =>
      Response.json({ id, ...(body as object), aiGenerated: true, transactionsChanged: 0 })
    const user = await openRulesPage()

    await user.click(screen.getByRole('checkbox', { name: 'AI only' }))
    expect(keywords()).toEqual(['bakeriet AI', 'nille AI'])

    await user.click(within(ruleRow('bakeriet AI')).getByRole('button', { name: 'Edit' }))
    const editing = within(screen.getByRole('button', { name: 'Save' }).closest('tr')!)
    await user.clear(editing.getByLabelText('Keyword'))
    await user.type(editing.getByLabelText('Keyword'), 'zbakeriet')
    await user.click(editing.getByRole('button', { name: 'Save' }))
    await screen.findByRole('status')
    expect(keywords()).toEqual(['nille AI', 'zbakeriet AI'])

    await user.click(screen.getByRole('checkbox', { name: 'AI only' }))
    expect(keywords()).toEqual(['kiwi', 'nille AI', 'overføring mellom egne kontoer', 'zbakeriet AI'])
  })
})
