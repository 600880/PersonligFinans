import { useState } from 'react'
import { AddTransactionModal } from './components/AddTransactionModal'

function App() {
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          PersonligFinans
        </h1>
      </header>

      <main className="flex justify-center px-6 py-10">
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-slate-700"
        >
          Add transaction
        </button>
      </main>

      {isModalOpen && (
        <AddTransactionModal onCancel={() => setIsModalOpen(false)} />
      )}
    </div>
  )
}

export default App
