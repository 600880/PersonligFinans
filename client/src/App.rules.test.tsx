import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { api, categories, fetchMock } from './test/fakeApi'
import { renderApp } from './test/renderApp'

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
      'Actions',
    ])
  })

  it('asks for the rules only on opening, not again after adding, editing or deleting one', async () => {
    const user = await openRulesPage()

    await addRuleInDialog(user, 'rema', 'Groceries')
    await screen.findByText('Rule added. 0 transactions changed category.')
    const editing = await openEditDialog(user, 'kiwi')
    await user.click(editing.getByRole('button', { name: 'Save' }))
    await screen.findByText('Rule updated. 0 transactions changed category.')
    await deleteConfirmed(user, 'rema')
    await screen.findByText('Rule deleted. 0 transactions changed category.')

    const listed = fetchMock.mock.calls.filter(([url, init]) => url === '/api/categorization-rules' && !init?.method)
    expect(listed).toHaveLength(1)
  })

  // The swatch beside a rule's Category, as a CSS colour.
  function categorySwatch(keyword: string, category: string) {
    return within(ruleRow(keyword)).getByRole('img', { name: `${category} colour` }).style.backgroundColor
  }

  it("shows each rule's Category with a swatch in the Category's colour", async () => {
    api.categoriesServed = [{ ...categories[0], colour: '#123456' }, { ...categories[1], colour: '#abcdef' }]
    await openRulesPage()

    expect(categorySwatch('kiwi', 'Groceries')).toBe('rgb(18, 52, 86)')
    expect(categorySwatch('overføring mellom egne kontoer', 'Other')).toBe('rgb(171, 205, 239)')
  })

  it('draws a dark Category lighter in Dark, in the same colour as the Dashboard draws it', async () => {
    localStorage.setItem('appearance', 'dark')
    api.categoriesServed = [{ ...categories[0], colour: '#104281' }, categories[1]]
    api.months = [{ year: 2026, month: 9 }]
    api.handleSpending = () => Response.json({ total: 120, slices: [{ categoryId: 1, amount: 120 }] })
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
    api.rules = [
      { id: 5, keyword: 'zara', categoryId: 1, aiGenerated: false, isNew: false },
      { id: 2, keyword: 'ørn', categoryId: 13, aiGenerated: false, isNew: false },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
      { id: 4, keyword: 'åpent', categoryId: 13, aiGenerated: false, isNew: false },
    ]
    const user = await openRulesPage()

    expect(keywords()).toEqual(['kiwi', 'zara', 'ørn', 'åpent'])

    await addRuleInDialog(user, 'ark', 'Groceries')
    await screen.findByRole('status')

    expect(keywords()).toEqual(['ark', 'kiwi', 'zara', 'ørn', 'åpent'])

    const dialog = await openEditDialog(user, 'kiwi')
    await user.clear(dialog.getByLabelText('Keyword'))
    await user.type(dialog.getByLabelText('Keyword'), 'æble')
    await user.click(dialog.getByRole('button', { name: 'Save' }))
    await screen.findByRole('cell', { name: 'æble' })

    expect(keywords()).toEqual(['ark', 'zara', 'æble', 'ørn', 'åpent'])
  })

  it('lists the rules in the white panel the Categories sit in, slate in Dark, with a ruled header row', async () => {
    await openRulesPage()

    // jsdom applies no stylesheet, so the panel is checked by its classes, as the phone layout is.
    const table = screen.getByRole('table')
    expect(table.parentElement).toHaveClass('rounded-lg', 'border', 'bg-white', 'dark:bg-slate-900', 'shadow-sm')
    const [head] = within(table).getAllByRole('rowgroup')
    expect(head).toHaveClass('border-b', 'text-sm')
    // The first and last columns keep their content off the panel's edges.
    const [firstHeading, ...otherHeadings] = within(head).getAllByRole('columnheader')
    expect(firstHeading).toHaveClass('pl-4')
    expect(otherHeadings.at(-1)).toHaveClass('pr-4')
    for (const row of within(table).getAllByRole('row').slice(1)) {
      const cells = within(row).getAllByRole('cell')
      expect(cells[0]).toHaveClass('pl-4')
      expect(cells.at(-1)).toHaveClass('pr-4')
    }
  })

  it('has its toolbar as the top strip of the panel, ruled off above the column headers', async () => {
    await openRulesPage()

    const panel = screen.getByRole('table').parentElement!
    const search = screen.getByRole('searchbox', { name: 'Search' })
    const toolbar = search.parentElement!.parentElement!
    expect(panel.firstElementChild).toBe(toolbar)
    expect(toolbar).toHaveClass('border-b', 'px-4')
    expect(toolbar).toContainElement(screen.getByRole('combobox', { name: 'Filter by category' }))
  })

  it('lays each rule out as a phone shows its two-line card inside the panel: keyword, badges and actions, then its Category', async () => {
    api.rules = [
      { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: true },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
    ]
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'Rules' }))
    const card = await screen.findByRole('row', { name: /^café løkka/ })

    // The cells come in the table's order, and the card places them on its two lines.
    const [keyword, category, actions] = within(card).getAllByRole('cell')
    expect(keyword).toHaveTextContent('café løkka AI New')
    expect(within(category).getByRole('img', { name: 'Other colour' })).toBeInTheDocument()
    expect(category).toHaveTextContent('Other')
    expect(within(actions).getAllByRole('button').map((button) => button.textContent)).toEqual(['Edit', 'Delete'])

    // jsdom applies no media queries, so the phone layout is checked by its classes: the table, its
    // body become blocks and each row a card, with the column headers hidden.
    const table = screen.getByRole('table')
    const [head, body] = within(table).getAllByRole('rowgroup')
    expect(table).toHaveClass('max-sm:block')
    expect(head).toHaveClass('max-sm:hidden')
    expect(body).toHaveClass('max-sm:block')
    expect(card).toHaveClass('max-sm:grid', 'max-sm:px-4')
    expect(keyword).toHaveClass('max-sm:col-start-1', 'max-sm:row-start-1')
    expect(actions).toHaveClass('max-sm:col-start-2', 'max-sm:row-start-1')
    expect(category).toHaveClass('max-sm:col-start-1', 'max-sm:row-start-2')
    // The cards sit in the one panel, ruled apart as the Categories' rows are, rather than each
    // floating as a box of its own.
    expect(body).toHaveClass('divide-y')
    expect(body).not.toHaveClass('max-sm:divide-y-0')
    for (const row of within(body).getAllByRole('row')) expect(row).not.toHaveClass('max-sm:border', 'max-sm:rounded-lg')
    // Nothing on the page is wider than the screen or scrolls sideways.
    const page = screen.getByRole('heading', { name: 'Categorization Rules' }).closest('section')!
    expect(page.querySelector('[class*="overflow-x-auto"], [class*="min-w-"]:not([class*="min-w-0"])')).toBeNull()
  })

  // Opens the dialog for adding a rule, with the Add rule button beside the heading.
  async function openAddDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    return within(screen.getByRole('dialog', { name: 'Add rule' }))
  }

  // Adds a rule through the dialog, choosing its Category.
  async function addRuleInDialog(user: ReturnType<typeof userEvent.setup>, keyword: string, category: string) {
    const dialog = await openAddDialog(user)
    await user.type(dialog.getByLabelText('Keyword'), keyword)
    await user.selectOptions(dialog.getByLabelText('Category'), category)
    await user.click(dialog.getByRole('button', { name: 'Save' }))
  }

  // Opens the dialog for editing a rule, with the Edit in its row.
  async function openEditDialog(user: ReturnType<typeof userEvent.setup>, keyword: string) {
    await user.click(within(ruleRow(keyword)).getByRole('button', { name: 'Edit' }))
    return within(screen.getByRole('dialog', { name: 'Edit rule' }))
  }

  it('adds a rule in a dialog opened beside the heading, and says how many transactions changed category', async () => {
    let posted: unknown
    api.handleAddRule = (body) => {
      posted = body
      return Response.json(
        { id: 3, keyword: 'rema', categoryId: 1, aiGenerated: false, isNew: false, transactionsChanged: 3 },
        { status: 201 },
      )
    }
    const user = await openRulesPage()
    // Nothing to fill in on the page itself: the button beside the heading opens the dialog.
    const heading = screen.getByRole('heading', { name: 'Categorization Rules' })
    expect(within(heading.parentElement!).getByRole('button', { name: 'Add rule' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Keyword')).not.toBeInTheDocument()

    const dialog = await openAddDialog(user)
    expect(dialog.getByLabelText('Keyword')).toHaveValue('')
    expect(dialog.getByLabelText('Keyword')).toHaveFocus()
    expect(dialog.getByLabelText('Category')).toHaveDisplayValue('Choose…')
    await user.type(dialog.getByLabelText('Keyword'), '  rema ')
    await user.selectOptions(dialog.getByLabelText('Category'), 'Groceries')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    expect(posted).toEqual({ keyword: 'rema', categoryId: 1 })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Rule added. 3 transactions changed category.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add rule' })).toHaveFocus()
    expect(screen.getByRole('cell', { name: 'rema' })).toBeInTheDocument()

    // The next rule starts from an empty dialog again.
    const next = await openAddDialog(user)
    expect(next.getByLabelText('Keyword')).toHaveValue('')
    expect(next.getByLabelText('Category')).toHaveDisplayValue('Choose…')
  })

  it('starts the add dialog on the Category the list is filtered to when it opens, or on Choose… while all are shown', async () => {
    let posted: unknown
    api.handleAddRule = (body) => {
      posted = body
      return Response.json(
        { id: 3, ...(body as object), aiGenerated: false, isNew: false, transactionsChanged: 0 },
        { status: 201 },
      )
    }
    const user = await openRulesPage()
    const filter = screen.getByRole('combobox', { name: 'Filter by category' })

    await user.selectOptions(filter, 'Other')
    let dialog = await openAddDialog(user)
    expect(dialog.getByLabelText('Category')).toHaveDisplayValue('Other')
    await user.type(dialog.getByLabelText('Keyword'), 'apotek')
    await user.click(dialog.getByRole('button', { name: 'Save' }))
    expect(posted).toEqual({ keyword: 'apotek', categoryId: 13 })
    expect(await screen.findByRole('cell', { name: 'apotek' })).toBeInTheDocument()

    await user.selectOptions(filter, 'Groceries')
    dialog = await openAddDialog(user)
    expect(dialog.getByLabelText('Category')).toHaveDisplayValue('Groceries')
    await user.click(dialog.getByRole('button', { name: 'Cancel' }))

    await user.selectOptions(filter, 'All categories')
    dialog = await openAddDialog(user)
    expect(dialog.getByLabelText('Category')).toHaveDisplayValue('Choose…')
  })

  it("shows the server's field errors beside their fields, keeping the dialog open with the input", async () => {
    api.handleAddRule = () =>
      Response.json(
        {
          errors: {
            keyword: ["A rule for 'Kiwi' already exists."],
            categoryId: ['Category is required.'],
          },
        },
        { status: 400 },
      )
    const user = await openRulesPage()

    const dialog = await openAddDialog(user)
    await user.type(dialog.getByLabelText('Keyword'), 'KIWI')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    const keywordError = await dialog.findByText("A rule for 'Kiwi' already exists.")
    expect(dialog.getByLabelText('Keyword')).toHaveAccessibleDescription(keywordError.textContent!)
    expect(dialog.getByLabelText('Category')).toHaveAccessibleDescription('Category is required.')
    expect(dialog.getByLabelText('Keyword')).toHaveValue('KIWI')
    expect(keywords()).toEqual(['kiwi', 'overføring mellom egne kontoer'])
  })

  it('shows the field error for a Category deleted elsewhere beside the Category', async () => {
    api.handleAddRule = () => Response.json({ errors: { categoryId: ['Category does not exist.'] } }, { status: 400 })
    const user = await openRulesPage()

    const dialog = await openAddDialog(user)
    await user.type(dialog.getByLabelText('Keyword'), 'rema')
    await user.selectOptions(dialog.getByLabelText('Category'), 'Other')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    expect(await dialog.findByText('Category does not exist.')).toBeInTheDocument()
    expect(dialog.getByLabelText('Category')).toHaveAccessibleDescription('Category does not exist.')
    expect(dialog.getByLabelText('Category')).toHaveDisplayValue('Other')
  })

  it('shows a general error in the dialog when the server cannot be reached', async () => {
    api.handleAddRule = () => {
      throw new TypeError('Failed to fetch')
    }
    const user = await openRulesPage()

    const dialog = await openAddDialog(user)
    await user.type(dialog.getByLabelText('Keyword'), 'rema')
    await user.selectOptions(dialog.getByLabelText('Category'), 'Groceries')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent('Could not reach the server.')
    expect(dialog.getByLabelText('Keyword')).toHaveValue('rema')
  })

  it('discards what was typed, and any errors, when the add dialog is closed by Cancel or by Escape', async () => {
    api.handleAddRule = () => Response.json({ errors: { categoryId: ['Category is required.'] } }, { status: 400 })
    const user = await openRulesPage()

    let dialog = await openAddDialog(user)
    await user.type(dialog.getByLabelText('Keyword'), 'rema')
    await user.click(dialog.getByRole('button', { name: 'Save' }))
    await dialog.findByText('Category is required.')
    await user.click(dialog.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add rule' })).toHaveFocus()

    dialog = await openAddDialog(user)
    expect(dialog.getByLabelText('Keyword')).toHaveValue('')
    expect(dialog.queryByText('Category is required.')).not.toBeInTheDocument()
    await user.type(dialog.getByLabelText('Keyword'), 'meny')
    await user.selectOptions(dialog.getByLabelText('Category'), 'Groceries')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add rule' })).toHaveFocus()

    dialog = await openAddDialog(user)
    expect(dialog.getByLabelText('Keyword')).toHaveValue('')
    expect(dialog.getByLabelText('Category')).toHaveDisplayValue('Choose…')
    const posts = fetchMock.mock.calls.filter(([url, init]) => url === '/api/categorization-rules' && init?.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(keywords()).toEqual(['kiwi', 'overføring mellom egne kontoer'])
  })

  it('says when the rules could not be loaded', async () => {
    api.rules = new Response(null, { status: 500 })
    const user = userEvent.setup()
    await renderApp()

    await user.click(screen.getByRole('button', { name: 'Rules' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the rules.')
  })

  it('clears an earlier field error when the next attempt fails for another reason', async () => {
    api.handleAddRule = () =>
      Response.json({ errors: { keyword: ["A rule for 'Kiwi' already exists."] } }, { status: 400 })
    const user = await openRulesPage()
    const dialog = await openAddDialog(user)
    await user.type(dialog.getByLabelText('Keyword'), 'kiwi')
    await user.selectOptions(dialog.getByLabelText('Category'), 'Groceries')
    await user.click(dialog.getByRole('button', { name: 'Save' }))
    await dialog.findByText("A rule for 'Kiwi' already exists.")

    api.handleAddRule = () => {
      throw new TypeError('Failed to fetch')
    }
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent('Could not reach the server.')
    expect(dialog.queryByText("A rule for 'Kiwi' already exists.")).not.toBeInTheDocument()
  })

  function ruleRow(keyword: string) {
    const row = screen.getByRole('cell', { name: keyword }).closest('tr')
    if (!row) throw new Error(`No row for ${keyword}`)
    return row
  }

  // Deletes the rule as the page always has it done: Delete, then Confirm delete in the confirmation.
  async function deleteConfirmed(user: ReturnType<typeof userEvent.setup>, keyword: string) {
    await user.click(within(ruleRow(keyword)).getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog', { name: `Delete the rule “${keyword}”?` })
    await user.click(within(dialog).getByRole('button', { name: 'Confirm delete' }))
  }

  it('edits a rule in a dialog filled in with it, and says how many transactions changed category', async () => {
    let edited: { id: number; body: unknown } | undefined
    api.handleEditRule = (id, body) => {
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

    const dialog = await openEditDialog(user, 'kiwi')
    expect(dialog.getByLabelText('Keyword')).toHaveValue('kiwi')
    expect(dialog.getByLabelText('Keyword')).toHaveFocus()
    expect(dialog.getByLabelText('Category')).toHaveValue('1')
    // An edited rule always has a Category, so there is none to choose.
    expect(dialog.queryByRole('option', { name: 'Choose…' })).not.toBeInTheDocument()
    await user.clear(dialog.getByLabelText('Keyword'))
    await user.type(dialog.getByLabelText('Keyword'), ' kiwi minipris ')
    await user.selectOptions(dialog.getByLabelText('Category'), 'Other')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    expect(edited).toEqual({ id: 1, body: { keyword: 'kiwi minipris', categoryId: 13 } })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Rule updated. 1 transaction changed category.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(ruleRow('kiwi minipris')).toHaveTextContent('kiwi miniprisOther')
  })

  it('closes the edit dialog without saving on Cancel or Escape, and opens filled in from the rule again', async () => {
    const user = await openRulesPage()

    let dialog = await openEditDialog(user, 'kiwi')
    await user.type(dialog.getByLabelText('Keyword'), ' extra')
    await user.selectOptions(dialog.getByLabelText('Category'), 'Other')
    await user.click(dialog.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(ruleRow('kiwi')).getByRole('button', { name: 'Edit' })).toHaveFocus()

    dialog = await openEditDialog(user, 'kiwi')
    expect(dialog.getByLabelText('Keyword')).toHaveValue('kiwi')
    expect(dialog.getByLabelText('Category')).toHaveValue('1')
    await user.type(dialog.getByLabelText('Keyword'), ' extra')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(ruleRow('kiwi')).getByRole('button', { name: 'Edit' })).toHaveFocus()

    dialog = await openEditDialog(user, 'kiwi')
    expect(dialog.getByLabelText('Keyword')).toHaveValue('kiwi')
    expect(ruleRow('kiwi')).toHaveTextContent('kiwiGroceries')
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringMatching(/\/1$/), expect.anything())
  })

  it("shows the server's field errors on an edit beside their fields, keeping the dialog open with the input", async () => {
    api.handleEditRule = () =>
      Response.json(
        {
          errors: {
            keyword: ["A rule for 'overføring mellom egne kontoer' already exists."],
            categoryId: ['Category does not exist.'],
          },
        },
        { status: 400 },
      )
    const user = await openRulesPage()

    const dialog = await openEditDialog(user, 'kiwi')
    await user.clear(dialog.getByLabelText('Keyword'))
    await user.type(dialog.getByLabelText('Keyword'), 'Overføring mellom egne kontoer')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    const error = await dialog.findByText("A rule for 'overføring mellom egne kontoer' already exists.")
    expect(dialog.getByLabelText('Keyword')).toHaveAccessibleDescription(error.textContent!)
    expect(dialog.getByLabelText('Category')).toHaveAccessibleDescription('Category does not exist.')
    expect(dialog.getByLabelText('Keyword')).toHaveValue('Overføring mellom egne kontoer')
  })

  it('shows a general error in the dialog when an edit cannot reach the server', async () => {
    api.handleEditRule = () => {
      throw new TypeError('Failed to fetch')
    }
    const user = await openRulesPage()

    const dialog = await openEditDialog(user, 'kiwi')
    await user.type(dialog.getByLabelText('Keyword'), ' extra')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent('Could not reach the server.')
    expect(dialog.getByLabelText('Keyword')).toHaveValue('kiwi extra')
  })

  function keywords() {
    return screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0].textContent)
  }

  it('shows an AI badge next to the keyword of AI-generated rules only', async () => {
    api.rules = [
      { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: false },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
    ]
    await openRulesPage()

    expect(within(ruleRow('café løkka AI')).getByText('AI')).toBeInTheDocument()
    expect(within(ruleRow('kiwi')).queryByText('AI')).not.toBeInTheDocument()
  })

  it('has the search, the Category filter and Show only new in the toolbar, with no chips and no AI-generated filter', async () => {
    api.rules = [
      { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: true },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
    ]
    await openRulesPage()

    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Filter by category' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Show only new' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AI-generated' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /AI/ })).not.toBeInTheDocument()
    expect(document.querySelector('[aria-pressed]')).toBeNull()
  })

  it('shows a New badge on rules added by the last upload, and can show only those with Show only new', async () => {
    api.rules = [
      { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: true },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
      { id: 4, keyword: 'nille', categoryId: 13, aiGenerated: false, isNew: true },
    ]
    const user = await openRulesPage()

    expect(keywords()).toEqual(['café løkka AI New', 'kiwi', 'nille New'])
    const newOnly = screen.getByRole('checkbox', { name: 'Show only new' })
    expect(newOnly).toBeEnabled()
    expect(newOnly).not.toBeChecked()

    await user.click(newOnly)

    expect(newOnly).toBeChecked()
    expect(keywords()).toEqual(['café løkka AI New', 'nille New'])

    await user.click(newOnly)

    expect(newOnly).not.toBeChecked()
    expect(keywords()).toEqual(['café løkka AI New', 'kiwi', 'nille New'])
  })

  it('disables Show only new, saying why, when the last upload added no rules', async () => {
    await openRulesPage()

    const newOnly = screen.getByRole('checkbox', { name: 'Show only new' })
    expect(newOnly).toBeDisabled()
    expect(newOnly).not.toBeChecked()
    expect(newOnly).toHaveAccessibleDescription('The last upload added no rules')
    expect(newOnly.closest('label')).toHaveAttribute('title', 'The last upload added no rules')
  })

  it('turns Show only new off and shows every rule again once no rule is New, as when the last New one is deleted', async () => {
    api.rules = [
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
      { id: 4, keyword: 'nille', categoryId: 13, aiGenerated: false, isNew: true },
    ]
    const user = await openRulesPage()
    await user.click(screen.getByRole('checkbox', { name: 'Show only new' }))
    expect(keywords()).toEqual(['nille New'])

    await user.click(within(ruleRow('nille New')).getByRole('button', { name: 'Delete' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete the rule “nille”?' })).getByRole('button', { name: 'Confirm delete' }),
    )
    await screen.findByRole('status')

    const newOnly = screen.getByRole('checkbox', { name: 'Show only new' })
    expect(newOnly).toBeDisabled()
    expect(newOnly).not.toBeChecked()
    expect(keywords()).toEqual(['kiwi'])
  })

  it('drops the AI badge, keeping the New badge, once an AI-generated rule is saved from the edit dialog, even unchanged', async () => {
    api.rules = [
      { id: 3, keyword: 'bakeriet', categoryId: 13, aiGenerated: true, isNew: true },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
      { id: 4, keyword: 'nille', categoryId: 13, aiGenerated: true, isNew: false },
    ]
    let edited: { id: number; body: unknown } | undefined
    api.handleEditRule = (id, body) => {
      edited = { id, body }
      return Response.json({ id, ...(body as object), aiGenerated: false, isNew: true, transactionsChanged: 0 })
    }
    const user = await openRulesPage()

    const dialog = await openEditDialog(user, 'bakeriet AI New')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Rule updated. 0 transactions changed category.')
    expect(edited).toEqual({ id: 3, body: { keyword: 'bakeriet', categoryId: 13 } })
    expect(keywords()).toEqual(['bakeriet New', 'kiwi', 'nille AI'])
  })

  it('offers Edit and Delete only on every rule, AI-generated or not, with no Keep', async () => {
    api.rules = [
      { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: true },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
      { id: 4, keyword: 'nille', categoryId: 13, aiGenerated: false, isNew: true },
      { id: 5, keyword: 'rema', categoryId: 1, aiGenerated: true, isNew: false },
    ]
    await openRulesPage()

    for (const keyword of ['café løkka AI New', 'kiwi', 'nille New', 'rema AI']) {
      const actions = within(ruleRow(keyword)).getAllByRole('cell').at(-1)!
      expect(within(actions).getAllByRole('button').map((button) => button.textContent)).toEqual(['Edit', 'Delete'])
    }
  })

  describe('searching', () => {
    it('narrows the rules to matching keywords as the search is typed, ignoring case and surrounding spaces', async () => {
      api.rules = [
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
      api.handleAddRule = () =>
        Response.json(
          { id: 3, keyword: 'rema', categoryId: 1, aiGenerated: false, isNew: false, transactionsChanged: 2 },
          { status: 201 },
        )
      const user = await openRulesPage()
      await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'kiwi')

      await addRuleInDialog(user, 'rema', 'Groceries')

      expect(await screen.findByRole('status')).toHaveTextContent('Rule added. 2 transactions changed category.')
      expect(keywords()).toEqual(['kiwi'])
    })

    it('shows only the new rules that match when Show only new is also ticked', async () => {
      api.rules = [
        { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: true },
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 5, keyword: 'kiwi minipris', categoryId: 1, aiGenerated: false, isNew: true },
      ]
      const user = await openRulesPage()

      await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'kiwi')
      await user.click(screen.getByRole('checkbox', { name: 'Show only new' }))

      expect(keywords()).toEqual(['kiwi minipris New'])
    })

    it('drops a rule from the list once it is saved with a keyword the search leaves out', async () => {
      api.rules = [
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 5, keyword: 'kiwi minipris', categoryId: 1, aiGenerated: false, isNew: false },
      ]
      api.handleEditRule = (id) =>
        Response.json({ id, keyword: 'meny', categoryId: 1, aiGenerated: false, isNew: false, transactionsChanged: 0 })
      const user = await openRulesPage()
      await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'kiwi')

      const dialog = await openEditDialog(user, 'kiwi')
      await user.clear(dialog.getByLabelText('Keyword'))
      await user.type(dialog.getByLabelText('Keyword'), 'meny')
      await user.click(dialog.getByRole('button', { name: 'Save' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Rule updated. 0 transactions changed category.')
      expect(keywords()).toEqual(['kiwi minipris'])
    })

    it('says no rules match when the search leaves none', async () => {
      const user = await openRulesPage()

      await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'xyz')

      expect(screen.getByText('No rules match')).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      // In the panel, under its toolbar, so the search can still be changed.
      const panel = screen.getByText('No rules match').parentElement!
      expect(panel).toHaveClass('rounded-lg', 'bg-white', 'shadow-sm')
      expect(panel).toContainElement(screen.getByRole('searchbox', { name: 'Search' }))
    })
  })

  describe('filtering', () => {
    it("narrows the rules to one Category's, and shows them all again with All categories", async () => {
      api.rules = [
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

    it('shows only the rules every filter lets through: search, Category and Show only new', async () => {
      api.rules = [
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

      await user.click(screen.getByRole('checkbox', { name: 'Show only new' }))
      expect(keywords()).toEqual(['kiwi butikk AI New', 'kiwi senter New'])

      // Each filter still narrows the others' rules, and widening one leaves the others as they were.
      await user.clear(screen.getByRole('searchbox', { name: 'Search' }))
      expect(keywords()).toEqual(['kiwi butikk AI New', 'kiwi senter New', 'meny butikk AI New'])

      await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by category' }), 'All categories')
      expect(keywords()).toEqual(['kiwi butikk AI New', 'kiwi kafé AI New', 'kiwi senter New', 'meny butikk AI New'])
    })

    it('says no rules match when the Category filter and Show only new leave none', async () => {
      api.rules = [
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 3, keyword: 'café løkka', categoryId: 13, aiGenerated: true, isNew: true },
      ]
      const user = await openRulesPage()

      await user.click(screen.getByRole('checkbox', { name: 'Show only new' }))
      await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by category' }), 'Groceries')

      expect(screen.getByText('No rules match')).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()

      await user.click(screen.getByRole('checkbox', { name: 'Show only new' }))

      expect(keywords()).toEqual(['kiwi'])
    })
  })

  describe('sorting', () => {
    // How each column heading the table can be sorted by says it is sorted by it.
    function sortStates() {
      return Object.fromEntries(
        screen
          .getAllByRole('columnheader')
          .filter((header) => header.hasAttribute('aria-sort'))
          .map((header) => [header.textContent, header.getAttribute('aria-sort')]),
      )
    }

    // Clicks the column heading, rather than the page of the same name in the header.
    async function sortBy(user: ReturnType<typeof userEvent.setup>, heading: string) {
      await user.click(within(screen.getByRole('table')).getByRole('button', { name: heading }))
    }

    it('sorts by keyword A–Å by default, and Å–A once Keyword is clicked, and back again', async () => {
      api.rules = [
        { id: 5, keyword: 'zara', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 2, keyword: 'ørn', categoryId: 13, aiGenerated: false, isNew: false },
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 4, keyword: 'åpent', categoryId: 13, aiGenerated: false, isNew: false },
      ]
      const user = await openRulesPage()

      expect(keywords()).toEqual(['kiwi', 'zara', 'ørn', 'åpent'])
      expect(sortStates()).toEqual({ Keyword: 'ascending', Category: 'none' })

      await sortBy(user, 'Keyword')

      expect(keywords()).toEqual(['åpent', 'ørn', 'zara', 'kiwi'])
      expect(sortStates()).toEqual({ Keyword: 'descending', Category: 'none' })

      await sortBy(user, 'Keyword')

      expect(keywords()).toEqual(['kiwi', 'zara', 'ørn', 'åpent'])
      expect(sortStates()).toEqual({ Keyword: 'ascending', Category: 'none' })
    })

    it('sorts by Category name in the Norwegian alphabet, either way, keeping keyword A–Å within a Category', async () => {
      api.categoriesServed = [...categories, { id: 20, name: 'Ørsta Sport' }]
      api.rules = [
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 2, keyword: 'anorakk', categoryId: 20, aiGenerated: false, isNew: false },
        { id: 3, keyword: 'zara', categoryId: 13, aiGenerated: false, isNew: false },
        { id: 4, keyword: 'bunnpris', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 5, keyword: 'apotek', categoryId: 13, aiGenerated: false, isNew: false },
      ]
      const user = await openRulesPage()

      await sortBy(user, 'Category')

      expect(keywords()).toEqual(['bunnpris', 'kiwi', 'apotek', 'zara', 'anorakk'])
      expect(sortStates()).toEqual({ Keyword: 'none', Category: 'ascending' })

      await sortBy(user, 'Category')

      expect(keywords()).toEqual(['anorakk', 'apotek', 'zara', 'bunnpris', 'kiwi'])
      expect(sortStates()).toEqual({ Keyword: 'none', Category: 'descending' })
    })

    it('places a rule added or edited where the current sort puts it', async () => {
      api.rules = [
        { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
        { id: 2, keyword: 'zara', categoryId: 13, aiGenerated: false, isNew: false },
      ]
      const user = await openRulesPage()
      await sortBy(user, 'Category')
      await sortBy(user, 'Category')

      await addRuleInDialog(user, 'rema', 'Groceries')
      await screen.findByRole('status')

      expect(keywords()).toEqual(['zara', 'kiwi', 'rema'])

      const dialog = await openEditDialog(user, 'kiwi')
      await user.selectOptions(dialog.getByLabelText('Category'), 'Other')
      await user.click(dialog.getByRole('button', { name: 'Save' }))
      await screen.findByText('Rule updated. 0 transactions changed category.')

      expect(keywords()).toEqual(['kiwi', 'zara', 'rema'])
      expect(sortStates()).toEqual({ Keyword: 'none', Category: 'descending' })
    })
  })

  type RulePreview = {
    changedCount: number
    changes: {
      id: number
      date: string
      description: string
      amount: number
      fromCategoryId: number | null
      toCategoryId: number | null
    }[]
  }

  function answer(preview: RulePreview) {
    return Response.json(preview)
  }

  describe('deleting a rule, always with a confirmation', () => {
    const kiwi = { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false }
    const rema = { id: 2, keyword: 'rema', categoryId: 1, aiGenerated: false, isNew: false }

    // What the delete preview answers for a rule, and every rule it was asked about.
    let handlePreview: (id: number) => Response | Promise<Response>
    let asked: number[]

    const kiwiSentrum = {
      id: 7,
      date: '2026-08-14',
      description: 'Kiwi Sentrum',
      amount: -249.9,
      fromCategoryId: 1,
      toCategoryId: null,
    }
    const kiwiKafe = {
      id: 5,
      date: '2026-08-03',
      description: 'Kiwi Kafé',
      amount: -54,
      fromCategoryId: 1,
      toCategoryId: 13,
    }

    function deleteDialog() {
      return screen.queryByRole('dialog', { name: 'Delete the rule “kiwi”?' })
    }

    beforeEach(() => {
      api.rules = [kiwi, rema]
      handlePreview = () => answer({ changedCount: 5, changes: [kiwiSentrum, kiwiKafe] })
      asked = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          const previewUrl = /^\/api\/categorization-rules\/(\d+)\/preview$/.exec(url)
          if (!previewUrl || init?.method !== 'DELETE') return fetchMock(url, init)
          asked.push(Number(previewUrl[1]))
          return handlePreview(Number(previewUrl[1]))
        }),
      )
    })

    it('asks first, showing what deleting would change', async () => {
      let deletedId: number | undefined
      api.handleDeleteRule = (id) => {
        deletedId = id
        return Response.json({ transactionsChanged: 5 })
      }
      const user = await openRulesPage()

      await user.click(within(ruleRow('kiwi')).getByRole('button', { name: 'Delete' }))

      const dialog = within(deleteDialog()!)
      const shown = within(await dialog.findByRole('region', { name: 'Preview' }))
      expect(shown.getByText('Would change 5 transactions')).toBeInTheDocument()
      await user.click(shown.getByRole('button', { name: 'Show transactions' }))
      expect(shown.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        '14.08.2026Kiwi Sentrum-249,90 krGroceries → Uncategorized',
        '03.08.2026Kiwi Kafé-54,00 krGroceries → Other',
      ])
      expect(asked).toEqual([1])
      expect(deletedId).toBeUndefined()
      expect(screen.getByRole('cell', { name: 'kiwi' })).toBeInTheDocument()
    })

    it('says how many of the transactions it would change the list leaves out', async () => {
      const changes = Array.from({ length: 10 }, (_, i) => ({ ...kiwiSentrum, id: 100 + i }))
      handlePreview = () => answer({ changedCount: 14, changes })
      const user = await openRulesPage()

      await user.click(within(ruleRow('kiwi')).getByRole('button', { name: 'Delete' }))
      const shown = within(await within(deleteDialog()!).findByRole('region', { name: 'Preview' }))
      await user.click(shown.getByRole('button', { name: 'Show transactions' }))

      expect(shown.getAllByRole('listitem')).toHaveLength(10)
      expect(shown.getByText('The 10 newest of 14.')).toBeInTheDocument()
    })

    it('deletes the rule once confirmed and says how many transactions changed category', async () => {
      let deletedId: number | undefined
      api.handleDeleteRule = (id) => {
        deletedId = id
        return Response.json({ transactionsChanged: 5 })
      }
      const user = await openRulesPage()
      await user.click(within(ruleRow('kiwi')).getByRole('button', { name: 'Delete' }))
      await within(deleteDialog()!).findByRole('region', { name: 'Preview' })

      await user.click(within(deleteDialog()!).getByRole('button', { name: 'Confirm delete' }))

      expect(deletedId).toBe(1)
      expect(await screen.findByRole('status')).toHaveTextContent('Rule deleted. 5 transactions changed category.')
      expect(deleteDialog()).not.toBeInTheDocument()
      expect(screen.queryByRole('cell', { name: 'kiwi' })).not.toBeInTheDocument()
    })

    it('keeps the rule when the confirmation is cancelled, by Cancel or by Escape', async () => {
      let deleted = false
      api.handleDeleteRule = () => {
        deleted = true
        return Response.json({ transactionsChanged: 5 })
      }
      const user = await openRulesPage()

      await user.click(within(ruleRow('kiwi')).getByRole('button', { name: 'Delete' }))
      await user.click(within(deleteDialog()!).getByRole('button', { name: 'Cancel' }))

      expect(deleteDialog()).not.toBeInTheDocument()

      await user.click(within(ruleRow('kiwi')).getByRole('button', { name: 'Delete' }))
      expect(deleteDialog()).toBeInTheDocument()
      await user.keyboard('{Escape}')

      expect(deleteDialog()).not.toBeInTheDocument()
      expect(deleted).toBe(false)
      expect(screen.getByRole('cell', { name: 'kiwi' })).toBeInTheDocument()
      expect(screen.queryByRole('status')).toBeEmptyDOMElement()
    })

    it('asks first even for a rule that matches nothing, saying nothing would change', async () => {
      let deletedId: number | undefined
      api.handleDeleteRule = (id) => {
        deletedId = id
        return Response.json({ transactionsChanged: 0 })
      }
      handlePreview = () => answer({ changedCount: 0, changes: [] })
      const user = await openRulesPage()

      await user.click(within(ruleRow('rema')).getByRole('button', { name: 'Delete' }))

      const dialog = within(screen.getByRole('dialog', { name: 'Delete the rule “rema”?' }))
      expect(await dialog.findByRole('region', { name: 'Preview' })).toHaveTextContent('Nothing would change')
      expect(asked).toEqual([2])
      expect(deletedId).toBeUndefined()

      await user.click(dialog.getByRole('button', { name: 'Confirm delete' }))

      expect(deletedId).toBe(2)
      expect(await screen.findByRole('status')).toHaveTextContent('Rule deleted. 0 transactions changed category.')
    })

    it('says the rule was already deleted when it was deleted elsewhere while asking, showing no preview', async () => {
      const notFound = () => Response.json({ title: 'Not Found', status: 404 }, { status: 404 })
      handlePreview = notFound
      api.handleDeleteRule = notFound
      const user = await openRulesPage()
      await user.click(within(ruleRow('kiwi')).getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(asked).toEqual([1]))

      expect(within(deleteDialog()!).queryByRole('region', { name: 'Preview' })).not.toBeInTheDocument()

      await user.click(within(deleteDialog()!).getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByRole('status')).toHaveTextContent('The rule was already deleted.')
      expect(deleteDialog()).not.toBeInTheDocument()
      expect(screen.queryByRole('cell', { name: 'kiwi' })).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('still asks, and deletes once confirmed, when the preview cannot be had', async () => {
      handlePreview = () => new Response(null, { status: 500 })
      api.handleDeleteRule = () => Response.json({ transactionsChanged: 5 })
      const user = await openRulesPage()
      await user.click(within(ruleRow('kiwi')).getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(asked).toEqual([1]))

      const dialog = within(deleteDialog()!)
      expect(dialog.queryByRole('region', { name: 'Preview' })).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()

      await user.click(dialog.getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Rule deleted. 5 transactions changed category.')
    })

    it('keeps the confirmation open, saying why, when the delete cannot reach the server', async () => {
      api.handleDeleteRule = () => {
        throw new TypeError('Failed to fetch')
      }
      const user = await openRulesPage()
      await user.click(within(ruleRow('kiwi')).getByRole('button', { name: 'Delete' }))

      await user.click(within(deleteDialog()!).getByRole('button', { name: 'Confirm delete' }))

      expect(await within(deleteDialog()!).findByRole('alert')).toHaveTextContent('Could not reach the server.')
      expect(screen.getByRole('cell', { name: 'kiwi' })).toBeInTheDocument()
    })
  })
})

describe("Rules page from a Category's rule count", () => {
  const health = { id: 7, name: 'Health', description: 'Pharmacy etc.', builtIn: false, transactionCount: 4, ruleCount: 0 }

  beforeEach(() => {
    api.categoriesServed = [{ ...categories[0], ruleCount: 2 }, health, { ...categories[1], ruleCount: 1 }]
    api.rules = [
      { id: 3, keyword: 'apotek', categoryId: 13, aiGenerated: false, isNew: false },
      { id: 1, keyword: 'kiwi', categoryId: 1, aiGenerated: false, isNew: false },
      { id: 4, keyword: 'rema', categoryId: 1, aiGenerated: false, isNew: false },
    ]
  })

  async function openCategoriesPage() {
    const user = userEvent.setup()
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'Categories' }))
    await screen.findByText('All groceries.')
    return user
  }

  function keywords() {
    return screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0].textContent)
  }

  it('links each nonzero count, and shows a zero count as plain text', async () => {
    await openCategoriesPage()

    expect(screen.getByRole('button', { name: 'Show rules for Groceries (2)' })).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: 'Show rules for Other (1)' })).toHaveTextContent('1')
    const healthRow = screen.getByRole('row', { name: /Health/ })
    expect(within(healthRow).queryByRole('button', { name: /Show rules/ })).not.toBeInTheDocument()
    expect(within(healthRow).getAllByRole('cell')[3]).toHaveTextContent('0')
  })

  it("opens Rules filtered to the Category, listing only that Category's rules", async () => {
    const user = await openCategoriesPage()

    await user.click(screen.getByRole('button', { name: 'Show rules for Groceries (2)' }))

    expect(await screen.findByRole('cell', { name: 'kiwi' })).toBeInTheDocument()
    expect(keywords()).toEqual(['kiwi', 'rema'])
    expect(screen.getByRole('combobox', { name: 'Filter by category' })).toHaveDisplayValue('Groceries')
    expect(screen.getByRole('button', { name: 'Rules' })).toHaveAttribute('aria-current', 'page')
  })

  it('lets the filter be changed like any other once open', async () => {
    const user = await openCategoriesPage()
    await user.click(screen.getByRole('button', { name: 'Show rules for Groceries (2)' }))
    await screen.findByRole('cell', { name: 'kiwi' })
    const filter = screen.getByRole('combobox', { name: 'Filter by category' })

    await user.selectOptions(filter, 'Other')
    expect(keywords()).toEqual(['apotek'])

    await user.selectOptions(filter, 'All categories')
    expect(keywords()).toEqual(['apotek', 'kiwi', 'rema'])
  })

  // Opens the dialog for adding a rule, with the Add rule button beside the heading.
  async function openAddDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    return within(screen.getByRole('dialog', { name: 'Add rule' }))
  }

  it('starts the add dialog on the filtered Category, and again for the next rule', async () => {
    let posted: unknown
    api.handleAddRule = (body) => {
      posted = body
      return Response.json(
        { id: 5, ...(body as object), aiGenerated: false, isNew: false, transactionsChanged: 0 },
        { status: 201 },
      )
    }
    const user = await openCategoriesPage()
    await user.click(screen.getByRole('button', { name: 'Show rules for Groceries (2)' }))
    await screen.findByRole('cell', { name: 'kiwi' })

    let dialog = await openAddDialog(user)
    expect(dialog.getByLabelText('Category')).toHaveDisplayValue('Groceries')
    await user.type(dialog.getByLabelText('Keyword'), 'meny')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    expect(posted).toEqual({ keyword: 'meny', categoryId: 1 })
    expect(await screen.findByRole('cell', { name: 'meny' })).toBeInTheDocument()
    dialog = await openAddDialog(user)
    expect(dialog.getByLabelText('Keyword')).toHaveValue('')
    expect(dialog.getByLabelText('Category')).toHaveDisplayValue('Groceries')
  })

  it('opens from the header on all rules, with no Category chosen to add, after following a count', async () => {
    const user = await openCategoriesPage()
    await user.click(screen.getByRole('button', { name: 'Show rules for Other (1)' }))
    await screen.findByRole('cell', { name: 'apotek' })

    await user.click(screen.getByRole('button', { name: 'Categories' }))
    await screen.findByText('All groceries.')
    await user.click(screen.getByRole('button', { name: 'Rules' }))

    expect(await screen.findByRole('cell', { name: 'kiwi' })).toBeInTheDocument()
    expect(keywords()).toEqual(['apotek', 'kiwi', 'rema'])
    expect(screen.getByRole('combobox', { name: 'Filter by category' })).toHaveDisplayValue('All categories')
    const dialog = await openAddDialog(user)
    expect(dialog.getByLabelText('Category')).toHaveDisplayValue('Choose…')
  })

  it('adds an entry, so Back returns to Categories, and Forward opens all rules as from the header', async () => {
    const user = await openCategoriesPage()
    await user.click(screen.getByRole('button', { name: 'Show rules for Other (1)' }))
    await screen.findByRole('cell', { name: 'apotek' })
    expect(window.location.pathname).toBe('/rules')
    expect(window.location.search).toBe('')

    window.history.back()
    expect(await screen.findByText('All groceries.')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/categories')

    window.history.forward()
    expect(await screen.findByRole('cell', { name: 'kiwi' })).toBeInTheDocument()
    expect(keywords()).toEqual(['apotek', 'kiwi', 'rema'])
    expect(screen.getByRole('combobox', { name: 'Filter by category' })).toHaveDisplayValue('All categories')
  })
})
