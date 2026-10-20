import { useEffect, useId, useRef, useState } from 'react'
import { useDismiss } from '../lib/useDismiss'

interface BookmarkAddedPopupProps {
  onDone: () => void
  // Removes the Bookmark, resolving whether it was removed.
  onRemove: () => Promise<boolean>
}

// Says a Transaction was just bookmarked: dropping down under the star that bookmarked it, or on a
// phone as a small box centred over the page, so it never runs off the screen. Escape or a click
// outside closes it like Done, except while Remove is being saved, so its outcome is always seen.
export function BookmarkAddedPopup({ onDone, onRemove }: BookmarkAddedPopupProps) {
  const headingId = useId()
  const popupRef = useRef<HTMLDivElement>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const [removeFailed, setRemoveFailed] = useState(false)
  // Cleared once the popup is gone, such as when the list shown changes, so a Remove that finishes
  // afterwards closes nothing.
  const isOpenRef = useRef(false)
  useDismiss(popupRef, !isRemoving, onDone)

  useEffect(() => {
    isOpenRef.current = true
    return () => {
      isOpenRef.current = false
    }
  }, [])

  // Closes once removed, and otherwise stays open saying so, since the Bookmark is still there.
  async function remove() {
    setIsRemoving(true)
    setRemoveFailed(false)
    const removed = await onRemove()
    if (!isOpenRef.current) return
    if (removed) {
      onDone()
    } else {
      setIsRemoving(false)
      setRemoveFailed(true)
    }
  }

  return (
    <div
      ref={popupRef}
      role="dialog"
      aria-labelledby={headingId}
      className="absolute top-full right-0 z-10 mt-1 flex w-max flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-md max-sm:fixed max-sm:inset-x-4 max-sm:top-1/2 max-sm:mx-auto max-sm:mt-0 max-sm:w-auto max-sm:max-w-xs max-sm:-translate-y-1/2"
    >
      <h3 id={headingId} className="text-sm font-medium text-slate-900">
        Bookmark added
      </h3>
      {removeFailed && (
        <p role="alert" className="text-xs text-red-600">
          Could not remove the bookmark.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={isRemoving}
          onClick={() => void remove()}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
        >
          {isRemoving ? 'Removing…' : 'Remove'}
        </button>
        {/* Focus moves in on opening, so the popup can be used from the keyboard. */}
        <button
          type="button"
          autoFocus
          disabled={isRemoving}
          onClick={onDone}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Done
        </button>
      </div>
    </div>
  )
}
