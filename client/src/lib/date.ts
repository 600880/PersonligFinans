export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

// "2026-08-31" → "31.08.2026", the Norwegian format the bank prints.
export function formatNorwegianDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  return `${day}.${month}.${year}`
}
