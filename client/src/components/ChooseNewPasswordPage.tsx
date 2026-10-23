import { useEffect, useState, type FormEvent } from 'react'
import {
  chooseNewPassword,
  fetchPasswordReset,
  requestPasswordReset,
  type PasswordReset,
  type User,
} from '../lib/api'
import { confirmPasswordError } from '../lib/confirmPassword'
import { linkSent, type ResetLink } from '../lib/passwordReset'
import { ConfirmPasswordField } from './ConfirmPasswordField'
import { Field, inputClassName } from './TransactionForm'

interface ChooseNewPasswordPageProps {
  link: ResetLink
  // Told the User the new password signed in as.
  onSignedIn: (user: User) => void
  // Told when leaving for Sign in instead.
  onLeave: () => void
}

// What the link in a reset email opens, whoever is signed in on this browser: a new password and
// the confirm field, which set the User's password and sign in as it. A link that has expired or was
// already used says so, and offers to send a new one to the email it was for.
export function ChooseNewPasswordPage({ link, onSignedIn, onLeave }: ChooseNewPasswordPageProps) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | undefined>()
  const [confirmPasswordFieldError, setConfirmPasswordFieldError] = useState<string | undefined>()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // A link without its email or token is one nobody was sent, so it is treated as expired.
  const [isExpired, setIsExpired] = useState(link.email === '' || link.token === '')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setPasswordError(undefined)
    setErrorMessage(null)
    // Nothing is sent until the confirm field matches the password.
    const mismatch = confirmPasswordError(password, confirmPassword)
    setConfirmPasswordFieldError(mismatch)
    if (mismatch) return
    setIsSubmitting(true)
    const result = await chooseNewPassword({ email: link.email, token: link.token, password })
    if (result.ok) {
      onSignedIn(result.user)
      return
    }
    setIsSubmitting(false)
    if (result.expired) {
      setIsExpired(true)
      return
    }
    setPasswordError(result.fieldErrors.password)
    setErrorMessage(result.message)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-4 max-sm:px-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">PersonligFinans</h1>
      </header>

      <main className="flex flex-col items-center px-6 py-10 max-sm:px-4">
        <section
          aria-labelledby="new-password-heading"
          className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm max-sm:p-4"
        >
          <h2 id="new-password-heading" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Choose a new password
          </h2>

          {isExpired ? (
            <ExpiredLink email={link.email} />
          ) : (
            <>
              <p className="mt-2 text-sm break-all text-slate-600 dark:text-slate-400">
                For <span className="font-medium text-slate-900 dark:text-slate-100">{link.email}</span>
              </p>

              {errorMessage && (
                <p role="alert" className="mt-3 rounded-lg bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                  {errorMessage}
                </p>
              )}

              <form noValidate className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
                <Field label="New password" error={passwordError}>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className={inputClassName}
                  />
                </Field>
                <ConfirmPasswordField
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  error={confirmPasswordFieldError}
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-sm font-medium text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-300 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
                >
                  {isSubmitting ? 'Setting new password…' : 'Set new password'}
                </button>
              </form>
            </>
          )}

          <p className="mt-4 text-center text-sm">
            <button type="button" onClick={onLeave} className="font-medium text-slate-900 dark:text-slate-100 underline">
              Back to Sign in
            </button>
          </p>
        </section>
      </main>
    </div>
  )
}

// Says the link can't be used, and offers to send a new one to the email the link was for. Offered
// only while Password reset is available, and only for a link with an email: without one, a new link
// is asked for from Sign in.
function ExpiredLink({ email }: { email: string }) {
  // Password reset, or null while unavailable, which it is until the server says otherwise.
  const [passwordReset, setPasswordReset] = useState<PasswordReset | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isSent, setIsSent] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    void fetchPasswordReset().then((reset) => {
      if (!ignore) setPasswordReset(reset)
    })
    return () => {
      ignore = true
    }
  }, [])

  async function handleSendNewLink() {
    setIsSending(true)
    setErrorMessage(null)
    const result = await requestPasswordReset(email)
    setIsSending(false)
    if (result.ok) setIsSent(true)
    else setErrorMessage(result.fieldErrors.email ?? result.message)
  }

  return (
    <>
      <p className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
        This link has expired or was already used.
      </p>

      {errorMessage && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {errorMessage}
        </p>
      )}

      {passwordReset && email !== '' && (
        isSent ? (
          <p role="status" className="mt-3 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300">
            {linkSent(passwordReset.linkHours)}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => void handleSendNewLink()}
            disabled={isSending}
            className="mt-4 w-full rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-sm font-medium text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-300 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
          >
            {isSending ? 'Sending link…' : 'Send a new link'}
          </button>
        )
      )}
    </>
  )
}
