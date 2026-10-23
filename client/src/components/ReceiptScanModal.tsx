import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { ReceiptSuggestion } from '../lib/api'
import { emptyTransactionForm, suggestedTransactionForm } from '../lib/transactionForm'
import { TransactionForm } from './TransactionForm'

const smallButtonClass =
  'rounded-lg px-2 py-1 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-300 dark:disabled:text-slate-600'

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
  // Called once the window closes: after the last Receipt has been saved or skipped, or once the
  // remaining Receipts have been discarded.
  onClosed: () => void
}

// Works through the Receipts one at a time, each saved as a manually-entered Transaction or
// skipped. There is no going back. Closing partway, once confirmed, discards the remaining
// Receipts and keeps the Transactions already saved.
export function ReceiptScanModal({ receipts, onSaved, onClosed }: ReceiptScanModalProps) {
  const headingId = useId()
  const confirmationId = useId()
  const [position, setPosition] = useState(0)
  // Whether closing is waiting for the discard of the remaining Receipts to be confirmed. The step
  // stays mounted meanwhile, so Keep going finds its form as it was left.
  const [isConfirmingClose, setIsConfirmingClose] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  // Set once the remaining Receipts are discarded, so that a Save finishing afterwards never moves
  // on, which would close the window again, possibly on a later scan.
  const isDiscarded = useRef(false)
  // The current Receipt and every one after it.
  const remaining = receipts.length - position

  function moveOn() {
    if (isDiscarded.current) return
    if (position + 1 === receipts.length) onClosed()
    else setPosition(position + 1)
  }

  // Releases the previews here rather than when the window unmounts, since StrictMode unmounts it
  // once on mounting, while the previews are still on screen.
  function discard() {
    isDiscarded.current = true
    for (const receipt of receipts.slice(position)) URL.revokeObjectURL(receipt.previewUrl)
    onClosed()
  }

  function keepGoing() {
    setIsConfirmingClose(false)
    closeButtonRef.current?.focus()
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-900/40 dark:bg-slate-950/70 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col rounded-xl bg-white dark:bg-slate-900 shadow-xl"
      >
        <div className="flex justify-end px-3 pt-3">
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close"
            onClick={() => setIsConfirmingClose(true)}
            className="rounded p-1 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-300"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="h-5 w-5">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>

        {isConfirmingClose && (
          <div
            role="alertdialog"
            aria-labelledby={confirmationId}
            className="mx-6 flex flex-wrap items-center justify-end gap-2 rounded-lg bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm"
          >
            <span id={confirmationId} className="mr-auto text-red-800 dark:text-red-300">
              Discard the remaining {remaining} receipt{remaining === 1 ? '' : 's'}?
            </span>
            <button type="button" onClick={discard} className={smallButtonClass}>
              Discard
            </button>
            <button type="button" autoFocus onClick={keepGoing} className={smallButtonClass}>
              Keep going
            </button>
          </div>
        )}

        {/* The form with the Receipt to its right, or below the breakpoint the Receipt above it, the
            two scrolling together. Out of reach while closing waits for its confirmation. */}
        <div
          inert={isConfirmingClose}
          className="flex min-h-0 flex-col gap-6 overflow-y-auto px-6 pt-2 pb-6 md:flex-row"
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
        <h2 id={headingId} className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {heading}
        </h2>

        {suggestion === null && <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Reading…</p>}
        {suggestion?.outcome === 'unreadable' && (
          <p className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
            Couldn't read this receipt
          </p>
        )}
        {suggestion?.outcome === 'limitReached' && (
          <p className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
            Daily AI limit reached until midnight Norwegian time — enter this receipt by hand
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

      <ReceiptPreview previewUrl={receipt.previewUrl} />
    </>
  )
}

// The Receipt beside its form, or above it on a narrow screen, scrolling within its panel when tall
// so the form stays in view. A click shows it full-screen, where a click or Escape closes it again.
// The full-screen view keeps the keyboard to itself, so its Escape never reaches the window.
function ReceiptPreview({ previewUrl }: { previewUrl: string }) {
  const [isFullScreen, setIsFullScreen] = useState(false)
  const showButtonRef = useRef<HTMLButtonElement>(null)

  function closeFullScreen() {
    setIsFullScreen(false)
    showButtonRef.current?.focus()
  }

  function handleFullScreenKeyDown(event: KeyboardEvent) {
    // The view covers the whole screen and is its only control, so Tab stays on it.
    if (event.key === 'Tab') event.preventDefault()
    if (event.key === 'Escape') {
      event.stopPropagation()
      closeFullScreen()
    }
  }

  return (
    <>
      {/* Placed first rather than reversing the row, which would start a narrow window scrolled to
          the bottom of the form. */}
      <div className="order-first max-h-72 shrink-0 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 md:order-none md:max-h-none md:min-w-0 md:flex-1">
        <button
          ref={showButtonRef}
          type="button"
          aria-label="Show the Receipt full-screen"
          onClick={() => setIsFullScreen(true)}
          className="block w-full cursor-zoom-in"
        >
          <img src={previewUrl} alt="Receipt" className="w-full" />
        </button>
      </div>

      {isFullScreen && (
        <button
          type="button"
          aria-label="Close the full-screen Receipt"
          autoFocus
          onClick={closeFullScreen}
          onKeyDown={handleFullScreenKeyDown}
          className="fixed inset-0 z-10 flex cursor-zoom-out items-center justify-center bg-slate-900/90 p-4"
        >
          <img src={previewUrl} alt="Receipt" className="max-h-full max-w-full object-contain" />
        </button>
      )}
    </>
  )
}
