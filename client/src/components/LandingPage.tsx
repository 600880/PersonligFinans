import { useState, type FormEvent } from 'react'
import { continueAsGuest, signIn, signUp, type CredentialsFieldErrors, type User } from '../lib/api'
import { confirmPasswordError } from '../lib/confirmPassword'
import { ConfirmPasswordField } from './ConfirmPasswordField'
import { Field, inputClassName } from './TransactionForm'

// Everything that differs between signing in and signing up. The form's heading and its submit
// button both say label, and the other Mode is offered after switchPrompt.
const MODES = {
  signIn: {
    label: 'Sign in',
    submittingLabel: 'Signing in…',
    passwordAutoComplete: 'current-password',
    switchPrompt: 'New user? ',
    other: 'signUp',
    submit: signIn,
  },
  signUp: {
    label: 'Sign up',
    submittingLabel: 'Signing up…',
    passwordAutoComplete: 'new-password',
    switchPrompt: 'Already signed up? ',
    other: 'signIn',
    submit: signUp,
  },
} as const

type Mode = keyof typeof MODES

interface LandingPageProps {
  onSignedIn: (user: User) => void
}

// What a visitor who isn't signed in sees: a form to sign in or, switched to, to sign up, and a
// way to try the app as the Guest. The email typed in carries over when switching.
export function LandingPage({ onSignedIn }: LandingPageProps) {
  const [mode, setMode] = useState<Mode>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [confirmPasswordMismatch, setConfirmPasswordMismatch] = useState<string | undefined>()
  const [fieldErrors, setFieldErrors] = useState<CredentialsFieldErrors>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [guestError, setGuestError] = useState<string | null>(null)
  const [isContinuingAsGuest, setIsContinuingAsGuest] = useState(false)
  const current = MODES[mode]

  function switchMode() {
    setMode(current.other)
    setConfirmPassword('')
    setConfirmPasswordMismatch(undefined)
    setFieldErrors({})
    setErrorMessage(null)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    setErrorMessage(null)
    // Signing up sends nothing until the confirm field matches the password.
    const mismatch = mode === 'signUp' ? confirmPasswordError(password, confirmPassword) : undefined
    setConfirmPasswordMismatch(mismatch)
    if (mismatch) return
    setIsSubmitting(true)
    const result = await current.submit({ email, password })
    if (result.ok) {
      onSignedIn(result.user)
      return
    }
    setIsSubmitting(false)
    setFieldErrors(result.fieldErrors)
    setErrorMessage(result.message)
  }

  async function handleContinueAsGuest() {
    setIsContinuingAsGuest(true)
    setGuestError(null)
    const result = await continueAsGuest()
    if (result.ok) {
      onSignedIn(result.user)
      return
    }
    setIsContinuingAsGuest(false)
    setGuestError(result.message)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4 max-sm:px-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">PersonligFinans</h1>
      </header>

      <main className="flex flex-col items-center gap-6 px-6 py-10 max-sm:px-4">
        <section
          aria-labelledby="credentials-heading"
          className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm max-sm:p-4"
        >
          <h2 id="credentials-heading" className="text-lg font-semibold text-slate-900">
            {current.label}
          </h2>

          {errorMessage && (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </p>
          )}

          {/* The server validates the email, so its message shows like every other field error. */}
          <form noValidate className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
            <Field label="Email" error={fieldErrors.email}>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClassName}
              />
            </Field>
            <Field label="Password" error={fieldErrors.password}>
              <input
                type="password"
                autoComplete={current.passwordAutoComplete}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={inputClassName}
              />
            </Field>
            {mode === 'signUp' && (
              <ConfirmPasswordField
                value={confirmPassword}
                onChange={setConfirmPassword}
                error={confirmPasswordMismatch}
              />
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isSubmitting ? current.submittingLabel : current.label}
            </button>
          </form>

          <p className="mt-4 text-center text-sm text-slate-600">
            {current.switchPrompt}
            <button type="button" onClick={switchMode} className="font-medium text-slate-900 underline">
              {MODES[current.other].label}
            </button>
          </p>
        </section>

        <section aria-label="Try as Guest" className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-sm text-slate-600">Or try the app first, without signing up.</p>
          <button
            type="button"
            onClick={() => void handleContinueAsGuest()}
            disabled={isContinuingAsGuest}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isContinuingAsGuest ? 'Continuing as Guest…' : 'Continue as Guest'}
          </button>
          {guestError && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {guestError}
            </p>
          )}
        </section>
      </main>
    </div>
  )
}
