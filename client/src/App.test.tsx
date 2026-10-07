import { render, screen } from '@testing-library/react'
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
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url === '/api/categories') return Response.json(categories)
  if (url === '/api/transactions' && init?.method === 'POST') {
    return handlePost(JSON.parse(init.body as string))
  }
  if (url === '/api/bank-statements' && init?.method === 'POST') {
    return handleUpload(init.body as FormData)
  }
  return new Response(null, { status: 404 })
})

beforeEach(() => {
  handlePost = () => Response.json({ id: 1 }, { status: 201 })
  handleUpload = () => Response.json(importedStatement, { status: 201 })
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

    const buttons = screen.getAllByRole('button').map((button) => button.textContent)
    expect(buttons).toEqual(['Upload transactions', 'Add transaction'])
  })

  it('uploads the chosen PDF and shows how many transactions were imported', async () => {
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
      'Imported 38 transactions from statement 01.08.2026–31.08.2026',
    )
  })

  it('only accepts PDF files', () => {
    render(<App />)

    expect(screen.getByLabelText(/bank statement pdf/i)).toHaveAttribute('accept', 'application/pdf')
  })

  it('disables the upload button while the upload is in progress', async () => {
    let respond: (response: Response) => void = () => {}
    handleUpload = () => new Promise((resolve) => (respond = resolve))
    const user = userEvent.setup()
    render(<App />)

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    const button = screen.getByRole('button', { name: /uploading/i })
    expect(button).toBeDisabled()

    respond(Response.json(importedStatement, { status: 201 }))
    expect(await screen.findByRole('button', { name: /upload transactions/i })).toBeEnabled()
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
