import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { monthOfDate } from './lib/month'
import { api, categories, fetchMock, monthlySpending } from './test/fakeApi'
import { deviceSetting, fillValidForm, openModal, renderApp, statementPdf } from './test/renderApp'

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
    return ['Year', 'Month', 'Filter by category'].map(
      (label) => (screen.getByLabelText(label) as HTMLSelectElement).selectedOptions[0].textContent,
    )
  }

  // Serves the Transactions of the requested year or month out of `transactions`.
  function serveTransactions(transactions: { date: string }[]) {
    api.handleListPeriod = (year, month) =>
      Response.json(
        transactions.filter(
          (t) => monthOfDate(t.date).year === year && (month === undefined || monthOfDate(t.date).month === month),
        ),
      )
  }

  it("opens on the latest month with Transactions and shows its Spending by Category, largest first", async () => {
    api.months = [
      { year: 2026, month: 9 },
      { year: 2026, month: 8 },
      { year: 2025, month: 12 },
    ]
    api.handleSpending = (year, month) =>
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
    api.months = [
      { year: 2026, month: 9 },
      { year: 2026, month: 8 },
    ]
    api.handleSpending = (_year, month) =>
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
    api.months = [
      { year: 2026, month: 9 },
      { year: 2026, month: 8 },
    ]
    api.handleSpending = (_year, month) =>
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
    api.categoriesServed = [{ ...categories[0], colour: '#123456' }, { ...categories[1], colour: '#abcdef' }]
    api.months = [{ year: 2026, month: 9 }]
    api.handleSpending = () => Response.json(septemberSpending)
    await renderApp()
    await waitFor(() => expect(legendRows()).toHaveLength(3))

    expect(swatchColour('Groceries')).toBe('rgb(18, 52, 86)')
    expect(swatchColour('Other')).toBe('rgb(171, 205, 239)')
    expect(swatchColour('Uncategorized')).toBe('rgb(148, 163, 184)')
  })

  it('adds a Savings slice, counted in the total and percentages, while Include savings is on', async () => {
    api.categoriesServed = [...categories, { id: 12, name: 'Savings' }]
    api.months = [{ year: 2026, month: 9 }]
    api.handleSpending = (_year, _month, _quarter, includeSavings) =>
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
    api.categoriesServed = [...categories, { id: 12, name: 'Savings' }]
    api.months = [{ year: 2026, month: 9 }]
    api.handleSpending = (_year, _month, _quarter, includeSavings) =>
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

  describe('a Category with negative Spending', () => {
    const clothing = { id: 14, name: 'Clothing', colour: '#eb6834' }

    beforeEach(() => {
      api.categoriesServed = [...categories, clothing]
      api.months = [{ year: 2026, month: 9 }]
    })

    // The legend swatch of the named row: its fill and its outline, as CSS colours.
    function swatch(name: string) {
      const row = within(dashboard()).getByRole('row', { name: new RegExp(`^${name}`) })
      const { backgroundColor, borderColor } = (row.querySelector('[aria-hidden="true"]') as HTMLElement).style
      return { fill: backgroundColor, outline: borderColor }
    }

    // The fill of each part of the ring: its slices, or the empty ring.
    function ringFills() {
      return [...dashboard().querySelectorAll('.recharts-pie-sector path')].map((sector) => sector.getAttribute('fill'))
    }

    it('is listed after the slices with a hollow swatch and "–" for its share, with no slice, beside the netted Total', async () => {
      api.handleSpending = () =>
        Response.json({
          total: 1270.5,
          slices: [...septemberSpending.slices, { categoryId: 14, amount: -300 }],
        })

      await renderApp()

      await waitFor(() => expect(legendRows()).toHaveLength(4))
      expect(legendRows()).toEqual([
        ['Other', '1 000,00 kr', '63,7 %'],
        ['Uncategorized', '450,50 kr', '28,7 %'],
        ['Groceries', '120,00 kr', '7,6 %'],
        ['Clothing', '-300,00 kr', '–'],
      ])
      expect(centreTotal()).toBe('Total 1 270,50 kr')
      expect(swatch('Clothing')).toEqual({ fill: 'transparent', outline: 'rgb(235, 104, 52)' })
      expect(swatch('Groceries').fill).toBe('rgb(42, 120, 214)')
      expect(ringFills()).toEqual(['#9085e9', '#94a3b8', '#2a78d6'])
    })

    it('lists the Categories with negative Spending after the slices with the most negative last, as the API orders them', async () => {
      api.categoriesServed = [...categories, clothing, { id: 15, name: 'Shopping', colour: '#1baf7a' }]
      api.handleSpending = () =>
        Response.json({
          total: -230,
          slices: [
            { categoryId: 1, amount: 100 },
            { categoryId: 15, amount: -30 },
            { categoryId: 14, amount: -300 },
          ],
        })

      await renderApp()

      await waitFor(() =>
        expect(legendRows()).toEqual([
          ['Groceries', '100,00 kr', '100,0 %'],
          ['Shopping', '-30,00 kr', '–'],
          ['Clothing', '-300,00 kr', '–'],
        ]),
      )
      expect(centreTotal()).toBe('Total -230,00 kr')
    })

    it('shows the empty ring, the negative Total and the negative rows when no Category is above zero', async () => {
      api.handleSpending = () =>
        Response.json({
          total: -350,
          slices: [
            { categoryId: null, amount: -50 },
            { categoryId: 14, amount: -300 },
          ],
        })

      await renderApp()

      await waitFor(() =>
        expect(legendRows()).toEqual([
          ['Uncategorized', '-50,00 kr', '–'],
          ['Clothing', '-300,00 kr', '–'],
        ]),
      )
      expect(centreTotal()).toBe('Total -350,00 kr')
      expect(swatch('Uncategorized')).toEqual({ fill: 'transparent', outline: 'rgb(148, 163, 184)' })
      expect(ringFills()).toEqual(['#e2e8f0'])
    })

    it('shows the coloured ring and a Total of 0 when the Categories net to exactly zero', async () => {
      api.handleSpending = () =>
        Response.json({
          total: 0,
          slices: [
            { categoryId: 1, amount: 300 },
            { categoryId: 14, amount: -300 },
          ],
        })

      await renderApp()

      await waitFor(() =>
        expect(legendRows()).toEqual([
          ['Groceries', '300,00 kr', '100,0 %'],
          ['Clothing', '-300,00 kr', '–'],
        ]),
      )
      expect(centreTotal()).toBe('Total 0,00 kr')
      expect(ringFills()).toEqual(['#2a78d6'])
    })

    it('gives Savings a negative row beside the netted Total while Include savings is on, when more was taken out than put in', async () => {
      api.categoriesServed = [...categories, { id: 12, name: 'Savings', colour: '#1baf7a' }]
      api.handleSpending = (_year, _month, _quarter, includeSavings) =>
        Response.json(
          includeSavings
            ? {
                total: -1500,
                slices: [
                  { categoryId: 1, amount: 500 },
                  { categoryId: 12, amount: -2000 },
                ],
              }
            : { total: 500, slices: [{ categoryId: 1, amount: 500 }] },
        )
      const user = userEvent.setup()
      await renderApp()
      await waitFor(() => expect(legendRows()).toEqual([['Groceries', '500,00 kr', '100,0 %']]))

      await user.click(within(dashboard()).getByRole('checkbox', { name: 'Include savings' }))

      await waitFor(() =>
        expect(legendRows()).toEqual([
          ['Groceries', '500,00 kr', '100,0 %'],
          ['Savings', '-2 000,00 kr', '–'],
        ]),
      )
      expect(centreTotal()).toBe('Total -1 500,00 kr')
      expect(swatch('Savings')).toEqual({ fill: 'transparent', outline: 'rgb(27, 175, 122)' })
      expect(ringFills()).toEqual(['#2a78d6'])
    })
  })

  it('says when the Spending could not be loaded', async () => {
    api.handleSpending = () => new Response(null, { status: 500 })

    await renderApp()

    expect(await within(dashboard()).findByRole('alert')).toHaveTextContent('Could not load the Spending.')
  })

  it('says when the months could not be loaded', async () => {
    api.months = new Response(null, { status: 500 })

    await renderApp()

    expect(await within(dashboard()).findByRole('alert')).toHaveTextContent('Could not load the Spending.')
  })

  it('reloads after a Bank Statement is uploaded', async () => {
    const user = userEvent.setup()
    await renderApp()
    await waitFor(() => expect(centreTotal()).toBe('Total 0,00 kr'))
    api.months = [{ year: 2026, month: 9 }]
    api.handleSpending = () => Response.json(septemberSpending)

    await user.upload(screen.getByLabelText(/bank statement pdf/i), statementPdf)

    await waitFor(() => expect(centreTotal()).toBe('Total 1 570,50 kr'))
    expect(screen.getByLabelText('Period')).toHaveValue('2026-9')
  })

  it('keeps the Period and Include savings when reloading after an upload', async () => {
    api.months = [
      { year: 2026, month: 9 },
      { year: 2026, month: 8 },
    ]
    const user = userEvent.setup()
    await renderApp()
    await waitFor(() => expect(centreTotal()).toBe('Total 0,00 kr'))
    await user.selectOptions(screen.getByLabelText('Period'), 'August 2026')
    await user.click(within(dashboard()).getByRole('checkbox', { name: 'Include savings' }))
    api.handleSpending = () => Response.json(septemberSpending)

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
    api.months = [{ year: 2026, month: 9 }]
    api.handleSpending = () => Response.json(septemberSpending)

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(centreTotal()).toBe('Total 1 570,50 kr'))
  })

  describe('coming back to the home view', () => {
    it('keeps the Granularity, Period and Include savings, and fetches the Spending again', async () => {
      api.months = [
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
      api.handleSpending = () => Response.json(septemberSpending)

      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

      await waitFor(() => expect(centreTotal()).toBe('Total 1 570,50 kr'))
      expect(within(dashboard()).getByLabelText('Granularity')).toHaveDisplayValue('Quarter')
      expect(screen.getByLabelText('Period')).toHaveValue('2026-Q1')
      expect(within(dashboard()).getByRole('checkbox', { name: 'Include savings' })).toBeChecked()
      expect(requestedSpending().slice(requestsBefore)).toEqual([
        '/api/spending?year=2026&quarter=1&includeSavings=true',
      ])
    })

    it('keeps the Granularity, Period and Include savings, and fetches the Spending again, by Back', async () => {
      api.months = [
        { year: 2026, month: 9 },
        { year: 2026, month: 3 },
      ]
      const user = userEvent.setup()
      await renderApp()
      await waitFor(() => expect(centreTotal()).toBe('Total 0,00 kr'))
      await user.selectOptions(within(dashboard()).getByLabelText('Granularity'), 'Quarter')
      await user.selectOptions(screen.getByLabelText('Period'), 'Q1 2026')
      await user.click(within(dashboard()).getByRole('checkbox', { name: 'Include savings' }))
      await user.click(screen.getByRole('button', { name: 'Rules' }))
      const requestsBefore = requestedSpending().length
      api.handleSpending = () => Response.json(septemberSpending)

      window.history.back()

      await waitFor(() => expect(centreTotal()).toBe('Total 1 570,50 kr'))
      expect(within(dashboard()).getByLabelText('Granularity')).toHaveDisplayValue('Quarter')
      expect(screen.getByLabelText('Period')).toHaveValue('2026-Q1')
      expect(within(dashboard()).getByRole('checkbox', { name: 'Include savings' })).toBeChecked()
      expect(requestedSpending().slice(requestsBefore)).toEqual([
        '/api/spending?year=2026&quarter=1&includeSavings=true',
      ])
    })

    it('keeps the Granularity, Period and Include savings after a visit to the User page', async () => {
      api.months = [
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
      api.months = [{ year: 2026, month: 9 }]
      api.handleSpending = () => new Response(null, { status: 500 })
      const user = userEvent.setup()
      await renderApp()
      expect(await within(dashboard()).findByRole('alert')).toHaveTextContent('Could not load the Spending.')
      await user.click(screen.getByRole('button', { name: 'Transactions' }))
      api.handleSpending = () => Response.json(septemberSpending)

      await user.click(screen.getByRole('button', { name: 'PersonligFinans' }))

      await waitFor(() => expect(centreTotal()).toBe('Total 1 570,50 kr'))
      expect(within(dashboard()).queryByRole('alert')).toBeNull()
    })

    it('shows a Transaction recategorized on the Transactions page', async () => {
      api.months = [{ year: 2026, month: 9 }]
      let uncategorizedAmount = 450.5
      api.handleSpending = () =>
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
      api.handleListPeriod = () => Response.json([transaction])
      api.handleChangeCategory = () => {
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
      api.months = [
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
      api.months = [
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
      api.months = monthsWithTransactions
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
      api.handleSpending = (_year, _month, quarter) =>
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
      api.months = [
        { year: 2026, month: 9 },
        { year: 2025, month: 12 },
      ]
      api.handleSpending = () => Response.json(septemberSpending)
      api.handleListPeriod = () => Response.json(groceriesAndUncategorized)
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

    it('adds an entry, so Back returns to the Dashboard, and Forward opens Transactions as from the header', async () => {
      const user = await openDashboard()
      await user.selectOptions(screen.getByLabelText('Period'), 'December 2025')
      await user.click(await legendButton('Groceries'))
      await screen.findByRole('cell', { name: 'Rema 1000' })
      expect(window.location.pathname).toBe('/transactions')
      expect(window.location.search).toBe('')

      window.history.back()
      expect(await screen.findByRole('region', { name: 'Spending' })).toBeInTheDocument()
      expect(window.location.pathname).toBe('/')

      window.history.forward()
      expect(await screen.findByRole('cell', { name: 'Ukjent butikk' })).toBeInTheDocument()
      expect(chosenFilters()).toEqual(['2026', 'September', 'All categories'])
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
      expect(screen.getByLabelText('Filter by category')).toHaveDisplayValue('Uncategorized')
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

    it("opens the Transactions of a Category with negative Spending from its legend row, though it has no slice", async () => {
      api.categoriesServed = [...categories, { id: 14, name: 'Clothing', colour: '#eb6834' }]
      api.months = [{ year: 2026, month: 9 }]
      api.handleSpending = () =>
        Response.json({ total: -180, slices: [{ categoryId: 1, amount: 120 }, { categoryId: 14, amount: -300 }] })
      api.handleListPeriod = () =>
        Response.json([
          ...groceriesAndUncategorized,
          { ...groceriesAndUncategorized[0], id: 6, description: 'Zalando retur', amount: 300, categoryId: 14 },
        ])
      const user = userEvent.setup()
      await renderApp()

      await user.click(await legendButton('Clothing'))

      expect(await screen.findByRole('cell', { name: 'Zalando retur' })).toBeInTheDocument()
      expect(listedDescriptions()).toEqual(['Zalando retur'])
      expect(chosenFilters()).toEqual(['2026', 'September', 'Clothing'])
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
        api.handleListPeriod = () => new Response(null, { status: 500 })

        await user.click(await legendButton('Groceries'))

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the transactions.')
        expect(requestedPeriods()).toEqual(['/api/transactions?year=2025'])
      })

      it('stays on the page chosen while the month was being found', async () => {
        const user = await openQuarter()
        let finishLoading = () => {}
        api.handleListPeriod = () =>
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
      api.months = [
        { year: 2026, month: 9 },
        { year: 2026, month: 8 },
      ]

      await renderApp()

      await waitFor(() => expect(trendTable()).toHaveLength(2))
      expect(dashboard().compareDocumentPosition(trend())).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    })

    it('opens on the 12 months ending at the latest month with Transactions, offering every month from the earliest', async () => {
      api.months = [
        { year: 2026, month: 9 },
        { year: 2026, month: 8 },
        { year: 2025, month: 4 },
        { year: 2025, month: 1 },
      ]
      api.handleMonthlySpending = (from, to) =>
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
          ['Groceries', '600,00 kr', '0,00 kr', '▼ −100,0 %'],
          ['Uncategorized', '400,00 kr', '0,00 kr', '▼ −100,0 %'],
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
      api.months = [
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
      api.months = offered

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
      ['Spending that stopped', 400, 0, '400,00 kr', '0,00 kr', '▼ −100,0 %'],
      ['no Spending at either end', 0, 0, '0,00 kr', '0,00 kr', '–'],
    ])('shows the first and last monthly totals and the change for %s', async (_case, first, last, firstShown, lastShown, change) => {
      api.months = [
        { year: 2026, month: 3 },
        { year: 2026, month: 1 },
      ]
      api.handleMonthlySpending = (from, to) =>
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
        api.months = [
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
        api.handleMonthlySpending = (from, to) =>
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
        api.months = [
          { year: 2026, month: 9 },
          { year: 2023, month: 1 },
        ]
        api.handleMonthlySpending = (from, to) =>
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
        api.months = [
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
        api.months = [
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
        api.months = offered
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
        api.months = [
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
        api.months = offered
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
        api.months = [
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

    it("gives the same Total as the donut for the donut's month while Include savings is off", async () => {
      api.categoriesServed = [...categories, { id: 14, name: 'Clothing', colour: '#eb6834' }]
      api.months = [
        { year: 2026, month: 9 },
        { year: 2026, month: 8 },
      ]
      const september = [
        { categoryId: 1, amount: 500 },
        { categoryId: 14, amount: -300 },
      ]
      api.handleSpending = () => Response.json({ total: 200, slices: september })
      api.handleMonthlySpending = (from, to) => Response.json(monthlySpending(from, to, { '2026-9': september }))

      await renderApp()

      await waitFor(() => expect(trendTable()[0]).toEqual(['', 'August 2026', 'September 2026', 'Change']))
      await waitFor(() => expect(centreTotal()).toBe('Total 200,00 kr'))
      expect(trendTable()[1][2]).toBe('200,00 kr')
    })

    it('says when the trend could not be loaded, leaving the Spending by Category shown', async () => {
      api.months = [
        { year: 2026, month: 9 },
        { year: 2026, month: 8 },
      ]
      api.handleSpending = () => Response.json(septemberSpending)
      api.handleMonthlySpending = () => new Response(null, { status: 500 })

      await renderApp()

      await waitFor(() =>
        expect(within(trend()).getByRole('alert')).toHaveTextContent('Could not load the Spending trend.'),
      )
      await waitFor(() => expect(centreTotal()).toBe('Total 1 570,50 kr'))
      expect(within(dashboard()).queryByRole('alert')).toBeNull()
      expect(trendTable()).toEqual([])
    })

    it('still shows the trend when the Categories could not be loaded', async () => {
      api.months = [
        { year: 2026, month: 9 },
        { year: 2026, month: 8 },
      ]
      api.categoriesServed = new Response(null, { status: 500 })

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
        api.months = [
          { year: 2026, month: 9 },
          { year: 2025, month: 1 },
        ]
        api.handleMonthlySpending = (from, to) =>
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
        api.handleMonthlySpending = (from, to) =>
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
        api.handleMonthlySpending = (from, to) =>
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
        api.months = [
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
        api.months = [
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
        api.handleMonthlySpending = (from, to) =>
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
        api.months = [
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
        api.categoriesServed = [...categories, { id: 4, name: 'Transport' }, { id: 5, name: 'Restaurants' }]
        api.months = [
          { year: 2026, month: 3 },
          { year: 2026, month: 1 },
        ]
        api.handleMonthlySpending = (from, to) =>
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
            ['Uncategorized', '50,00 kr', '0,00 kr', '▼ −100,0 %'],
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
        api.months = [
          { year: 2026, month: 9 },
          { year: 2026, month: 8 },
        ]
        api.handleSpending = () => Response.json(septemberSpending)
        api.handleMonthlySpending = (from, to) =>
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
        api.categoriesServed = [{ ...categories[0], colour: '#123456' }, { ...categories[1], colour: '#abcdef' }]
        api.months = [
          { year: 2026, month: 9 },
          { year: 2026, month: 8 },
        ]
        api.handleMonthlySpending = (from, to) =>
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
        api.categoriesServed = [{ ...categories[0], colour: '#104281' }, categories[1]]
        api.months = [
          { year: 2026, month: 9 },
          { year: 2026, month: 8 },
        ]
        api.handleSpending = () => Response.json(septemberSpending)
        api.handleMonthlySpending = (from, to) =>
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
        api.months = [
          { year: 2026, month: 9 },
          { year: 2026, month: 8 },
        ]
        api.handleSpending = () => Response.json(septemberSpending)
        api.handleMonthlySpending = (from, to) =>
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
        api.months = [
          { year: 2026, month: 9 },
          { year: 2026, month: 8 },
        ]
        api.handleMonthlySpending = (from, to) =>
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
        api.months = [
          { year: 2026, month: 9 },
          { year: 2025, month: 1 },
        ]
        api.handleMonthlySpending = (from, to) =>
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
        api.categoriesServed = [...categories, { id: 12, name: 'Savings' }, { id: 14, name: 'Income' }]
        api.months = [
          { year: 2026, month: 9 },
          { year: 2026, month: 8 },
        ]
        api.handleMonthlySpending = (from, to) =>
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
        api.handleMonthlySpending = (from, to) =>
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

    describe('Negative figures', () => {
      // August and September 2026. Groceries has Spending in both; Other has a refund in September
      // that outweighs its Spending in August, Uncategorized only a refund, Savings a withdrawal and
      // Income a repayment.
      beforeEach(() => {
        api.categoriesServed = [...categories, { id: 12, name: 'Savings' }, { id: 14, name: 'Income' }]
        api.months = [
          { year: 2026, month: 9 },
          { year: 2026, month: 8 },
        ]
        api.handleMonthlySpending = (from, to) =>
          Response.json(
            monthlySpending(
              from,
              to,
              {
                '2026-8': [
                  { categoryId: 1, amount: 400 },
                  { categoryId: 13, amount: 100 },
                ],
                '2026-9': [
                  { categoryId: 1, amount: 500 },
                  { categoryId: 13, amount: -300 },
                  { categoryId: null, amount: -50 },
                ],
              },
              { '2026-9': { savings: { categoryId: 12, amount: -1500 }, income: { categoryId: 14, amount: -200 } } },
            ),
          )
      })

      // The names of the rows switched on, in table order.
      function switchedOn() {
        return within(within(trend()).getByRole('table'))
          .getAllByRole('checkbox')
          .filter((checkbox) => (checkbox as HTMLInputElement).checked)
          .map((checkbox) => checkbox.closest('tr')!.firstElementChild!.textContent)
      }

      it('shows each figure that nets the other way below zero, the rows adding up to Total', async () => {
        await renderApp()

        await waitFor(() =>
          expect(trendTable()).toEqual([
            ['', 'August 2026', 'September 2026', 'Change'],
            ['Total', '500,00 kr', '150,00 kr', '▼ −70,0 %'],
            ['Groceries', '400,00 kr', '500,00 kr', '▲ +25,0 %'],
            ['Uncategorized', '0,00 kr', '-50,00 kr', 'New'],
            ['Other', '100,00 kr', '-300,00 kr', '▼ −400,0 %'],
            ['Savings', '0,00 kr', '-1 500,00 kr', 'New'],
            ['Income', '0,00 kr', '-200,00 kr', 'New'],
          ]),
        )
      })

      it('shows a figure below zero by Quarter, divided by the months its point covers', async () => {
        // Every month from January to September 2026 is offered.
        api.months = [
          { year: 2026, month: 9 },
          { year: 2026, month: 1 },
        ]
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(trendTable()[0]).toEqual(['', 'January 2026', 'September 2026', 'Change']))

        await user.selectOptions(within(trend()).getByLabelText('Granularity'), 'Quarter')

        await waitFor(() => expect(trendTable()[0]).toEqual(['', 'Q1 2026', 'Q3 2026', 'Change']))
        expect(trendTable()[3]).toEqual(['Uncategorized', '0,00 kr', '-16,67 kr', 'New'])
      })

      describe('zero line', () => {
        // The trend's chart is as wide as its container, which jsdom can't measure, so recharts draws
        // nothing without a size. The stubs are undone after each test: the global by the file's
        // afterEach.
        let measure: { mockRestore: () => void }
        beforeEach(() => {
          vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
          measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 280, width: 600, height: 280, toJSON: () => ({}),
          })
        })

        afterEach(() => measure.mockRestore())

        // The horizontal line drawn at zero, if any.
        function zeroLine() {
          return trend().querySelector('.recharts-reference-line-line')
        }

        // Waits for the chart, then switches the named lines on, or Total off.
        async function openTrend(...lines: string[]) {
          const user = userEvent.setup()
          await renderApp()
          await waitFor(() => expect(trend().querySelector('.recharts-line')).not.toBeNull())
          for (const line of lines) await user.click(within(trend()).getByRole('checkbox', { name: line }))
          return user
        }

        it('is drawn while a switched-on line is below zero', async () => {
          await openTrend('Other')

          expect(zeroLine()).not.toBeNull()
        })

        it('goes when that line is switched off, leaving nothing drawn below zero', async () => {
          const user = await openTrend('Other')

          await user.click(within(trend()).getByRole('checkbox', { name: 'Other' }))

          expect(trend().querySelector('.recharts-line')).not.toBeNull()
          expect(zeroLine()).toBeNull()
        })

        it('is not drawn for a line below zero that is switched off', async () => {
          // Uncategorized, Other, Savings and Income go below zero in September, but only Total is on.
          await openTrend()

          expect(switchedOn()).toEqual(['Total'])
          expect(zeroLine()).toBeNull()
        })

        it.each(['light', 'dark'])('is drawn in the colour of the axes in %s', async (appearance) => {
          localStorage.setItem('appearance', appearance)
          await openTrend('Other')

          const axis = trend().querySelector('.recharts-yAxis .recharts-cartesian-axis-line')!
          expect(zeroLine()).toHaveAttribute('stroke', axis.getAttribute('stroke'))
        })

        it('has the y axis reach below zero, so the points below it are drawn inside the chart', async () => {
          // Savings is -1 500 kr in September, its lowest dot.
          await openTrend('Savings')

          const axis = trend().querySelector('.recharts-yAxis .recharts-cartesian-axis-line')!
          const lowest = Math.max(
            ...[...trend().querySelectorAll('.recharts-line-dot')].map((dot) => Number(dot.getAttribute('cy'))),
          )
          expect(lowest).toBeGreaterThan(Number(zeroLine()!.getAttribute('y1')))
          expect(lowest).toBeLessThanOrEqual(Number(axis.getAttribute('y2')))
        })
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
        api.months = [
          { year: 2026, month: 6 },
          { year: 2025, month: 10 },
        ]
        api.handleMonthlySpending = (from, to) =>
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
        expect(listedDescriptions()).toEqual(['Elkjøp', 'Meny'])
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

      it('opens the Category of a dot below zero, finding the nearest line by the figures drawn', async () => {
        // A refund outweighs Groceries' Spending in March, so its dot there is below zero, beneath
        // Total's at zero, where Other's Spending nets it out.
        api.handleMonthlySpending = (from, to) =>
          Response.json(
            monthlySpending(from, to, {
              '2025-11': [{ categoryId: 1, amount: 100 }],
              '2026-1': [{ categoryId: 1, amount: 100 }],
              '2026-3': [
                { categoryId: 1, amount: -100 },
                { categoryId: 13, amount: 100 },
              ],
            }),
          )
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(trendTable()).toHaveLength(4))
        await user.click(within(trend()).getByRole('checkbox', { name: 'Groceries' }))
        await waitFor(() => expect(dots(GROCERIES_COLOUR)).toHaveLength(9))

        await clickNear(dots(GROCERIES_COLOUR)[5])

        expect(await screen.findByRole('cell', { name: 'Meny' })).toBeInTheDocument()
        expect(chosenFilters()).toEqual(['2026', 'March', 'Groceries'])
      })
    })
  })

  describe('Set Budget', () => {
    // As the API lists them: the Built-in Categories first, Income and Savings among them.
    const budgetCategories = [
      { id: 3, name: 'Housing', description: 'Mortgage.', colour: '#eda100', builtIn: true, budget: 9000, transactionCount: 0, ruleCount: 0 },
      { ...categories[0], budget: 4000 },
      categories[1],
      { id: 11, name: 'Income', description: 'All income.', colour: '#8a5a1c', builtIn: true, budget: 0, transactionCount: 0, ruleCount: 0 },
      { id: 12, name: 'Savings', description: 'Savings.', colour: '#0f766e', builtIn: true, budget: 0, transactionCount: 0, ruleCount: 0 },
      { id: 20, name: 'Entertainment', description: 'Fun.', colour: '#104281', builtIn: false, budget: 250, transactionCount: 0, ruleCount: 0 },
    ]

    beforeEach(() => {
      api.categoriesServed = budgetCategories
    })

    function setBudgetButton() {
      return within(dashboard()).getByRole('button', { name: 'Set budget' })
    }

    function budgetDialog() {
      return screen.getByRole('dialog', { name: 'Set monthly budget' })
    }

    function budgetInput(name: string) {
      return within(budgetDialog()).getByRole('textbox', { name })
    }

    // Each input in the dialog, in order, as its Category's name and the Budget it shows.
    function budgetFields() {
      return within(budgetDialog())
        .getAllByRole('textbox')
        .map((input) => [input.closest('label')?.textContent, (input as HTMLInputElement).value])
    }

    function savedBudgets() {
      return fetchMock.mock.calls
        .filter(([url, init]) => url === '/api/categories/budgets' && init?.method === 'PUT')
        .map(([, init]) => JSON.parse(init!.body as string))
    }

    async function openBudgetDialog() {
      const user = userEvent.setup()
      await renderApp()
      await waitFor(() => expect(setBudgetButton()).toBeEnabled())
      await user.click(setBudgetButton())
      return user
    }

    it('sits above the legend, after the Period, and is disabled until the Categories are loaded', async () => {
      let serveCategories!: (response: Response) => void
      api.categoriesServed = new Promise((resolve) => (serveCategories = resolve))
      await renderApp()

      expect(setBudgetButton()).toBeDisabled()
      await waitFor(() => expect(screen.getByLabelText('Period')).toBeInTheDocument())
      expect(screen.getByLabelText('Period').compareDocumentPosition(setBudgetButton())).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      )

      serveCategories(Response.json(budgetCategories))

      await waitFor(() => expect(setBudgetButton()).toBeEnabled())
      const legend = await within(dashboard()).findByRole('table')
      expect(setBudgetButton().compareDocumentPosition(legend)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    })

    it('keeps the page from scrolling while the dialog is open', async () => {
      const user = await openBudgetDialog()

      expect(document.documentElement.style.overflow).toBe('hidden')

      await user.click(within(budgetDialog()).getByRole('button', { name: 'Cancel' }))

      expect(document.documentElement.style.overflow).toBe('')
    })

    it('lists every Category but Income and Savings, in the usual order, each with its swatch and current Budget', async () => {
      await openBudgetDialog()

      expect(budgetFields()).toEqual([
        ['Housing', '9000'],
        ['Groceries', '4000'],
        ['Other', '0'],
        ['Entertainment', '250'],
      ])
      const swatch = budgetInput('Groceries').closest('label')!.querySelector('[aria-hidden="true"]') as HTMLElement
      expect(swatch.style.backgroundColor).toBe('rgb(42, 120, 214)')
    })

    it('saves every listed Budget at once, an emptied one as 0, and closes', async () => {
      const user = await openBudgetDialog()

      await user.clear(budgetInput('Housing'))
      await user.clear(budgetInput('Groceries'))
      await user.type(budgetInput('Groceries'), ' 3500 ')
      await user.click(within(budgetDialog()).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(savedBudgets()).toEqual([
        [
          { categoryId: 3, budget: 0 },
          { categoryId: 1, budget: 3500 },
          { categoryId: 13, budget: 0 },
          { categoryId: 20, budget: 250 },
        ],
      ])
    })

    it('keeps the Categories the save returns, without loading them again', async () => {
      api.handleSaveBudgets = () =>
        Response.json(budgetCategories.map((c) => (c.id === 1 ? { ...c, budget: 3500 } : c)))
      const user = await openBudgetDialog()
      await user.clear(budgetInput('Groceries'))
      await user.type(budgetInput('Groceries'), '3500')
      await user.click(within(budgetDialog()).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      await user.click(setBudgetButton())

      expect(budgetInput('Groceries')).toHaveValue('3500')
      expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/categories' && !init?.method)).toHaveLength(1)
    })

    it('shows that it is saving until the save is done', async () => {
      let finishSaving!: (response: Response) => void
      api.handleSaveBudgets = () => new Promise((resolve) => (finishSaving = resolve))
      const user = await openBudgetDialog()

      await user.click(within(budgetDialog()).getByRole('button', { name: 'Save' }))

      expect(within(budgetDialog()).getByRole('button', { name: 'Saving…' })).toBeDisabled()
      finishSaving(Response.json(budgetCategories))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('Reset sets every input to 0 without saving, so Cancel still keeps the Budgets', async () => {
      const user = await openBudgetDialog()

      await user.click(within(budgetDialog()).getByRole('button', { name: 'Reset' }))

      expect(budgetFields()).toEqual([
        ['Housing', '0'],
        ['Groceries', '0'],
        ['Other', '0'],
        ['Entertainment', '0'],
      ])
      expect(savedBudgets()).toEqual([])

      await user.click(within(budgetDialog()).getByRole('button', { name: 'Cancel' }))
      await user.click(setBudgetButton())

      expect(budgetFields()).toEqual([
        ['Housing', '9000'],
        ['Groceries', '4000'],
        ['Other', '0'],
        ['Entertainment', '250'],
      ])
    })

    it('Cancel and Escape close it without saving what was typed', async () => {
      const user = await openBudgetDialog()
      await user.type(budgetInput('Other'), '5')

      await user.click(within(budgetDialog()).getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      await user.click(setBudgetButton())
      expect(budgetInput('Other')).toHaveValue('0')
      await user.type(budgetInput('Other'), '5')
      await user.keyboard('{Escape}')

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(savedBudgets()).toEqual([])
    })

    it.each(['-5', '12,5', '12.5', 'abc', '10000001'])(
      'refuses %s with a message by its input, and sends nothing',
      async (typed) => {
        const user = await openBudgetDialog()
        await user.clear(budgetInput('Groceries'))
        await user.type(budgetInput('Groceries'), typed)

        await user.click(within(budgetDialog()).getByRole('button', { name: 'Save' }))

        expect(budgetInput('Groceries')).toHaveAccessibleDescription('Enter a whole number from 0 to 10 000 000.')
        expect(budgetInput('Groceries')).toBeInvalid()
        expect(budgetInput('Housing')).toBeValid()
        expect(budgetDialog()).toBeInTheDocument()
        expect(savedBudgets()).toEqual([])
      },
    )

    it('accepts a Budget of 10 000 000', async () => {
      const user = await openBudgetDialog()
      await user.clear(budgetInput('Groceries'))
      await user.type(budgetInput('Groceries'), '10000000')

      await user.click(within(budgetDialog()).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(savedBudgets()[0][1]).toEqual({ categoryId: 1, budget: 10_000_000 })
    })

    it('shows an error and stays open with the inputs kept when saving fails', async () => {
      api.handleSaveBudgets = () => new Response(null, { status: 500 })
      const user = await openBudgetDialog()
      await user.clear(budgetInput('Groceries'))
      await user.type(budgetInput('Groceries'), '3500')

      await user.click(within(budgetDialog()).getByRole('button', { name: 'Save' }))

      expect(await within(budgetDialog()).findByRole('alert')).toHaveTextContent('Saving failed (500).')
      expect(budgetInput('Groceries')).toHaveValue('3500')
      expect(within(budgetDialog()).getByRole('button', { name: 'Save' })).toBeEnabled()
    })

    it("shows the server's reason when it refuses the Budgets", async () => {
      api.handleSaveBudgets = () =>
        Response.json({ errors: { '[2].categoryId': ['Category does not exist.'] } }, { status: 400 })
      const user = await openBudgetDialog()

      await user.click(within(budgetDialog()).getByRole('button', { name: 'Save' }))

      expect(await within(budgetDialog()).findByRole('alert')).toHaveTextContent('Category does not exist.')
      expect(budgetDialog()).toBeInTheDocument()
    })
  })

  describe('Budget left', () => {
    // Groceries has a Budget; Other and Savings have none, nor Clothing unless a test gives it one.
    const groceries = { ...categories[0], budget: 4000 }
    const other = categories[1]
    const savings = { id: 12, name: 'Savings', description: 'Savings.', colour: '#0f766e', builtIn: true, budget: 0, transactionCount: 0, ruleCount: 0 }
    const clothing = { id: 14, name: 'Clothing', description: 'Clothing.', colour: '#eb6834', builtIn: true, budget: 0, transactionCount: 0, ruleCount: 0 }

    beforeEach(() => {
      api.categoriesServed = [groceries, other, savings, clothing]
      api.months = [{ year: 2026, month: 9 }]
    })

    // Every row of the legend as shown, its header and Total rows included, with every space plain.
    function legend() {
      return within(dashboard())
        .queryAllByRole('row')
        .map((row) =>
          [...row.querySelectorAll('th, td')].map((cell) => cell.textContent!.replace(/[  ]/g, ' ')),
        )
    }

    // The Budget left cell of the legend row whose first cell is the name.
    function budgetLeftCell(name: string) {
      const row = within(dashboard())
        .getAllByRole('row')
        .find((r) => r.querySelector('th, td')?.textContent === name)!
      return [...row.querySelectorAll('th, td')].at(-1)!
    }

    // The colour a Budget left figure shows in, by its Light and Dark classes.
    function tone(name: string) {
      const cell = budgetLeftCell(name)
      if (cell.matches('.text-emerald-700.dark\\:text-emerald-400')) return 'green'
      if (cell.matches('.text-red-700.dark\\:text-red-400')) return 'red'
      if (cell.matches('.text-slate-500.dark\\:text-slate-400')) return 'neutral'
      return 'none'
    }

    function spendingOf(slices: { categoryId: number | null; amount: number }[]) {
      return { total: slices.reduce((sum, s) => sum + s.amount, 0), slices }
    }

    it('shows the legend as it always has, with no header, column or Total row, while every Budget is 0', async () => {
      api.categoriesServed = categories
      api.handleSpending = () => Response.json(septemberSpending)
      await renderApp()

      await waitFor(() => expect(legend()).toHaveLength(3))
      expect(legend()).toEqual([
        ['Other', '1 000,00 kr', '63,7 %'],
        ['Uncategorized', '450,50 kr', '28,7 %'],
        ['Groceries', '120,00 kr', '7,6 %'],
      ])
      expect(within(dashboard()).queryByRole('columnheader')).toBeNull()
    })

    it("shows each Category's Budget left in a Month, all its Spending below zero without a Budget, and the overall one in a Total row", async () => {
      api.handleSpending = () =>
        Response.json(spendingOf([{ categoryId: 1, amount: 3500 }, { categoryId: 13, amount: 1000 }, { categoryId: null, amount: 450.5 }]))
      await renderApp()

      await waitFor(() => expect(legend()).toHaveLength(5))
      expect(legend()).toEqual([
        ['Category', 'Spending', 'Share', 'Budget left'],
        ['Groceries', '3 500,00 kr', '70,7 %', '+500,00 kr'],
        ['Other', '1 000,00 kr', '20,2 %', '−1 000,00 kr'],
        ['Uncategorized', '450,50 kr', '9,1 %', '−450,50 kr'],
        ['Total', '4 950,50 kr', '', '−950,50 kr'],
      ])
      expect(tone('Groceries')).toBe('green')
      expect(tone('Other')).toBe('red')
      expect(tone('Uncategorized')).toBe('red')
      expect(tone('Total')).toBe('red')
    })

    it('shows a Budget left of exactly zero without a sign, in neutral grey', async () => {
      api.categoriesServed = [groceries, other, savings, { ...clothing, budget: 500 }]
      api.handleSpending = () => Response.json(spendingOf([{ categoryId: 1, amount: 3500 }, { categoryId: 14, amount: 500 }]))
      await renderApp()

      await waitFor(() => expect(legend()).toHaveLength(4))
      expect(legend().slice(1)).toEqual([
        ['Groceries', '3 500,00 kr', '87,5 %', '+500,00 kr'],
        ['Clothing', '500,00 kr', '12,5 %', '0,00 kr'],
        ['Total', '4 000,00 kr', '', '+500,00 kr'],
      ])
      expect(tone('Clothing')).toBe('neutral')
    })

    it('counts three months of Budget in a Quarter', async () => {
      api.months = [
        { year: 2026, month: 9 },
        { year: 2026, month: 8 },
        { year: 2026, month: 7 },
      ]
      api.handleSpending = (_year, _month, quarter) =>
        Response.json(spendingOf([{ categoryId: 1, amount: quarter === 3 ? 13000 : 3500 }]))
      const user = userEvent.setup()
      await renderApp()
      await waitFor(() => expect(legend()).toHaveLength(3))

      await user.selectOptions(within(dashboard()).getByLabelText('Granularity'), 'Quarter')

      await waitFor(() => expect(legend()[1]).toEqual(['Groceries', '13 000,00 kr', '100,0 %', '−1 000,00 kr']))
      expect(tone('Groceries')).toBe('red')
      expect(legend()[2]).toEqual(['Total', '13 000,00 kr', '', '−1 000,00 kr'])
    })

    it('counts twelve months of Budget in a Year', async () => {
      api.handleSpending = (_year, month) =>
        Response.json(spendingOf([{ categoryId: 1, amount: month === undefined ? 45000 : 3500 }]))
      const user = userEvent.setup()
      await renderApp()
      await waitFor(() => expect(legend()).toHaveLength(3))

      await user.selectOptions(within(dashboard()).getByLabelText('Granularity'), 'Year')

      await waitFor(() => expect(legend()[1]).toEqual(['Groceries', '45 000,00 kr', '100,0 %', '+3 000,00 kr']))
      expect(tone('Groceries')).toBe('green')
      expect(legend()[2]).toEqual(['Total', '45 000,00 kr', '', '+3 000,00 kr'])
    })

    it('gives a Category whose refunds outweigh its purchases a Budget left larger than its Budget', async () => {
      api.categoriesServed = [groceries, other, savings, { ...clothing, budget: 500 }]
      api.handleSpending = () => Response.json(spendingOf([{ categoryId: 1, amount: 3500 }, { categoryId: 14, amount: -200 }]))
      await renderApp()

      await waitFor(() => expect(legend()).toHaveLength(4))
      expect(legend().slice(1)).toEqual([
        ['Groceries', '3 500,00 kr', '100,0 %', '+500,00 kr'],
        ['Clothing', '-200,00 kr', '–', '+700,00 kr'],
        ['Total', '3 300,00 kr', '', '+1 200,00 kr'],
      ])
      expect(tone('Clothing')).toBe('green')
    })

    it('shows "–" for an included Savings, and never takes Savings off the overall Budget left', async () => {
      api.handleSpending = (_year, _month, _quarter, includeSavings) =>
        Response.json(
          spendingOf(
            includeSavings
              ? [{ categoryId: 12, amount: 1500 }, { categoryId: 1, amount: 3500 }]
              : [{ categoryId: 1, amount: 3500 }],
          ),
        )
      const user = userEvent.setup()
      await renderApp()
      await waitFor(() => expect(legend()).toHaveLength(3))
      expect(legend()[2]).toEqual(['Total', '3 500,00 kr', '', '+500,00 kr'])

      await user.click(within(dashboard()).getByRole('checkbox', { name: 'Include savings' }))

      await waitFor(() => expect(legend()).toHaveLength(4))
      expect(legend().slice(1)).toEqual([
        ['Savings', '1 500,00 kr', '30,0 %', '–'],
        ['Groceries', '3 500,00 kr', '70,0 %', '+500,00 kr'],
        ['Total', '5 000,00 kr', '', '+500,00 kr'],
      ])
    })

    it('shows the overall Budget left of the Total row in green above zero', async () => {
      api.handleSpending = () => Response.json(spendingOf([{ categoryId: 1, amount: 100 }]))
      await renderApp()

      await waitFor(() => expect(legend()).toHaveLength(3))
      expect(legend()[2]).toEqual(['Total', '100,00 kr', '', '+3 900,00 kr'])
      expect(tone('Total')).toBe('green')
    })

    it('updates straight after saving Budgets, and goes once they are all reset to 0', async () => {
      api.categoriesServed = [{ ...groceries, budget: 0 }, other, savings, clothing]
      api.handleSpending = () => Response.json(spendingOf([{ categoryId: 1, amount: 3500 }]))
      const user = userEvent.setup()
      await renderApp()
      await waitFor(() => expect(legend()).toEqual([['Groceries', '3 500,00 kr', '100,0 %']]))
      const setBudget = within(dashboard()).getByRole('button', { name: 'Set budget' })

      await user.click(setBudget)
      const dialog = screen.getByRole('dialog', { name: 'Set monthly budget' })
      await user.clear(within(dialog).getByRole('textbox', { name: 'Groceries' }))
      await user.type(within(dialog).getByRole('textbox', { name: 'Groceries' }), '4000')
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      await waitFor(() =>
        expect(legend()).toEqual([
          ['Category', 'Spending', 'Share', 'Budget left'],
          ['Groceries', '3 500,00 kr', '100,0 %', '+500,00 kr'],
          ['Total', '3 500,00 kr', '', '+500,00 kr'],
        ]),
      )

      await user.click(setBudget)
      await user.click(within(screen.getByRole('dialog', { name: 'Set monthly budget' })).getByRole('button', { name: 'Reset' }))
      await user.click(within(screen.getByRole('dialog', { name: 'Set monthly budget' })).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(legend()).toEqual([['Groceries', '3 500,00 kr', '100,0 %']]))
      expect(screen.getAllByRole('button', { name: 'Set budget' })).toHaveLength(1)
    })

    it('scrolls the legend sideways on its own on a phone, so the page never runs wider than the screen', async () => {
      api.handleSpending = () => Response.json(spendingOf([{ categoryId: 1, amount: 3500 }]))
      await renderApp()

      await waitFor(() => expect(legend()).toHaveLength(3))
      expect(within(dashboard()).getByRole('table').parentElement).toHaveClass('max-sm:overflow-x-auto', 'min-w-0')
    })

    describe('a budgeted Category without Spending', () => {
      // As the API lists them. Housing, Clothing and Entertainment have Budgets but, in the Spending
      // below, no Spending; Transport has neither.
      const housing = { id: 3, name: 'Housing', description: 'Mortgage.', colour: '#eda100', builtIn: true, budget: 9000, transactionCount: 0, ruleCount: 0 }
      const transport = { id: 4, name: 'Transport', description: 'Transport.', colour: '#1baf7a', builtIn: true, budget: 0, transactionCount: 0, ruleCount: 0 }
      const entertainment = { id: 20, name: 'Entertainment', description: 'Fun.', colour: '#104281', builtIn: false, budget: 250, transactionCount: 0, ruleCount: 0 }

      beforeEach(() => {
        api.categoriesServed = [housing, groceries, { ...clothing, budget: 500 }, transport, other, savings, entertainment]
      })

      // Groceries over and under nothing, an unbudgeted Other, Uncategorized, and Transport below zero.
      const mixedSpending = spendingOf([
        { categoryId: 1, amount: 3500 },
        { categoryId: 13, amount: 1000 },
        { categoryId: null, amount: 450.5 },
        { categoryId: 4, amount: -100 },
      ])

      // The legend swatch of the named row: its fill and its outline, as CSS colours.
      function swatch(name: string) {
        const row = within(dashboard()).getByRole('row', { name: new RegExp(`^${name}`) })
        const { backgroundColor, borderColor } = (row.querySelector('[aria-hidden="true"]') as HTMLElement).style
        return { fill: backgroundColor, outline: borderColor }
      }

      // The fill of each part of the ring: its slices, or the empty ring.
      function ringFills() {
        return [...dashboard().querySelectorAll('.recharts-pie-sector path')].map((sector) => sector.getAttribute('fill'))
      }

      // A figure as the legend shows it, back as a number: "+8 899,50 kr" → 8899.5, "–" → 0.
      function figure(text: string) {
        if (text === '–') return 0
        return Number(text.replace(/ kr$/, '').replace(/ /g, '').replace('−', '-').replace(',', '.'))
      }

      it('is listed after every row with Spending, in the usual Category order, with 0 kr and its whole Budget left in green', async () => {
        api.handleSpending = () => Response.json(mixedSpending)
        await renderApp()

        await waitFor(() => expect(legend()).toHaveLength(9))
        expect(legend()).toEqual([
          ['Category', 'Spending', 'Share', 'Budget left'],
          ['Groceries', '3 500,00 kr', '70,7 %', '+500,00 kr'],
          ['Other', '1 000,00 kr', '20,2 %', '−1 000,00 kr'],
          ['Uncategorized', '450,50 kr', '9,1 %', '−450,50 kr'],
          ['Transport', '-100,00 kr', '–', '+100,00 kr'],
          ['Housing', '0,00 kr', '–', '+9 000,00 kr'],
          ['Clothing', '0,00 kr', '–', '+500,00 kr'],
          ['Entertainment', '0,00 kr', '–', '+250,00 kr'],
          ['Total', '4 850,50 kr', '', '+8 899,50 kr'],
        ])
        expect(['Housing', 'Clothing', 'Entertainment'].map(tone)).toEqual(['green', 'green', 'green'])
      })

      it('has a hollow swatch and no slice of the ring, and leaves the shares as they were', async () => {
        api.handleSpending = () => Response.json(mixedSpending)
        await renderApp()

        await waitFor(() => expect(legend()).toHaveLength(9))
        expect(swatch('Housing')).toEqual({ fill: 'transparent', outline: 'rgb(237, 161, 0)' })
        expect(swatch('Entertainment')).toEqual({ fill: 'transparent', outline: 'rgb(16, 66, 129)' })
        expect(ringFills()).toEqual(['#2a78d6', '#9085e9', '#94a3b8'])
        expect(legend().slice(1, 4).map((row) => row[2])).toEqual(['70,7 %', '20,2 %', '9,1 %'])
      })

      it('adds up, with every other row, to the overall Budget left of the Total row', async () => {
        api.handleSpending = () => Response.json(mixedSpending)
        await renderApp()
        await waitFor(() => expect(legend()).toHaveLength(9))

        const rowsLeft = legend()
          .slice(1, -1)
          .reduce((sum, row) => sum + figure(row[3]), 0)

        expect(rowsLeft).toBeCloseTo(figure(legend().at(-1)![3]), 2)
      })

      it("opens its Transactions in the Period when clicked, as any row's does", async () => {
        api.handleSpending = () => Response.json(mixedSpending)
        api.handleListPeriod = () =>
          Response.json([
            { id: 9, date: '2026-09-02', description: 'Husleie', amount: 9000, note: null, categoryId: 3, locked: true, imported: false, bookmarked: false },
          ])
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(legend()).toHaveLength(9))

        await user.click(within(dashboard()).getByRole('button', { name: 'Housing' }))

        expect(await screen.findByRole('cell', { name: 'Husleie' })).toBeInTheDocument()
        expect(chosenFilters()).toEqual(['2026', 'September', 'Housing'])
        expect(requestedPeriods()).toEqual(['/api/transactions?year=2026&month=9'])
      })

      it('shows the empty ring, the budgeted rows and the Total row when the Period has no Spending', async () => {
        api.handleSpending = () => Response.json(spendingOf([]))
        await renderApp()

        await waitFor(() => expect(legend()).toHaveLength(6))
        expect(legend()).toEqual([
          ['Category', 'Spending', 'Share', 'Budget left'],
          ['Housing', '0,00 kr', '–', '+9 000,00 kr'],
          ['Groceries', '0,00 kr', '–', '+4 000,00 kr'],
          ['Clothing', '0,00 kr', '–', '+500,00 kr'],
          ['Entertainment', '0,00 kr', '–', '+250,00 kr'],
          ['Total', '0,00 kr', '', '+13 750,00 kr'],
        ])
        expect(ringFills()).toEqual(['#e2e8f0'])
      })

      it('counts the whole Budget for the months in the Period', async () => {
        api.handleSpending = (_year, month) =>
          Response.json(month === undefined ? spendingOf([{ categoryId: 1, amount: 45000 }]) : mixedSpending)
        const user = userEvent.setup()
        await renderApp()
        await waitFor(() => expect(legend()).toHaveLength(9))

        await user.selectOptions(within(dashboard()).getByLabelText('Granularity'), 'Year')

        await waitFor(() =>
          expect(legend().slice(1)).toEqual([
            ['Groceries', '45 000,00 kr', '100,0 %', '+3 000,00 kr'],
            ['Housing', '0,00 kr', '–', '+108 000,00 kr'],
            ['Clothing', '0,00 kr', '–', '+6 000,00 kr'],
            ['Entertainment', '0,00 kr', '–', '+3 000,00 kr'],
            ['Total', '45 000,00 kr', '', '+120 000,00 kr'],
          ]),
        )
      })

      it('lists nothing extra while every Budget is 0', async () => {
        api.categoriesServed = [housing, groceries, clothing, transport, other, savings, entertainment].map((c) => ({ ...c, budget: 0 }))
        api.handleSpending = () => Response.json(spendingOf([{ categoryId: 1, amount: 3500 }]))
        await renderApp()

        await waitFor(() => expect(legend()).toEqual([['Groceries', '3 500,00 kr', '100,0 %']]))
      })

      it('lists nothing at all for a Period with no Spending while every Budget is 0', async () => {
        api.categoriesServed = [housing, groceries, clothing, transport, other, savings, entertainment].map((c) => ({ ...c, budget: 0 }))
        await renderApp()

        await waitFor(() => expect(centreTotal()?.replace(/\s/g, ' ')).toBe('Total 0,00 kr'))
        expect(legend()).toEqual([])
        expect(within(dashboard()).queryByRole('table')).toBeNull()
      })
    })
  })
})
