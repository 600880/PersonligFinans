const nok = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// -1249.9 → "-1 249,90 kr", with non-breaking spaces so the Amount never wraps. Uses a plain
// hyphen-minus rather than the "−" nb-NO formats with.
export function formatAmount(amount: number): string {
  return `${amount < 0 ? '-' : ''}${nok.format(Math.abs(amount))}\u00a0kr`
}
