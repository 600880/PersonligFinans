import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { api, categories, fetchMock } from './test/fakeApi'
import { renderApp } from './test/renderApp'

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
    api.categoriesServed = [
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
    api.categoriesServed = [
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
    api.categoriesServed = [
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
    api.categoriesServed = [{ ...categories[0], colour: '#104281' }, categories[1]]
    api.months = [{ year: 2026, month: 9 }]
    api.handleSpending = () => Response.json({ total: 120, slices: [{ categoryId: 1, amount: 120 }] })
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
    api.categoriesServed = [...categories, health]
    let posted: unknown
    api.handleAddCategory = (body) => {
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
      api.categoriesServed = [...categories, added, health]
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
    await screen.findByRole('cell', { name: 'kiwi' })
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    const addRule = within(screen.getByRole('dialog', { name: 'Add rule' }))
    expect(within(addRule.getByLabelText('Category')).getByRole('option', { name: 'Fitness' })).toBeInTheDocument()
  })

  it('places an added Category where the API lists it: in the Norwegian alphabet, whatever the browser language', async () => {
    const health = { id: 7, name: 'Health', description: 'Pharmacy etc.', builtIn: false, transactionCount: 0, ruleCount: 0 }
    const yearly = { id: 8, name: 'Årlig', description: 'Yearly costs.', builtIn: false, transactionCount: 0, ruleCount: 0 }
    api.categoriesServed = [...categories, health, yearly]
    api.handleAddCategory = () =>
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
    api.handleAddCategory = () =>
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
    api.handleAddCategory = () => {
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
    api.handleAddCategory = () => Response.json({ errors: { name: ['Name is required.'] } }, { status: 400 })
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
    api.categoriesServed = new Response(null, { status: 500 })
    await openCategoriesPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the categories.')
  })

  describe('Uncategorized line', () => {
    it('says under the list, never as a row in it, how many transactions are Uncategorized', async () => {
      api.uncategorizedCount = 1032
      await openCategoriesPage()
      await listedRows()

      // The thousands apart as nb-NO writes them, with a non-breaking space.
      const line = await screen.findByRole('button', { name: '1 032 transactions are Uncategorized' })
      expect(screen.getByRole('table')).not.toContainElement(line)
      expect(screen.getByRole('table').compareDocumentPosition(line)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(screen.queryByRole('row', { name: /Uncategorized/ })).not.toBeInTheDocument()
    })

    it('says is for a single Uncategorized transaction', async () => {
      api.uncategorizedCount = 1
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
      api.uncategorizedCount = new Response(null, { status: 500 })
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
      api.categoriesServed = [categories[0], health, categories[1]]
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
      api.categoriesServed = [categories[0], health]
      let deletedId: number | undefined
      api.handleDeleteCategory = (id) => {
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
      api.categoriesServed = [
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
      api.categoriesServed = [categories[0], { ...health, transactionCount: 3, ruleCount: 2 }, categories[1]]
      let deleted: { id: number; query: string } | undefined
      api.handleDeleteCategory = (id, query) => {
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
      api.categoriesServed = [categories[0], { ...health, transactionCount: 2, ruleCount: 1 }, categories[1]]
      let deleted: { id: number; query: string } | undefined
      api.handleDeleteCategory = (id, query) => {
        deleted = { id, query: query.toString() }
        // A remaining Groceries rule picked up one of its Transactions; the other is Uncategorized.
        api.categoriesServed = [{ ...categories[0], transactionCount: 13 }, categories[1]]
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
      api.categoriesServed = [categories[0], { ...health, transactionCount: 2, ruleCount: 1 }, categories[1]]
      api.handleDeleteCategory = () => {
        // A remaining Groceries rule picked up one of its Transactions; the other is Uncategorized.
        api.categoriesServed = [{ ...categories[0], transactionCount: 13 }, categories[1]]
        api.uncategorizedCount = 1
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
      api.categoriesServed = [categories[0], { ...health, ruleCount: 1 }, categories[1]]
      const replacements: string[] = []
      api.handleDeleteCategory = (_id, query) => {
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
      api.categoriesServed = [categories[0], health]
      let deleted = false
      api.handleDeleteCategory = () => {
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
      api.categoriesServed = [categories[0], health]
      api.handleDeleteCategory = () =>
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
      api.categoriesServed = [categories[0], health]
      api.handleDeleteCategory = () => Response.json({ title: 'Not Found', status: 404 }, { status: 404 })
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
      api.categoriesServed = [categories[0], { ...health, ruleCount: 1 }, { ...health, id: 8, name: 'Hobby' }]
      api.handleDeleteCategory = (id) =>
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
      api.categoriesServed = [categories[0], health]
      api.handleDeleteCategory = () => {
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
      api.categoriesServed = [...categories, health, travel]
      let edited: { id: number; body: unknown } | undefined
      api.handleEditCategory = (id, body) => {
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
      api.handleEditCategory = (_id, body) => {
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
      api.categoriesServed = [health]
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
      api.categoriesServed = [categories[0], health]
      api.handleEditCategory = () =>
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
      api.categoriesServed = [health]
      api.handleEditCategory = () => {
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
      api.categoriesServed = [health]
      let respond: (response: Response) => void = () => {}
      api.handleEditCategory = () => new Promise((resolve) => (respond = resolve))
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
      api.categoriesServed = [health]
      let respond: (response: Response) => void = () => {}
      api.handleEditCategory = () => new Promise((resolve) => (respond = resolve))
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
      api.categoriesServed = [categories[0], categories[1], { ...health, colour: '#2a78d6' }]
      let posted: unknown
      api.handleAddCategory = (body) => {
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

    it('counts a colour as taken whatever its case, as the server does when it chooses one', async () => {
      api.categoriesServed = [categories[0], categories[1], { ...health, colour: '#EB6834' }]
      let posted: unknown
      api.handleAddCategory = (body) => {
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
      expect(picker.getByRole('radio', { checked: true })).toBe(picker.getAllByRole('radio')[3])
      await user.type(dialog.getByLabelText('Name'), 'Fitness')
      await user.type(dialog.getByLabelText('Description'), 'Gym and sports.')
      await user.click(dialog.getByRole('button', { name: 'Save' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Category added.')
      expect(posted).toEqual({ name: 'Fitness', description: 'Gym and sports.', colour: '#1baf7a' })
    })

    it('starts a new Category on no colour once every one is taken, and leaves its colour to the server', async () => {
      api.palette = ['#2a78d6', '#9085e9']
      let posted: unknown
      api.handleAddCategory = (body) => {
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
      api.categoriesServed = [...categories]
      let edited: unknown
      api.handleEditCategory = (_id, body) => {
        edited = body
        const recoloured = { ...categories[0], ...(body as object) }
        api.categoriesServed = [recoloured, categories[1]]
        return Response.json(recoloured)
      }
      api.months = [{ year: 2026, month: 9 }]
      api.handleSpending = () => Response.json({ total: 120, slices: [{ categoryId: 1, amount: 120 }] })
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
      api.categoriesServed = [...categories, slate]
      let edited: unknown
      api.handleEditCategory = (_id, body) => {
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
      api.handleAddCategory = () =>
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
      api.palette = new Response(null, { status: 500 })
      let posted: unknown
      api.handleAddCategory = (body) => {
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
