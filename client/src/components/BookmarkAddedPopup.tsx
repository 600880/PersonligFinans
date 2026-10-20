import { useEffect, useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { FileBookmarkResult, Folder, SaveFolderResult } from '../lib/api'
import { useDismiss } from '../lib/useDismiss'
import { FolderDropdown } from './FolderDropdown'

interface BookmarkAddedPopupProps {
  // The User's Folders, shared with the Bookmarks view; null until loaded.
  folders: Folder[] | null
  // The Folder the Bookmark went into when it was added, or null for none.
  addedFolderId: number | null
  onDone: () => void
  // Removes the Bookmark, resolving whether it was removed.
  onRemove: () => Promise<boolean>
  // Files the Bookmark in the Folder, or in none for null.
  onFile: (folderId: number | null) => Promise<FileBookmarkResult>
  // Makes a Folder and adds it to the User's Folders, without filing anything in it.
  createFolder: (name: string) => Promise<SaveFolderResult>
}

// Says a Transaction was just bookmarked and where: dropping down under the star that bookmarked it,
// or on a phone as a small box centred over the page, so it never runs off the screen. Choosing a
// Folder, or creating one, files the Bookmark there at once. Escape or a click outside closes it like
// Done, except while a filing or Remove is being saved, so its outcome is always seen.
export function BookmarkAddedPopup({
  folders,
  addedFolderId,
  onDone,
  onRemove,
  onFile,
  createFolder,
}: BookmarkAddedPopupProps) {
  const headingId = useId()
  const popupRef = useRef<HTMLDivElement>(null)
  const folderSelectRef = useRef<HTMLSelectElement>(null)
  // The Folder the Bookmark is filed in, as far as the popup knows: the one chosen while it is saved.
  const [folderId, setFolderId] = useState(addedFolderId)
  // What is being saved, if anything. Nothing else can be done in the popup meanwhile.
  const [saving, setSaving] = useState<'file' | 'remove' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Whether a new Folder is being named, when the name field's own Create and Cancel are the only
  // buttons, so Remove and Done are hidden.
  const [isNamingFolder, setIsNamingFolder] = useState(false)
  // Cleared once the popup is gone, such as when the list shown changes, so a save that finishes
  // afterwards changes nothing in it.
  const isOpenRef = useRef(false)
  useDismiss(popupRef, saving === null, onDone)

  useEffect(() => {
    isOpenRef.current = true
    return () => {
      isOpenRef.current = false
    }
  }, [])

  // Focus moves to the Folder dropdown on opening, so the popup can be used from the keyboard. Until
  // the Folders are loaded the dropdown is disabled and can't take it, so the popup holds it meanwhile
  // and passes it on once they are, unless it has been moved elsewhere by then.
  const foldersLoaded = folders !== null
  useEffect(() => {
    if (!foldersLoaded) popupRef.current?.focus()
    else if (document.activeElement === popupRef.current) folderSelectRef.current?.focus()
  }, [foldersLoaded])

  // Shows the chosen Folder at once, and goes back to the previous one when saving fails, so the
  // dropdown always shows where the Bookmark really is.
  async function file(chosenId: number | null) {
    const previousId = folderId
    setFolderId(chosenId)
    setSaving('file')
    setError(null)
    const result = await onFile(chosenId)
    if (!isOpenRef.current) return
    flushSync(() => {
      setSaving(null)
      if (!result.ok) {
        setFolderId(previousId)
        setError(result.message)
      }
    })
    // The dropdown lost the focus while disabled, so it gets it back for the keyboard.
    if (document.activeElement === document.body) folderSelectRef.current?.focus()
  }

  // Files the Bookmark in the new Folder once it is made. A failed filing still leaves the Folder
  // made, so the name field closes either way, with the dropdown saying what failed.
  async function createAndFile(name: string): Promise<SaveFolderResult> {
    setSaving('file')
    setError(null)
    const result = await createFolder(name)
    if (!isOpenRef.current) return result
    if (result.ok) {
      await file(result.folder.id)
    } else {
      setSaving(null)
      // Field errors show under the name field.
      setError(result.message)
    }
    return result
  }

  // Closes once removed, and otherwise stays open saying so, since the Bookmark is still there.
  async function remove() {
    setSaving('remove')
    setError(null)
    const removed = await onRemove()
    if (!isOpenRef.current) return
    if (removed) {
      onDone()
    } else {
      setSaving(null)
      setError('Could not remove the bookmark.')
    }
  }

  return (
    <div
      ref={popupRef}
      role="dialog"
      aria-labelledby={headingId}
      tabIndex={-1}
      className="absolute top-full right-0 z-10 mt-1 flex w-max flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-md outline-none max-sm:fixed max-sm:inset-x-4 max-sm:top-1/2 max-sm:mx-auto max-sm:mt-0 max-sm:w-auto max-sm:max-w-xs max-sm:-translate-y-1/2"
    >
      <h3 id={headingId} className="text-sm font-medium text-slate-900">
        Bookmark added
      </h3>
      {/* Also takes the focus back when the name field for a new Folder closes. */}
      <FolderDropdown
        folders={folders}
        chosenId={folderId}
        onChoose={(chosenId) => void file(chosenId)}
        createFolder={createAndFile}
        onCreatingChange={setIsNamingFolder}
        disabled={saving !== null}
        autoFocus
        selectRef={folderSelectRef}
      />
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {!isNamingFolder && (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={saving !== null}
            onClick={() => void remove()}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            {saving === 'remove' ? 'Removing…' : 'Remove'}
          </button>
          <button
            type="button"
            disabled={saving !== null}
            onClick={onDone}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Done
          </button>
        </div>
      )}
    </div>
  )
}
