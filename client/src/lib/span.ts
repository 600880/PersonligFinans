import type { TransactionMonth } from './api'

// A run of consecutive whole months from `from` to `to`, both included. At least two months long.
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

// The 12 months ending at the latest offered month, or all of them when there are fewer. Null when
// fewer than two months are offered, since a Span is at least two months long.
export function defaultSpan(offered: TransactionMonth[]): Span | null {
  if (offered.length < 2) return null
  return { from: offered[Math.max(0, offered.length - DEFAULT_SPAN_MONTHS)], to: offered[offered.length - 1] }
}

// The Span starting at `from`. When `from` isn't at least one month before To, To moves to the month
// after it, or `from` moves back to the month before the latest one if there is no month after it.
export function withFrom(span: Span, from: TransactionMonth, offered: TransactionMonth[]): Span {
  if (indexOf(from) < indexOf(span.to)) return { from, to: span.to }
  const latest = offered[offered.length - 1]
  if (indexOf(from) < indexOf(latest)) return { from, to: monthAt(indexOf(from) + 1) }
  return { from: monthAt(indexOf(latest) - 1), to: latest }
}

// The Span ending at `to`, the other way round from withFrom: From moves to the month before it, or
// `to` moves forward to the month after the earliest one if there is no month before it.
export function withTo(span: Span, to: TransactionMonth, offered: TransactionMonth[]): Span {
  if (indexOf(span.from) < indexOf(to)) return { from: span.from, to }
  const earliest = offered[0]
  if (indexOf(earliest) < indexOf(to)) return { from: monthAt(indexOf(to) - 1), to }
  return { from: earliest, to: monthAt(indexOf(earliest) + 1) }
}

// The Span as the monthly Spending endpoint's query parameters.
export function spanQuery({ from, to }: Span) {
  return `fromYear=${from.year}&fromMonth=${from.month}&toYear=${to.year}&toMonth=${to.month}`
}
