import { useState, type FormEvent } from 'react'
import { logIn, register, type CredentialsFieldErrors, type User } from '../lib/api'
import { Field, inputClassName } from './TransactionForm'

// Everything that differs between logging in and registering. The form's heading and its submit
// button both say label, and the other Mode is offered after switchPrompt.
const MODES = {
  logIn: {
    label: 'Log in',
    submittingLabel: 'Logging in…',
    passwordAutoComplete: 'current-password',
    switchPrompt: 'New here? ',
    other: 'register',
    submit: logIn,
  },
  register: {
    label: 'Register',
    submittingLabel: 'Registering…',
    passwordAutoComplete: 'new-password',
    switchPrompt: 'Already registered? ',
    other: 'logIn',
    submit: register,
  },
} as const

type Mode = keyof typeof MODES

interface LandingPageProps {
  onSignedIn: (user: User) => void
}

// What a visitor who isn't signed in sees: what the app is, and a form to log in or, switched to,
// to register. The email typed in carries over when switching.
export function LandingPage({ onSignedIn }: LandingPageProps) {
  const [mode, setMode] = useState<Mode>('logIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<CredentialsFieldErrors>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const current = MODES[mode]

  function switchMode() {
    setMode(current.other)
    setFieldErrors({})
    setErrorMessage(null)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setIsSubmitting(true)
    setFieldErrors({})
    setErrorMessage(null)
    const result = await current.submit({ email, password })
    if (result.ok) {
      onSignedIn(result.user)
      return
    }
    setIsSubmitting(false)
    setFieldErrors(result.fieldErrors)
    setErrorMessage(result.message)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4 max-sm:px-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">PersonligFinans</h1>
      </header>

      <main className="flex flex-col items-center gap-6 px-6 py-10 max-sm:px-4">
        <p className="max-w-md text-center text-slate-600">
          Import your bank statements and receipts, and see what your money goes to.
        </p>

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
      </main>
    </div>
  )
}
