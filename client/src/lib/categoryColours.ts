// The colour each Category is drawn in, shared by the Dashboard's donut and Spending trend so a
// Category looks the same in both. Keyed by Category id, so each Category keeps its colour whichever
// Period or Span is shown.
const CATEGORY_COLOURS: Record<number, string> = {
  1: '#2a78d6',
  2: '#eb6834',
  3: '#1baf7a',
  4: '#eda100',
  5: '#e87ba4',
  6: '#008300',
  7: '#4a3aa7',
  8: '#e34948',
  9: '#104281',
  10: '#86b6ef',
  11: '#8a5a1c',
  12: '#0f766e',
  13: '#9085e9',
  14: '#b8336a',
  15: '#6b8e23',
}
// Neutral grey, so Uncategorized stands apart from the Categories.
const UNCATEGORIZED_COLOUR = '#94a3b8'
// For a Category added after this list; never the Uncategorized grey.
const FALLBACK_COLOUR = '#475569'

// The colour of a Category, or of Uncategorized when categoryId is null.
export function categoryColour(categoryId: number | null): string {
  return categoryId === null ? UNCATEGORIZED_COLOUR : (CATEGORY_COLOURS[categoryId] ?? FALLBACK_COLOUR)
}
