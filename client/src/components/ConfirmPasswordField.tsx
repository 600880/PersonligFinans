import { Field, inputClassName } from './TransactionForm'

interface ConfirmPasswordFieldProps {
  value: string
  onChange: (value: string) => void
  error?: string
}

// The second password field of a form that sets a new password, so that a typo is caught before
// it leaves a User with a password they don't know. See confirmPasswordError for its check.
export function ConfirmPasswordField({ value, onChange, error }: ConfirmPasswordFieldProps) {
  return (
    <Field label="Confirm password" error={error}>
      <input
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClassName}
      />
    </Field>
  )
}
