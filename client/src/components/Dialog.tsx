import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'

const widthClass = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  '4xl': 'max-w-4xl',
}

// The id of the dialog's heading, for a DialogHeading placed within the content.
const HeadingIdContext = createContext<string | undefined>(undefined)

interface DialogProps {
  // Shown as the heading at the top, which names the dialog. A dialog whose heading sits within its
  // own layout leaves it out, and places a DialogHeading in its content instead.
  title?: ReactNode
  // What Escape does: the same as the dialog's own Cancel or Close.
  onCancel: () => void
  width?: keyof typeof widthClass
  children: ReactNode
}

// A modal window over the dimmed page, which every dialog is built on so they look and behave
// alike. Opening it moves the focus into it, unless something in it has taken the focus already,
// and closing it gives the focus back to wherever it was before. It never grows past the screen, a
// phone's included: with a title, its content scrolls under the title's padding, and without one the
// content arranges its own scrolling. Escape anywhere is handed to onCancel, except where something
// in the dialog keeps it, such as a full-screen Receipt.
export function Dialog({ title, onCancel, width = 'md', children }: DialogProps) {
  const headingId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  // Taken while rendering, before anything in the dialog takes the focus as it mounts.
  const [opener] = useState(() => document.activeElement)

  useEffect(() => {
    const panel = panelRef.current!
    if (!panel.contains(document.activeElement)) panel.focus()
    return () => {
      // Only once the dialog has left the page, rather than when StrictMode remounts it.
      if (!panel.isConnected && opener instanceof HTMLElement) opener.focus()
    }
  }, [opener])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-900/40 dark:bg-slate-950/70 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className={`flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-xl bg-white dark:bg-slate-900 shadow-xl outline-none ${widthClass[width]}`}
      >
        <HeadingIdContext value={headingId}>
          {title === undefined ? (
            children
          ) : (
            <div className="min-h-0 overflow-y-auto p-6">
              <DialogHeading>{title}</DialogHeading>
              {children}
            </div>
          )}
        </HeadingIdContext>
      </div>
    </div>
  )
}

// The heading that names the dialog it is in, for a dialog that places it within its own layout.
export function DialogHeading({ children }: { children: ReactNode }) {
  return (
    <h2 id={useContext(HeadingIdContext)} className="text-lg font-semibold text-slate-900 dark:text-slate-100">
      {children}
    </h2>
  )
}
