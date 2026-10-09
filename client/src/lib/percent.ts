// 0.123 → "12,3 %", as the Dashboard shows shares and changes.
export const percent = new Intl.NumberFormat('nb-NO', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
