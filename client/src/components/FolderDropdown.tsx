import { useId, useState, type FormEvent, type ReactNode } from 'react'
import type { Folder, FolderFieldErrors, SaveFolderResult } from '../lib/api'

// The select's values for "Bookmarks", the bookmarks in no Folder, and for "Create folder". A
// Folder's value is its id.
const NO_FOLDER = ''
const CREATE_FOLDER = 'create'

const inputClass = 'rounded-lg border border-slate-300 px-3 py-2 font-normal'
const smallButtonClass =
  'rounded-lg px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300'

// The Folder dropdown: "Bookmarks" for the bookmarks in no Folder, then the Folders in the order
// given, then "Create folder" last. chosenId is null for "Bookmarks". Disabled while the Folders are
// null, as they are until loaded.
// "Create folder" swaps the dropdown for a name field with Create and Cancel. Create hands the
// trimmed name to createFolder, which makes the Folder and chooses it; the field stays, with its
// input, until that succeeds. Cancel brings back the dropdown with the same option chosen.
// The children are shown next to the dropdown, and hidden with it while the name field shows.
export function FolderDropdown({
  folders,
  chosenId,
  onChoose,
  createFolder,
  children,
}: {
  folders: Folder[] | null
  chosenId: number | null
  onChoose: (folderId: number | null) => void
  createFolder: (name: string) => Promise<SaveFolderResult>
  children?: ReactNode
}) {
  // Whether the name field for a new Folder shows in place of the dropdown.
  const [isCreating, setIsCreating] = useState(false)

  function choose(value: string) {
    if (value === CREATE_FOLDER) setIsCreating(true)
    else onChoose(value === NO_FOLDER ? null : Number(value))
  }

  async function create(name: string) {
    const result = await createFolder(name)
    if (result.ok) setIsCreating(false)
    return result
  }

  if (isCreating) {
    return <FolderNameForm initialName="" submitLabel="Create" save={create} onCancel={() => setIsCreating(false)} />
  }

  return (
    <>
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
      {children}
    </>
  )
}

// A Folder's name field, starting from initialName, with a submit button and Cancel, for naming a
// new Folder or renaming one. Submitting hands the trimmed name to save. Until that succeeds, when
// whoever shows the field closes it, the field keeps its input and shows the server's field errors.
export function FolderNameForm({
  initialName,
  submitLabel,
  save,
  onCancel,
}: {
  initialName: string
  submitLabel: string
  save: (name: string) => Promise<SaveFolderResult>
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const [fieldErrors, setFieldErrors] = useState<FolderFieldErrors>({})
  const [isSaving, setIsSaving] = useState(false)
  const nameErrorId = useId()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (isSaving) return

    setIsSaving(true)
    setFieldErrors({})
    const result = await save(name.trim()).finally(() => setIsSaving(false))
    if (!result.ok) setFieldErrors(result.fieldErrors)
  }

  return (
    <form className="flex flex-wrap items-start gap-2" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Folder name
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-describedby={nameErrorId}
            className={inputClass}
          />
        </label>
        <span id={nameErrorId} className="text-xs text-red-600">
          {fieldErrors.name}
        </span>
      </div>
      <div className="mt-7 flex gap-2">
        <button type="submit" disabled={isSaving} className={smallButtonClass}>
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className={smallButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  )
}
