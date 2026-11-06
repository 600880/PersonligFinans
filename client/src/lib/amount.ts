const nok = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// -1249.9 → "-1 249,90 kr", with non-breaking spaces so the Amount never wraps. Uses a plain
// hyphen-minus rather than the "−" nb-NO formats with.
export function formatAmount(amount: number): string {
  return `${amount < 0 ? '-' : ''}${nok.format(Math.abs(amount))}\u00a0kr`
}

// 1, -1 or 0, by whether the Amount is above, below or at zero once rounded to øre.
export function signOf(amount: number): 1 | -1 | 0 {
  return Math.sign(Math.round(amount * 100)) as 1 | -1 | 0
}

// 500 → "+500,00 kr", -1000 → "−1 000,00 kr" and 0 → "0,00 kr": always with its sign, the "−" as the
// Spending trend's figures show it, and none at zero.
export function formatSignedAmount(amount: number): string {
  const sign = { 1: '+', [-1]: '−', 0: '' }[signOf(amount)]
  return `${sign}${nok.format(Math.abs(amount))}\u00a0kr`
}
