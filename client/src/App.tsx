import { useRef, useState } from 'react'
import { AddTransactionModal } from './components/AddTransactionModal'
import { CategoriesPage } from './components/CategoriesPage'
import { Dashboard } from './components/Dashboard'
import { ErrorMessage, StatusMessage } from './components/Messages'
import { ReceiptScanModal, type Receipt } from './components/ReceiptScanModal'
import { RulesPage } from './components/RulesPage'
import { TransactionsPage, type TransactionsTarget } from './components/TransactionsPage'
import { readReceipt, uploadBankStatement, type ImportedBankStatement } from './lib/api'
import { formatNorwegianDate } from './lib/date'
import { checkReceiptPick, RECEIPT_IMAGE_TYPES } from './lib/receiptPick'

type View = 'home' | 'transactions' | 'categories' | 'rules'

// A picked PDF the server rejected, named by its filename since it may not be a readable Bank
// Statement, with the reason the server gave; or a picked file left out of a Receipt scan, with why.
type Rejection = { filename: string; message: string }

const NAV_ITEMS: { view: View; label: string }[] = [
  { view: 'transactions', label: 'Transactions' },
  { view: 'categories', label: 'Categories' },
  { view: 'rules', label: 'Rules' },
]

function App() {
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
  // Where the Transactions page opens when reached from the Dashboard; undefined from the header.
  const [transactionsTarget, setTransactionsTarget] = useState<TransactionsTarget | undefined>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const receiptInputRef = useRef<HTMLInputElement>(null)

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
  // rest. Every Receipt is sent to be read at once, before the window opens on the first. Done here
  // rather than when the window mounts, so each is read once.
  function handleReceiptsChosen(files: File[]) {
    if (files.length === 0) return
    clearHomeMessages()

    const pick = checkReceiptPick(files)
    if (!pick.ok) {
      setReceiptPickError(pick.message)
      return
    }
    setRejections(pick.leftOut)
    if (pick.receipts.length === 0) return

    const id = crypto.randomUUID()
    setScan({
      id,
      receipts: pick.receipts.map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
        suggestion: readReceipt(file),
      })),
    })
    setScanSaved({ scanId: id, count: 0 })
  }

  // Reloads the Dashboard after each Transaction saved from a Receipt, as after Add transaction.
  function handleReceiptSaved(scanId: string) {
    setScanSaved((saved) => (saved?.scanId === scanId ? { scanId, count: saved.count + 1 } : saved))
    setDashboardVersion((version) => version + 1)
  }

  // Closes the window and says how many Transactions the scan saved, keeping the names of any files
  // left out of the pick on screen.
  function handleScanFinished() {
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
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          <button type="button" onClick={() => chooseView('home')}>
            PersonligFinans
          </button>
        </h1>
        <nav className="flex gap-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.view}
              type="button"
              onClick={() => chooseView(item.view)}
              aria-current={view === item.view ? 'page' : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                view === item.view ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      {view === 'transactions' ? (
        <main className="flex flex-col items-center px-6 py-10">
          <TransactionsPage target={transactionsTarget} />
        </main>
      ) : view === 'categories' ? (
        <main className="flex flex-col items-center px-6 py-10">
          <CategoriesPage />
        </main>
      ) : view === 'rules' ? (
        <main className="flex flex-col items-center px-6 py-10">
          <RulesPage />
        </main>
      ) : null}

      {/* Hidden rather than unmounted while away, so the Dashboard keeps its choices. */}
      <main hidden={view !== 'home'} className="flex flex-col items-center gap-4 px-6 py-10">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            aria-busy={isUploading}
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isUploading && (
              <span
                aria-hidden="true"
                className="size-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900"
              />
            )}
            {uploadProgress
              ? `Categorizing… (${uploadProgress.finished}/${uploadProgress.picked})`
              : 'Upload transactions'}
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
            onClick={() => setIsModalOpen(true)}
            className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-100"
          >
            Add transaction
          </button>
          <button
            type="button"
            onClick={() => receiptInputRef.current?.click()}
            className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-100"
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
              handleReceiptsChosen([...(event.target.files ?? [])])
              event.target.value = ''
            }}
          />
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
          onFinished={handleScanFinished}
        />
      )}
    </div>
  )
}

function scanSummary(saved: number) {
  if (saved === 0) return 'No transactions saved'
  return `${saved} transaction${saved === 1 ? '' : 's'} saved`
}

// One imported Bank Statement is described by its period; several by their sums.
function importSummary(statements: ImportedBankStatement[]) {
  if (statements.length > 1) {
    const transactions = statements.reduce((sum, statement) => sum + statement.transactionCount, 0)
    const uncategorized = statements.reduce((sum, statement) => sum + statement.uncategorizedCount, 0)
    const aiUnavailable = statements.filter((statement) => statement.aiCategorizationUnavailable).length
    return (
      `Imported ${statements.length} Bank Statements, ${transactions} transactions: ` +
      `${transactions - uncategorized} categorized, ${uncategorized} Uncategorized` +
      (aiUnavailable > 0
        ? `. AI categorization unavailable for ${aiUnavailable} Bank Statement${aiUnavailable === 1 ? '' : 's'}`
        : '')
    )
  }

  const { transactionCount, uncategorizedCount, aiCategorizationUnavailable, periodStart, periodEnd } = statements[0]
  return (
    `Imported ${transactionCount} transactions from statement ` +
    `${formatNorwegianDate(periodStart)}–${formatNorwegianDate(periodEnd)}: ` +
    `${transactionCount - uncategorizedCount} categorized, ${uncategorizedCount} Uncategorized` +
    (aiCategorizationUnavailable
      ? `. AI categorization unavailable — ${uncategorizedCount} rows left Uncategorized`
      : '')
  )
}

export default App
