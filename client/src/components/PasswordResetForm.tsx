import { useState, type FormEvent } from 'react'
import { requestPasswordReset } from '../lib/api'
import { linkSent } from '../lib/passwordReset'
import { Field, inputClassName } from './TransactionForm'

interface PasswordResetFormProps {
  // The email, shared with Sign in, so it starts as typed there and carries back.
  email: string
  onEmailChange: (email: string) => void
  // How long the link works, as the server says.
  linkHours: number
  onBack: () => void
}

// Asks for a link to choose a new password, for a User who can't sign in. Shown only while Password
// reset is available.
export function PasswordResetForm({ email, onEmailChange, linkHours, onBack }: PasswordResetFormProps) {
  const [emailError, setEmailError] = useState<string | undefined>()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isSent, setIsSent] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setIsSending(true)
    setEmailError(undefined)
    setErrorMessage(null)
    const result = await requestPasswordReset(email)
    setIsSending(false)
    if (result.ok) {
      setIsSent(true)
      return
    }
    setEmailError(result.fieldErrors.email)
    setErrorMessage(result.message)
  }

  return (
    <section
      aria-labelledby="reset-heading"
      className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm max-sm:p-4"
    >
      <h2 id="reset-heading" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
        Reset your password
      </h2>

      {isSent ? (
        <p role="status" className="mt-3 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300">
          {linkSent(linkHours)}
        </p>
      ) : (
        <>
          {errorMessage && (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {errorMessage}
            </p>
          )}

          <form noValidate className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
            <Field label="Email" error={emailError}>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
                className={inputClassName}
              />
            </Field>
            <button
              type="submit"
              disabled={isSending}
              className="rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-sm font-medium text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-300 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
            >
              {isSending ? 'Sending link…' : 'Send link'}
            </button>
          </form>
        </>
      )}

      <p className="mt-4 text-center text-sm">
        <button type="button" onClick={onBack} className="font-medium text-slate-900 dark:text-slate-100 underline">
          Back to Sign in
        </button>
      </p>
    </section>
  )
}
