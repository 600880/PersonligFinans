import type { TransactionMonth } from './api'
import { MONTHS_IN, type Granularity } from './period'

// A run of consecutive whole months from `from` to `to`, both included, touching at least two
// Periods of the trend's granularity, so at least two months long.
export interface Span {
  from: TransactionMonth
  to: TransactionMonth
}

// The trend opens on this many months, or on fewer when there aren't as many to offer.
const DEFAULT_SPAN_MONTHS = 12

// Counts months from year 0, so that consecutive months have consecutive indexes.
function indexOf({ year, month }: TransactionMonth) {
  return year * 12 + month - 1
}

function monthAt(index: number): TransactionMonth {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

// Identifies a month, e.g. "2025-2".
export function monthValue({ year, month }: TransactionMonth) {
  return `${year}-${month}`
}

// "02.2025".
export function monthLabel({ year, month }: TransactionMonth) {
  return `${String(month).padStart(2, '0')}.${year}`
}

// The months a Span can start or end on: every calendar month from the earliest to the latest of
// the months with Transactions, oldest first, including the months between without any.
export function offeredMonths(months: TransactionMonth[]): TransactionMonth[] {
  if (months.length === 0) return []
  const indexes = months.map(indexOf)
  const offered: TransactionMonth[] = []
  for (let index = Math.min(...indexes); index <= Math.max(...indexes); index++) offered.push(monthAt(index))
  return offered
}

// Counts the Periods of the granularity, so that consecutive Periods have consecutive indexes.
function periodIndexOf(month: TransactionMonth, granularity: Granularity) {
  return Math.floor(indexOf(month) / MONTHS_IN[granularity])
}

function firstMonthOf(periodIndex: number, granularity: Granularity) {
  return monthAt(periodIndex * MONTHS_IN[granularity])
}

function lastMonthOf(periodIndex: number, granularity: Granularity) {
  return monthAt((periodIndex + 1) * MONTHS_IN[granularity] - 1)
}

// The Span starting at `from`. When `from` isn't in a Period before To's, To moves to the end of the
// Period after `from`'s, or, if no month after it is offered, `from` moves back to the start of the
// Period before the latest one, so the Span touches at least two Periods of the granularity.
export function withFrom(
  span: Span,
  from: TransactionMonth,
  offered: TransactionMonth[],
  granularity: Granularity,
): Span {
  const periodOf = (month: TransactionMonth) => periodIndexOf(month, granularity)
  if (periodOf(from) < periodOf(span.to)) return { from, to: span.to }
  const [earliest, latest] = [offered[0], offered[offered.length - 1]]
  if (periodOf(from) < periodOf(latest)) {
    return { from, to: earliestOf(lastMonthOf(periodOf(from) + 1, granularity), latest) }
  }
  return {
    from: latestOf(firstMonthOf(periodOf(latest) - 1, granularity), earliest),
    to: periodOf(span.to) === periodOf(latest) ? span.to : latest,
  }
}

// The Span ending at `to`, the other way round from withFrom: From moves to the start of the Period
// before `to`'s, or, if no month before it is offered, `to` moves forward to the end of the Period
// after the earliest one.
export function withTo(span: Span, to: TransactionMonth, offered: TransactionMonth[], granularity: Granularity): Span {
  const periodOf = (month: TransactionMonth) => periodIndexOf(month, granularity)
  if (periodOf(span.from) < periodOf(to)) return { from: span.from, to }
  const [earliest, latest] = [offered[0], offered[offered.length - 1]]
  if (periodOf(earliest) < periodOf(to)) {
    return { from: latestOf(firstMonthOf(periodOf(to) - 1, granularity), earliest), to }
  }
  return {
    from: periodOf(span.from) === periodOf(earliest) ? span.from : earliest,
    to: earliestOf(lastMonthOf(periodOf(earliest) + 1, granularity), latest),
  }
}

// The Span shown at a new granularity: kept when it touches at least two Periods of it, or else
// corrected as when From is chosen. Null when the offered months all fall in one Period of it.
export function withGranularity(span: Span, offered: TransactionMonth[], granularity: Granularity): Span | null {
  return isOnePeriod(offered, granularity) ? null : withFrom(span, span.from, offered, granularity)
}

function isOnePeriod(offered: TransactionMonth[], granularity: Granularity) {
  const [earliest, latest] = [offered[0], offered[offered.length - 1]]
  return periodIndexOf(earliest, granularity) === periodIndexOf(latest, granularity)
}

// The 12 months ending at the latest offered month, or all of them when there are fewer, corrected
// to touch at least two Periods of the granularity. Null when the offered months all fall in one
// Period, since a Span then can't.
export function defaultSpan(offered: TransactionMonth[], granularity: Granularity): Span | null {
  if (offered.length === 0) return null
  const latest = offered[offered.length - 1]
  const twelveMonths = { from: offered[Math.max(0, offered.length - DEFAULT_SPAN_MONTHS)], to: latest }
  return withGranularity(twelveMonths, offered, granularity)
}

// The Span to show once the offered months are reloaded: a fresh copy of `span`, so its Spending is
// fetched again, when both its ends are still offered, or else the default Span.
export function reloadedSpan(span: Span | null, offered: TransactionMonth[], granularity: Granularity): Span | null {
  const isOffered = (month: TransactionMonth) => offered.some((option) => monthValue(option) === monthValue(month))
  if (!span || !isOffered(span.from) || !isOffered(span.to)) return defaultSpan(offered, granularity)
  const kept = withGranularity(span, offered, granularity)
  return kept && { ...kept }
}

function earliestOf(a: TransactionMonth, b: TransactionMonth) {
  return indexOf(a) <= indexOf(b) ? a : b
}

function latestOf(a: TransactionMonth, b: TransactionMonth) {
  return indexOf(a) >= indexOf(b) ? a : b
}

// The Span as the monthly Spending endpoint's query parameters.
export function spanQuery({ from, to }: Span) {
  return `fromYear=${from.year}&fromMonth=${from.month}&toYear=${to.year}&toMonth=${to.month}`
}
