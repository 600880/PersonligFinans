import { useId } from 'react'
import type { Category } from '../lib/api'
import { useIsDark } from '../lib/appearance'
import { drawnColour } from '../lib/categoryColours'

// The colours a Category can be given, in the palette's order, once loaded.
export type Palette = string[] | 'loading' | 'failed'

interface ColourPickerProps {
  palette: Palette
  // The Categories other than the one being added or edited, whose colours are marked.
  others: Category[]
  // The chosen colour, or none.
  value: string | null
  onChange: (colour: string) => void
  error?: string
}

// "Groceries", "Groceries and Health", "Groceries, Health and Other".
function listed(names: string[]) {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
}

// The palette as a row of swatches to choose a Category's colour from, drawn as the Dashboard would
// draw a Category in them. A colour another Category has is marked with a dot, and named with those
// Categories for screen readers and on hover, but can still be chosen. Real radio buttons, hidden
// behind their swatches, so the arrow keys move between them.
export function ColourPicker({ palette, others, value, onChange, error }: ColourPickerProps) {
  const id = useId()
  const dark = useIsDark()
  const usersOf = (colour: string) => others.filter((c) => c.colour === colour).map((c) => c.name)
  const chosenUsers = value ? usersOf(value) : []

  return (
    <div className="flex flex-col gap-1">
      <span id={`${id}-label`} className="text-sm font-medium text-slate-700 dark:text-slate-300">
        Colour
      </span>
      {palette === 'loading' ? null : palette === 'failed' ? (
        <span className="text-sm text-slate-500 dark:text-slate-400">Could not load the colours.</span>
      ) : (
        <div
          role="radiogroup"
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-error`}
          className="flex flex-wrap gap-2 py-1"
        >
          {palette.map((colour, index) => {
            const users = usersOf(colour)
            const name = `Colour ${index + 1}`
            return (
              <label
                key={colour}
                title={users.length > 0 ? `Used by ${listed(users)}` : undefined}
                className="relative cursor-pointer rounded-full has-focus-visible:outline-2 has-focus-visible:outline-offset-4 has-focus-visible:outline-slate-500"
              >
                <input
                  type="radio"
                  name={id}
                  value={colour}
                  checked={value === colour}
                  onChange={() => onChange(colour)}
                  aria-label={users.length > 0 ? `${name}, used by ${listed(users)}` : name}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className="block size-7 rounded-full ring-1 ring-black/10 ring-inset peer-checked:ring-2 peer-checked:ring-slate-900 peer-checked:ring-offset-2 peer-checked:ring-offset-white dark:ring-white/10 dark:peer-checked:ring-slate-100 dark:peer-checked:ring-offset-slate-900"
                  style={{ backgroundColor: drawnColour(colour, dark) }}
                />
                {users.length > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 m-auto size-2 rounded-full bg-white/90 ring-1 ring-black/20"
                  />
                )}
              </label>
            )
          })}
        </div>
      )}
      {/* The chosen colour's other Categories, for those who can't hover over it; the radio already
          names them for screen readers. */}
      {chosenUsers.length > 0 && (
        <span aria-hidden="true" className="text-xs text-slate-500 dark:text-slate-400">
          {listed(chosenUsers)} {chosenUsers.length === 1 ? 'has' : 'have'} this colour too.
        </span>
      )}
      <span id={`${id}-error`} className="text-xs text-red-600 dark:text-red-300">
        {error}
      </span>
    </div>
  )
}
