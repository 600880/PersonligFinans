import { describe, expect, it } from 'vitest'
import type { MonthSpending, SpendingSlice } from './api'
import { trendCategories, trendPoints } from './trend'

const GROCERIES = 1
const SHOPPING = 2
const SAVINGS = 3
const INCOME = 4

// A month of 2026 as the monthly Spending endpoint returns it, with each group's net Spending.
function month(month: number, slices: SpendingSlice[] = []): MonthSpending {
  return { year: 2026, month, slices, savings: null, income: null }
}

describe('trendPoints', () => {
  it("nets a Category over a quarter's months, so a refund reduces an earlier month's Spending", () => {
    const monthly = [
      month(1, [{ categoryId: SHOPPING, amount: 500 }, { categoryId: GROCERIES, amount: 300 }]),
      month(2, [{ categoryId: SHOPPING, amount: -700 }]),
      month(3, [{ categoryId: GROCERIES, amount: -60 }]),
    ]

    const [q1] = trendPoints(monthly, 'quarter')

    expect(q1.values[String(SHOPPING)] ?? 0).toBe(0)
    expect(q1.values[String(GROCERIES)]).toBe(80)
    expect(q1.values.total).toBe(80)
  })

  it("nets Savings and Income over a quarter's months, never counting them in Total", () => {
    const monthly = [
      { ...month(1), savings: { categoryId: SAVINGS, amount: 5000 }, income: { categoryId: INCOME, amount: 3000 } },
      { ...month(2), savings: { categoryId: SAVINGS, amount: -2000 } },
      { ...month(3), income: { categoryId: INCOME, amount: -3600 } },
    ]

    const [q1] = trendPoints(monthly, 'quarter')

    expect(q1.values[String(SAVINGS)]).toBe(1000)
    expect(q1.values[String(INCOME)] ?? 0).toBe(0)
    expect(q1.values.total).toBe(0)
  })

  it('leaves out a month that nets the other way, at Month granularity', () => {
    const monthly = [month(1, [{ categoryId: SHOPPING, amount: 500 }]), month(2, [{ categoryId: SHOPPING, amount: -700 }])]

    const [january, february] = trendPoints(monthly, 'month')

    expect(january.values[String(SHOPPING)]).toBe(500)
    expect(february.values[String(SHOPPING)]).toBe(0)
    expect(february.values.total).toBe(0)
  })
})

describe('trendCategories', () => {
  const monthly = [
    { ...month(1, [{ categoryId: SHOPPING, amount: 500 }, { categoryId: GROCERIES, amount: 100 }]), savings: { categoryId: SAVINGS, amount: 5000 } },
    { ...month(2, [{ categoryId: SHOPPING, amount: -700 }, { categoryId: GROCERIES, amount: 100 }]), savings: { categoryId: SAVINGS, amount: -6000 } },
  ]

  it('lists the Categories with Spending in a point, largest summed over the points first, then Savings and Income', () => {
    expect(trendCategories(monthly, 'month')).toEqual([SHOPPING, GROCERIES, SAVINGS])
  })

  it('leaves out a Category, Savings or Income that nets the other way in every point', () => {
    expect(trendCategories(monthly, 'quarter')).toEqual([GROCERIES])
  })
})
