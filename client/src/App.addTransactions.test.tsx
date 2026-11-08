import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { todayIsoDate } from './lib/date'
import { reduceReceipt } from './lib/reduceReceipt'
import { api, fetchMock, importedStatement } from './test/fakeApi'
import { addActions, chooseBookmark, fillValidForm, leavingTheSiteAsks, openModal, renderApp, renderAppAt, statementPdf } from './test/renderApp'

// jsdom can't decode images, so the Receipt scan tests say what reducing each Receipt gives.
vi.mock('./lib/reduceReceipt', () => ({ reduceReceipt: vi.fn() }))

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
    api.folders = [
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
    api.handlePost = (body) => {
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
    api.folders = [{ id: 30, name: 'Tax deductible' }]
    let posted: unknown
    api.handlePost = (body) => {
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
    api.folders = [{ id: 30, name: 'Tax deductible' }]
    let posted: unknown
    api.handlePost = (body) => {
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
    api.folders = [{ id: 30, name: 'Tax deductible' }]
    api.handlePost = () => Response.json({ errors: { bookmark: ['The folder no longer exists.'] } }, { status: 400 })
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
    api.folders = new Promise(() => {})
    await openModal()

    const bookmark = screen.getByLabelText(/^bookmark/i)
    expect(bookmark).toBeDisabled()
    expect(within(bookmark).getAllByRole('option').map((option) => option.textContent)).toEqual(['-'])
  })

  it('saves without a bookmark when the Folders could not be loaded, saying so under the Bookmark', async () => {
    api.folders = new Response(null, { status: 500 })
    let posted: unknown
    api.handlePost = (body) => {
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
    api.handlePost = () =>
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
    api.handlePost = () => new Response(null, { status: 500 })
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
    api.handleUpload = (body) => {
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
    api.handleUpload = () =>
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
    api.handleUpload = () => new Promise((resolve) => (respond = resolve))
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
    api.handleUpload = (body) => {
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
    api.handleUpload = (body) => {
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
    api.handleUpload = () => new Promise((resolve) => responders.push(resolve))
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
    api.handleUpload = () => Response.json(statements[call++], { status: 201 })
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
    api.handleUpload = () =>
      Response.json({ ...importedStatement, aiCategorizationUnavailable: call++ === 0 }, { status: 201 })
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), [statementPdf, statementPdf])

    expect(await screen.findByRole('status')).toHaveTextContent(
      /AI categorization unavailable for 1 Bank Statement$/,
    )
  })

  it('says when the daily AI limit was reached during the import', async () => {
    api.handleUpload = () => Response.json({ ...importedStatement, dailyAiLimitReached: true }, { status: 201 })
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
    api.handleUpload = () => Response.json(statements[call++], { status: 201 })
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
    api.handleUpload = () => Response.json({ ...importedStatement, dailyAiLimitReached: call++ === 1 }, { status: 201 })
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
    api.handleUpload = (body) => {
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
    api.handleUpload = () => {
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
    api.handleUpload = () =>
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
    api.handleUpload = () =>
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
    api.handleUpload = () =>
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
    api.handleUpload = () => {
      throw new TypeError('Failed to fetch')
    }
    const user = userEvent.setup()
    await renderApp()

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    expect(await screen.findByRole('alert')).toHaveTextContent('kontoutskrift.pdf: Could not reach the server.')
    expect(screen.getByRole('button', { name: /upload transactions/i })).toBeEnabled()
  })

  it('clears an upload error once a later upload succeeds', async () => {
    api.handleUpload = () => new Response(null, { status: 500 })
    const user = userEvent.setup()
    await renderApp()
    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)
    expect(await screen.findByRole('alert')).toHaveTextContent('kontoutskrift.pdf: Upload failed (500).')

    api.handleUpload = () => Response.json(importedStatement, { status: 201 })
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
      api.handleUpload = () => new Response(null, { status: 500 })
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
      api.handleUpload = () => new Promise((resolve) => (respond = resolve))
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

    it('clears the import summary when left by Back, so it is gone when Forward returns', async () => {
      const user = userEvent.setup()
      await renderAppAt('/rules')
      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))
      await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)
      expect(await screen.findByRole('status')).toHaveTextContent('Imported 38 transactions')

      window.history.back()
      await screen.findByRole('heading', { name: 'Categorization Rules' })
      window.history.forward()

      expect(await screen.findByRole('button', { name: 'Add transaction' })).toBeInTheDocument()
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
    })

    it('still shows an upload that finished while away when Back returns', async () => {
      let respond: (response: Response) => void = () => {}
      api.handleUpload = () => new Promise((resolve) => (respond = resolve))
      const user = userEvent.setup()
      await renderApp()
      await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)
      await user.click(screen.getByRole('button', { name: 'Transactions' }))
      const response = Response.json(importedStatement, { status: 201 })
      const read = vi.spyOn(response, 'json')
      respond(response)
      // Lets the upload finish while away.
      await waitFor(() => expect(read).toHaveBeenCalled())
      await act(async () => {})

      window.history.back()

      expect(await screen.findByRole('button', { name: /upload transactions/i })).toBeEnabled()
      expect(screen.getByRole('status')).toHaveTextContent('Imported 38 transactions')
    })
  })

  it('shows the import summary in place of Transaction saved when a transaction is saved during an upload', async () => {
    let respond: (response: Response) => void = () => {}
    api.handleUpload = () => new Promise((resolve) => (respond = resolve))
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
    api.handlePost = (body) => {
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
          return api.handlePost(JSON.parse(body.get('transaction') as string))
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

  it('adds no history entry, and stays open when Back changes the page', async () => {
    const user = userEvent.setup()
    await renderAppAt('/rules')
    await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))
    await user.upload(screen.getByLabelText(/^receipts$/i), [kiwi, rema])
    await formIsReady()

    window.history.back()

    await waitFor(() => expect(window.location.pathname).toBe('/rules'))
    expect(await screen.findByRole('button', { name: 'Rules', current: 'page' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Receipt 1 of 2' })).toBeInTheDocument()
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
    expect(api.antiforgeryTokensGiven).toBe(1)
  })

  it('saves the entered values as a manually-entered Transaction and moves on to the next Receipt', async () => {
    const posted: unknown[] = []
    api.handlePost = (body) => {
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
    api.folders = [{ id: 30, name: 'Tax deductible' }]
    const posted: unknown[] = []
    api.handlePost = (body) => {
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
    api.handlePost = (body) => {
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
    api.handlePost = () => Response.json({ errors: { description: ['Description is required.'] } }, { status: 400 })
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
    api.handlePost = () => new Promise<Response>((resolve) => (respond = resolve)) as unknown as Response
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
    api.handlePost = () => new Promise<Response>((resolve) => (respond = resolve)) as unknown as Response
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
    api.handlePost = () => new Promise<Response>((resolve) => (respond = resolve)) as unknown as Response
    const user = await scanUntilFormIsReady([kiwi])
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    api.handlePost = () => Response.json({ id: 2 }, { status: 201 })
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
      api.handlePost = (body) => {
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
      api.handlePost = (body) => {
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
      api.handlePost = () => Response.json({ errors: { description: ['Description is required.'] } }, { status: 400 })
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
      api.handlePost = () => Response.json({ errors: { receipt: ['The Receipt is not a JPEG image.'] } }, { status: 400 })
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
      api.handlePost = (body) => {
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

  it('asks "Leave site?" while the scan is open, even with every Receipt read, and no longer once it closes', async () => {
    const user = await scanUntilFormIsReady([kiwi, rema])

    expect(leavingTheSiteAsks()).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(leavingTheSiteAsks()).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(leavingTheSiteAsks()).toBe(false)
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
      api.handlePost = (body) => {
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
      api.handlePost = () => new Promise<Response>((resolve) => (respond = resolve)) as unknown as Response
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
      api.handlePost = () => new Promise<Response>((resolve) => (respond = resolve)) as unknown as Response
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
      api.handlePost = (body) => {
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
      api.handlePost = (body) => {
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
