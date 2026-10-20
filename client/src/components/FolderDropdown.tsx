import { useId, useState, type FormEvent } from 'react'
import type { Folder, FolderFieldErrors, SaveFolderResult } from '../lib/api'

// The select's values for "Bookmarks", the bookmarks in no Folder, and for "Create folder". A
// Folder's value is its id.
const NO_FOLDER = ''
const CREATE_FOLDER = 'create'

const inputClass = 'rounded-lg border border-slate-300 px-3 py-2 font-normal'
const smallButtonClass =
  'rounded-lg px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300'

// The new Folder's name as typed so far, and the errors the server gave it.
interface FolderDraft {
  name: string
  fieldErrors: FolderFieldErrors
}

// The Folder dropdown: "Bookmarks" for the bookmarks in no Folder, then the Folders in the order
// given, then "Create folder" last. chosenId is null for "Bookmarks". Disabled while the Folders are
// null, as they are until loaded.
// "Create folder" swaps the dropdown for a name field with Create and Cancel. Create hands the
// trimmed name to createFolder, which makes the Folder and chooses it; the field stays, with its
// input, until that succeeds. Cancel brings back the dropdown with the same option chosen.
export function FolderDropdown({
  folders,
  chosenId,
  onChoose,
  createFolder,
}: {
  folders: Folder[] | null
  chosenId: number | null
  onChoose: (folderId: number | null) => void
  createFolder: (name: string) => Promise<SaveFolderResult>
}) {
  // The Folder being named, or null while the dropdown shows.
  const [draft, setDraft] = useState<FolderDraft | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const nameErrorId = useId()

  function choose(value: string) {
    if (value === CREATE_FOLDER) setDraft({ name: '', fieldErrors: {} })
    else onChoose(value === NO_FOLDER ? null : Number(value))
  }

  async function handleCreate(event: FormEvent, current: FolderDraft) {
    event.preventDefault()
    if (isSaving) return

    setIsSaving(true)
    setDraft({ ...current, fieldErrors: {} })
    const result = await createFolder(current.name.trim()).finally(() => setIsSaving(false))

    // A field cancelled while it was saving stays closed.
    if (result.ok) setDraft(null)
    else setDraft((open) => open && { ...current, fieldErrors: result.fieldErrors })
  }

  if (draft) {
    return (
      <form className="flex flex-wrap items-start gap-2" onSubmit={(event) => handleCreate(event, draft)}>
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Folder name
            <input
              autoFocus
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              aria-describedby={nameErrorId}
              className={inputClass}
            />
          </label>
          <span id={nameErrorId} className="text-xs text-red-600">
            {draft.fieldErrors.name}
          </span>
        </div>
        <div className="mt-7 flex gap-2">
          <button type="submit" disabled={isSaving} className={smallButtonClass}>
            Create
          </button>
          <button type="button" onClick={() => setDraft(null)} className={smallButtonClass}>
            Cancel
          </button>
        </div>
      </form>
    )
  }

  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
      Folder
      <select
        value={chosenId ?? NO_FOLDER}
        disabled={folders === null}
        onChange={(event) => choose(event.target.value)}
        className={inputClass}
      >
        <option value={NO_FOLDER}>Bookmarks</option>
        {folders?.map((folder) => (
          <option key={folder.id} value={folder.id}>
            {folder.name}
          </option>
        ))}
        <option value={CREATE_FOLDER}>Create folder</option>
      </select>
    </label>
  )
}
