import { useId } from 'react'
import { emptyTransactionForm } from '../lib/transactionForm'
import { TransactionForm } from './TransactionForm'

interface AddTransactionModalProps {
  onCancel: () => void
  onSaved: () => void
}

export function AddTransactionModal({ onCancel, onSaved }: AddTransactionModalProps) {
  const headingId = useId()

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
      >
        <h2 id={headingId} className="text-lg font-semibold text-slate-900">
          Add transaction
        </h2>

        <TransactionForm
          initialValues={emptyTransactionForm()}
          secondaryAction={{ label: 'Cancel', onClick: onCancel }}
          onSaved={onSaved}
        />
      </div>
    </div>
  )
}
