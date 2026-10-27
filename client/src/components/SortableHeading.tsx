// The column a table is sorted by, and which way, named as aria-sort names it. Each page has its own
// columns.
export interface Sort<Column extends string> {
  column: Column
  direction: 'ascending' | 'descending'
}

// A column heading that sorts the table by its column, in whichever direction the page chooses on each
// click. The arrow shows which way; aria-sort says it.
export function SortableHeading<Column extends string>({
  column,
  sort,
  onSort,
  className,
  children,
}: {
  column: Column
  sort: Sort<Column>
  onSort: (column: Column) => void
  className: string
  children: string
}) {
  const direction = sort.column === column ? sort.direction : null
  return (
    <th aria-sort={direction ?? 'none'} className={className}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1 rounded font-medium hover:text-slate-900 dark:hover:text-slate-100 ${direction ? 'text-slate-900 dark:text-slate-100' : ''}`}
      >
        {children}
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
          className={`h-4 w-4 ${direction ? '' : 'text-slate-300 dark:text-slate-600'}`}
        >
          {direction === 'ascending' ? (
            <path d="M4.22 9.78a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1-1.06 1.06L8 7.06 5.28 9.78a.75.75 0 0 1-1.06 0Z" />
          ) : direction === 'descending' ? (
            <path d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" />
          ) : (
            <path d="M5.22 10.22a.75.75 0 0 1 1.06 0L8 11.94l1.72-1.72a.75.75 0 1 1 1.06 1.06l-2.25 2.25a.75.75 0 0 1-1.06 0l-2.25-2.25a.75.75 0 0 1 0-1.06ZM10.78 5.78a.75.75 0 0 1-1.06 0L8 4.06 6.28 5.78a.75.75 0 0 1-1.06-1.06l2.25-2.25a.75.75 0 0 1 1.06 0l2.25 2.25a.75.75 0 0 1 0 1.06Z" />
          )}
        </svg>
      </button>
    </th>
  )
}
