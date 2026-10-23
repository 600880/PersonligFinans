const wholeNumber = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 })

// 1032 → "1 032", with a non-breaking space between the thousands as nb-NO writes them, so a count
// never wraps.
export function formatCount(count: number): string {
  return wholeNumber.format(count)
}

// "1 Bank Statement", "1 032 Transactions": the count and the noun, plural unless the count is one.
export function counted(count: number, noun: string): string {
  return `${formatCount(count)} ${noun}${count === 1 ? '' : 's'}`
}
