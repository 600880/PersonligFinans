import type { Category } from './api'

// The name of a Category among those loaded, or "Uncategorized" when categoryId is null.
export function categoryName(categoryId: number | null, categories: Category[]): string {
  if (categoryId === null) return 'Uncategorized'
  return categories.find((c) => c.id === categoryId)?.name ?? `Category ${categoryId}`
}
