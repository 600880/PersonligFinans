import { useId, useState, type FormEvent } from 'react'
import { addCategory, editCategory, type Category, type CategoryFieldErrors } from '../lib/api'
import { ColourPicker, type Palette } from './ColourPicker'
import { Dialog } from './Dialog'
import { ErrorMessage } from './Messages'
import { inputClassName } from './TransactionForm'

interface CategoryDialogProps {
  // The Category to edit, or none to add one.
  category?: Category
  // Every Category, the edited one included, for the colours they have.
  categories: Category[]
  palette: Palette
  onCancel: () => void
  onSaved: (category: Category) => void
}

// The colour the picker starts on: the Category's own, or for a new Category the first no Category
// has, ignoring case as the server does when it chooses one. None when that isn't a palette colour,
// as for a Category on the slate fallback, or when every one is taken, or before the palette has
// loaded.
function startingColour(category: Category | undefined, categories: Category[], palette: Palette) {
  if (!Array.isArray(palette)) return null
  if (category) return palette.includes(category.colour) ? category.colour : null
  const taken = new Set(categories.map((c) => c.colour?.toLowerCase()))
  return palette.find((colour) => !taken.has(colour.toLowerCase())) ?? null
}

// Adds a Category, or edits one, by its Name, Description and Colour. The fields start empty for a
// new Category and filled in for one being edited. A Built-in Category's name is shown but can't be
// changed, so it is sent unchanged; its colour can. The colour the picker starts on is sent like a
// chosen one, so once the palette has loaded a new Category is sent the dialog's own pick of the
// first unused colour. With no colour at all none is sent, so a new Category gets the server's
// choice and an edited one keeps its own. Closing the dialog without saving discards what was typed
// and chosen.
export function CategoryDialog({ category, categories, palette, onCancel, onSaved }: CategoryDialogProps) {
  const id = useId()
  const builtIn = category?.builtIn ?? false
  const [name, setName] = useState(category?.name ?? '')
  const [description, setDescription] = useState(category?.description ?? '')
  // Undefined until a colour is chosen, so until then the picker follows the palette as it loads.
  const [pickedColour, setPickedColour] = useState<string>()
  const colour = pickedColour ?? startingColour(category, categories, palette)
  const [isSaving, setIsSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<CategoryFieldErrors>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (isSaving) return

    setIsSaving(true)
    setFieldErrors({})
    setErrorMessage(null)

    const request = { name: name.trim(), description: description.trim(), colour: colour ?? undefined }
    const result = await (category ? editCategory(category.id, request) : addCategory(request)).finally(() =>
      setIsSaving(false),
    )

    if (result.ok) {
      onSaved(result.category)
    } else {
      setFieldErrors(result.fieldErrors)
      setErrorMessage(result.message)
    }
  }

  return (
    <Dialog title={category ? 'Edit category' : 'Add category'} onCancel={onCancel}>
      {errorMessage && <ErrorMessage className="mt-3">{errorMessage}</ErrorMessage>}

      <form className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              readOnly={builtIn}
              autoFocus={!builtIn}
              aria-describedby={builtIn ? `${id}-name-hint` : `${id}-name-error`}
              className={`${inputClassName} read-only:bg-slate-50 dark:read-only:bg-slate-800/50 read-only:text-slate-500 dark:read-only:text-slate-400`}
            />
          </label>
          {builtIn ? (
            <span id={`${id}-name-hint`} className="text-xs text-slate-500 dark:text-slate-400">
              Built-in Categories can't be renamed.
            </span>
          ) : (
            <span id={`${id}-name-error`} className="text-xs text-red-600 dark:text-red-300">
              {fieldErrors.name}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-300">
            Description
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              autoFocus={builtIn}
              aria-describedby={`${id}-description-error`}
              className={inputClassName}
            />
          </label>
          <span id={`${id}-description-error`} className="text-xs text-red-600 dark:text-red-300">
            {fieldErrors.description}
          </span>
        </div>
        <ColourPicker
          palette={palette}
          others={categories.filter((c) => c.id !== category?.id)}
          value={colour}
          onChange={setPickedColour}
          error={fieldErrors.colour}
        />

        <div className="mt-2 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-sm font-medium text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-300 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
