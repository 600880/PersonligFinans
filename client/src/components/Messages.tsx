import type { ReactNode } from 'react'

// A success card's height, kept free while there is no message so the page below never moves.
const MESSAGE_HEIGHT = 'min-h-9.5'

// Tells that an action worked. Always rendered, empty while there is no message.
export function StatusMessage({ message, className = '' }: { message: string | null; className?: string }) {
  return (
    <div role="status" className={`${MESSAGE_HEIGHT} ${className}`}>
      {message && (
        <p className="flex w-fit items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500">
            <path
              fillRule="evenodd"
              d="M13.53 4.22a.75.75 0 0 1 0 1.06l-6.5 6.5a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06L6.5 10.19l5.97-5.97a.75.75 0 0 1 1.06 0Z"
            />
          </svg>
          {message}
        </p>
      )}
    </div>
  )
}

// Tells that something went wrong. As tall as a success card, so swapping one for the other never
// moves the page.
export function ErrorMessage({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div role="alert" className={`w-fit rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700 ${className}`}>
      {children}
    </div>
  )
}
