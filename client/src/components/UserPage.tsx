import { useId, useState, type FormEvent } from 'react'
import { chooseAppearance, readAppearance, type Appearance } from '../lib/appearance'
import { changePassword, signOut, type ChangePasswordRequest, type User } from '../lib/api'
import { confirmPasswordError } from '../lib/confirmPassword'
import { secondaryButtonClass } from './buttons'
import { ConfirmPasswordField } from './ConfirmPasswordField'
import { DeleteDataSection } from './DeleteDataSection'
import { ErrorMessage, StatusMessage } from './Messages'
import { Field, inputClassName } from './TransactionForm'

interface UserPageProps {
  user: User
  // Called once the server has signed the User out.
  onSignedOut: () => void
  // Whether an Upload is in progress, during which nothing can be deleted.
  isUploading: boolean
  // Called after each delete of the User's data.
  onDataDeleted: () => void
}

// One card with who is signed in, the email or the Guest, and Sign out next to it, and below them the
// Change password form, always open. Under it the Appearance card, then the deletes.
export function UserPage({ user, onSignedOut, isUploading, onDataDeleted }: UserPageProps) {
  const [signOutFailed, setSignOutFailed] = useState(false)

  // Stays signed in, saying so, when the server couldn't be told.
  async function handleSignOut() {
    setSignOutFailed(false)
    if (await signOut()) onSignedOut()
    else setSignOutFailed(true)
  }

  return (
    <section className="w-full max-w-2xl">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">User</h2>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 p-4">
          {/* Sign out stays beside the email at any width; a long email breaks across lines instead. */}
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-sm break-all text-slate-600 dark:text-slate-400">
              Signed in as{' '}
              <span className="font-medium text-slate-900 dark:text-slate-100">{user.isGuest ? 'Guest' : user.email}</span>
            </p>
            <button type="button" onClick={() => void handleSignOut()} className={`shrink-0 ${secondaryButtonClass}`}>
              Sign out
            </button>
          </div>
          {signOutFailed && <ErrorMessage>Signing out failed. Try again.</ErrorMessage>}
        </div>

        <div className="border-t border-slate-200 p-4 dark:border-slate-800">
          {/* The Guest has no password, so it has no Change password. The form is shown anyway,
              disabled, so the Guest sees what a signed-up User can do. */}
          <ChangePasswordForm disabled={user.isGuest} />
        </div>
      </div>

      <AppearanceCard />

      {/* Deleting the User signs this browser out, so the app goes on as after Sign out. */}
      <DeleteDataSection
        isUploading={isUploading}
        onDeleted={onDataDeleted}
        isGuest={user.isGuest}
        onUserDeleted={onSignedOut}
      />
    </section>
  )
}

const APPEARANCES: { value: Appearance; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

// Light, Dark or System side by side, applied at once and remembered in this browser, not on the
// User, so it needs no saving and no status line.
function AppearanceCard() {
  const headingId = useId()
  const [appearance, setAppearance] = useState(readAppearance)

  function choose(picked: Appearance) {
    chooseAppearance(picked)
    setAppearance(picked)
  }

  return (
    <section
      aria-labelledby={headingId}
      className="mt-3 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <h3 id={headingId} className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        Appearance
      </h3>
      {/* Real radio buttons, hidden behind their labels, so the arrow keys move between them. */}
      <div
        role="radiogroup"
        aria-labelledby={headingId}
        className="flex w-fit gap-0.5 rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800"
      >
        {APPEARANCES.map(({ value, label }) => (
          <label
            key={value}
            className={`cursor-pointer rounded-md px-4 py-1.5 text-sm font-medium has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-slate-500 ${
              appearance === value
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                : 'text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700'
            }`}
          >
            <input
              type="radio"
              name={headingId}
              value={value}
              checked={appearance === value}
              onChange={() => choose(value)}
              className="sr-only"
            />
            {label}
          </label>
        ))}
      </div>
    </section>
  )
}

interface ChangePasswordFormProps {
  disabled: boolean
}

// The current password, so that someone using an open tab can't take the User over, and the new one
// twice, as at Sign up. Changing it keeps this browser signed in and signs the User out everywhere
// else, and empties the fields for the next change.
function ChangePasswordForm({ disabled }: ChangePasswordFormProps) {
  const headingId = useId()
  // What the last change did, until the next one is typed or sent.
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ChangePasswordRequest, string>>>({})
  const [confirmPasswordFieldError, setConfirmPasswordFieldError] = useState<string | undefined>()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setStatusMessage(null)
    setFieldErrors({})
    setErrorMessage(null)
    // Nothing is sent until the confirm field matches the new password.
    const mismatch = confirmPasswordError(newPassword, confirmPassword)
    setConfirmPasswordFieldError(mismatch)
    if (mismatch) return
    setIsSubmitting(true)
    const result = await changePassword({ currentPassword, newPassword })
    setIsSubmitting(false)
    if (result.ok) {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setStatusMessage('Password changed.')
      return
    }
    setFieldErrors(result.fieldErrors)
    setErrorMessage(result.message)
  }

  // Its own region, so its status line is told apart from the Delete data section's.
  return (
    <section aria-labelledby={headingId}>
      {/* Typing in any field clears the last change's status line. */}
      <form
        noValidate
        onSubmit={handleSubmit}
        onChange={() => setStatusMessage(null)}
        className="max-w-sm max-sm:max-w-none"
      >
        <fieldset
          disabled={disabled}
          className="flex min-w-0 flex-col gap-4 [&_input:disabled]:cursor-not-allowed [&_input:disabled]:bg-slate-50 dark:[&_input:disabled]:bg-slate-950"
        >
          <h3 id={headingId} className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Change password
          </h3>
          {errorMessage && <ErrorMessage>{errorMessage}</ErrorMessage>}
          <Field label="Current password" error={fieldErrors.currentPassword}>
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className={inputClassName}
            />
          </Field>
          <Field label="New password" error={fieldErrors.newPassword}>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className={inputClassName}
            />
          </Field>
          <ConfirmPasswordField value={confirmPassword} onChange={setConfirmPassword} error={confirmPasswordFieldError} />
          {/* The status line keeps its place beside the button, so the card never grows when it comes. */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className={secondaryButtonClass}
            >
              {isSubmitting ? 'Changing password…' : 'Change password'}
            </button>
            <StatusMessage message={statusMessage} />
          </div>
        </fieldset>
      </form>
    </section>
  )
}
