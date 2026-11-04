import { describe, expect, it } from 'vitest'
import type { MonthSpending, SpendingSlice } from './api'
import { formatChange, trendCategories, trendPoints } from './trend'

const GROCERIES = 1
const SHOPPING = 2
const SAVINGS = 3
const INCOME = 4

// A month of 2026 as the monthly Spending endpoint returns it, with each group's Amounts netted as
// what it cost, negative when it nets the other way.
function month(number: number, slices: SpendingSlice[] = []): MonthSpending {
  return { year: 2026, month: number, slices, savings: null, income: null }
}

describe('trendPoints', () => {
  it("nets a Category over a quarter's months, so a refund in a later month reduces the quarter's Spending, below zero when it outweighs it", () => {
    const monthly = [
      month(1, [{ categoryId: SHOPPING, amount: 500 }, { categoryId: GROCERIES, amount: 300 }]),
      month(2, [{ categoryId: SHOPPING, amount: -700 }]),
      month(3, [{ categoryId: GROCERIES, amount: -60 }]),
    ]

    const [q1] = trendPoints(monthly, 'quarter')

    expect(q1.values[String(SHOPPING)]).toBe(-200 / 3)
    expect(q1.values[String(GROCERIES)]).toBe(80)
    expect(q1.values.total).toBe(40 / 3)
  })

  it("nets Savings and Income over a quarter's months, below zero when they net the other way, never counting them in Total", () => {
    const monthly = [
      { ...month(1), savings: { categoryId: SAVINGS, amount: 5000 }, income: { categoryId: INCOME, amount: 3000 } },
      { ...month(2), savings: { categoryId: SAVINGS, amount: -2000 } },
      { ...month(3), income: { categoryId: INCOME, amount: -3600 } },
    ]

    const [q1] = trendPoints(monthly, 'quarter')

    expect(q1.values[String(SAVINGS)]).toBe(1000)
    expect(q1.values[String(INCOME)]).toBe(-200)
    expect(q1.values.total).toBe(0)
  })

  it('nets only the months inside the Span for a point at its edge, divided by the months it covers', () => {
    const monthly = [month(2, [{ categoryId: SHOPPING, amount: 500 }]), month(3, [{ categoryId: SHOPPING, amount: -200 }])]

    const [q1] = trendPoints(monthly, 'quarter')

    expect(q1.monthsCovered).toBe(2)
    expect(q1.values[String(SHOPPING)]).toBe(150)
  })

  it('keeps a Category that nets the other way below zero, divided by the months the point covers', () => {
    const monthly = [month(2, [{ categoryId: SHOPPING, amount: 900 }]), month(3, [{ categoryId: SHOPPING, amount: -1500 }])]

    const [q1] = trendPoints(monthly, 'quarter')

    expect(q1.values[String(SHOPPING)]).toBe(-300)
  })

  it('keeps a month that nets the other way below zero at Month granularity, as Total does', () => {
    const monthly = [month(1, [{ categoryId: SHOPPING, amount: 500 }]), month(2, [{ categoryId: SHOPPING, amount: -700 }])]

    const [january, february] = trendPoints(monthly, 'month')

    expect(january.values[String(SHOPPING)]).toBe(500)
    expect(february.values[String(SHOPPING)]).toBe(-700)
    expect(february.values.total).toBe(-700)
  })

  it('keeps Savings and Income below zero when they net the other way', () => {
    const monthly = [
      { ...month(1), savings: { categoryId: SAVINGS, amount: -5000 }, income: { categoryId: INCOME, amount: -200 } },
      { ...month(2), savings: { categoryId: SAVINGS, amount: 1000 } },
    ]

    const [january] = trendPoints(monthly, 'month')

    expect(january.values[String(SAVINGS)]).toBe(-5000)
    expect(january.values[String(INCOME)]).toBe(-200)
    expect(january.values.total).toBe(0)
  })

  it('makes Total the net of every Category, so a refund in one lowers it, never counting Savings or Income', () => {
    const monthly = [
      {
        ...month(1, [{ categoryId: SHOPPING, amount: -1200 }, { categoryId: GROCERIES, amount: 400 }, { categoryId: null, amount: 100 }]),
        savings: { categoryId: SAVINGS, amount: 5000 },
        income: { categoryId: INCOME, amount: 30000 },
      },
    ]

    const [january] = trendPoints(monthly, 'month')

    expect(january.values.total).toBe(-700)
    expect(january.values[String(SHOPPING)] + january.values[String(GROCERIES)] + january.values.uncategorized).toBe(-700)
  })

  it('counts what is left over from adding up Amounts that cancel to the øre as no figure', () => {
    const monthly = [
      month(1, [{ categoryId: SHOPPING, amount: 10.1 }, { categoryId: GROCERIES, amount: 0.1 }]),
      month(2, [{ categoryId: SHOPPING, amount: 20.2 }, { categoryId: GROCERIES, amount: 0.2 }]),
      month(3, [{ categoryId: SHOPPING, amount: -30.3 }, { categoryId: GROCERIES, amount: -0.3 }]),
    ]

    const [q1] = trendPoints(monthly, 'quarter')

    expect(trendCategories(monthly, 'quarter')).toEqual([])
    expect(Object.is(q1.values.total, 0)).toBe(true)
  })
})

describe('trendCategories', () => {
  const monthly = [
    { ...month(1, [{ categoryId: SHOPPING, amount: 500 }, { categoryId: GROCERIES, amount: 100 }]), savings: { categoryId: SAVINGS, amount: 5000 } },
    { ...month(2, [{ categoryId: SHOPPING, amount: -700 }, { categoryId: GROCERIES, amount: 100 }]), savings: { categoryId: SAVINGS, amount: -6000 } },
  ]

  it('lists the Categories with a figure in some point, largest signed figure summed over the points first, then Savings and Income', () => {
    expect(trendCategories(monthly, 'month')).toEqual([GROCERIES, SHOPPING, SAVINGS])
  })

  it('lists a Category, Savings or Income that only nets the other way', () => {
    expect(trendCategories(monthly, 'quarter')).toEqual([GROCERIES, SHOPPING, SAVINGS])
  })

  it('leaves out a Category, Savings or Income that is zero in every point', () => {
    const zeroes = [
      { ...month(1, [{ categoryId: SHOPPING, amount: 500 }]), savings: { categoryId: SAVINGS, amount: 300 } },
      { ...month(2, [{ categoryId: SHOPPING, amount: -500 }, { categoryId: GROCERIES, amount: 100 }]), savings: { categoryId: SAVINGS, amount: -300 } },
    ]

    expect(trendCategories(zeroes, 'quarter')).toEqual([GROCERIES])
  })

  it('orders the Spending Categories by their signed figures summed over the points, largest first, then Savings and Income', () => {
    const refunds = [
      { ...month(1, [{ categoryId: SHOPPING, amount: 500 }, { categoryId: GROCERIES, amount: 100 }]), income: { categoryId: INCOME, amount: 9000 } },
      { ...month(2, [{ categoryId: SHOPPING, amount: -700 }, { categoryId: null, amount: -50 }]), savings: { categoryId: SAVINGS, amount: -6000 } },
    ]

    expect(trendCategories(refunds, 'month')).toEqual([GROCERIES, null, SHOPPING, SAVINGS, INCOME])
  })
})

describe('formatChange', () => {
  it.each([
    ['grew from below zero to above it', -300, 900, '▲ +400,0 %'],
    ['fell further below zero', -300, -600, '▼ −100,0 %'],
    ['rose from below zero to zero', -300, 0, '▲ +100,0 %'],
    ['fell from above zero to zero', 400, 0, '▼ −100,0 %'],
  ])('measures a change against the size of the first figure, when it %s', (_case, first, last, shown) => {
    expect(formatChange(first, last)).toBe(shown)
  })

  it('shows "New" when there was no figure at first', () => {
    expect(formatChange(0, 500)).toBe('New')
    expect(formatChange(0, -500)).toBe('New')
  })

  it('shows "–" when there was no figure at either end', () => {
    expect(formatChange(0, 0)).toBe('–')
  })

  it('shows no arrow or sign when the change rounds to zero', () => {
    expect(formatChange(-300, -300.1)).toBe('0,0 %')
    expect(formatChange(1000, 1000.4)).toBe('0,0 %')
  })
})
