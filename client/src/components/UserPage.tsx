import { useId, useState, type FormEvent } from 'react'
import { changePassword, signOut, type ChangePasswordRequest, type User } from '../lib/api'
import { confirmPasswordError } from '../lib/confirmPassword'
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
// Change password form, always open. Below the card, the deletes.
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
      <h2 className="text-lg font-semibold text-slate-900">User</h2>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white shadow-sm">
        {/* Sign out stays beside the email at any width; a long email breaks across lines instead. */}
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <p className="min-w-0 text-sm break-all text-slate-600">
            Signed in as <span className="font-medium text-slate-900">{user.isGuest ? 'Guest' : user.email}</span>
          </p>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className={`shrink-0 ${secondaryButtonClassName}`}
          >
            Sign out
          </button>
        </div>
        {signOutFailed && <ErrorMessage className="mx-4 mb-3">Signing out failed. Try again.</ErrorMessage>}

        <div className="border-t border-slate-200 p-4">
          {/* The Guest has no password, so it has no Change password. The form is shown anyway,
              disabled, so the Guest sees what a signed-up User can do. */}
          <ChangePasswordForm disabled={user.isGuest} />
        </div>
      </div>

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

const secondaryButtonClassName =
  'rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-white'

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
          className="flex min-w-0 flex-col gap-4 [&_input:disabled]:cursor-not-allowed [&_input:disabled]:bg-slate-50"
        >
          <h3 id={headingId} className="text-sm font-semibold text-slate-900">
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
          <div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isSubmitting ? 'Changing password…' : 'Change password'}
            </button>
          </div>
        </fieldset>
      </form>
      <StatusMessage message={statusMessage} className="mt-3" />
    </section>
  )
}
