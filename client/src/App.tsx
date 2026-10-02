import { useEffect, useState } from 'react'
import { AddTransactionModal } from './components/AddTransactionModal'

const CONFIRMATION_MS = 3000

function App() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [showSavedMessage, setShowSavedMessage] = useState(false)

  useEffect(() => {
    if (!showSavedMessage) return
    const timeout = setTimeout(() => setShowSavedMessage(false), CONFIRMATION_MS)
    return () => clearTimeout(timeout)
  }, [showSavedMessage])

  function handleSaved() {
    setIsModalOpen(false)
    setShowSavedMessage(true)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          PersonligFinans
        </h1>
      </header>

      <main className="flex flex-col items-center gap-4 px-6 py-10">
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-slate-700"
        >
          Add transaction
        </button>

        <p role="status" className="h-5 text-sm text-emerald-700">
          {showSavedMessage && 'Transaction saved'}
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
