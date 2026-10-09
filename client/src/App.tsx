import { useEffect, useRef, useState } from 'react'
import { AddTransactionModal } from './components/AddTransactionModal'
import { RulesPage } from './components/RulesPage'
import { uploadBankStatement } from './lib/api'
import { formatNorwegianDate } from './lib/date'

const CONFIRMATION_MS = 3000

function App() {
  const [view, setView] = useState<'home' | 'rules'>('home')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [showSavedMessage, setShowSavedMessage] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!showSavedMessage) return
    const timeout = setTimeout(() => setShowSavedMessage(false), CONFIRMATION_MS)
    return () => clearTimeout(timeout)
  }, [showSavedMessage])

  function handleSaved() {
    setIsModalOpen(false)
    setImportMessage(null)
    setUploadError(null)
    setShowSavedMessage(true)
  }

  async function handleFileChosen(file: File | undefined) {
    if (!file) return
    setIsUploading(true)
    setShowSavedMessage(false)
    setImportMessage(null)
    setUploadError(null)

    const result = await uploadBankStatement(file).finally(() => setIsUploading(false))
    if (result.ok) {
      const { transactionCount, uncategorizedCount, aiCategorizationUnavailable, periodStart, periodEnd } =
        result.statement
      setImportMessage(
        `Imported ${transactionCount} transactions from statement ` +
          `${formatNorwegianDate(periodStart)}–${formatNorwegianDate(periodEnd)}: ` +
          `${transactionCount - uncategorizedCount} categorized, ${uncategorizedCount} Uncategorized` +
          (aiCategorizationUnavailable
            ? `. AI categorization unavailable — ${uncategorizedCount} rows left Uncategorized`
            : ''),
      )
    } else {
      setUploadError(result.message)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          PersonligFinans
        </h1>
        <button
          type="button"
          onClick={() => setView(view === 'home' ? 'rules' : 'home')}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          {view === 'home' ? 'Rules' : 'Back'}
        </button>
      </header>

      {view === 'rules' ? (
        <main className="flex flex-col items-center px-6 py-10">
          <RulesPage />
        </main>
      ) : (
        <main className="flex flex-col items-center gap-4 px-6 py-10">
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
              {isUploading ? 'Categorizing…' : 'Upload transactions'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              aria-label="Bank Statement PDF"
              hidden
              onChange={(event) => {
                void handleFileChosen(event.target.files?.[0])
                event.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-slate-700"
            >
              Add transaction
            </button>
          </div>

          {uploadError ? (
            <p role="alert" className="min-h-5 text-sm text-red-700">
              {uploadError}
            </p>
          ) : (
            <p role="status" className="h-5 text-sm text-emerald-700">
              {showSavedMessage ? 'Transaction saved' : importMessage}
            </p>
          )}
        </main>
      )}

      {isModalOpen && (
        <AddTransactionModal
          onCancel={() => setIsModalOpen(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}

export default App
