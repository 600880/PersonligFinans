import { useEffect, useState, type FormEvent } from 'react'
import {
  continueAsGuest,
  fetchPasswordReset,
  signIn,
  signUp,
  type CredentialsFieldErrors,
  type PasswordReset,
  type User,
} from '../lib/api'
import { confirmPasswordError } from '../lib/confirmPassword'
import { ConfirmPasswordField } from './ConfirmPasswordField'
import { PasswordResetForm } from './PasswordResetForm'
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

// The server's lockout message, which ends by saying to try again later, offering a Password reset
// as well, since a reset ends the lockout: "Try again later." becomes "Try again later, or reset
// your password."
function withResetOffer(lockoutMessage: string) {
  return `${lockoutMessage.replace(/\.$/, '')}, or reset your password.`
}

// What a visitor who isn't signed in sees: a form to sign in or, switched to, to sign up, and a
// way to try the app as the Guest, and, when Password reset is available, a way to ask for a link to
// choose a new password. The email typed in carries over when switching.
export function LandingPage({ onSignedIn }: LandingPageProps) {
  const [mode, setMode] = useState<Mode>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [confirmPasswordFieldError, setConfirmPasswordFieldError] = useState<string | undefined>()
  const [fieldErrors, setFieldErrors] = useState<CredentialsFieldErrors>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [guestError, setGuestError] = useState<string | null>(null)
  const [isContinuingAsGuest, setIsContinuingAsGuest] = useState(false)
  const current = MODES[mode]
  // Password reset, or null while unavailable, which it is until the server says otherwise.
  // Everything the landing page says about resetting a password depends on this alone.
  const [passwordReset, setPasswordReset] = useState<PasswordReset | null>(null)
  const [isAskingForReset, setIsAskingForReset] = useState(false)
  // Whether errorMessage says the email is locked after too many failed sign-ins.
  const [isLockedOut, setIsLockedOut] = useState(false)

  useEffect(() => {
    let ignore = false
    void fetchPasswordReset().then((reset) => {
      if (!ignore) setPasswordReset(reset)
    })
    return () => {
      ignore = true
    }
  }, [])

  function switchMode() {
    setMode(current.other)
    setConfirmPassword('')
    setConfirmPasswordFieldError(undefined)
    setFieldErrors({})
    setErrorMessage(null)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    setErrorMessage(null)
    // Signing up sends nothing until the confirm field matches the password.
    const mismatch = mode === 'signUp' ? confirmPasswordError(password, confirmPassword) : undefined
    setConfirmPasswordFieldError(mismatch)
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
    setIsLockedOut(result.lockedOut === true)
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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-4 max-sm:px-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">PersonligFinans</h1>
      </header>

      <main className="flex flex-col items-center gap-6 px-6 py-10 max-sm:px-4">
        {isAskingForReset && passwordReset && (
          <PasswordResetForm
            email={email}
            onEmailChange={setEmail}
            linkHours={passwordReset.linkHours}
            onBack={() => setIsAskingForReset(false)}
          />
        )}

        {/* Hidden rather than gone while asking for a reset, so going back finds Sign in as it was
            left. */}
        <section
          hidden={isAskingForReset}
          aria-labelledby="credentials-heading"
          className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm max-sm:p-4"
        >
          <h2 id="credentials-heading" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {current.label}
          </h2>

          {errorMessage && (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {isLockedOut && passwordReset ? withResetOffer(errorMessage) : errorMessage}
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
                error={confirmPasswordFieldError}
              />
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-slate-900 dark:bg-slate-100 px-4 py-2 text-sm font-medium text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-300 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
            >
              {isSubmitting ? current.submittingLabel : current.label}
            </button>
          </form>

          {mode === 'signIn' && passwordReset && (
            <p className="mt-3 text-center text-sm">
              <button
                type="button"
                onClick={() => setIsAskingForReset(true)}
                className="font-medium text-slate-900 dark:text-slate-100 underline"
              >
                Forgot your password?
              </button>
            </p>
          )}

          <p className="mt-4 text-center text-sm text-slate-600 dark:text-slate-400">
            {current.switchPrompt}
            <button type="button" onClick={switchMode} className="font-medium text-slate-900 dark:text-slate-100 underline">
              {MODES[current.other].label}
            </button>
          </p>
        </section>

        <section aria-label="Try as Guest" className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-sm text-slate-600 dark:text-slate-400">Or try the app first, without signing up.</p>
          <button
            type="button"
            onClick={() => void handleContinueAsGuest()}
            disabled={isContinuingAsGuest}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-medium text-slate-900 dark:text-slate-100 shadow-sm hover:bg-slate-100 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isContinuingAsGuest ? 'Continuing as Guest…' : 'Continue as Guest'}
          </button>
          {guestError && (
            <p role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {guestError}
            </p>
          )}
        </section>
      </main>
    </div>
  )
}
