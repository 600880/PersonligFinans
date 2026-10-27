import { useCallback, useEffect, useRef, useState } from 'react'
import { AddTransactionModal } from './components/AddTransactionModal'
import { CategoriesPage } from './components/CategoriesPage'
import { ChooseNewPasswordPage } from './components/ChooseNewPasswordPage'
import { Dashboard } from './components/Dashboard'
import { LandingPage } from './components/LandingPage'
import { ErrorMessage, StatusMessage } from './components/Messages'
import { ReceiptScanModal, type Receipt } from './components/ReceiptScanModal'
import { RulesPage } from './components/RulesPage'
import { TransactionsPage, type TransactionsTarget } from './components/TransactionsPage'
import { UserPage } from './components/UserPage'
import {
  fetchCurrentUser,
  readReceipt,
  setSignedOutHandler,
  uploadBankStatement,
  type ImportedBankStatement,
  type User,
} from './lib/api'
import { followAppearance } from './lib/appearance'
import { counted } from './lib/count'
import { formatNorwegianDate } from './lib/date'
import { resetLinkAt } from './lib/passwordReset'
import { checkReceiptPick, NOT_A_RECEIPT_IMAGE, RECEIPT_IMAGE_TYPES } from './lib/receiptPick'
import { reduceReceipt } from './lib/reduceReceipt'
import { useDismiss } from './lib/useDismiss'

type View = 'home' | 'transactions' | 'categories' | 'rules' | 'user'

// A picked PDF the server rejected, named by its filename since it may not be a readable Bank
// Statement, with the reason the server gave; or a picked file left out of a Receipt scan, with why.
type Rejection = { filename: string; message: string }

const NAV_ITEMS: { view: View; label: string }[] = [
  { view: 'transactions', label: 'Transactions' },
  { view: 'categories', label: 'Categories' },
  { view: 'rules', label: 'Rules' },
  { view: 'user', label: 'User' },
]

// The look of each way to add Transactions: a button of its own on a wide screen, an item in the
// Add transactions menu on a narrow one.
const ADD_ACTION_CLASS =
  'rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-5 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 shadow-sm hover:bg-slate-100 dark:hover:bg-slate-800 max-sm:w-full max-sm:border-0 max-sm:text-left max-sm:shadow-none'

// Opened at the link in a reset email, shows the page to choose a new password, whoever is signed in,
// so it never asks who is. Otherwise, or once the page is done, the landing page or the app. The
// app has no router: the reset email's link is the only address besides its own. Leaving the page
// puts / in the address bar, so reloading doesn't open it again.
function App() {
  const [resetLink, setResetLink] = useState(() => resetLinkAt(window.location))
  // The User the new password signed in as, so the app shows without asking who is signed in.
  const [signedInByReset, setSignedInByReset] = useState<User | undefined>()

  // On every page, signed in or not, and System switching with the device while open.
  useEffect(() => followAppearance(), [])

  function leaveResetPage() {
    window.history.replaceState(null, '', '/')
    setResetLink(null)
  }

  if (resetLink) {
    return (
      <ChooseNewPasswordPage
        link={resetLink}
        onSignedIn={(user) => {
          setSignedInByReset(user)
          leaveResetPage()
        }}
        onLeave={leaveResetPage}
      />
    )
  }
  return <LandingPageOrApp signedIn={signedInByReset} />
}

interface LandingPageOrAppProps {
  // Who is already known to be signed in; undefined to ask.
  signedIn?: User
}

// Asks who is signed in, unless told, and shows the landing page to nobody and the app to a User.
// Being signed out, by Sign out or by any call answering 401, unmounts the app, so the next User
// starts from nothing the previous one saw.
function LandingPageOrApp({ signedIn }: LandingPageOrAppProps) {
  // undefined while asking, null when nobody is signed in.
  const [user, setUser] = useState<User | null | undefined>(signedIn)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    if (signedIn) return
    let ignore = false
    fetchCurrentUser().then(
      (current) => {
        if (!ignore) setUser(current)
      },
      () => {
        if (!ignore) setLoadFailed(true)
      },
    )
    return () => {
      ignore = true
    }
  }, [signedIn])

  useEffect(() => {
    setSignedOutHandler(() => setUser(null))
    return () => setSignedOutHandler(null)
  }, [])

  if (loadFailed) {
    return (
      <div className="flex min-h-screen justify-center bg-slate-50 dark:bg-slate-950 px-6 py-10 max-sm:px-4">
        <ErrorMessage className="h-fit">Could not reach the server. Reload the page to try again.</ErrorMessage>
      </div>
    )
  }
  // A blank page while asking, so a signed-in User never sees the landing page flash by.
  if (user === undefined) return <div className="min-h-screen bg-slate-50 dark:bg-slate-950" />
  if (user === null) return <LandingPage onSignedIn={setUser} />
  return <SignedInApp user={user} onSignedOut={() => setUser(null)} />
}

interface SignedInAppProps {
  user: User
  onSignedOut: () => void
}

function SignedInApp({ user, onSignedOut }: SignedInAppProps) {
  const [view, setView] = useState<View>('home')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [showSavedMessage, setShowSavedMessage] = useState(false)
  // How many of the picked Bank Statements have finished, out of how many; null when not uploading.
  const [uploadProgress, setUploadProgress] = useState<{ finished: number; picked: number } | null>(null)
  const isUploading = uploadProgress !== null
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [rejections, setRejections] = useState<Rejection[]>([])
  // The Receipt scan under way; null when not scanning.
  const [scan, setScan] = useState<{ id: string; receipts: Receipt[] } | null>(null)
  // How many Transactions the latest Receipt scan has saved, said once it has finished. A Save
  // that finishes late, after its Receipt was skipped, still counts towards its own scan.
  const [scanSaved, setScanSaved] = useState<{ scanId: string; count: number } | null>(null)
  const [showScanMessage, setShowScanMessage] = useState(false)
  // Why a whole pick of Receipts was rejected.
  const [receiptPickError, setReceiptPickError] = useState<string | null>(null)
  // Bumped after new Transactions are saved, and on coming back to home, so the Dashboard reloads in
  // place.
  const [dashboardVersion, setDashboardVersion] = useState(0)
  // Where the Transactions page opens when reached from the Dashboard or the Categories page;
  // undefined from the header.
  const [transactionsTarget, setTransactionsTarget] = useState<TransactionsTarget | undefined>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const receiptInputRef = useRef<HTMLInputElement>(null)
  // The id of the Receipt scan of the latest pick of Receipts, so that an earlier pick still being
  // reduced never starts its scan.
  const latestScanIdRef = useRef<string | null>(null)
  // On a narrow screen the pages, and the ways to add Transactions, each sit behind a menu.
  const [isNavOpen, setIsNavOpen] = useState(false)
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false)
  const headerRef = useRef<HTMLElement>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)
  // Set once the User has signed out and the app is gone, so an Upload under way sends none of its
  // remaining Bank Statements, and a pick of Receipts still being reduced sends none of them, which
  // would otherwise go to whoever signs in next.
  const hasSignedOutRef = useRef(false)
  useEffect(() => {
    hasSignedOutRef.current = false
    return () => {
      hasSignedOutRef.current = true
    }
  }, [])
  const closeNav = useCallback(() => setIsNavOpen(false), [])
  const closeAddMenu = useCallback(() => setIsAddMenuOpen(false), [])
  useDismiss(headerRef, isNavOpen, closeNav)
  useDismiss(addMenuRef, isAddMenuOpen, closeAddMenu)

  function clearHomeMessages() {
    setShowSavedMessage(false)
    setShowScanMessage(false)
    setImportMessage(null)
    setRejections([])
    setReceiptPickError(null)
  }

  // Leaving home clears its messages. An upload that finishes while away sets them again, so they
  // are seen on return. The home view stays mounted while away, so the Dashboard is kept as it was
  // left, and coming back reloads it, so changes made on the other pages show up.
  function chooseView(next: View) {
    if (view === 'home' && next !== 'home') clearHomeMessages()
    if (view !== 'home' && next === 'home') setDashboardVersion((version) => version + 1)
    setTransactionsTarget(undefined)
    setIsNavOpen(false)
    setView(next)
  }

  function openTransactions(target: TransactionsTarget) {
    chooseView('transactions')
    setTransactionsTarget(target)
  }

  function handleSaved() {
    setIsModalOpen(false)
    clearHomeMessages()
    setShowSavedMessage(true)
    setDashboardVersion((version) => version + 1)
  }

  // After any delete on the User page, the Dashboard kept while away reloads, so it never shows
  // deleted Transactions, even if it is reached some other way than coming back to home. The
  // Transactions page needs nothing: it isn't kept while away, so it loads afresh whenever it opens.
  function handleDataDeleted() {
    setDashboardVersion((version) => version + 1)
  }

  // Imports the picked Bank Statements one after another, in pick order, so AI-generated rules
  // created for one already categorize matching rows in the next. Each Bank Statement is imported
  // or rejected on its own, so a rejection doesn't stop the rest. Together they are one Upload, whose
  // rules the Rules page marks New.
  async function handleFilesChosen(files: File[]) {
    if (files.length === 0) return
    setUploadProgress({ finished: 0, picked: files.length })
    clearHomeMessages()

    const uploadId = crypto.randomUUID()
    const imported: ImportedBankStatement[] = []
    const rejected: Rejection[] = []
    try {
      for (const [index, file] of files.entries()) {
        if (hasSignedOutRef.current) return
        const result = await uploadBankStatement(file, uploadId)
        if (result.ok) {
          imported.push(result.statement)
          setDashboardVersion((version) => version + 1)
        } else {
          rejected.push({ filename: file.name, message: result.message })
        }
        setUploadProgress({ finished: index + 1, picked: files.length })
      }
      // Replaces a Transaction saved during the upload, so the result is never hidden.
      setShowSavedMessage(false)
      setShowScanMessage(false)
      setImportMessage(imported.length > 0 ? importSummary(imported) : null)
      setRejections(rejected)
    } finally {
      setUploadProgress(null)
    }
  }

  // Starts a Receipt scan of the picked images that can be read, after leaving out and naming the
  // rest. Each is first reduced, and one the browser can't decode is left out too. Every Receipt is
  // then sent to be read at once, before the window opens on the first. Done here rather than when
  // the window mounts, so each is read once.
  async function handleReceiptsChosen(files: File[]) {
    if (files.length === 0) return
    clearHomeMessages()
    // Taken before the checks, so that even a rejected pick replaces one still being reduced.
    const id = crypto.randomUUID()
    latestScanIdRef.current = id

    const pick = checkReceiptPick(files)
    if (!pick.ok) {
      setReceiptPickError(pick.message)
      return
    }

    // One after another, so that only one full-size photo is decoded at a time, which a phone's
    // memory may need.
    const images: Blob[] = []
    const leftOut = [...pick.leftOut]
    for (const file of pick.receipts) {
      const reduced = await reduceReceipt(file)
      if (reduced.ok) images.push(reduced.jpeg)
      else leftOut.push({ filename: file.name, message: NOT_A_RECEIPT_IMAGE })
    }
    // Nothing is sent once the User has signed out, or for a pick replaced while it was reduced.
    if (hasSignedOutRef.current || latestScanIdRef.current !== id) return

    setRejections(leftOut)
    if (images.length === 0) return

    setScan({
      id,
      receipts: images.map((image) => ({
        image,
        previewUrl: URL.createObjectURL(image),
        suggestion: readReceipt(image),
      })),
    })
    setScanSaved({ scanId: id, count: 0 })
  }

  // Reloads the Dashboard after each Transaction saved from a Receipt, as after Add transaction.
  function handleReceiptSaved(scanId: string) {
    setScanSaved((saved) => (saved?.scanId === scanId ? { scanId, count: saved.count + 1 } : saved))
    setDashboardVersion((version) => version + 1)
  }

  // Closes the window, after the last Receipt or once the rest are discarded, and says how many
  // Transactions the scan saved, keeping the names of any files left out of the pick on screen. The
  // Dashboard has already reloaded after each of them.
  function handleScanClosed() {
    setScan(null)
    setShowSavedMessage(false)
    setImportMessage(null)
    setShowScanMessage(true)
  }

  const savedMessage = showSavedMessage
    ? 'Transaction saved'
    : showScanMessage && scanSaved
      ? scanSummary(scanSaved.count)
      : null
  const hasErrors = receiptPickError !== null || rejections.length > 0

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header
        ref={headerRef}
        className="relative flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-4 max-sm:px-4"
      >
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          <button type="button" onClick={() => chooseView('home')}>
            PersonligFinans
          </button>
        </h1>
        <button
          type="button"
          aria-label="Menu"
          aria-expanded={isNavOpen}
          aria-controls="pages"
          onClick={() => setIsNavOpen((open) => !open)}
          className="rounded-lg p-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 sm:hidden"
        >
          {isNavOpen ? (
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="h-6 w-6">
              <path d="M4.28 3.22a.75.75 0 0 0-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 1 0 1.06 1.06L8 9.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L9.06 8l3.72-3.72a.75.75 0 0 0-1.06-1.06L8 6.94 4.28 3.22Z" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="h-6 w-6">
              <path d="M2 3.75A.75.75 0 0 1 2.75 3h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 3.75ZM2 8a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8Zm0 4.25a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" />
            </svg>
          )}
        </button>
        {/* On a narrow screen, a panel dropped over the page from under the header while open. */}
        <nav
          id="pages"
          className={`flex gap-1 max-sm:absolute max-sm:inset-x-0 max-sm:top-full max-sm:z-10 max-sm:flex-col max-sm:border-b max-sm:border-slate-200 dark:max-sm:border-slate-800 max-sm:bg-white dark:max-sm:bg-slate-900 max-sm:p-2 max-sm:shadow-md ${
            isNavOpen ? '' : 'max-sm:hidden'
          }`}
        >
          {NAV_ITEMS.map((item) => (
            <button
              key={item.view}
              type="button"
              onClick={() => chooseView(item.view)}
              aria-current={view === item.view ? 'page' : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium max-sm:py-3 max-sm:text-left max-sm:text-base ${
                view === item.view ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Under the header on every page, for as long as the Guest is signed in. */}
      {user.isGuest && (
        <p
          role="note"
          aria-label="Guest"
          className="border-b border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-6 py-2 text-center text-sm text-amber-900 dark:text-amber-200 max-sm:px-4"
        >
          Demo mode: only use test data.
        </p>
      )}

      {view === 'transactions' ? (
        <main className="flex flex-col items-center px-6 py-10 max-sm:px-4">
          <TransactionsPage target={transactionsTarget} />
        </main>
      ) : view === 'categories' ? (
        <main className="flex flex-col items-center px-6 py-10 max-sm:px-4">
          <CategoriesPage onOpenTransactions={openTransactions} />
        </main>
      ) : view === 'rules' ? (
        <main className="flex flex-col items-center px-6 py-10 max-sm:px-4">
          <RulesPage />
        </main>
      ) : view === 'user' ? (
        <main className="flex flex-col items-center px-6 py-10 max-sm:px-4">
          <UserPage
            user={user}
            onSignedOut={onSignedOut}
            isUploading={isUploading}
            onDataDeleted={handleDataDeleted}
          />
        </main>
      ) : null}

      {/* Hidden rather than unmounted while away, so the Dashboard keeps its choices. */}
      <main hidden={view !== 'home'} className="flex flex-col items-center gap-4 px-6 py-10 max-sm:px-4">
        <div ref={addMenuRef} className="relative">
          {/* Shows the upload's progress too, since Upload transactions is hidden in the menu. The
              menu still opens meanwhile, for the other ways to add Transactions. */}
          <button
            type="button"
            aria-expanded={isAddMenuOpen}
            aria-controls="add-actions"
            aria-busy={isUploading}
            onClick={() => setIsAddMenuOpen((open) => !open)}
            className="flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-5 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 shadow-sm hover:bg-slate-100 dark:hover:bg-slate-800 sm:hidden"
          >
            {isUploading && <Spinner />}
            {uploadProgress ? uploadProgressLabel(uploadProgress) : 'Add transactions'}
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="h-4 w-4 text-slate-500 dark:text-slate-400">
              <path d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
          {/* On a narrow screen, a menu dropped under the button above while open. */}
          <div
            id="add-actions"
            role="group"
            aria-label="Ways to add transactions"
            className={`flex gap-3 max-sm:absolute max-sm:top-full max-sm:left-1/2 max-sm:z-10 max-sm:mt-1 max-sm:w-max max-sm:min-w-full max-sm:-translate-x-1/2 max-sm:flex-col max-sm:gap-0 max-sm:rounded-lg max-sm:border max-sm:border-slate-200 dark:max-sm:border-slate-800 max-sm:bg-white dark:max-sm:bg-slate-900 max-sm:p-1 max-sm:shadow-md ${
              isAddMenuOpen ? '' : 'max-sm:hidden'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setIsAddMenuOpen(false)
                fileInputRef.current?.click()
              }}
              disabled={isUploading}
              aria-busy={isUploading}
              className={`flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60 ${ADD_ACTION_CLASS}`}
            >
              {isUploading && <Spinner />}
              {uploadProgress ? uploadProgressLabel(uploadProgress) : 'Upload transactions'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              aria-label="Bank Statement PDF"
              multiple
              hidden
              onChange={(event) => {
                void handleFilesChosen([...(event.target.files ?? [])])
                event.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => {
                setIsAddMenuOpen(false)
                setIsModalOpen(true)
              }}
              className={ADD_ACTION_CLASS}
            >
              Add transaction
            </button>
            <button
              type="button"
              onClick={() => {
                setIsAddMenuOpen(false)
                receiptInputRef.current?.click()
              }}
              className={ADD_ACTION_CLASS}
            >
              Scan receipts
            </button>
            <input
              ref={receiptInputRef}
              type="file"
              accept={RECEIPT_IMAGE_TYPES.join(',')}
              aria-label="Receipts"
              multiple
              hidden
              onChange={(event) => {
                void handleReceiptsChosen([...(event.target.files ?? [])])
                event.target.value = ''
              }}
            />
          </div>
        </div>

        {(!hasErrors || importMessage || savedMessage) && (
          <StatusMessage message={savedMessage ?? importMessage} />
        )}
        {hasErrors && (
          <ErrorMessage>
            {receiptPickError && <p>{receiptPickError}</p>}
            {rejections.map((rejection, index) => (
              <p key={index}>
                {rejection.filename}: {rejection.message}
              </p>
            ))}
          </ErrorMessage>
        )}

        <Dashboard version={dashboardVersion} onOpenTransactions={openTransactions} />
      </main>

      {isModalOpen && (
        <AddTransactionModal
          onCancel={() => setIsModalOpen(false)}
          onSaved={handleSaved}
        />
      )}

      {scan && (
        <ReceiptScanModal
          key={scan.id}
          receipts={scan.receipts}
          onSaved={() => handleReceiptSaved(scan.id)}
          onClosed={handleScanClosed}
        />
      )}
    </div>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-4 animate-spin rounded-full border-2 border-slate-300 dark:border-slate-700 border-t-slate-900 dark:border-t-slate-100"
    />
  )
}

function uploadProgressLabel({ finished, picked }: { finished: number; picked: number }) {
  return `Categorizing… (${finished}/${picked})`
}

function scanSummary(saved: number) {
  if (saved === 0) return 'No transactions saved'
  return `${saved} transaction${saved === 1 ? '' : 's'} saved`
}

// The Daily AI limit resets at midnight Norwegian time.
const DAILY_AI_LIMIT_REACHED = 'Daily AI limit reached until midnight Norwegian time'

// One imported Bank Statement is described by its period; several by their sums.
function importSummary(statements: ImportedBankStatement[]) {
  if (statements.length > 1) {
    const transactions = statements.reduce((sum, statement) => sum + statement.transactionCount, 0)
    const uncategorized = statements.reduce((sum, statement) => sum + statement.uncategorizedCount, 0)
    const aiUnavailable = statements.filter((statement) => statement.aiCategorizationUnavailable).length
    const limitReached = statements.filter((statement) => statement.dailyAiLimitReached).length
    return (
      `Imported ${statements.length} Bank Statements, ${transactions} transactions: ` +
      `${transactions - uncategorized} categorized, ${uncategorized} Uncategorized` +
      (aiUnavailable > 0 ? `. AI categorization unavailable for ${counted(aiUnavailable, 'Bank Statement')}` : '') +
      (limitReached > 0 ? `. ${DAILY_AI_LIMIT_REACHED} for ${counted(limitReached, 'Bank Statement')}` : '')
    )
  }

  const { transactionCount, uncategorizedCount, periodStart, periodEnd } = statements[0]
  // Why the unmatched rows got no AI-generated rules, when the LLM was meant to propose some.
  const noAiRulesReason = statements[0].aiCategorizationUnavailable
    ? 'AI categorization unavailable'
    : statements[0].dailyAiLimitReached
      ? DAILY_AI_LIMIT_REACHED
      : null
  return (
    `Imported ${transactionCount} transactions from statement ` +
    `${formatNorwegianDate(periodStart)}–${formatNorwegianDate(periodEnd)}: ` +
    `${transactionCount - uncategorizedCount} categorized, ${uncategorizedCount} Uncategorized` +
    (noAiRulesReason ? `. ${noAiRulesReason} — ${uncategorizedCount} rows left Uncategorized` : '')
  )
}

export default App
