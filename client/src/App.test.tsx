import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { todayIsoDate } from './lib/date'

describe('App', () => {
  it('shows the Add transaction button with no modal open', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /add transaction/i })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the modal with all fields when the button is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /add transaction/i }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByLabelText(/date/i)).toHaveValue(todayIsoDate())
    expect(screen.getByLabelText(/description/i)).toHaveValue('')
    expect(screen.getByLabelText(/^in$/i)).toHaveValue(null)
    expect(screen.getByLabelText(/^out$/i)).toHaveValue(null)
    expect(screen.getByLabelText(/reference/i)).toHaveValue('')
    expect(screen.getByLabelText(/category/i)).toHaveValue('Other')
  })

  it('disables Save until the amount is filled in, then enables it', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /add transaction/i }))

    const saveButton = screen.getByRole('button', { name: /^save$/i })
    expect(saveButton).toBeDisabled()

    await user.type(screen.getByLabelText(/^in$/i), '100')
    expect(saveButton).toBeEnabled()
  })

  it('does nothing observable when Save is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /add transaction/i }))
    await user.type(screen.getByLabelText(/^in$/i), '100')

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText(/^in$/i)).toHaveValue(100)
  })

  it('closes and discards input when Cancel is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /add transaction/i }))
    await user.type(screen.getByLabelText(/description/i), 'Groceries')

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add transaction/i }))
    expect(screen.getByLabelText(/description/i)).toHaveValue('')
  })
})
