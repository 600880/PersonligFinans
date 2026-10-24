import { useRef, useState, type KeyboardEvent } from 'react'

interface ZoomableReceiptProps {
  // Where the Receipt is loaded from: a browser-local URL during a Receipt scan, or where a kept
  // Receipt is served.
  src: string
  // How the button and the Receipt in it look, which depends on where it is shown.
  className: string
  imageClassName: string
}

// A Receipt shown as a button that shows it full-screen, where a click or Escape closes it again and
// focus goes back to the button. The full-screen view keeps the keyboard to itself, so its Escape
// never reaches the window or whatever it was opened from, such as a Note editor.
export function ZoomableReceipt({ src, className, imageClassName }: ZoomableReceiptProps) {
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
      <button
        ref={showButtonRef}
        type="button"
        aria-label="Show the Receipt full-screen"
        onClick={() => setIsFullScreen(true)}
        className={`cursor-zoom-in ${className}`}
      >
        <img src={src} alt="Receipt" className={imageClassName} />
      </button>

      {isFullScreen && (
        <button
          type="button"
          aria-label="Close the full-screen Receipt"
          autoFocus
          onClick={closeFullScreen}
          onKeyDown={handleFullScreenKeyDown}
          className="fixed inset-0 z-10 flex cursor-zoom-out items-center justify-center bg-slate-900/90 p-4"
        >
          <img src={src} alt="Receipt" className="max-h-full max-w-full object-contain" />
        </button>
      )}
    </>
  )
}
