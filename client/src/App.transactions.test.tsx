import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { monthOfDate } from './lib/month'
import { api, categories, fetchMock } from './test/fakeApi'
import { renderApp } from './test/renderApp'

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
    api.months = [{ year: 2026, month: 9 }]
    api.handleListPeriod = () => Response.json(septemberTransactions)
    const user = await openTransactionsPage()
    await screen.findByRole('cell', { name: 'Rema 1000' })
    return user
  }

  it('opens on the newest month with Transactions and lists its rows', async () => {
    api.months = [
      { year: 2026, month: 9 },
      { year: 2026, month: 8 },
      { year: 2025, month: 12 },
    ]
    api.handleListPeriod = (year, month) =>
      Response.json(year === 2026 && month === 9 ? septemberTransactions : [])

    await openTransactionsPage()

    await screen.findByRole('cell', { name: 'Rema 1000' })
    expect(screen.getByLabelText('Year')).toHaveValue('2026')
    expect(screen.getByLabelText('Month')).toHaveValue('9')
    expect(requestedPeriods()).toEqual(['/api/transactions?year=2026&month=9'])
  })

  it('shows the date, Description, Category or Uncategorized, and the Amount in NOK', async () => {
    api.months = [{ year: 2026, month: 9 }]
    api.handleListPeriod = () => Response.json(septemberTransactions)

    await openTransactionsPage()

    await screen.findByRole('cell', { name: 'Rema 1000' })
    expect(rowCells()).toEqual([
      ['24.09.2026', 'Rema 1000', 'Groceries', '-1\u00a0249,90\u00a0kr', '', '', ''],
      ['03.09.2026', 'Lønn Fra: Testfirma AS', 'Uncategorized', '24\u00a0500,00\u00a0kr', '', '', ''],
    ])
  })

  it('offers the years with Transactions plus the current year, and all twelve months after All months', async () => {
    api.months = [
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

  // The All view's toolbar: the Year, Month and Category selects, then the search, in that order.
  function toolbarControls() {
    return [
      screen.getByRole<HTMLSelectElement>('combobox', { name: 'Year' }),
      screen.getByRole<HTMLSelectElement>('combobox', { name: 'Month' }),
      screen.getByRole<HTMLSelectElement>('combobox', { name: 'Filter by category' }),
      screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search' }),
    ]
  }

  it('has a toolbar of the Year, Month and Category selects, then the search for descriptions last, each named without a visible label', async () => {
    await openSeptember()

    const controls = toolbarControls()
    expect(controls.at(-1)).toHaveAttribute('placeholder', 'Search descriptions')
    for (const control of controls) expect(control.labels).toHaveLength(0)
    for (const [index, control] of controls.slice(1).entries()) {
      expect(controls[index].compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('wraps the toolbar on a phone, with the search on its own line under the selects, never scrolling sideways', async () => {
    await openSeptember()

    const controls = toolbarControls()
    const selects = controls.slice(0, -1)
    const search = controls.at(-1)!
    const searchLine = search.parentElement!
    const toolbar = searchLine.parentElement!
    expect(toolbar).toHaveClass('flex-wrap')
    expect(searchLine).toHaveClass('max-sm:basis-full')
    for (const select of selects) {
      expect(select.parentElement).toBe(toolbar)
      // Shrinking, so a long Category name never pushes the toolbar wider than the screen.
      expect(select).toHaveClass('min-w-0')
    }
  })

  it("lists the whole year's Transactions when All months is chosen", async () => {
    api.months = [
      { year: 2026, month: 9 },
      { year: 2025, month: 3 },
    ]
    api.handleListPeriod = (year, month) =>
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
    api.months = [
      { year: 2026, month: 9 },
      { year: 2025, month: 9 },
    ]
    api.handleListPeriod = (year, month) =>
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
    api.months = [{ year: 2026, month: 9 }]
    api.handleListPeriod = () => Response.json(otherCategoryTransactions.concat(septemberTransactions[1]))
    const user = await openTransactionsPage()
    await screen.findByRole('cell', { name: 'Rema 1000' })

    const filter = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Filter by category' })
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
    const bøker = { ...septemberTransactions[0], id: 10, date: '2026-09-05', description: 'Bøker Og Blader' }
    api.months = [{ year: 2026, month: 9 }]
    api.handleListPeriod = () => Response.json([...otherCategoryTransactions, bøker])
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
    api.months = [{ year: 2026, month: 9 }]
    api.handleListPeriod = () => Response.json([...septemberTransactions, invoice])
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
    api.months = [{ year: 2026, month: 9 }]
    api.handleListPeriod = (_year, month) =>
      Response.json(month === undefined ? [octoberTransaction, ...septemberTransactions] : septemberTransactions)
    const user = await openTransactionsPage()
    await screen.findByRole('cell', { name: 'Rema 1000' })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by category' }), 'Groceries')
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'i')
    await user.selectOptions(screen.getByLabelText('Month'), 'All months')

    expect(await screen.findByRole('cell', { name: 'Kiwi' })).toBeInTheDocument()
    expect(rowCells().map((cells) => cells[1])).toEqual(['Kiwi'])
    expect(screen.getByRole('combobox', { name: 'Filter by category' })).toHaveValue('1')
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('i')
  })

  it('drops a row from the filtered list once its Category is changed to one the filter leaves out', async () => {
    api.handleChangeCategory = () => Response.json({ ...septemberTransactions[1], categoryId: 1 })
    const user = await openSeptember()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by category' }), 'Uncategorized')

    await user.selectOptions(categorySelect('Lønn Fra: Testfirma AS'), 'Groceries')

    expect(await screen.findByRole('status')).toHaveTextContent('Category changed')
    expect(screen.queryByRole('cell', { name: 'Lønn Fra: Testfirma AS' })).not.toBeInTheDocument()
  })

  it('says no transactions match when the filters leave none', async () => {
    const user = await openSeptember()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by category' }), 'Other')
    expect(screen.getByText('No transactions match')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by category' }), 'All categories')
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'xyz')
    expect(screen.getByText('No transactions match')).toBeInTheDocument()
  })

  it('says when the Transactions could not be loaded', async () => {
    api.months = new Response(null, { status: 500 })

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
    api.handleChangeCategory = (id, body) => {
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
    api.handleChangeCategory = () => new Response(null, { status: 500 })
    const user = await openSeptember()

    await user.selectOptions(categorySelect('Rema 1000'), 'Other')

    expect(await screen.findByRole('alert')).toHaveTextContent('Saving failed (500).')
    expect(categorySelect('Rema 1000')).toHaveValue('1')
  })

  it('shows an error when changing a Category cannot reach the server', async () => {
    api.handleChangeCategory = () => Promise.reject(new TypeError('Failed to fetch'))
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
    api.months = [{ year: 2026, month: 9 }]
    api.handleListPeriod = () => Response.json(otherCategoryTransactions)
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
    api.handleChangeCategory = (_id, body) =>
      Response.json({ ...otherCategoryTransactions[1], ...(body as object), locked: true })
    const user = await openOtherCategoryMonth()

    await user.selectOptions(categorySelect('Vipps *Ola Nordmann'), 'Groceries')

    expect(await screen.findByRole('status')).toHaveTextContent('Category changed')
    expect(categorySelect('Vipps *Ola Nordmann')).toHaveValue('1')
    expect(lockMark('Vipps *Ola Nordmann')).toBeInTheDocument()
  })

  it('leaves a Transaction unmarked when changing its Category fails', async () => {
    api.handleChangeCategory = () => new Response(null, { status: 500 })
    const user = await openOtherCategoryMonth()

    await user.selectOptions(categorySelect('Vipps *Ola Nordmann'), 'Groceries')

    expect(await screen.findByRole('alert')).toHaveTextContent('Saving failed (500).')
    expect(categorySelect('Vipps *Ola Nordmann')).toHaveValue('13')
    expect(lockMark('Vipps *Ola Nordmann')).not.toBeInTheDocument()
  })

  describe('sorting', () => {
    // A September Transaction with the given fields, the rest as an imported, Uncategorized one has.
    function september(id: number, date: string, description: string, amount: number, categoryId: number | null) {
      return {
        id,
        date: `2026-09-${date}`,
        description,
        amount,
        note: null,
        categoryId,
        locked: false,
        imported: true,
        bookmarked: false,
      }
    }

    // How each sortable column heading says the table is sorted by it.
    function sortStates() {
      return Object.fromEntries(
        screen
          .getAllByRole('columnheader')
          .slice(0, 4)
          .map((header) => [header.textContent, header.getAttribute('aria-sort')]),
      )
    }

    // Clicks the column heading, rather than the page or filter of the same name.
    async function sortBy(user: ReturnType<typeof userEvent.setup>, heading: string) {
      await user.click(within(screen.getByRole('table')).getByRole('button', { name: heading }))
    }

    function descriptions() {
      return rowCells().map((cells) => cells[1])
    }

    // Opens September listing the given Transactions in the order the server sends them.
    async function openSeptemberWith(transactions: ReturnType<typeof september>[]) {
      api.months = [{ year: 2026, month: 9 }]
      api.handleListPeriod = () => Response.json(transactions)
      const user = await openTransactionsPage()
      await screen.findByRole('cell', { name: transactions[0].description })
      return user
    }

    it('sorts by Date newest first by default, oldest first once Date is clicked, and back again', async () => {
      const user = await openSeptemberWith([
        september(1, '10', 'Kiwi', -89.9, 1),
        september(2, '24', 'Rema 1000', -1249.9, 1),
        september(3, '03', 'Lønn', 24500, null),
      ])

      expect(descriptions()).toEqual(['Rema 1000', 'Kiwi', 'Lønn'])
      expect(sortStates()).toEqual({ Date: 'descending', Description: 'none', Category: 'none', Amount: 'none' })

      await sortBy(user, 'Date')

      expect(descriptions()).toEqual(['Lønn', 'Kiwi', 'Rema 1000'])
      expect(sortStates()).toEqual({ Date: 'ascending', Description: 'none', Category: 'none', Amount: 'none' })

      await sortBy(user, 'Date')

      expect(descriptions()).toEqual(['Rema 1000', 'Kiwi', 'Lønn'])
      expect(sortStates()).toEqual({ Date: 'descending', Description: 'none', Category: 'none', Amount: 'none' })
    })

    it('goes newest first on the first click on Date after another column', async () => {
      const user = await openSeptemberWith([
        september(1, '10', 'Kiwi', -89.9, 1),
        september(2, '24', 'Rema 1000', -1249.9, 1),
        september(3, '03', 'Lønn', 24500, null),
      ])

      await sortBy(user, 'Description')
      await sortBy(user, 'Date')

      expect(descriptions()).toEqual(['Rema 1000', 'Kiwi', 'Lønn'])
      expect(sortStates()).toEqual({ Date: 'descending', Description: 'none', Category: 'none', Amount: 'none' })
    })

    it('leaves the Bookmark, Note and Delete columns unsortable', async () => {
      await openSeptemberWith([september(1, '10', 'Kiwi', -89.9, 1)])

      for (const header of screen.getAllByRole('columnheader').slice(4)) {
        expect(header).not.toHaveAttribute('aria-sort')
        expect(within(header).queryByRole('button')).not.toBeInTheDocument()
      }
    })

    it('sorts by the signed Amount, the biggest spending first, or the biggest income first', async () => {
      const user = await openSeptemberWith([
        september(1, '24', 'Rema 1000', -1249.9, 1),
        september(2, '20', 'Lønn', 24500, null),
        september(3, '12', 'Kiwi', -89.9, 1),
        september(4, '03', 'Gave', -500, 13),
      ])

      await sortBy(user, 'Amount')

      expect(descriptions()).toEqual(['Rema 1000', 'Gave', 'Kiwi', 'Lønn'])
      expect(sortStates()).toEqual({ Date: 'none', Description: 'none', Category: 'none', Amount: 'ascending' })

      await sortBy(user, 'Amount')

      expect(descriptions()).toEqual(['Lønn', 'Kiwi', 'Gave', 'Rema 1000'])
      expect(sortStates()).toEqual({ Date: 'none', Description: 'none', Category: 'none', Amount: 'descending' })
    })

    it('sorts by Description in the Norwegian alphabet, A–Å or Å–A', async () => {
      const user = await openSeptemberWith([
        september(1, '24', 'Åpent Bakeri', -59, 1),
        september(2, '20', 'zara', -599, 13),
        september(3, '12', 'Øl og mat', -149, 1),
        september(4, '03', 'Apotek 1', -89, 13),
      ])

      await sortBy(user, 'Description')

      expect(descriptions()).toEqual(['Apotek 1', 'zara', 'Øl og mat', 'Åpent Bakeri'])
      expect(sortStates()).toEqual({ Date: 'none', Description: 'ascending', Category: 'none', Amount: 'none' })

      await sortBy(user, 'Description')

      expect(descriptions()).toEqual(['Åpent Bakeri', 'Øl og mat', 'zara', 'Apotek 1'])
      expect(sortStates()).toEqual({ Date: 'none', Description: 'descending', Category: 'none', Amount: 'none' })
    })

    it('sorts by Category name in the Norwegian alphabet, Uncategorized last A–Å and first Å–A, newest first within each', async () => {
      api.categoriesServed = [...categories, { id: 20, name: 'Ørsta Sport' }]
      const user = await openSeptemberWith([
        september(1, '28', 'Anorakk', -899, 20),
        september(2, '24', 'Rema 1000', -1249.9, 1),
        september(3, '20', 'Lønn', 24500, null),
        september(4, '12', 'Gave', -500, 13),
        september(5, '03', 'Kiwi', -89.9, 1),
      ])

      await sortBy(user, 'Category')

      expect(descriptions()).toEqual(['Rema 1000', 'Kiwi', 'Gave', 'Anorakk', 'Lønn'])
      expect(sortStates()).toEqual({ Date: 'none', Description: 'none', Category: 'ascending', Amount: 'none' })

      await sortBy(user, 'Category')

      expect(descriptions()).toEqual(['Lønn', 'Anorakk', 'Gave', 'Rema 1000', 'Kiwi'])
      expect(sortStates()).toEqual({ Date: 'none', Description: 'none', Category: 'descending', Amount: 'none' })
    })

    it('orders Transactions that tie newest first whichever way the column goes, then as they arrived', async () => {
      // All four tie on Amount, and the two on the 12th on the date too.
      const user = await openSeptemberWith([
        september(1, '03', 'Kiwi', -89.9, 1),
        september(2, '24', 'Rema 1000', -89.9, 1),
        september(3, '12', 'Meny', -89.9, 1),
        september(4, '12', 'Bunnpris', -89.9, 1),
        september(5, '20', 'Joker', -500, 1),
      ])

      await sortBy(user, 'Amount')
      expect(descriptions()).toEqual(['Joker', 'Rema 1000', 'Meny', 'Bunnpris', 'Kiwi'])

      await sortBy(user, 'Amount')
      expect(descriptions()).toEqual(['Rema 1000', 'Meny', 'Bunnpris', 'Kiwi', 'Joker'])
    })

    it('sorts the Bookmarks too, keeping the sort when switching between All and Bookmarks', async () => {
      api.handleListBookmarks = () =>
        Response.json([
          { ...september(1, '24', 'Rema 1000', -1249.9, 1), bookmarked: true },
          { ...september(2, '03', 'Elkjøp', -4990, 13), date: '2024-05-17', bookmarked: true },
        ])
      const user = await openSeptemberWith([
        september(1, '24', 'Rema 1000', -1249.9, 1),
        september(3, '12', 'Kiwi', -89.9, 1),
      ])
      await sortBy(user, 'Amount')
      await sortBy(user, 'Amount')

      await user.click(within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: 'Bookmarks' }))

      await screen.findByRole('cell', { name: 'Elkjøp' })
      expect(descriptions()).toEqual(['Rema 1000', 'Elkjøp'])
      expect(sortStates()).toEqual({ Date: 'none', Description: 'none', Category: 'none', Amount: 'descending' })

      await sortBy(user, 'Description')
      expect(descriptions()).toEqual(['Elkjøp', 'Rema 1000'])

      await user.click(within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: 'All' }))

      await screen.findByRole('cell', { name: 'Kiwi' })
      expect(descriptions()).toEqual(['Kiwi', 'Rema 1000'])
      expect(sortStates()).toEqual({ Date: 'none', Description: 'ascending', Category: 'none', Amount: 'none' })
    })

    it('keeps the sort when the Period, Category filter or search changes', async () => {
      const kiwi = september(1, '12', 'Kiwi', -89.9, 1)
      const rema = september(2, '24', 'Rema 1000', -1249.9, 1)
      const meny = { ...september(3, '02', 'Meny', -349, 1), date: '2026-10-02' }
      const lønn = september(4, '03', 'Lønn', 24500, null)
      const user = await openSeptemberWith([rema, kiwi, lønn])
      api.handleListPeriod = (_year, month) => Response.json(month === undefined ? [meny, rema, kiwi, lønn] : [rema, kiwi, lønn])
      await sortBy(user, 'Amount')

      await user.selectOptions(screen.getByLabelText('Month'), 'All months')
      await screen.findByRole('cell', { name: 'Meny' })
      expect(descriptions()).toEqual(['Rema 1000', 'Meny', 'Kiwi', 'Lønn'])

      await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by category' }), 'Groceries')
      expect(descriptions()).toEqual(['Rema 1000', 'Meny', 'Kiwi'])

      await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'e')
      expect(descriptions()).toEqual(['Rema 1000', 'Meny'])
      expect(sortStates()).toEqual({ Date: 'none', Description: 'none', Category: 'none', Amount: 'ascending' })
    })

    it('moves a Transaction to where the sort puts it once its Category is changed', async () => {
      api.handleChangeCategory = (_id, body) =>
        Response.json({ ...september(3, '03', 'Lønn', 24500, null), ...(body as object), locked: true })
      const user = await openSeptemberWith([
        september(1, '24', 'Rema 1000', -1249.9, 1),
        september(2, '12', 'Gave', -500, 13),
        september(3, '03', 'Lønn', 24500, null),
      ])
      await sortBy(user, 'Category')
      expect(descriptions()).toEqual(['Rema 1000', 'Gave', 'Lønn'])

      await user.selectOptions(categorySelect('Lønn'), 'Groceries')

      expect(await screen.findByRole('status')).toHaveTextContent('Category changed')
      expect(descriptions()).toEqual(['Rema 1000', 'Lønn', 'Gave'])
    })

    it('closes an open Note editor, delete confirmation or "Bookmark added" popup when the sort changes', async () => {
      const user = await openSeptemberWith([
        september(1, '24', 'Rema 1000', -1249.9, 1),
        { ...september(2, '15', 'Frisør', -450, 13), imported: false },
      ])

      await user.click(screen.getByRole('button', { name: 'Add note for Rema 1000' }))
      expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument()
      await sortBy(user, 'Amount')
      expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Delete Frisør' }))
      expect(screen.getByText(/^Delete "Frisør"/)).toBeInTheDocument()
      await sortBy(user, 'Description')
      expect(screen.queryByText(/^Delete "Frisør"/)).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Bookmark Rema 1000' }))
      await screen.findByRole('dialog', { name: 'Bookmark added' })
      // From the keyboard, since a click outside the popup closes it anyway.
      act(() => within(screen.getByRole('table')).getByRole('button', { name: 'Date' }).focus())
      await user.keyboard('{Enter}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(sortStates()).toEqual({ Date: 'descending', Description: 'none', Category: 'none', Amount: 'none' })
    })

  })

  describe('Category dots', () => {
    // The dot in the Transaction's Category cell. Hidden from screen readers, it is found as the cell's
    // first hidden element.
    function dot(description: string) {
      const found = categorySelect(description).closest('td')!.querySelector<HTMLElement>('[aria-hidden="true"]')
      if (!found) throw new Error(`No dot for ${description}`)
      return found
    }

    it("puts a dot at the start of each Category select in the colour the Dashboard draws it in, or Uncategorized's grey", async () => {
      api.categoriesServed = [{ ...categories[0], colour: '#123456' }, categories[1]]
      api.months = [{ year: 2026, month: 9 }]
      api.handleListPeriod = () => Response.json([...otherCategoryTransactions, septemberTransactions[1]])
      await openTransactionsPage()
      await screen.findByRole('cell', { name: 'Rema 1000' })

      expect(dot('Rema 1000')).toHaveStyle({ backgroundColor: 'rgb(18, 52, 86)' })
      expect(dot('Gave')).toHaveStyle({ backgroundColor: 'rgb(144, 133, 233)' })
      expect(dot('Lønn Fra: Testfirma AS')).toHaveStyle({ backgroundColor: 'rgb(148, 163, 184)' })
      // Before the select, with the Locked icon still after it.
      expect(dot('Gave').compareDocumentPosition(categorySelect('Gave'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(categorySelect('Gave').compareDocumentPosition(lockMark('Gave')!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    })

    it("sits inside the select's border, at its left, letting a click through to the select", async () => {
      await openSeptember()

      expect(dot('Rema 1000').parentElement).toBe(categorySelect('Rema 1000').parentElement)
      expect(dot('Rema 1000')).toHaveClass('absolute', 'pointer-events-none')
      expect(categorySelect('Rema 1000')).toHaveClass('pl-7')
    })

    it('keeps the dot while the list of Categories is open, since only the options go without it', async () => {
      const user = await openSeptember()

      await user.click(categorySelect('Rema 1000'))
      expect(dot('Rema 1000')).toHaveStyle({ backgroundColor: 'rgb(42, 120, 214)' })
    })

    it('leaves the dot out of what a screen reader reads, since the select names the Category', async () => {
      await openSeptember()

      expect(within(transactionRow('Rema 1000')).queryByRole('img', { name: /colour/ })).not.toBeInTheDocument()
      expect(dot('Rema 1000')).not.toHaveAttribute('role')
      expect(dot('Rema 1000')).not.toHaveAttribute('aria-label')
    })

    it('changes the dot as soon as another Category is chosen, and back when saving fails', async () => {
      let failSave: () => void = () => {}
      api.handleChangeCategory = () =>
        new Promise((resolve) => {
          failSave = () => resolve(new Response(null, { status: 500 }))
        })
      const user = await openSeptember()

      await user.selectOptions(categorySelect('Lønn Fra: Testfirma AS'), 'Other')
      expect(dot('Lønn Fra: Testfirma AS')).toHaveStyle({ backgroundColor: 'rgb(144, 133, 233)' })

      failSave()
      expect(await screen.findByRole('alert')).toHaveTextContent('Saving failed (500).')
      expect(dot('Lønn Fra: Testfirma AS')).toHaveStyle({ backgroundColor: 'rgb(148, 163, 184)' })
    })

    it('draws a dot lighter in Dark, just as the Dashboard draws its Category', async () => {
      localStorage.setItem('appearance', 'dark')
      api.categoriesServed = [{ ...categories[0], colour: '#104281' }, categories[1]]
      api.months = [{ year: 2026, month: 9 }]
      api.handleSpending = () => Response.json({ total: 120, slices: [{ categoryId: 1, amount: 120 }] })
      api.handleListPeriod = () => Response.json(septemberTransactions)
      const user = userEvent.setup()
      await renderApp()
      const legendRow = await within(screen.getByRole('region', { name: 'Spending' })).findByRole('row', {
        name: /Groceries/,
      })
      const onDashboard = (legendRow.querySelector('[aria-hidden="true"]') as HTMLElement).style.backgroundColor

      await user.click(screen.getByRole('button', { name: 'Transactions' }))
      await screen.findByRole('cell', { name: 'Rema 1000' })

      expect(dot('Rema 1000').style.backgroundColor).toBe(onDashboard)
      expect(dot('Rema 1000')).not.toHaveStyle({ backgroundColor: 'rgb(16, 66, 129)' })
    })
  })

  it('gives Description the room left over, so Category, Amount and the icons keep their spacing', async () => {
    await openSeptember()

    const headings = within(screen.getByRole('table')).getAllByRole('columnheader')
    expect(headings[1]).toHaveTextContent('Description')
    expect(headings[1]).toHaveClass('w-full')
    for (const heading of [headings[0], ...headings.slice(2)]) expect(heading).not.toHaveClass('w-full')
  })

  describe('panel', () => {
    // The white panel the table sits in, as on Categories, with its ruled header row.
    function expectInPanel(table: HTMLElement) {
      expect(table.parentElement).toHaveClass('rounded-lg', 'border', 'bg-white', 'shadow-sm')
      expect(within(table).getAllByRole('rowgroup')[0]).toHaveClass('border-b')
    }

    it('shows the table in the white panel, in both All and Bookmarks', async () => {
      api.handleListBookmarks = () => Response.json([{ ...septemberTransactions[0], bookmarked: true }])
      const user = await openSeptember()
      expectInPanel(screen.getByRole('table'))

      await user.click(within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: 'Bookmarks' }))
      await waitFor(() => expect(screen.queryByRole('cell', { name: 'Lønn Fra: Testfirma AS' })).not.toBeInTheDocument())
      expectInPanel(screen.getByRole('table'))
    })

    it('has the toolbar as the top strip of the panel in All, ruled off above the column headers', async () => {
      await openSeptember()

      const panel = screen.getByRole('table').parentElement!
      const controls = toolbarControls()
      const toolbar = controls[0].parentElement!
      expect(panel.firstElementChild).toBe(toolbar)
      // Unruled while it is all the panel holds, as it is while the Period loads.
      expect(toolbar).toHaveClass('border-b', 'last:border-b-0', 'px-4')
    })

    it('says no Transactions match in the panel, under its toolbar, so the filters can still be changed', async () => {
      const user = await openSeptember()

      await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'xyz')

      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      const panel = screen.getByText('No transactions match').parentElement!
      expect(panel).toHaveClass('rounded-lg', 'bg-white', 'shadow-sm')
      for (const control of toolbarControls()) expect(panel).toContainElement(control)
    })

    it('says a Period has no Transactions in the panel, under its toolbar', async () => {
      api.months = [{ year: 2026, month: 9 }]
      api.handleListPeriod = () => Response.json([])
      await openTransactionsPage()

      const panel = (await screen.findByText('No transactions in September 2026')).parentElement!
      expect(panel).toHaveClass('rounded-lg', 'bg-white', 'shadow-sm')
      for (const control of toolbarControls()) expect(panel).toContainElement(control)
    })

    it('keeps the Date a little apart from the Description', async () => {
      await openSeptember()

      const [dateHeading] = within(screen.getByRole('table')).getAllByRole('columnheader')
      expect(dateHeading).toHaveClass('pr-5')
      expect(within(transactionRow('Rema 1000')).getAllByRole('cell')[0]).toHaveClass('pr-5')
    })

    it('lays each Transaction out as a card inside the panel on a phone, never scrolling sideways', async () => {
      const user = await openSeptember()
      await user.click(screen.getByRole('button', { name: 'Add note for Rema 1000' }))

      // jsdom applies no media queries, so the phone layout is checked by its classes: the table and
      // its body are blocks, the column headers hidden, and each card kept off the panel's edge.
      const table = screen.getByRole('table')
      const [head, body] = within(table).getAllByRole('rowgroup')
      expect(table).toHaveClass('max-sm:block')
      expect(head).toHaveClass('max-sm:hidden')
      expect(body).toHaveClass('max-sm:block')
      for (const description of ['Rema 1000', 'Lønn Fra: Testfirma AS']) {
        expect(transactionRow(description)).toHaveClass('max-sm:grid', 'max-sm:px-4')
      }
      // The Note editor under its card, kept off the edge too.
      expect(screen.getByRole('textbox', { name: 'Note' }).closest('td')).toHaveClass('px-4')
      const page = screen.getByRole('heading', { name: 'Transactions' }).closest('section')!
      expect(page.querySelector('[class*="overflow-x-auto"], [class*="min-w-"]:not([class*="min-w-0"])')).toBeNull()
    })
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
      api.months = [{ year: 2026, month: 9 }]
      api.handleListPeriod = () => Response.json(transactions)
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
      api.handleDeleteTransaction = (id) => {
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
      api.handleDeleteTransaction = () => {
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
      api.months = []
      await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByText('No transactions in September 2026')).toBeInTheDocument()
      expect(screen.getByLabelText('Month')).toHaveValue('9')
      expect(monthsRequests()).toBe(before + 1)
    })

    it("keeps the year chosen once the last of that year's Transactions is deleted", async () => {
      const lastOf2024 = { ...manualTransaction, date: '2024-03-15' }
      api.months = [{ year: 2024, month: 3 }]
      api.handleListPeriod = (year) => Response.json(year === 2024 ? [lastOf2024] : [])
      const user = await openTransactionsPage()
      await screen.findByRole('cell', { name: 'Frisør' })

      await user.click(deleteButton('Frisør'))
      api.months = []
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
      await user.selectOptions(screen.getByLabelText('Filter by category'), 'Groceries')
      await user.selectOptions(screen.getByLabelText('Filter by category'), 'All categories')
      expect(screen.queryByText(confirmation)).not.toBeInTheDocument()

      await user.click(deleteButton('Frisør'))
      await user.selectOptions(screen.getByLabelText('Month'), 'August')
      await user.selectOptions(screen.getByLabelText('Month'), 'September')
      await screen.findByRole('cell', { name: 'Frisør' })
      expect(screen.queryByText(confirmation)).not.toBeInTheDocument()
    })

    it("shows the server's reason and keeps the row when the delete is refused", async () => {
      api.handleDeleteTransaction = () =>
        Response.json({ detail: "Imported Transactions can't be deleted." }, { status: 409 })
      const user = await openMonthWithManualTransaction()

      await user.click(deleteButton('Frisør'))
      await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByRole('alert')).toHaveTextContent("Imported Transactions can't be deleted.")
      expect(screen.getByRole('cell', { name: 'Frisør' })).toBeInTheDocument()
    })

    it('removes a Transaction that was already deleted elsewhere', async () => {
      api.handleDeleteTransaction = () => new Response(null, { status: 404 })
      const user = await openMonthWithManualTransaction()

      await user.click(deleteButton('Frisør'))
      await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByRole('status')).toHaveTextContent('The transaction was already deleted.')
      expect(screen.queryByRole('cell', { name: 'Frisør' })).not.toBeInTheDocument()
    })

    it('keeps the Transaction and shows an error when the delete fails', async () => {
      api.handleDeleteTransaction = () => new Response(null, { status: 500 })
      const user = await openMonthWithManualTransaction()

      await user.click(deleteButton('Frisør'))
      await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Deleting failed (500).')
      expect(screen.getByRole('cell', { name: 'Frisør' })).toBeInTheDocument()
    })

    it('shows an error when a delete cannot reach the server', async () => {
      api.handleDeleteTransaction = () => Promise.reject(new TypeError('Failed to fetch'))
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
      api.handleAddBookmark = (id) => {
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
      api.months = [{ year: 2026, month: 9 }]
      api.handleListPeriod = () =>
        Response.json([{ ...septemberTransactions[0], bookmarked: true }, septemberTransactions[1]])
      const user = await openTransactionsPage()
      await screen.findByRole('cell', { name: 'Rema 1000' })
      return user
    }

    it('removes the Bookmark with a filled star, which empties at once, with no popup', async () => {
      const removed = waitingAnswer()
      const removedIds: number[] = []
      api.handleRemoveBookmark = (id) => {
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
      api.handleAddBookmark = () => new Response(null, { status: 500 })
      const user = await openSeptember()

      await user.click(screen.getByRole('button', { name: 'Bookmark Rema 1000' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not add the bookmark.')
      expect(screen.getByRole('button', { name: 'Bookmark Rema 1000' })).toHaveAttribute('aria-pressed', 'false')
    })

    it('fills the star again and says so when removing the Bookmark fails', async () => {
      api.handleRemoveBookmark = () => new Response(null, { status: 500 })
      const user = await openSeptemberWithABookmark()

      await user.click(screen.getByRole('button', { name: 'Remove bookmark for Rema 1000' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove the bookmark.')
      expect(screen.getByRole('button', { name: 'Remove bookmark for Rema 1000' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('says the same when the server cannot be reached', async () => {
      api.handleAddBookmark = () => Promise.reject(new TypeError('Failed to fetch'))
      api.handleRemoveBookmark = () => Promise.reject(new TypeError('Failed to fetch'))
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
        api.handleAddBookmark = () => added.response
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
          api.folders = [
            { id: 20, name: 'Tax deductible' },
            { id: 21, name: 'Warranty' },
          ]
        })

        // The popup open on Rema 1000, bookmarked in the Folder adding answered with, once the Folders
        // are loaded.
        async function openPopupIn(folderId: number | null) {
          api.handleAddBookmark = () => Response.json({ folderId })
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
          api.handleFileBookmark = (id, body) => {
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
          api.handleFileBookmark = () => filed.response
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
          api.handleFileBookmark = () => new Response(null, { status: 500 })
          const user = await openPopupIn(21)

          await user.selectOptions(popupFolderSelect(), 'Tax deductible')

          expect(await within(popup()).findByRole('alert')).toHaveTextContent('Could not move the bookmark.')
          expect(popupFolderSelect()).toHaveDisplayValue('Warranty')
          expect(popupFolderSelect()).toBeEnabled()
          expect(screen.getByRole('button', { name: 'Remove bookmark for Rema 1000' })).toHaveAttribute('aria-pressed', 'true')
        })

        it('says when the chosen Folder no longer exists', async () => {
          api.handleFileBookmark = () =>
            Response.json({ errors: { folderId: ['The folder no longer exists.'] } }, { status: 400 })
          const user = await openPopupIn(null)

          await user.selectOptions(popupFolderSelect(), 'Warranty')

          expect(await within(popup()).findByRole('alert')).toHaveTextContent('The folder no longer exists.')
          expect(popupFolderSelect()).toHaveDisplayValue('Bookmarks')
        })

        it('offers only the chosen option, disabled, until the Folders are loaded', async () => {
          const loaded = waitingAnswer()
          api.folders = loaded.response
          api.handleAddBookmark = () => Response.json({ folderId: 21 })
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
            api.handleAddFolder = (body) => {
              created.push(body)
              return Response.json({ id: 30, name: 'Kvitteringer' }, { status: 201 })
            }
            api.handleFileBookmark = (id, body) => {
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
            api.handleAddFolder = () =>
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
            api.handleAddFolder = () => new Response(null, { status: 500 })
            const user = await openPopupIn(null)
            await user.selectOptions(popupFolderSelect(), 'New folder…')
            await user.type(nameField(), 'Kvitteringer')

            await user.click(within(popup()).getByRole('button', { name: 'Create' }))

            expect(await within(popup()).findByRole('alert')).toHaveTextContent('Saving failed (500).')
            expect(nameField()).toHaveValue('Kvitteringer')
          })

          it('keeps the new Folder, with the dropdown back on the Bookmark\'s Folder, when filing in it fails', async () => {
            api.handleAddFolder = () => Response.json({ id: 30, name: 'Kvitteringer' }, { status: 201 })
            api.handleFileBookmark = () => new Response(null, { status: 500 })
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
        api.handleAddBookmark = () => new Response(null, { status: 500 })
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
        api.handleRemoveBookmark = (id) => {
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
        api.handleRemoveBookmark = () => new Response(null, { status: 500 })
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
        api.handleListBookmarks = () => Response.json([{ ...septemberTransactions[0], bookmarked: true }])
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
      api.months = [{ year: 2026, month: 9 }]
      api.handleListPeriod = () => Response.json(keptReceiptTransactions)
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
      api.handleChangeNote = (id, body) => {
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
      api.folders = [{ id: 21, name: 'Warranty' }]
      api.handleListBookmarks = () => Response.json([{ ...keptReceiptTransactions[0], bookmarked: true }])
      api.handleListFolderBookmarks = () =>
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
      api.months = [{ year: 2026, month: 9 }]
      api.handleListPeriod = () => Response.json(septemberTransactions)
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
      api.handleChangeNote = () => new Promise((resolve) => (respond = resolve))
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

    it('lists the bookmarks from any date in place of the Year, Month, Category and search', async () => {
      api.handleListBookmarks = () => Response.json(bookmarks)
      const user = await openSeptember()

      await showBookmarks(user)

      expect(await screen.findByRole('cell', { name: 'Elkjøp' })).toBeInTheDocument()
      expect(switchButton('Bookmarks')).toHaveAttribute('aria-pressed', 'true')
      expect(switchButton('All')).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByLabelText('Folder')).toHaveDisplayValue('Bookmarks')
      for (const field of ['Year', 'Month', 'Filter by category', 'Search']) {
        expect(screen.queryByLabelText(field)).not.toBeInTheDocument()
      }
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
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
      // In the panel, under the Folder dropdown at its top, as All says it has none under its toolbar.
      const panel = screen.getByText('No bookmarks').parentElement!
      expect(panel).toHaveClass('rounded-lg', 'bg-white', 'shadow-sm')
      expect(panel.firstElementChild).toContainElement(screen.getByLabelText('Folder'))
    })

    it('says when the bookmarks could not be loaded', async () => {
      api.handleListBookmarks = () => new Response(null, { status: 500 })
      const user = await openSeptember()

      await showBookmarks(user)

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the bookmarks.')
      expect(screen.queryByText('No bookmarks')).not.toBeInTheDocument()
    })

    it('restores the Year, Month, Category, Search and listed Transactions when switching back to All', async () => {
      api.months = [
        { year: 2026, month: 9 },
        { year: 2025, month: 3 },
      ]
      api.handleListPeriod = (_year, month) =>
        Response.json(month === undefined ? [octoberTransaction, ...septemberTransactions] : septemberTransactions)
      api.handleListBookmarks = () => Response.json(bookmarks)
      const user = await openTransactionsPage()
      await screen.findByRole('cell', { name: 'Rema 1000' })
      await user.selectOptions(screen.getByLabelText('Month'), 'All months')
      await screen.findByRole('cell', { name: 'Kiwi' })
      await user.selectOptions(screen.getByLabelText('Filter by category'), 'Groceries')
      await user.type(screen.getByLabelText('Search'), 'i')
      await showBookmarks(user)
      await screen.findByRole('cell', { name: 'Elkjøp' })
      const periodsRequested = requestedPeriods().length

      await user.click(switchButton('All'))

      expect(switchButton('All')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByLabelText('Year')).toHaveValue('2026')
      expect(screen.getByLabelText('Month')).toHaveValue('')
      expect(screen.getByLabelText('Filter by category')).toHaveValue('1')
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
      api.handleListBookmarks = () => Response.json(bookmarks)
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
      api.handleAddBookmark = (id) => {
        addedIds.push(id)
        return Response.json({ folderId: null })
      }
      api.handleListBookmarks = () => Response.json(bookmarks)
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
      api.handleListBookmarks = () => Response.json([bookmarks[0]])
      await user.click(switchButton('All'))
      await showBookmarks(user)

      expect(await screen.findByRole('cell', { name: 'Rema 1000' })).toBeInTheDocument()
      expect(listedDescriptions()).toEqual(['Rema 1000'])
    })

    it('shows a star changed in Bookmarks the same in All', async () => {
      api.months = [{ year: 2026, month: 9 }]
      api.handleListPeriod = () => Response.json([bookmarks[0], septemberTransactions[1]])
      api.handleListBookmarks = () => Response.json(bookmarks)
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
      api.handleListBookmarks = () => Response.json(bookmarks)
      api.handleChangeCategory = (_id, body) => Response.json({ ...bookmarks[1], ...(body as object) })
      api.handleChangeNote = (_id, body) => Response.json({ ...bookmarks[1], ...(body as object) })
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
      api.handleDeleteTransaction = (id) => {
        deletedId = id
        return new Response(null, { status: 204 })
      }
      api.handleListBookmarks = () => Response.json(bookmarks)
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
        api.folders = [
          { id: 20, name: 'Tax deductible' },
          { id: 21, name: 'Warranty' },
        ]
        api.handleListBookmarks = () => Response.json(bookmarks)
        api.handleListFolderBookmarks = (folderId) => Response.json(folderId === 21 ? warrantyBookmarks : [])
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
        api.handleListFolderBookmarks = () => Response.json([])

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
        api.folders = new Response(null, { status: 500 })
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
          api.handleAddFolder = (body) => {
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
          api.handleAddFolder = () =>
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
          api.handleAddFolder = () => new Response(null, { status: 500 })
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

      it("has the Folder dropdown, Rename, Delete and the delete question as the panel's top strip, ruled off above the column headers", async () => {
        const user = await showWarranty()

        await user.click(screen.getByRole('button', { name: 'Delete' }))

        const strip = screen.getByRole('table').parentElement!.firstElementChild!
        expect(strip).toHaveClass('border-b', 'px-4')
        for (const element of [
          folderSelect(),
          screen.getByRole('button', { name: 'Rename' }),
          screen.getByRole('button', { name: 'Confirm delete' }),
          screen.getByText("Delete 'Warranty' and its bookmarks?"),
        ]) {
          expect(strip).toContainElement(element)
        }
      })

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
        api.handleAddBookmark = () => Response.json({ folderId: 21 })
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

        api.handleListFolderBookmarks = (folderId) => Response.json(folderId === 20 ? warrantyBookmarks : [])
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
          api.handleRenameFolder = (id, body) => {
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
          api.handleRenameFolder = () =>
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
          api.handleDeleteFolder = (id) => {
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
          api.handleDeleteFolder = () => new Response(null, { status: 500 })
          const user = await showWarranty()
          await user.click(screen.getByRole('button', { name: 'Delete' }))

          await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

          expect(await screen.findByRole('alert')).toHaveTextContent('Deleting failed (500).')
          expect(folderSelect()).toHaveDisplayValue('Warranty')
          expect(folderOptions()).toEqual(['Bookmarks', 'Tax deductible', 'Warranty', 'New folder…'])
          expect(listedDescriptions()).toEqual(['Power'])
        })

        it('says so when the Folder was already deleted, and shows "Bookmarks"', async () => {
          api.handleDeleteFolder = () => new Response(null, { status: 404 })
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
          api.months = [{ year: 2026, month: 9 }]
          api.handleListPeriod = () =>
            Response.json([{ ...warrantyBookmarks[0], date: '2026-09-10', bookmarked: powerBookmarked }])
          api.handleDeleteFolder = () => {
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
    api.categoriesServed = [categories[0], health, categories[1]]
    api.months = [
      { year: 2026, month: 3 },
      { year: 2026, month: 1 },
      { year: 2025, month: 11 },
      { year: 2024, month: 5 },
      { year: 2023, month: 2 },
    ]
    api.handleListPeriod = (year, month) =>
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
    return ['Year', 'Month', 'Filter by category'].map(
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
    api.uncategorizedCount = 1
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

  it('adds an entry, so Back returns to Categories, and Forward opens Transactions as from the header', async () => {
    const user = await openCategoriesPage()
    await user.click(screen.getByRole('button', { name: 'Show transactions in Other (1)' }))
    await screen.findByRole('cell', { name: 'Elkjøp' })
    expect(window.location.pathname).toBe('/transactions')
    expect(window.location.search).toBe('')

    window.history.back()
    expect(await screen.findByText('All groceries.')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/categories')

    window.history.forward()
    expect(await screen.findByRole('cell', { name: 'Rema 1000' })).toBeInTheDocument()
    expect(chosenFilters()).toEqual(['2026', 'March', 'All categories'])
  })
})
