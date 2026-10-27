// The search that starts a list's toolbar, with the placeholder saying what it searches. On a phone it
// takes the toolbar's first line, with the rest of the toolbar wrapping under it.
export function ToolbarSearch({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="relative min-w-0 flex-1 max-sm:basis-full sm:max-w-xs">
      <svg
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
      >
        <path d="M10.68 11.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06ZM11.5 7a4.5 4.5 0 1 0-9 0 4.5 4.5 0 0 0 9 0Z" />
      </svg>
      <input
        type="search"
        aria-label="Search"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 py-1.5 pr-3 pl-8 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
      />
    </div>
  )
}
