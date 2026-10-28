// The white panel a page's list sits in, as on Categories, so the lists read as one app.
export const panelClass =
  'rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm'
// The toolbar at the top of the panel, ruled off from the column headers under it, so the search and
// filters read as part of the list they filter. On a phone it wraps. While the list loads it is all the
// panel holds, so its rule is dropped rather than doubling the panel's own edge.
export const panelToolbarClass =
  'flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 dark:border-slate-800 px-4 py-3 last:border-b-0'
// A compact select in the panel's toolbar, beside its search, labelled for screen readers only.
export const toolbarSelectClass =
  'min-w-0 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100'
// Why the list is empty, said in the panel under its toolbar.
export const panelEmptyClass = 'px-4 py-6 text-sm text-slate-500 dark:text-slate-400'
// The panel's ruled header row. On a phone the rows are cards instead, so it is hidden.
export const panelHeadClass =
  'border-b border-slate-200 dark:border-slate-800 text-sm text-slate-500 dark:text-slate-400 max-sm:hidden'
