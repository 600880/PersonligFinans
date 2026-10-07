import { useEffect, useRef, useState } from 'react'
import { AddTransactionModal } from './components/AddTransactionModal'
import { uploadBankStatement } from './lib/api'
import { formatNorwegianDate } from './lib/date'

const CONFIRMATION_MS = 3000

function App() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [showSavedMessage, setShowSavedMessage] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!showSavedMessage) return
    const timeout = setTimeout(() => setShowSavedMessage(false), CONFIRMATION_MS)
    return () => clearTimeout(timeout)
  }, [showSavedMessage])

  function handleSaved() {
    setIsModalOpen(false)
    setImportMessage(null)
    setShowSavedMessage(true)
  }

  async function handleFileChosen(file: File | undefined) {
    if (!file) return
    setIsUploading(true)
    setShowSavedMessage(false)
    setImportMessage(null)

    const result = await uploadBankStatement(file).finally(() => setIsUploading(false))
    if (result.ok) {
      const { transactionCount, periodStart, periodEnd } = result.statement
      setImportMessage(
        `Imported ${transactionCount} transactions from statement ` +
          `${formatNorwegianDate(periodStart)}–${formatNorwegianDate(periodEnd)}`,
      )
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          PersonligFinans
        </h1>
      </header>

      <main className="flex flex-col items-center gap-4 px-6 py-10">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isUploading ? 'Uploading…' : 'Upload transactions'}
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

        <p role="status" className="h-5 text-sm text-emerald-700">
          {showSavedMessage ? 'Transaction saved' : importMessage}
        </p>
      </main>

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
