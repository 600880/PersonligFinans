import type { Category } from './api'

// Neutral grey, so Uncategorized stands apart from the Categories, which never get it.
const UNCATEGORIZED_COLOUR = '#94a3b8'
// For a Category missing from those loaded.
const FALLBACK_COLOUR = '#475569'

// The colour of a Category among those loaded, or of Uncategorized when categoryId is null. Shared
// by the Dashboard's donut and Spending trend, so a Category looks the same in both, whichever
// Period or Span is shown.
export function categoryColour(categoryId: number | null, categories: Category[]): string {
  if (categoryId === null) return UNCATEGORIZED_COLOUR
  return categories.find((c) => c.id === categoryId)?.colour ?? FALLBACK_COLOUR
}
