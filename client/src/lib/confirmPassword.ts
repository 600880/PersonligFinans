// The error to show under a Confirm password field on submit, or undefined when it matches the
// password. Only the client checks this: the API takes one password.
export function confirmPasswordError(password: string, confirmPassword: string): string | undefined {
  return password === confirmPassword ? undefined : "Passwords don't match"
}
