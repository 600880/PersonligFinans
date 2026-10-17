import { useEffect, useId, useRef, useState } from 'react'
import type { ReceiptSuggestion } from '../lib/api'
import { emptyTransactionForm, suggestedTransactionForm } from '../lib/transactionForm'
import { TransactionForm } from './TransactionForm'

// One Receipt of a Receipt scan: its image, a browser-local URL showing it, and the server's
// reading of it. The URL and the reading are made as soon as the Receipt is picked, so that every
// Receipt is read at once. The URL is released once the Receipt is saved or skipped.
export interface Receipt {
  file: File
  previewUrl: string
  suggestion: Promise<ReceiptSuggestion>
}

interface ReceiptScanModalProps {
  receipts: Receipt[]
  // Called for each Transaction the server records, including one whose Save finishes after its
  // Receipt was skipped or the window closed.
  onSaved: () => void
  // Called once the last Receipt has been saved or skipped.
  onFinished: () => void
}

// Works through the Receipts one at a time, each saved as a manually-entered Transaction or
// skipped. There is no going back.
export function ReceiptScanModal({ receipts, onSaved, onFinished }: ReceiptScanModalProps) {
  const headingId = useId()
  const [position, setPosition] = useState(0)

  function moveOn() {
    if (position + 1 === receipts.length) onFinished()
    else setPosition(position + 1)
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-4xl gap-6 rounded-xl bg-white p-6 shadow-xl"
      >
        <ReceiptStep
          // A new step for each Receipt, so its form starts over.
          key={position}
          receipt={receipts[position]}
          heading={`Receipt ${position + 1} of ${receipts.length}`}
          headingId={headingId}
          onSaved={onSaved}
          onDone={moveOn}
        />
      </div>
    </div>
  )
}

interface ReceiptStepProps {
  receipt: Receipt
  heading: string
  headingId: string
  onSaved: () => void
  onDone: () => void
}

// One Receipt's form beside its image. Until the Receipt has been read the form is disabled, and
// then it starts over from what was read. onDone is called once, on the first Save or Skip, which
// also releases the preview: a Save that finishes after Skip is still reported to onSaved, but
// doesn't move the scan on again.
function ReceiptStep({ receipt, heading, headingId, onSaved, onDone }: ReceiptStepProps) {
  const isDone = useRef(false)
  // null while the Receipt is still being read.
  const [suggestion, setSuggestion] = useState<ReceiptSuggestion | null>(null)

  useEffect(() => {
    let ignore = false
    // Never rejects: a Receipt that couldn't be read comes back unreadable.
    void receipt.suggestion.then((read) => {
      if (!ignore) setSuggestion(read)
    })
    return () => {
      ignore = true
    }
  }, [receipt.suggestion])

  function done() {
    if (isDone.current) return
    isDone.current = true
    URL.revokeObjectURL(receipt.previewUrl)
    onDone()
  }

  return (
    <>
      <div className="w-full max-w-md shrink-0 overflow-y-auto">
        <h2 id={headingId} className="text-lg font-semibold text-slate-900">
          {heading}
        </h2>

        {suggestion === null && <p className="mt-3 text-sm text-slate-500">Reading…</p>}
        {suggestion?.outcome === 'unreadable' && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Couldn't read this receipt
          </p>
        )}

        <TransactionForm
          // Started over from what was read, once the Receipt has been read.
          key={suggestion === null ? 'reading' : 'read'}
          initialValues={suggestion === null ? emptyTransactionForm() : suggestedTransactionForm(suggestion)}
          disabled={suggestion === null}
          secondaryAction={{ label: 'Skip', onClick: done }}
          onSaved={() => {
            onSaved()
            done()
          }}
        />
      </div>

      {/* A tall Receipt scrolls here, keeping the form in view. */}
      <div className="min-w-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-slate-50">
        <img src={receipt.previewUrl} alt="Receipt" className="w-full" />
      </div>
    </>
  )
}
