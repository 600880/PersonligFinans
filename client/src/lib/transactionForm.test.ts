import { describe, expect, it } from 'vitest'
import { isTransactionFormValid, type TransactionFormValues } from './transactionForm'

function validForm(overrides: Partial<TransactionFormValues> = {}): TransactionFormValues {
  return {
    date: '2026-09-19',
    description: '',
    amountIn: '100',
    amountOut: '',
    reference: '',
    category: 'Other',
    ...overrides,
  }
}

describe('isTransactionFormValid', () => {
  it('is valid when In alone has a non-negative amount', () => {
    expect(isTransactionFormValid(validForm({ amountIn: '100', amountOut: '' }))).toBe(true)
  })

  it('is valid when Out alone has a non-negative amount', () => {
    expect(isTransactionFormValid(validForm({ amountIn: '', amountOut: '50' }))).toBe(true)
  })

  it('is valid when the amount is exactly zero', () => {
    expect(isTransactionFormValid(validForm({ amountIn: '0', amountOut: '' }))).toBe(true)
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

  it('is invalid when the category is missing', () => {
    expect(isTransactionFormValid(validForm({ category: '' }))).toBe(false)
  })

  it('does not require Description or Reference', () => {
    expect(
      isTransactionFormValid(validForm({ description: '', reference: '' })),
    ).toBe(true)
  })
})
