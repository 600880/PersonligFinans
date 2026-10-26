import { emptyTransactionForm } from '../lib/transactionForm'
import { Dialog } from './Dialog'
import { TransactionForm } from './TransactionForm'

interface AddTransactionModalProps {
  onCancel: () => void
  onSaved: () => void
}

export function AddTransactionModal({ onCancel, onSaved }: AddTransactionModalProps) {
  return (
    <Dialog title="Add transaction" onCancel={onCancel}>
      <TransactionForm
        initialValues={emptyTransactionForm()}
        secondaryAction={{ label: 'Cancel', onClick: onCancel }}
        onSaved={onSaved}
      />
    </Dialog>
  )
}
