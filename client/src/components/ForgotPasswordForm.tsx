import { useState, type FormEvent } from 'react'
import { requestPasswordReset } from '../lib/api'
import { Field, inputClassName } from './TransactionForm'

// The same for every email, whether or not it is a User's, as the server's answer is, so nobody can
// find out which emails are in use.
const LINK_SENT = "If that email is in use, we've sent a link to it. It works for 1 hour."

interface ForgotPasswordFormProps {
  // The email, shared with Sign in, so it starts as typed there and carries back.
  email: string
  onEmailChange: (email: string) => void
  onBack: () => void
}

// Asks for a link to choose a new password, for a User who can't sign in. Shown only while Password
// reset is available.
export function ForgotPasswordForm({ email, onEmailChange, onBack }: ForgotPasswordFormProps) {
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
      className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm max-sm:p-4"
    >
      <h2 id="reset-heading" className="text-lg font-semibold text-slate-900">
        Reset your password
      </h2>

      {isSent ? (
        <p role="status" className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {LINK_SENT}
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-slate-600">We'll email you a link to choose a new password.</p>

          {errorMessage && (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
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
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isSending ? 'Sending link…' : 'Send link'}
            </button>
          </form>
        </>
      )}

      <p className="mt-4 text-center text-sm">
        <button type="button" onClick={onBack} className="font-medium text-slate-900 underline">
          Back to Sign in
        </button>
      </p>
    </section>
  )
}
