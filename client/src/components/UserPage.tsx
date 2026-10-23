import { useState, type FormEvent } from 'react'
import { changePassword, signOut, type ChangePasswordRequest, type User } from '../lib/api'
import { confirmPasswordError } from '../lib/confirmPassword'
import { ConfirmPasswordField } from './ConfirmPasswordField'
import { ErrorMessage, StatusMessage } from './Messages'
import { Field, inputClassName } from './TransactionForm'

interface UserPageProps {
  user: User
  // Called once the server has signed the User out.
  onSignedOut: () => void
}

// Who is signed in, the email or the Guest, with Sign out next to it, and Change password below.
export function UserPage({ user, onSignedOut }: UserPageProps) {
  const [signOutFailed, setSignOutFailed] = useState(false)
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  // What the last action did, until the next one.
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  // Stays signed in, saying so, when the server couldn't be told.
  async function handleSignOut() {
    setSignOutFailed(false)
    setStatusMessage(null)
    if (await signOut()) onSignedOut()
    else setSignOutFailed(true)
  }

  function handleOpenChangePassword() {
    setStatusMessage(null)
    setIsChangingPassword(true)
  }

  function handlePasswordChanged() {
    setIsChangingPassword(false)
    setStatusMessage('Password changed.')
  }

  return (
    <section className="w-full max-w-2xl">
      <h2 className="text-lg font-semibold text-slate-900">User</h2>

      {/* Sign out stays beside the email at any width; a long email breaks across lines instead. */}
      <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
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
      {signOutFailed && <ErrorMessage className="mt-3">Signing out failed. Try again.</ErrorMessage>}

      <div className="mt-6">
        {isChangingPassword ? (
          <ChangePasswordForm onChanged={handlePasswordChanged} onCancel={() => setIsChangingPassword(false)} />
        ) : (
          // The Guest has no password, so it has no Change password. The button is shown anyway, so
          // the Guest sees what a signed-up User can do.
          <button
            type="button"
            disabled={user.isGuest}
            onClick={handleOpenChangePassword}
            className={secondaryButtonClassName}
          >
            Change password
          </button>
        )}
        <StatusMessage message={statusMessage} className="mt-3" />
      </div>
    </section>
  )
}

const secondaryButtonClassName =
  'rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-white'

interface ChangePasswordFormProps {
  onChanged: () => void
  onCancel: () => void
}

// The current password, so that someone using an open tab can't take the User over, and the new one
// twice, as at Sign up. Changing it keeps this browser signed in and signs the User out everywhere
// else.
function ChangePasswordForm({ onChanged, onCancel }: ChangePasswordFormProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ChangePasswordRequest, string>>>({})
  const [confirmPasswordFieldError, setConfirmPasswordFieldError] = useState<string | undefined>()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    setErrorMessage(null)
    // Nothing is sent until the confirm field matches the new password.
    const mismatch = confirmPasswordError(newPassword, confirmPassword)
    setConfirmPasswordFieldError(mismatch)
    if (mismatch) return
    setIsSubmitting(true)
    const result = await changePassword({ currentPassword, newPassword })
    if (result.ok) {
      onChanged()
      return
    }
    setIsSubmitting(false)
    setFieldErrors(result.fieldErrors)
    setErrorMessage(result.message)
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className="flex max-w-sm flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm max-sm:max-w-none"
    >
      <h3 className="text-sm font-semibold text-slate-900">Change password</h3>
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
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isSubmitting ? 'Changing password…' : 'Change password'}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButtonClassName}>
          Cancel
        </button>
      </div>
    </form>
  )
}
