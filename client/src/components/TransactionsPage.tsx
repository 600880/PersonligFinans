import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import {
  addBookmark,
  addFolder,
  changeTransactionCategory,
  changeTransactionNote,
  deleteFolder,
  deleteTransaction,
  fetchBookmarks,
  fetchCategories,
  fetchFolderBookmarks,
  fetchFolders,
  fetchTransactionMonths,
  fetchTransactions,
  fileBookmark,
  receiptUrl,
  removeBookmark,
  renameFolder,
  type Category,
  type Folder,
  type SaveFolderResult,
  type Transaction,
  type TransactionMonth,
  type YearOrMonth,
} from '../lib/api'
import { categoryFilterOf, matchesCategory, UNCATEGORIZED } from '../lib/categoryFilter'
import { formatAmount } from '../lib/amount'
import { formatNorwegianDate } from '../lib/date'
import { inFolderOrder } from '../lib/folders'
import { currentMonth, MONTH_NAMES } from '../lib/month'
import { periodLabel, periodValue, type Period } from '../lib/period'
import { firstMonthWithTransactions, monthsOfQuarter } from '../lib/quarter'
import { BookmarkAddedPopup } from './BookmarkAddedPopup'
import { FolderDropdown, FolderNameForm } from './FolderDropdown'
import { ErrorMessage, StatusMessage } from './Messages'
import { ZoomableReceipt } from './ZoomableReceipt'
import { inputClassName } from './TransactionForm'

const LOAD_ERROR = 'Could not load the transactions.'
const BOOKMARKS_LOAD_ERROR = 'Could not load the bookmarks.'
const FOLDERS_LOAD_ERROR = 'Could not load the folders.'

const inputClass = 'rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 font-normal'
const smallButtonClass =
  'rounded-lg px-2 py-1 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-300 dark:disabled:text-slate-600'
const categorySelectClass =
  'rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800'

// The set with the id added, or removed.
function withId(ids: ReadonlySet<number>, id: number, present: boolean): ReadonlySet<number> {
  const next = new Set(ids)
  if (present) next.add(id)
  else next.delete(id)
  return next
}

// What the page lists: All, the chosen Period's Transactions, or the bookmarked ones.
type List = 'all' | 'bookmarks'

const LISTS: { list: List; label: string }[] = [
  { list: 'all', label: 'All' },
  { list: 'bookmarks', label: 'Bookmarks' },
]

// What is open for the chosen Folder in the Bookmarks view: its name field, or its delete
// confirmation.
type FolderAction = 'rename' | 'delete'

// A Period's Transactions, remembered with the Period they were loaded for.
interface LoadedPeriod {
  period: YearOrMonth
  transactions: Transaction[]
}

// Where the page opens when reached from the Dashboard, filtered to a Category, to Uncategorized
// when categoryId is null, or to all Categories: a month, a whole year, or a quarter's first month
// with Transactions in that Category. A quarter looks only at its months among `allowedMonths`, such
// as the months inside the trend's Span, or at all three when not given.
export interface TransactionsTarget {
  period: Period
  categoryId: number | null | 'all'
  allowedMonths?: TransactionMonth[]
}

// The month or year a target opens on; for a quarter, a month found in its year's Transactions.
// Null without a target.
async function openedPeriod(target?: TransactionsTarget): Promise<YearOrMonth | null> {
  if (!target) return null
  const { period } = target
  if (period.granularity !== 'quarter') return period
  const transactions = await fetchTransactions({ granularity: 'year', year: period.year })
  const filter = categoryFilterOf(target.categoryId)
  const allowed = target.allowedMonths ?? monthsOfQuarter(period)
  return { granularity: 'month', ...firstMonthWithTransactions(period, allowed, filter, transactions) }
}

// Whether the description contains the search text, ignoring case and the text's surrounding spaces.
// Æ, Ø and Å are letters of their own, so "o" never matches "ø".
function matchesSearch(transaction: Transaction, search: string) {
  return transaction.description.toLowerCase().includes(search.trim().toLowerCase())
}

// Opens on All, on the target when given, with the search empty, and otherwise on the latest month
// with Transactions and all Categories. The target is read on mount only.
export function TransactionsPage({ target }: { target?: TransactionsTarget }) {
  const [list, setList] = useState<List>('all')
  const [categories, setCategories] = useState<Category[]>([])
  const [monthsWithTransactions, setMonthsWithTransactions] = useState<TransactionMonth[]>([])
  // The chosen month or whole year. Null until loaded, since the target's, or else the latest month
  // with Transactions, decides the one the page opens on.
  const [selected, setSelected] = useState<YearOrMonth | null>(null)
  const [loaded, setLoaded] = useState<LoadedPeriod | null>(null)
  // Set when a Transaction, or a Folder with its Bookmarks, is deleted while Bookmarks is shown, so the
  // Period and the months are loaded again the next time All is shown, with every star as it now is.
  const [isAllStale, setIsAllStale] = useState(false)
  // The chosen Folder's bookmarked Transactions while Bookmarks is shown; null while they load, and
  // while All is shown, so choosing Bookmarks or a Folder always loads them afresh. A row whose Bookmark is removed stays, with
  // its star empty, so it can be bookmarked again with one click.
  const [bookmarks, setBookmarks] = useState<Transaction[] | null>(null)
  // The Folder whose bookmarks Bookmarks lists, or null for those in no Folder.
  const [chosenFolderId, setChosenFolderId] = useState<number | null>(null)
  // The User's Folders, in the API's order, shared by the Bookmarks view and the popup. Null until
  // first needed and loaded, then kept for the rest of the visit to the page.
  const [folders, setFolders] = useState<Folder[] | null>(null)
  // What is open for the chosen Folder, if anything, and whether its delete is being saved.
  const [folderAction, setFolderAction] = useState<FolderAction | null>(null)
  const [isDeletingFolder, setIsDeletingFolder] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // The Transactions whose Category is being saved. Their selects are disabled until it is, so a
  // failed save never goes back over a later choice.
  const [savingIds, setSavingIds] = useState<ReadonlySet<number>>(new Set())
  // The Transactions whose Bookmark is being added or removed. Their stars are disabled until it is,
  // so a failed save never goes back over a later click.
  const [bookmarkSavingIds, setBookmarkSavingIds] = useState<ReadonlySet<number>>(new Set())
  // The Transaction whose "Bookmark added" popup is open, with the Folder its Bookmark went into. Only
  // one is ever open.
  const [popup, setPopup] = useState<{ transactionId: number; addedFolderId: number | null } | null>(null)
  // The star under the open popup, which gets the focus back when the popup closes.
  const popupStarRef = useRef<HTMLButtonElement>(null)
  // The Transaction whose delete is waiting for confirmation, and whether that delete is being saved.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  // The Transaction whose note editor is open, the draft text, and whether the save is in flight.
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [isSavingNote, setIsSavingNote] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState(
    target ? categoryFilterOf(target.categoryId) : '',
  )
  const [search, setSearch] = useState('')
  // Kept from mount, so the target is looked at once.
  const [openingTarget] = useState(target)

  useEffect(() => {
    let ignore = false
    Promise.all([fetchCategories(), fetchTransactionMonths(), openedPeriod(openingTarget)])
      .then(([loadedCategories, loadedMonths, opened]) => {
        if (ignore) return
        setCategories(loadedCategories)
        setMonthsWithTransactions(loadedMonths)
        setSelected(opened ?? { granularity: 'month', ...(loadedMonths[0] ?? currentMonth()) })
      })
      .catch(() => {
        if (!ignore) setErrorMessage(LOAD_ERROR)
      })
    return () => {
      ignore = true
    }
  }, [openingTarget])

  useEffect(() => {
    if (!selected) return
    let ignore = false
    fetchTransactions(selected)
      .then((transactions) => {
        if (!ignore) setLoaded({ period: selected, transactions })
      })
      .catch(() => {
        if (!ignore) setErrorMessage(LOAD_ERROR)
      })
    return () => {
      ignore = true
    }
  }, [selected])

  useEffect(() => {
    if (list !== 'bookmarks') return
    let ignore = false
    const loading = chosenFolderId === null ? fetchBookmarks() : fetchFolderBookmarks(chosenFolderId)
    loading
      .then((loadedBookmarks) => {
        if (!ignore) setBookmarks(loadedBookmarks)
      })
      .catch(() => {
        if (!ignore) setErrorMessage(BOOKMARKS_LOAD_ERROR)
      })
    return () => {
      ignore = true
    }
  }, [list, chosenFolderId])

  // The Folders are loaded the first time Bookmarks or a popup needs them. Failing, they are tried
  // again the next time either needs them.
  const needsFolders = list === 'bookmarks' || popup !== null
  useEffect(() => {
    if (!needsFolders || folders !== null) return
    let ignore = false
    fetchFolders()
      .then((loadedFolders) => {
        if (!ignore) setFolders(loadedFolders)
      })
      .catch(() => {
        if (!ignore) setErrorMessage(FOLDERS_LOAD_ERROR)
      })
    return () => {
      ignore = true
    }
  }, [needsFolders, folders])

  // The chosen year stays offered even once its last Transaction is deleted.
  const years = [
    ...new Set([
      currentMonth().year,
      ...(selected ? [selected.year] : []),
      ...monthsWithTransactions.map((m) => m.year),
    ]),
  ].sort((a, b) => b - a)
  const transactions =
    loaded && selected && periodValue(loaded.period) === periodValue(selected) ? loaded.transactions : null
  const isFiltering = categoryFilter !== '' || search.trim() !== ''
  const chosenFolder = folders?.find((f) => f.id === chosenFolderId) ?? null
  const shownTransactions =
    list === 'bookmarks'
      ? bookmarks
      : (transactions?.filter((t) => matchesCategory(t, categoryFilter) && matchesSearch(t, search)) ?? null)

  // Closes any open Note editor, delete confirmation or "Bookmark added" popup, and the chosen Folder's
  // name field or delete confirmation.
  function closeOpenActions() {
    setConfirmingDeleteId(null)
    setEditingNoteId(null)
    setPopup(null)
    setFolderAction(null)
  }

  // The Year, Month, Category and Search are kept while Bookmarks is shown, and so is the Period's
  // list, so All comes back as it was left: unless a Transaction or a Folder was deleted meanwhile,
  // when the Period and the months are loaded again. Bookmarks always opens on the bookmarks in no
  // Folder.
  function chooseList(next: List) {
    if (next === list) return
    setStatusMessage(null)
    setErrorMessage(null)
    closeOpenActions()
    setBookmarks(null)
    setChosenFolderId(null)
    if (next === 'all' && isAllStale) {
      setIsAllStale(false)
      // The same Period as a new object, so the effect loads it again.
      setSelected((current) => current && { ...current })
      reloadMonths()
    }
    setList(next)
  }

  // The months offered may have lost one to a delete. Failing, they stay as they were.
  function reloadMonths() {
    fetchTransactionMonths()
      .then(setMonthsWithTransactions)
      .catch(() => {})
  }

  // Loads the Folder's bookmarks afresh, so rows whose Bookmark was removed meanwhile are gone.
  function chooseFolder(folderId: number | null) {
    setStatusMessage(null)
    setErrorMessage(null)
    closeOpenActions()
    setBookmarks(null)
    setChosenFolderId(folderId)
  }

  // Adds the new Folder to the User's Folders in the API's order, so both the Bookmarks view and the
  // popup offer it.
  async function addToFolders(name: string): Promise<SaveFolderResult> {
    const result = await addFolder(name)
    if (result.ok) setFolders((current) => inFolderOrder([...(current ?? []), result.folder]))
    return result
  }

  // Shows the new Folder, empty.
  async function createFolder(name: string): Promise<SaveFolderResult> {
    setStatusMessage(null)
    setErrorMessage(null)
    const result = await addToFolders(name)
    if (result.ok) {
      chooseFolder(result.folder.id)
      setStatusMessage('Folder created')
    } else {
      setErrorMessage(result.message)
    }
    return result
  }

  // Opens the chosen Folder's name field or delete confirmation, closing whatever else is open.
  function openFolderAction(action: FolderAction) {
    setStatusMessage(null)
    setErrorMessage(null)
    closeOpenActions()
    setFolderAction(action)
  }

  // Moves the renamed Folder to its place in the API's order, still chosen.
  async function renameChosenFolder(folder: Folder, name: string): Promise<SaveFolderResult> {
    setStatusMessage(null)
    setErrorMessage(null)
    const result = await renameFolder(folder.id, name)
    if (result.ok) {
      setFolders(
        (current) => current && inFolderOrder(current.map((f) => (f.id === result.folder.id ? result.folder : f))),
      )
      setFolderAction(null)
      setStatusMessage('Folder renamed')
    } else {
      setErrorMessage(result.message)
    }
    return result
  }

  // Shows "Bookmarks" once the Folder is deleted. Its Bookmarks went with it, so All's stars for their
  // Transactions are out of date until All is loaded again.
  async function deleteChosenFolder(folder: Folder) {
    if (isDeletingFolder) return

    setIsDeletingFolder(true)
    const result = await deleteFolder(folder.id).finally(() => setIsDeletingFolder(false))
    setFolderAction(null)

    if (result.ok) {
      setFolders((current) => current && current.filter((f) => f.id !== folder.id))
      chooseFolder(null)
      setStatusMessage(result.alreadyDeleted ? 'The folder was already deleted.' : 'Folder deleted')
      setIsAllStale(true)
    } else {
      setErrorMessage(result.message)
    }
  }

  function choosePeriod(period: YearOrMonth) {
    setStatusMessage(null)
    setErrorMessage(null)
    closeOpenActions()
    setSelected(period)
  }

  // Changing the filter or search may hide the row whose inline editor or popup is open, so close
  // them all.
  function chooseCategoryFilter(value: string) {
    closeOpenActions()
    setCategoryFilter(value)
  }

  function chooseSearch(value: string) {
    closeOpenActions()
    setSearch(value)
  }

  // Shows the change on the Transaction's row in both lists, whichever is shown, so the other one
  // agrees once it is shown again.
  function showChange(id: number, change: Partial<Transaction>) {
    const changed = (transactions: Transaction[]) => transactions.map((t) => (t.id === id ? { ...t, ...change } : t))
    setLoaded((current) => current && { ...current, transactions: changed(current.transactions) })
    setBookmarks((current) => current && changed(current))
  }

  function setSaving(id: number, saving: boolean) {
    setSavingIds((current) => withId(current, id, saving))
  }

  function setBookmarkSaving(id: number, saving: boolean) {
    setBookmarkSavingIds((current) => withId(current, id, saving))
  }

  // Shows the chosen Category at once, and goes back to the previous one when saving fails, so the
  // page never keeps a Category that wasn't saved. Once saved, the row shows whether the server
  // now has it Locked.
  async function changeCategory(transaction: Transaction, categoryId: number) {
    setStatusMessage(null)
    setErrorMessage(null)
    setSaving(transaction.id, true)
    showChange(transaction.id, { categoryId })

    const result = await changeTransactionCategory(transaction.id, categoryId).finally(() =>
      setSaving(transaction.id, false),
    )

    if (result.ok) {
      const { categoryId: savedCategoryId, locked } = result.transaction
      showChange(transaction.id, { categoryId: savedCategoryId, locked })
      setStatusMessage('Category changed')
    } else {
      showChange(transaction.id, { categoryId: transaction.categoryId })
      setErrorMessage(result.message)
    }
  }

  // Fills or empties the star at once, and goes back when saving fails, so the page never shows a
  // Bookmark that wasn't saved, nor hides one that still exists. Any star closes the open popup, and
  // an empty one opens its own once the Bookmark is added, showing the Folder it went into.
  async function toggleBookmark(transaction: Transaction) {
    const bookmarked = !transaction.bookmarked
    setStatusMessage(null)
    setErrorMessage(null)
    setPopup(null)
    setBookmarkSaving(transaction.id, true)
    showChange(transaction.id, { bookmarked })

    if (bookmarked) {
      const result = await addBookmark(transaction.id).finally(() => setBookmarkSaving(transaction.id, false))
      if (result.ok) setPopup({ transactionId: transaction.id, addedFolderId: result.folderId })
      else undoBookmarkToggle(transaction, 'Could not add the bookmark.')
    } else {
      const removed = await removeBookmark(transaction.id).finally(() => setBookmarkSaving(transaction.id, false))
      if (!removed) undoBookmarkToggle(transaction, 'Could not remove the bookmark.')
    }
  }

  // Puts the star back as it was before the click, saying what failed.
  function undoBookmarkToggle(transaction: Transaction, message: string) {
    showChange(transaction.id, { bookmarked: transaction.bookmarked })
    setErrorMessage(message)
  }

  // Files the Bookmark from its popup. Its row stays in the Bookmarks view, star filled, even when
  // moved to another Folder, until the list is loaded again.
  async function fileFromPopup(transaction: Transaction, folderId: number | null) {
    setStatusMessage(null)
    setErrorMessage(null)
    setBookmarkSaving(transaction.id, true)
    return fileBookmark(transaction.id, folderId).finally(() => setBookmarkSaving(transaction.id, false))
  }

  // Removes the Bookmark from its popup. Unlike the star, it waits for the save, so when that fails
  // the star stays filled and the popup stays open, saying so.
  async function removeFromPopup(transaction: Transaction) {
    setStatusMessage(null)
    setErrorMessage(null)
    setBookmarkSaving(transaction.id, true)
    const removed = await removeBookmark(transaction.id).finally(() => setBookmarkSaving(transaction.id, false))
    if (removed) showChange(transaction.id, { bookmarked: false })
    return removed
  }

  // Gives the focus back to the star once the page shows the popup closed, and the star enabled again
  // after a Remove.
  const closePopup = useCallback(() => {
    const star = popupStarRef.current
    flushSync(() => setPopup(null))
    star?.focus()
  }, [])

  // Opens the Transaction's Note editor, or closes it if open, discarding the draft as Cancel does.
  function toggleNoteEditor(transaction: Transaction) {
    if (editingNoteId === transaction.id) {
      setEditingNoteId(null)
      return
    }

    setStatusMessage(null)
    setErrorMessage(null)
    setConfirmingDeleteId(null)
    setFolderAction(null)
    setEditingNoteId(transaction.id)
    setNoteDraft(transaction.note ?? '')
  }

  async function saveNote(transaction: Transaction) {
    if (isSavingNote) return

    setIsSavingNote(true)
    const result = await changeTransactionNote(transaction.id, noteDraft || null).finally(() =>
      setIsSavingNote(false),
    )

    if (result.ok) {
      setEditingNoteId(null)
      showChange(transaction.id, { note: result.transaction.note })
      setStatusMessage('Note saved.')
    } else {
      setErrorMessage(result.message)
    }
  }

  function startDelete(transaction: Transaction) {
    setStatusMessage(null)
    setErrorMessage(null)
    setEditingNoteId(null)
    setFolderAction(null)
    setConfirmingDeleteId(transaction.id)
  }

  // Removes the row once deleted, staying on the chosen Period even when that leaves it empty, and
  // reloads the months, which may have lost one. Deleted from Bookmarks, the Period and the months
  // are loaded again once All is shown.
  async function confirmDelete(transaction: Transaction) {
    if (isDeleting) return

    setIsDeleting(true)
    const result = await deleteTransaction(transaction.id).finally(() => setIsDeleting(false))
    setConfirmingDeleteId(null)

    if (result.ok) {
      const remaining = (transactions: Transaction[]) => transactions.filter((t) => t.id !== transaction.id)
      setLoaded((current) => current && { ...current, transactions: remaining(current.transactions) })
      setBookmarks((current) => current && remaining(current))
      setStatusMessage(result.alreadyDeleted ? 'The transaction was already deleted.' : 'Transaction deleted.')
      if (list === 'bookmarks') setIsAllStale(true)
      else reloadMonths()
    } else {
      setErrorMessage(result.message)
    }
  }

  return (
    <section className="w-full max-w-3xl">
      {/* The switch wraps under the heading when the line has no room for both. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Transactions</h2>
        <div role="group" aria-label="Show" className="flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-sm font-medium">
          {LISTS.map((option) => (
            <button
              key={option.list}
              type="button"
              aria-pressed={list === option.list}
              onClick={() => chooseList(option.list)}
              className={`rounded-md px-2.5 py-0.5 ${
                list === option.list ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {list === 'bookmarks' && (
        <div className="mt-4 flex flex-wrap gap-3">
          {chosenFolder && folderAction === 'rename' ? (
            <FolderNameForm
              initialName={chosenFolder.name}
              submitLabel="Save"
              save={(name) => renameChosenFolder(chosenFolder, name)}
              onCancel={() => setFolderAction(null)}
            />
          ) : (
            <FolderDropdown
              folders={folders}
              chosenId={chosenFolderId}
              onChoose={chooseFolder}
              createFolder={createFolder}
            >
              {chosenFolder && (
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    disabled={isDeletingFolder}
                    onClick={() => openFolderAction('rename')}
                    className={smallButtonClass}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    disabled={isDeletingFolder}
                    onClick={() => openFolderAction('delete')}
                    className={smallButtonClass}
                  >
                    Delete
                  </button>
                </div>
              )}
            </FolderDropdown>
          )}
        </div>
      )}

      {list === 'bookmarks' && chosenFolder && folderAction === 'delete' && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 rounded-lg bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm">
          <span className="mr-auto text-red-800 dark:text-red-300">Delete '{chosenFolder.name}' and its bookmarks?</span>
          <button
            type="button"
            disabled={isDeletingFolder}
            onClick={() => deleteChosenFolder(chosenFolder)}
            className={smallButtonClass}
          >
            Confirm delete
          </button>
          <button
            type="button"
            disabled={isDeletingFolder}
            onClick={() => setFolderAction(null)}
            className={smallButtonClass}
          >
            Cancel
          </button>
        </div>
      )}

      {list === 'all' && selected && (
        <div className="mt-4 flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
            Year
            <select
              value={selected.year}
              onChange={(event) => choosePeriod({ ...selected, year: Number(event.target.value) })}
              className={inputClass}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
            Month
            <select
              value={selected.granularity === 'month' ? selected.month : ''}
              onChange={(event) =>
                choosePeriod(
                  event.target.value === ''
                    ? { granularity: 'year', year: selected.year }
                    : { granularity: 'month', year: selected.year, month: Number(event.target.value) },
                )
              }
              className={inputClass}
            >
              <option value="">All months</option>
              {MONTH_NAMES.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
            Category
            <select
              value={categoryFilter}
              onChange={(event) => chooseCategoryFilter(event.target.value)}
              className={inputClass}
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
              <option value={UNCATEGORIZED}>Uncategorized</option>
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
            Search
            <input
              type="search"
              value={search}
              onChange={(event) => chooseSearch(event.target.value)}
              className={inputClass}
            />
          </label>
        </div>
      )}

      {errorMessage ? (
        <ErrorMessage className="mt-3">{errorMessage}</ErrorMessage>
      ) : (
        <StatusMessage message={statusMessage} className="mt-3" />
      )}

      {list === 'all' && selected && shownTransactions?.length === 0 && (
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
          {isFiltering ? 'No transactions match' : `No transactions in ${periodLabel(selected)}`}
        </p>
      )}

      {list === 'bookmarks' && shownTransactions?.length === 0 && (
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
          {chosenFolder ? `No bookmarks in ${chosenFolder.name}` : 'No bookmarks'}
        </p>
      )}

      {shownTransactions && shownTransactions.length > 0 && (
        // On a phone each row is laid out as a card instead, its column headers hidden, so the table
        // never runs wider than the screen.
        <table className="mt-4 w-full text-left text-sm max-sm:block">
          <thead className="text-slate-500 dark:text-slate-400 max-sm:hidden">
            <tr>
              <th className="py-2 font-medium">Date</th>
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 font-medium">Category</th>
              <th className="py-2 text-right font-medium">Amount</th>
              <th className="py-2">
                <span className="sr-only">Bookmark</span>
              </th>
              <th className="py-2">
                <span className="sr-only">Note</span>
              </th>
              <th className="py-2">
                <span className="sr-only">Delete</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-slate-900 dark:text-slate-100 max-sm:block">
            {shownTransactions.map((transaction) => (
              <Fragment key={transaction.id}>
                <tr className="max-sm:grid max-sm:grid-cols-[1fr_auto_auto_auto] max-sm:items-center max-sm:gap-1 max-sm:py-3">
                  <td className="py-2 pr-3 whitespace-nowrap max-sm:col-start-1 max-sm:row-start-1 max-sm:p-0">
                    {formatNorwegianDate(transaction.date)}
                  </td>
                  <td className="py-2 pr-3 max-sm:col-span-4 max-sm:row-start-2 max-sm:p-0 max-sm:break-words">
                    {transaction.description}
                  </td>
                  <td className="py-2 pr-3 max-sm:col-start-1 max-sm:row-start-3 max-sm:p-0">
                    <select
                      aria-label={`Category for ${transaction.description}`}
                      value={transaction.categoryId ?? ''}
                      disabled={savingIds.has(transaction.id) || (isDeleting && confirmingDeleteId === transaction.id)}
                      onChange={(event) => changeCategory(transaction, Number(event.target.value))}
                      className={`${categorySelectClass} ${
                        transaction.categoryId === null ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {transaction.categoryId === null && (
                        <option value="" disabled>
                          Uncategorized
                        </option>
                      )}
                      {categories.map((category) => (
                        <option key={category.id} value={category.id} className="text-slate-900 dark:text-slate-100">
                          {category.name}
                        </option>
                      ))}
                    </select>
                    {transaction.locked && (
                      <span
                        role="img"
                        aria-label="Locked"
                        title="Locked: rules won't change this Category"
                        className="ml-1.5 inline-block align-middle text-slate-400 dark:text-slate-500"
                      >
                        <svg viewBox="0 0 16 16" fill="currentColor" fillRule="evenodd" aria-hidden="true" className="h-3.5 w-3.5">
                          <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7H4a1.5 1.5 0 0 0-1.5 1.5v5A1.5 1.5 0 0 0 4 15h8a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 12 7h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 6V4.5a2 2 0 1 0-4 0V7h4Z" />
                        </svg>
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap tabular-nums max-sm:col-span-3 max-sm:col-start-2 max-sm:row-start-1 max-sm:p-0">
                    {formatAmount(transaction.amount)}
                  </td>
                  <td className="relative py-2 pl-4 text-right max-sm:col-start-2 max-sm:row-start-3 max-sm:p-0">
                    <button
                      ref={popup?.transactionId === transaction.id ? popupStarRef : undefined}
                      type="button"
                      aria-pressed={transaction.bookmarked}
                      aria-label={
                        transaction.bookmarked
                          ? `Remove bookmark for ${transaction.description}`
                          : `Bookmark ${transaction.description}`
                      }
                      disabled={bookmarkSavingIds.has(transaction.id)}
                      onClick={() => toggleBookmark(transaction)}
                      className="group rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:cursor-not-allowed"
                    >
                      {/* An empty star turns amber on hover, showing what a click does. */}
                      <svg
                        viewBox="0 0 16 16"
                        fill={transaction.bookmarked ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        strokeWidth="1.25"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className={`h-4 w-4 ${
                          transaction.bookmarked
                            ? 'text-amber-500'
                            : 'text-slate-500 dark:text-slate-400 group-hover:text-amber-500'
                        }`}
                      >
                        <path d="M8 1.75 9.93 5.66l4.32.63-3.13 3.04.74 4.3L8 11.6l-3.86 2.03.74-4.3L1.75 6.29l4.32-.63L8 1.75Z" />
                      </svg>
                    </button>
                    {popup?.transactionId === transaction.id && (
                      <BookmarkAddedPopup
                        folders={folders}
                        addedFolderId={popup.addedFolderId}
                        onDone={closePopup}
                        onRemove={() => removeFromPopup(transaction)}
                        onFile={(folderId) => fileFromPopup(transaction, folderId)}
                        createFolder={addToFolders}
                      />
                    )}
                  </td>
                  <td className="py-2 pl-1 text-right max-sm:col-start-3 max-sm:row-start-3 max-sm:p-0">
                    <button
                      type="button"
                      aria-label={`${transaction.note ? 'Edit' : 'Add'} note for ${transaction.description}`}
                      title={transaction.note ?? undefined}
                      aria-expanded={editingNoteId === transaction.id}
                      // Disabled while its Note saves, so closing can't hide the save or its error.
                      disabled={isSavingNote && editingNoteId === transaction.id}
                      onClick={() => toggleNoteEditor(transaction)}
                      className={`group rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:cursor-not-allowed ${
                        editingNoteId === transaction.id ? 'bg-slate-100 dark:bg-slate-800' : ''
                      }`}
                    >
                      {/* Filled when the Note editor has something to show: a Note or a kept Receipt. */}
                      {transaction.note || transaction.hasReceipt ? (
                        <svg viewBox="0 0 16 16" fill="currentColor" fillRule="evenodd" aria-hidden="true" className="h-4 w-4 text-slate-600 dark:text-slate-300">
                          <path d="M1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25v-8.5C0 2.784.784 2 1.75 2Zm2.5 3.5a.75.75 0 0 0 0 1.5h7a.75.75 0 0 0 0-1.5h-7Zm0 3a.75.75 0 0 0 0 1.5h4a.75.75 0 0 0 0-1.5h-4Z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="h-4 w-4 text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200">
                          <path d="M0 3.75C0 2.784.784 2 1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25Zm1.75-.25a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25ZM3.5 6.25a.75.75 0 0 1 .75-.75h7a.75.75 0 0 1 0 1.5h-7a.75.75 0 0 1-.75-.75Zm.75 2.25h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1 0-1.5Z" />
                        </svg>
                      )}
                    </button>
                  </td>
                  <td className="py-2 pl-1 text-right max-sm:col-start-4 max-sm:row-start-3 max-sm:p-0">
                    <button
                      type="button"
                      aria-label={`Delete ${transaction.description}`}
                      title={transaction.imported ? "Imported Transactions can't be deleted" : undefined}
                      disabled={transaction.imported || isDeleting}
                      onClick={() => startDelete(transaction)}
                      className="rounded p-1 text-slate-400 dark:text-slate-500 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-700 dark:hover:text-red-300 disabled:cursor-not-allowed disabled:text-slate-300 dark:disabled:text-slate-600 disabled:hover:bg-transparent"
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor" fillRule="evenodd" aria-hidden="true" className="h-4 w-4">
                        <path d="M6.5 1A1.5 1.5 0 0 0 5 2.5V3H2.75a.75.75 0 0 0 0 1.5h.3l.63 9.06A1.5 1.5 0 0 0 5.18 15h5.64a1.5 1.5 0 0 0 1.5-1.44l.63-9.06h.3a.75.75 0 0 0 0-1.5H11v-.5A1.5 1.5 0 0 0 9.5 1h-3Zm3 2v-.5h-3V3h3ZM6.75 6.5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5a.75.75 0 0 1 .75-.75Zm3.25.75a.75.75 0 0 0-1.5 0v4.5a.75.75 0 0 0 1.5 0v-4.5Z" />
                      </svg>
                    </button>
                  </td>
                </tr>
                {editingNoteId === transaction.id && (
                  <tr className="max-sm:block">
                    <td colSpan={7} className="pb-3 max-sm:block max-sm:pt-1">
                      <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 dark:bg-slate-950 px-3 py-2">
                        {/* The Note with the kept Receipt to its left, or above it on a phone. The
                            Receipt is loaded only now, so listing Transactions never loads one. */}
                        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end">
                          {transaction.hasReceipt && (
                            <ZoomableReceipt
                              src={receiptUrl(transaction.id)}
                              className="shrink-0 self-start overflow-hidden rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sm:self-end"
                              imageClassName="h-24 w-auto max-w-full"
                            />
                          )}
                          <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
                            Note
                            <textarea
                              rows={2}
                              maxLength={256}
                              value={noteDraft}
                              onChange={(e) => setNoteDraft(e.target.value)}
                              placeholder="Add a note…"
                              className={`${inputClassName} font-normal`}
                            />
                          </label>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={isSavingNote}
                            onClick={() => saveNote(transaction)}
                            className={smallButtonClass}
                          >
                            {isSavingNote ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            type="button"
                            disabled={isSavingNote}
                            onClick={() => setEditingNoteId(null)}
                            className={smallButtonClass}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                {confirmingDeleteId === transaction.id && (
                  <tr className="max-sm:block">
                    <td colSpan={7} className="pb-3 max-sm:block max-sm:pt-1">
                      <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg bg-red-50 dark:bg-red-950/40 px-3 py-2">
                        <span className="mr-auto text-red-800 dark:text-red-300">
                          Delete "{transaction.description}" ({formatAmount(transaction.amount)} on{' '}
                          {formatNorwegianDate(transaction.date)})? This can't be undone.
                        </span>
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => confirmDelete(transaction)}
                          className={smallButtonClass}
                        >
                          Confirm delete
                        </button>
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => setConfirmingDeleteId(null)}
                          className={smallButtonClass}
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
