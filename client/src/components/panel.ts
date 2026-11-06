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
// The Dashboard's cards: a panel with its title and dropdowns in a ruled header, and its chart and
// table in the body under it. On a phone the dropdowns wrap under the title.
export const cardHeaderClass =
  'flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-slate-200 dark:border-slate-800 px-5 py-4 max-sm:px-4'
export const cardTitleClass = 'pb-1 text-lg font-semibold text-slate-900 dark:text-slate-100'
export const cardBodyClass = 'p-5 max-sm:p-4'
// A labelled dropdown in a card's header, its label small above it. The dropdown itself looks like the
// toolbar's on the other pages, without taking its label's weight.
export const fieldLabelClass = 'flex w-fit flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400'
export const fieldSelectClass = `${toolbarSelectClass} font-normal`
// The muted, small-caps header row of a Dashboard table, its cells medium weight rather than bold.
export const cardTableHeadClass = 'text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400 [&_th]:font-medium'
