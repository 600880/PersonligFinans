import { describe, expect, it } from 'vitest'
import type { ReceiptSuggestion } from './api'
import { todayIsoDate } from './date'
import {
  isTransactionFormValid,
  suggestedTransactionForm,
  toCreateTransactionRequest,
  type TransactionFormValues,
} from './transactionForm'

function validForm(overrides: Partial<TransactionFormValues> = {}): TransactionFormValues {
  return {
    date: '2026-09-19',
    description: 'Rema 1000',
    amountIn: '100',
    amountOut: '',
    categoryId: '13',
    bookmark: '',
    note: '',
    ...overrides,
  }
}

describe('isTransactionFormValid', () => {
  it('is valid when In alone has a positive amount', () => {
    expect(isTransactionFormValid(validForm({ amountIn: '100', amountOut: '' }))).toBe(true)
  })

  it('is valid when Out alone has a positive amount', () => {
    expect(isTransactionFormValid(validForm({ amountIn: '', amountOut: '50' }))).toBe(true)
  })

  it('is valid with two decimals', () => {
    expect(isTransactionFormValid(validForm({ amountIn: '249.90' }))).toBe(true)
  })

  it('is invalid when the amount is zero', () => {
    expect(isTransactionFormValid(validForm({ amountIn: '0' }))).toBe(false)
    expect(isTransactionFormValid(validForm({ amountIn: '0.00' }))).toBe(false)
  })

  it('is invalid with more than two decimals', () => {
    expect(isTransactionFormValid(validForm({ amountIn: '10.005' }))).toBe(false)
  })

  it('is invalid when neither In nor Out is filled', () => {
    expect(isTransactionFormValid(validForm({ amountIn: '', amountOut: '' }))).toBe(false)
  })

  it('is invalid when both In and Out are filled', () => {
    expect(isTransactionFormValid(validForm({ amountIn: '100', amountOut: '50' }))).toBe(false)
  })

  it('is invalid when In is negative', () => {
    expect(isTransactionFormValid(validForm({ amountIn: '-1', amountOut: '' }))).toBe(false)
  })

  it('is invalid when Out is negative', () => {
    expect(isTransactionFormValid(validForm({ amountIn: '', amountOut: '-1' }))).toBe(false)
  })

  it('is invalid when the date is missing', () => {
    expect(isTransactionFormValid(validForm({ date: '' }))).toBe(false)
  })

  it('is invalid when no category is chosen', () => {
    expect(isTransactionFormValid(validForm({ categoryId: '' }))).toBe(false)
  })

  it('is invalid when the description is blank', () => {
    expect(isTransactionFormValid(validForm({ description: '   ' }))).toBe(false)
  })

  it('does not require Note', () => {
    expect(isTransactionFormValid(validForm({ note: '' }))).toBe(true)
  })
})

describe('toCreateTransactionRequest', () => {
  it('turns In into a positive Amount', () => {
    expect(toCreateTransactionRequest(validForm({ amountIn: '1500' })).amount).toBe(1500)
  })

  it('turns Out into a negative Amount', () => {
    expect(
      toCreateTransactionRequest(validForm({ amountIn: '', amountOut: '249.90' })).amount,
    ).toBe(-249.9)
  })

  it('trims text, sends a blank Note as null, and parses the category id', () => {
    expect(
      toCreateTransactionRequest(
        validForm({ description: '  Rema 1000 ', note: '  ', categoryId: '1' }),
      ),
    ).toEqual({
      date: '2026-09-19',
      description: 'Rema 1000',
      amount: 100,
      note: null,
      categoryId: 1,
    })
  })
})

describe('suggestedTransactionForm', () => {
  function suggestion(overrides: Partial<ReceiptSuggestion> = {}): ReceiptSuggestion {
    return {
      outcome: 'read',
      date: '2026-10-12',
      description: 'Rema 1000',
      amount: -249.9,
      categoryId: 1,
      ...overrides,
    }
  }

  it('fills a purchase into Out, with the date, Description and Category, and leaves the Bookmark at - and Note empty', () => {
    expect(suggestedTransactionForm(suggestion())).toEqual({
      date: '2026-10-12',
      description: 'Rema 1000',
      amountIn: '',
      amountOut: '249.90',
      categoryId: '1',
      bookmark: '',
      note: '',
    })
  })

  it('fills a refund into In', () => {
    const values = suggestedTransactionForm(suggestion({ amount: 1500 }))

    expect(values.amountIn).toBe('1500.00')
    expect(values.amountOut).toBe('')
  })

  it("falls back to today's date and leaves every other field empty when nothing was suggested", () => {
    expect(
      suggestedTransactionForm(
        suggestion({ outcome: 'unreadable', date: null, description: null, amount: null, categoryId: null }),
      ),
    ).toEqual({
      date: todayIsoDate(),
      description: '',
      amountIn: '',
      amountOut: '',
      categoryId: '',
      bookmark: '',
      note: '',
    })
  })

  it('gives a form that can be saved as it is when every field was suggested', () => {
    expect(isTransactionFormValid(suggestedTransactionForm(suggestion({ amount: -0.5 })))).toBe(true)
  })
})
