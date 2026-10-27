// Compares in the Norwegian alphabet, ignoring case, so Æ, Ø and Å come after Z whatever the
// browser's language.
export function norwegian(a: string, b: string) {
  return a.localeCompare(b, 'nb', { sensitivity: 'accent' })
}
