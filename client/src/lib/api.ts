import { periodQuery, type Period } from './period'
import { spanQuery, type Span } from './span'
import type { CreateTransactionRequest, PossibleDuplicateQuery } from './transactionForm'

// Told when any call for the app's data answers 401, which means the sign-in has ended: it expired,
// or the User signed out elsewhere. The app then goes back to its landing page.
let handleSignedOut: (() => void) | null = null

export function setSignedOutHandler(handler: (() => void) | null) {
  handleSignedOut = handler
}

// fetch for the app's data, which needs a signed-in User. The browser sends the sign-in cookie
// itself, since the API has the same origin as the app.
async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init)
  if (response.status === 401) {
    forgetAntiforgeryToken()
    handleSignedOut?.()
  }
  return response
}

// The header the multipart forms (a Bank Statement's Upload and reading a Receipt) send the
// antiforgery token in.
const ANTIFORGERY_HEADER = 'X-CSRF-TOKEN'

// The antiforgery token the multipart forms send, fetched at the first one after signing in, since the
// server binds it to the signed-in User. null until then, and again whenever who is signed in may
// have changed.
let antiforgeryToken: Promise<string> | null = null

function forgetAntiforgeryToken() {
  antiforgeryToken = null
}

function currentAntiforgeryToken(): Promise<string> {
  antiforgeryToken ??= (async () => {
    const response = await apiFetch('/api/antiforgery-token')
    if (!response.ok) throw new Error(`Loading the antiforgery token failed (${response.status})`)
    return ((await response.json()) as { token: string }).token
  })().catch((error: unknown) => {
    // A failed fetch is tried again at the next form rather than kept.
    forgetAntiforgeryToken()
    throw error
  })
  return antiforgeryToken
}

// Posts a multipart form, which the server only accepts with the antiforgery token. A token it
// refuses (403), for example one given before the server's keys changed, is replaced by a fresh one
// and the form sent once more.
async function postForm(url: string, body: FormData): Promise<Response> {
  const send = async () =>
    apiFetch(url, { method: 'POST', headers: { [ANTIFORGERY_HEADER]: await currentAntiforgeryToken() }, body })

  const response = await send()
  if (response.status !== 403) return response
  forgetAntiforgeryToken()
  return send()
}

// The problem a request was refused with: the first message for each field of a validation problem,
// keyed on the field, and the detail of any other problem. A body that isn't a problem gives neither.
async function readProblem<Request = object>(
  response: Response,
): Promise<{ fieldErrors: Partial<Record<keyof Request, string>>; detail: string | null }> {
  const problem = (await response.json().catch(() => null)) as {
    detail?: string
    errors?: Record<string, string[]>
  } | null
  const fieldErrors: Partial<Record<keyof Request, string>> = {}
  for (const [field, messages] of Object.entries(problem?.errors ?? {})) {
    fieldErrors[field as keyof Request] = messages[0]
  }
  return { fieldErrors, detail: problem?.detail ?? null }
}

// The signed-in User, by the email they signed up with, and whether they are the Guest.
export interface User {
  email: string
  isGuest: boolean
}

// Who is signed in, or null when nobody is.
export async function fetchCurrentUser(): Promise<User | null> {
  forgetAntiforgeryToken()
  const response = await fetch('/api/user')
  if (response.status === 401) return null
  if (!response.ok) throw new Error(`Loading who is signed in failed (${response.status})`)
  return (await response.json()) as User
}

export interface CredentialsRequest {
  email: string
  password: string
}

export type CredentialsFieldErrors = Partial<Record<keyof CredentialsRequest, string>>

// lockedOut is true when the email is locked after too many failed sign-ins.
export type SubmitCredentialsResult =
  | { ok: true; user: User }
  | { ok: false; fieldErrors: CredentialsFieldErrors; message: string | null; lockedOut?: boolean }

// A wrong email or password gets one message that doesn't say which was wrong; a locked email gets
// a message of its own.
export function signIn(request: CredentialsRequest): Promise<SubmitCredentialsResult> {
  return submitCredentials('/api/user/sign-in', request, 'Signing in')
}

// Creates a User and signs it in. An email in use, an invalid email or a short password gets a
// field error.
export function signUp(request: CredentialsRequest): Promise<SubmitCredentialsResult> {
  return submitCredentials('/api/user/sign-up', request, 'Signing up')
}

// Posts the body as JSON to an endpoint that signs someone in, or null when the server couldn't be
// reached. Who is signed in changes when it succeeds, so the antiforgery token is forgotten.
async function postSignIn(url: string, body: object): Promise<Response | null> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (response.ok) forgetAntiforgeryToken()
    return response
  } catch {
    return null
  }
}

const UNREACHABLE = 'Could not reach the server.'

// action names what failed, e.g. "Signing in", for an answer that isn't a problem.
async function submitCredentials(
  url: string,
  request: CredentialsRequest,
  action: string,
): Promise<SubmitCredentialsResult> {
  const response = await postSignIn(url, request)
  if (!response) return { ok: false, fieldErrors: {}, message: UNREACHABLE }
  if (response.ok) return { ok: true, user: (await response.json()) as User }

  // 400 is a validation problem keyed on the fields. 401 is a wrong email or password, and 429 a
  // locked email: problems whose detail says which.
  if (response.status === 400 || response.status === 401 || response.status === 429) {
    const { fieldErrors, detail } = await readProblem<CredentialsRequest>(response)
    if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, message: null }
    if (detail) return { ok: false, fieldErrors: {}, message: detail, lockedOut: response.status === 429 }
  }

  return { ok: false, fieldErrors: {}, message: `${action} failed (${response.status}).` }
}

export type ContinueAsGuestResult = { ok: true; user: User } | { ok: false; message: string }

// Signs in as the Guest, the one User every visitor shares. Sent as JSON, which the server requires
// so that another site's form can't sign its visitors in as the Guest.
export async function continueAsGuest(): Promise<ContinueAsGuestResult> {
  const response = await postSignIn('/api/user/continue-as-guest', {})
  if (!response) return { ok: false, message: UNREACHABLE }
  if (!response.ok) return { ok: false, message: `Continuing as Guest failed (${response.status}).` }
  return { ok: true, user: (await response.json()) as User }
}

// linkHours is how long a link to choose a new password works.
export interface PasswordReset {
  linkHours: number
}

// Password reset when it is available, meaning the server can send email, or null. Anything but a
// clear yes, a server that can't be reached included, counts as unavailable, so the landing page
// never offers a reset that can't work.
export async function fetchPasswordReset(): Promise<PasswordReset | null> {
  try {
    const response = await fetch('/api/user/password-reset/availability')
    if (!response.ok) return null
    const { available, linkHours } = (await response.json()) as { available: boolean; linkHours: number }
    return available === true ? { linkHours } : null
  } catch {
    return null
  }
}

export type RequestPasswordResetResult =
  | { ok: true }
  | { ok: false; fieldErrors: { email?: string }; message: string | null }

// Asks for a link to choose a new password to be emailed. The server answers the same for every
// email, whether or not it is a User's, so success says only that the request was taken. Sent as
// JSON, which the server requires, like Sign in.
export async function requestPasswordReset(email: string): Promise<RequestPasswordResetResult> {
  let response: Response
  try {
    response = await fetch('/api/user/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
  } catch {
    return { ok: false, fieldErrors: {}, message: UNREACHABLE }
  }
  if (response.ok) return { ok: true }

  // 400 is a validation problem for the email, and 503 means email can't be sent at all.
  if (response.status === 400) {
    const { fieldErrors } = await readProblem<{ email: string }>(response)
    if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, message: null }
  }
  if (response.status === 503) return { ok: false, fieldErrors: {}, message: 'Password reset is unavailable.' }
  return { ok: false, fieldErrors: {}, message: `Sending the link failed (${response.status}).` }
}

// The email and token from the link in a reset email, the token as the link holds it, and the new
// password.
export interface NewPasswordRequest {
  email: string
  token: string
  password: string
}

// expired is true for a link that can't reset a password: the server says only that it has expired
// or was already used, never which, nor whether the email is a User's.
export type ChooseNewPasswordResult =
  | { ok: true; user: User }
  | { ok: false; expired: true }
  | { ok: false; expired: false; fieldErrors: { password?: string }; message: string | null }

// Sets the new password and signs in as the User, replacing whoever was signed in. Sent as JSON,
// which the server requires, like Sign in.
export async function chooseNewPassword(request: NewPasswordRequest): Promise<ChooseNewPasswordResult> {
  const response = await postSignIn('/api/user/password-reset/new-password', request)
  if (!response) return { ok: false, expired: false, fieldErrors: {}, message: UNREACHABLE }
  if (response.ok) return { ok: true, user: (await response.json()) as User }

  // 410 is a link that has expired or was already used. 400 is a validation problem, which for a
  // link's email and token can only be a password the server refused, and 503 means Password reset
  // is unavailable.
  if (response.status === 410) return { ok: false, expired: true }
  if (response.status === 400) {
    const { fieldErrors } = await readProblem<{ password: string }>(response)
    if (fieldErrors.password) return { ok: false, expired: false, fieldErrors, message: null }
  }
  if (response.status === 503) {
    return { ok: false, expired: false, fieldErrors: {}, message: 'Password reset is unavailable.' }
  }
  return { ok: false, expired: false, fieldErrors: {}, message: `Setting the new password failed (${response.status}).` }
}

export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; fieldErrors: Partial<Record<keyof ChangePasswordRequest, string>>; message: string | null }

// Changes the signed-in User's password, which keeps this browser signed in and signs the User out
// everywhere else. A wrong current password or a new one that breaks Sign up's rules gets a field
// error, and a locked email gets Sign in's message. Sent as JSON, which the server requires, like
// Sign in.
export async function changePassword(request: ChangePasswordRequest): Promise<ChangePasswordResult> {
  let response: Response
  try {
    response = await apiFetch('/api/user/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch {
    return { ok: false, fieldErrors: {}, message: UNREACHABLE }
  }
  if (response.ok) return { ok: true }

  // 400 is a validation problem keyed on the fields, and 429 a locked email, whose detail says so.
  if (response.status === 400 || response.status === 429) {
    const { fieldErrors, detail } = await readProblem<ChangePasswordRequest>(response)
    if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, message: null }
    if (detail) return { ok: false, fieldErrors: {}, message: detail }
  }
  return { ok: false, fieldErrors: {}, message: `Changing the password failed (${response.status}).` }
}

export type DeleteYourUserResult =
  | { ok: true }
  | { ok: false; fieldErrors: { password?: string }; message: string | null }

// Deletes the signed-in User and everything it owns, for good, given its password, and signs this
// browser out. A wrong password gets a field error, and a locked email gets Sign in's message. Sent
// as JSON, which the server requires, like Sign in.
export async function deleteYourUser(password: string): Promise<DeleteYourUserResult> {
  let response: Response
  try {
    response = await apiFetch('/api/user/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
  } catch {
    return { ok: false, fieldErrors: {}, message: UNREACHABLE }
  }
  if (response.ok) {
    forgetAntiforgeryToken()
    return { ok: true }
  }

  // 400 is a validation problem for the password, and 429 a locked email, whose detail says so.
  if (response.status === 400 || response.status === 429) {
    const { fieldErrors, detail } = await readProblem<{ password: string }>(response)
    if (fieldErrors.password) return { ok: false, fieldErrors, message: null }
    if (detail) return { ok: false, fieldErrors: {}, message: detail }
  }
  return { ok: false, fieldErrors: {}, message: `Deleting the User failed (${response.status}).` }
}

// Ends the sign-in. Resolves false when the server couldn't be told, so the User is still signed in.
export async function signOut(): Promise<boolean> {
  try {
    const response = await fetch('/api/user/sign-out', { method: 'POST' })
    if (response.ok) forgetAntiforgeryToken()
    return response.ok
  } catch {
    return false
  }
}

// colour is what the Dashboard draws the Category in, as #rrggbb. transactionCount and ruleCount are
// how many Transactions and Categorization Rules have the Category.
export interface Category {
  id: number
  name: string
  description: string
  colour: string
  builtIn: boolean
  transactionCount: number
  ruleCount: number
}

export type FieldErrors = Partial<Record<keyof CreateTransactionRequest, string>>

export type CreateTransactionResult =
  | { ok: true }
  | { ok: false; fieldErrors: FieldErrors; message: string | null }

export async function fetchCategories(): Promise<Category[]> {
  const response = await apiFetch('/api/categories')
  if (!response.ok) throw new Error(`Loading categories failed (${response.status})`)
  return (await response.json()) as Category[]
}

// alreadyDeleted: the Category was gone before this delete, so nothing changed.
export type DeleteCategoryResult =
  | { ok: true; alreadyDeleted: boolean; transactionsChanged: number }
  | { ok: false; message: string }

// What happens to what uses the Category being deleted. A Category in use needs one of the two:
// moveToReplacement, which moves its Categorization Rules and Transactions to another Category, or
// deleteRules, which deletes its rules and leaves its Transactions to the remaining rules, or
// Uncategorized. One nothing uses needs neither.
export type DeleteCategoryChoice =
  | { kind: 'unused' }
  | { kind: 'moveToReplacement'; replacementCategoryId: number }
  | { kind: 'deleteRules' }

// Deletes a Category. The server refuses a Built-in Category, one in use without a choice, or a
// replacement that isn't another existing Category, and the message says why.
export async function deleteCategory(
  id: number,
  choice: DeleteCategoryChoice = { kind: 'unused' },
): Promise<DeleteCategoryResult> {
  const query = new URLSearchParams()
  if (choice.kind === 'moveToReplacement') query.set('replacementCategoryId', String(choice.replacementCategoryId))
  if (choice.kind === 'deleteRules') query.set('deleteRules', 'true')
  const search = query.toString() ? `?${query}` : ''

  let response: Response
  try {
    response = await apiFetch(`/api/categories/${id}${search}`, { method: 'DELETE' })
  } catch {
    return { ok: false, message: 'Could not reach the server.' }
  }

  if (response.ok) {
    const { transactionsChanged } = (await response.json()) as { transactionsChanged: number }
    return { ok: true, alreadyDeleted: false, transactionsChanged }
  }

  if (response.status === 404) return { ok: true, alreadyDeleted: true, transactionsChanged: 0 }

  if (response.status === 400) {
    const { fieldErrors } = await readProblem<Record<string, unknown>>(response)
    const message = Object.values(fieldErrors)[0]
    if (message) return { ok: false, message }
  }

  return { ok: false, message: `Deleting failed (${response.status}).` }
}

export interface CategoryRequest {
  name: string
  description: string
}

export type CategoryFieldErrors = Partial<Record<keyof CategoryRequest, string>>

export type SaveCategoryResult =
  | { ok: true; category: Category }
  | { ok: false; fieldErrors: CategoryFieldErrors; message: string | null }

export function addCategory(request: CategoryRequest): Promise<SaveCategoryResult> {
  return saveCategory('/api/categories', 'POST', request)
}

// A Built-in Category must be sent with its name unchanged.
export function editCategory(id: number, request: CategoryRequest): Promise<SaveCategoryResult> {
  return saveCategory(`/api/categories/${id}`, 'PUT', request)
}

async function saveCategory(
  url: string,
  method: 'POST' | 'PUT',
  request: CategoryRequest,
): Promise<SaveCategoryResult> {
  let response: Response
  try {
    response = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch {
    return { ok: false, fieldErrors: {}, message: 'Could not reach the server.' }
  }

  if (response.ok) return { ok: true, category: (await response.json()) as Category }

  if (response.status === 400) {
    const { fieldErrors } = await readProblem<CategoryRequest>(response)
    if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, message: null }
  }

  return { ok: false, fieldErrors: {}, message: `Saving failed (${response.status}).` }
}

// A named group the User files Bookmarks in, such as "Tax deductible".
export interface Folder {
  id: number
  name: string
}

// The User's Folders, by name in the Norwegian alphabet, ignoring case.
export async function fetchFolders(): Promise<Folder[]> {
  const response = await apiFetch('/api/folders')
  if (!response.ok) throw new Error(`Loading folders failed (${response.status})`)
  return (await response.json()) as Folder[]
}

export type FolderFieldErrors = { name?: string }

export type SaveFolderResult =
  | { ok: true; folder: Folder }
  | { ok: false; fieldErrors: FolderFieldErrors; message: string | null }

// Creates a Folder. The server refuses a blank name, one already used ignoring case, or "Bookmarks",
// with a field error on the name.
export function addFolder(name: string): Promise<SaveFolderResult> {
  return saveFolder('/api/folders', 'POST', name)
}

// Renames a Folder, with the same rules as creating one, except that its own name isn't taken, so
// only its letter case can change.
export function renameFolder(id: number, name: string): Promise<SaveFolderResult> {
  return saveFolder(`/api/folders/${id}`, 'PUT', name)
}

async function saveFolder(url: string, method: 'POST' | 'PUT', name: string): Promise<SaveFolderResult> {
  let response: Response
  try {
    response = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
  } catch {
    return { ok: false, fieldErrors: {}, message: 'Could not reach the server.' }
  }

  if (response.ok) return { ok: true, folder: (await response.json()) as Folder }

  if (response.status === 400) {
    const { fieldErrors } = await readProblem<{ name: string }>(response)
    if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, message: null }
  }

  return { ok: false, fieldErrors: {}, message: `Saving failed (${response.status}).` }
}

// alreadyDeleted: the Folder was gone before this delete, so nothing changed.
export type DeleteFolderResult = { ok: true; alreadyDeleted: boolean } | { ok: false; message: string }

// Deletes a Folder and the Bookmarks in it, but never their Transactions.
export async function deleteFolder(id: number): Promise<DeleteFolderResult> {
  let response: Response
  try {
    response = await apiFetch(`/api/folders/${id}`, { method: 'DELETE' })
  } catch {
    return { ok: false, message: 'Could not reach the server.' }
  }

  if (response.ok) return { ok: true, alreadyDeleted: false }

  if (response.status === 404) return { ok: true, alreadyDeleted: true }

  return { ok: false, message: `Deleting failed (${response.status}).` }
}

// The bookmarked Transactions in the Folder, from any date, newest first.
export async function fetchFolderBookmarks(folderId: number): Promise<Transaction[]> {
  const response = await apiFetch(`/api/bookmarks?folderId=${folderId}`)
  if (!response.ok) throw new Error(`Loading bookmarks failed (${response.status})`)
  return (await response.json()) as Transaction[]
}

// categoryId is null for an Uncategorized Transaction. locked is set when the Categorization Rules
// will never change its Category: it was entered manually, or its Category was chosen manually.
// imported is set when it came from a Bank Statement, so it can't be deleted. bookmarked is set when
// the User has put a Bookmark on it.
export interface Transaction {
  id: number
  date: string
  description: string
  amount: number
  note: string | null
  categoryId: number | null
  locked: boolean
  imported: boolean
  bookmarked: boolean
}

export interface TransactionMonth {
  year: number
  month: number
}

// The months that have at least one Transaction, newest first.
export async function fetchTransactionMonths(): Promise<TransactionMonth[]> {
  const response = await apiFetch('/api/transactions/months')
  if (!response.ok) throw new Error(`Loading months failed (${response.status})`)
  return (await response.json()) as TransactionMonth[]
}

// The Transactions endpoint lists a year or a month, not a quarter.
export type YearOrMonth = Exclude<Period, { granularity: 'quarter' }>

export async function fetchTransactions(period: YearOrMonth): Promise<Transaction[]> {
  const response = await apiFetch(`/api/transactions?${periodQuery(period)}`)
  if (!response.ok) throw new Error(`Loading transactions failed (${response.status})`)
  return (await response.json()) as Transaction[]
}

// categoryId is null for the Uncategorized slice. Amounts are positive.
export interface SpendingSlice {
  categoryId: number | null
  amount: number
}

// A Period's Spending: the total and one slice per group with Spending, largest first.
export interface Spending {
  total: number
  slices: SpendingSlice[]
}

// Transactions in the Transfers Category count only when includeTransfers is set.
export async function fetchSpending(period: Period, includeTransfers: boolean): Promise<Spending> {
  const transfers = includeTransfers ? '&includeTransfers=true' : ''
  const response = await apiFetch(`/api/spending?${periodQuery(period)}${transfers}`)
  if (!response.ok) throw new Error(`Loading spending failed (${response.status})`)
  return (await response.json()) as Spending
}

// One month of a Span's Spending: one slice per group with Spending, largest first, and none for a
// month without Spending.
export interface MonthSpending {
  year: number
  month: number
  slices: SpendingSlice[]
}

// A Span's Spending month by month, one entry per month of the Span in order. Transactions in the
// Transfers Category count only when includeTransfers is set.
export async function fetchMonthlySpending(span: Span, includeTransfers: boolean): Promise<MonthSpending[]> {
  const transfers = includeTransfers ? '&includeTransfers=true' : ''
  const response = await apiFetch(`/api/spending/monthly?${spanQuery(span)}${transfers}`)
  if (!response.ok) throw new Error(`Loading monthly spending failed (${response.status})`)
  return (await response.json()) as MonthSpending[]
}

export type ChangeCategoryResult = { ok: true; transaction: Transaction } | { ok: false; message: string }

// Categorizes the Transaction manually: for an imported one, rules never change it again.
export async function changeTransactionCategory(
  id: number,
  categoryId: number,
): Promise<ChangeCategoryResult> {
  let response: Response
  try {
    response = await apiFetch(`/api/transactions/${id}/category`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId }),
    })
  } catch {
    return { ok: false, message: 'Could not reach the server.' }
  }

  if (response.ok) return { ok: true, transaction: (await response.json()) as Transaction }

  return { ok: false, message: `Saving failed (${response.status}).` }
}

export type ChangeNoteResult = { ok: true; transaction: Transaction } | { ok: false; message: string }

// Sets or clears the Note on any Transaction — imported or manual. Blank clears it.
export async function changeTransactionNote(id: number, note: string | null): Promise<ChangeNoteResult> {
  let response: Response
  try {
    response = await apiFetch(`/api/transactions/${id}/note`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    })
  } catch {
    return { ok: false, message: 'Could not reach the server.' }
  }

  if (response.ok) return { ok: true, transaction: (await response.json()) as Transaction }

  return { ok: false, message: `Saving failed (${response.status}).` }
}

// alreadyDeleted: the Transaction was gone before this delete, so nothing changed.
export type DeleteTransactionResult = { ok: true; alreadyDeleted: boolean } | { ok: false; message: string }

// Deletes a manually-entered Transaction for good; the server refuses an imported one.
export async function deleteTransaction(id: number): Promise<DeleteTransactionResult> {
  let response: Response
  try {
    response = await apiFetch(`/api/transactions/${id}`, { method: 'DELETE' })
  } catch {
    return { ok: false, message: 'Could not reach the server.' }
  }

  if (response.ok) return { ok: true, alreadyDeleted: false }

  if (response.status === 404) return { ok: true, alreadyDeleted: true }

  // 409 is a problem whose detail says why the Transaction can't be deleted.
  if (response.status === 409) {
    const { detail } = await readProblem(response)
    if (detail) return { ok: false, message: detail }
  }

  return { ok: false, message: `Deleting failed (${response.status}).` }
}

// folderId is the Folder the Bookmark is filed in, or null for none.
export type AddBookmarkResult = { ok: true; folderId: number | null } | { ok: false }

// Bookmarks the Transaction in the User's last used folder. One already bookmarked is left as it is,
// in its Folder.
export async function addBookmark(id: number): Promise<AddBookmarkResult> {
  try {
    const response = await apiFetch(`/api/transactions/${id}/bookmark`, { method: 'POST' })
    if (!response.ok) return { ok: false }
    const { folderId } = (await response.json()) as { folderId: number | null }
    return { ok: true, folderId }
  } catch {
    return { ok: false }
  }
}

export type FileBookmarkResult = { ok: true } | { ok: false; message: string }

const FILE_BOOKMARK_ERROR = 'Could not move the bookmark.'

// Files the Transaction's Bookmark in the Folder, or in none for null, bookmarking it if it isn't,
// and makes that the User's last used folder. A Folder deleted meanwhile, for example by another
// visitor using the Guest, is refused with the server's message saying so.
export async function fileBookmark(id: number, folderId: number | null): Promise<FileBookmarkResult> {
  let response: Response
  try {
    response = await apiFetch(`/api/transactions/${id}/bookmark`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId }),
    })
  } catch {
    return { ok: false, message: FILE_BOOKMARK_ERROR }
  }

  if (response.ok) return { ok: true }

  if (response.status === 400) {
    const { fieldErrors } = await readProblem<{ folderId: number }>(response)
    if (fieldErrors.folderId) return { ok: false, message: fieldErrors.folderId }
  }

  return { ok: false, message: FILE_BOOKMARK_ERROR }
}

// Removes the Transaction's Bookmark, if it has one. Resolves false when it couldn't be removed.
export async function removeBookmark(id: number): Promise<boolean> {
  try {
    const response = await apiFetch(`/api/transactions/${id}/bookmark`, { method: 'DELETE' })
    return response.ok
  } catch {
    return false
  }
}

// The bookmarked Transactions in no Folder, from any date, newest first.
export async function fetchBookmarks(): Promise<Transaction[]> {
  const response = await apiFetch('/api/bookmarks')
  if (!response.ok) throw new Error(`Loading bookmarks failed (${response.status})`)
  return (await response.json()) as Transaction[]
}

// An existing Transaction, imported or manually-entered, with the same Amount and a posted date
// within three days of one being entered.
export interface PossibleDuplicate {
  id: number
  date: string
  description: string
  amount: number
}

// The Possible duplicates of a Transaction on the query's date with its signed Amount, oldest first.
export async function fetchPossibleDuplicates({ date, amount }: PossibleDuplicateQuery): Promise<PossibleDuplicate[]> {
  const search = new URLSearchParams({ date, amount: String(amount) })
  const response = await apiFetch(`/api/transactions/possible-duplicates?${search}`)
  if (!response.ok) throw new Error(`Checking for possible duplicates failed (${response.status})`)
  return (await response.json()) as PossibleDuplicate[]
}

export async function createTransaction(
  request: CreateTransactionRequest,
): Promise<CreateTransactionResult> {
  let response: Response
  try {
    response = await apiFetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch {
    return { ok: false, fieldErrors: {}, message: 'Could not reach the server.' }
  }

  if (response.ok) return { ok: true }

  if (response.status === 400) {
    const { fieldErrors } = await readProblem<CreateTransactionRequest>(response)
    if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, message: null }
  }

  return { ok: false, fieldErrors: {}, message: `Saving failed (${response.status}).` }
}

// aiCategorizationUnavailable: the LLM was asked for rules for the unmatched rows but couldn't answer.
// dailyAiLimitReached: the LLM wasn't asked, because the Daily AI limit was reached.
export interface ImportedBankStatement {
  id: number
  accountNumber: string
  periodStart: string
  periodEnd: string
  transactionCount: number
  uncategorizedCount: number
  aiCategorizationUnavailable: boolean
  dailyAiLimitReached: boolean
}

export type UploadBankStatementResult =
  | { ok: true; statement: ImportedBankStatement }
  | { ok: false; message: string }

// uploadId: shared by every Bank Statement picked together in one Upload.
export async function uploadBankStatement(file: File, uploadId: string): Promise<UploadBankStatementResult> {
  const body = new FormData()
  body.append('file', file)
  body.append('uploadId', uploadId)

  let response: Response
  try {
    response = await postForm('/api/bank-statements', body)
  } catch {
    return { ok: false, message: 'Could not reach the server.' }
  }

  if (response.ok) return { ok: true, statement: (await response.json()) as ImportedBankStatement }

  // 400 is a validation problem keyed on "file"; 409 is a problem whose detail explains the conflict.
  if (response.status === 400 || response.status === 409) {
    const { fieldErrors, detail } = await readProblem<{ file: File }>(response)
    const message = fieldErrors.file ?? detail
    if (message) return { ok: false, message }
  }

  return { ok: false, message: `Upload failed (${response.status}).` }
}

// A Bank Statement as the User's list shows it. importedOn is the date in Norway it was imported.
export interface ListedBankStatement {
  id: number
  accountNumber: string
  periodStart: string
  periodEnd: string
  importedOn: string
  transactionCount: number
}

// The User's Bank Statements, newest period first.
export async function fetchBankStatements(): Promise<ListedBankStatement[]> {
  const response = await apiFetch('/api/bank-statements')
  if (!response.ok) throw new Error(`Loading Bank Statements failed (${response.status})`)
  return (await response.json()) as ListedBankStatement[]
}

export type DeleteBankStatementsResult = { ok: true; bankStatementsDeleted: number } | { ok: false; message: string }

// Deletes the Bank Statements with their Transactions, all or none. The server refuses an empty set,
// or one with a Bank Statement that no longer exists, and the message says why.
export async function deleteBankStatements(ids: number[]): Promise<DeleteBankStatementsResult> {
  let response: Response
  try {
    response = await apiFetch('/api/bank-statements/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
  } catch {
    return { ok: false, message: 'Could not reach the server.' }
  }

  if (response.ok) {
    const { bankStatementsDeleted } = (await response.json()) as { bankStatementsDeleted: number }
    return { ok: true, bankStatementsDeleted }
  }

  if (response.status === 400) {
    const { fieldErrors } = await readProblem<{ ids: number[] }>(response)
    if (fieldErrors.ids) return { ok: false, message: fieldErrors.ids }
  }

  return { ok: false, message: `Deleting failed (${response.status}).` }
}

// What the User page's confirm dialogs ask with. transactionCount: every Transaction of the User,
// manually-entered and imported.
export interface DeleteCounts {
  transactionCount: number
}

export async function fetchDeleteCounts(): Promise<DeleteCounts> {
  const response = await apiFetch('/api/user/delete-counts')
  if (!response.ok) throw new Error(`Loading the counts failed (${response.status})`)
  return (await response.json()) as DeleteCounts
}

export type DeleteAllTransactionsResult = { ok: true; transactionsDeleted: number } | { ok: false; message: string }

// Deletes every Transaction of the User, and so every Bank Statement too.
export async function deleteAllTransactions(): Promise<DeleteAllTransactionsResult> {
  let response: Response
  try {
    response = await apiFetch('/api/transactions', { method: 'DELETE' })
  } catch {
    return { ok: false, message: 'Could not reach the server.' }
  }

  if (!response.ok) return { ok: false, message: `Deleting failed (${response.status}).` }
  const { transactionsDeleted } = (await response.json()) as { transactionsDeleted: number }
  return { ok: true, transactionsDeleted }
}

// read: the receipt reader read the Receipt. unreadable: it couldn't. unavailable: no receipt reader
// is configured. limitReached: the reader wasn't asked, because the Daily AI limit was reached.
export type ReceiptOutcome = 'read' | 'unreadable' | 'unavailable' | 'limitReached'

// What a manually-entered Transaction from one Receipt should start from. amount is signed: negative
// for a purchase, positive for a refund. Every field is null unless the outcome is read.
export interface ReceiptSuggestion {
  outcome: ReceiptOutcome
  date: string | null
  description: string | null
  amount: number | null
  categoryId: number | null
}

const UNREADABLE: ReceiptSuggestion = {
  outcome: 'unreadable',
  date: null,
  description: null,
  amount: null,
  categoryId: null,
}

// Asks the server to read one Receipt's image. Never rejects: a Receipt the server refuses, or that
// can't be sent, is treated as unreadable.
export async function readReceipt(file: File): Promise<ReceiptSuggestion> {
  const body = new FormData()
  body.append('file', file)

  try {
    const response = await postForm('/api/receipts/read', body)
    if (!response.ok) return UNREADABLE
    return (await response.json()) as ReceiptSuggestion
  } catch {
    return UNREADABLE
  }
}

// aiGenerated: created by an LLM during import rather than by hand. Only records where the rule
// came from; the rule otherwise behaves like any other.
// isNew: added by the most recent Upload that imported a Bank Statement; editing keeps it.
export interface CategorizationRule {
  id: number
  keyword: string
  categoryId: number
  aiGenerated: boolean
  isNew: boolean
}

export interface CategorizationRuleRequest {
  keyword: string
  categoryId: number | null
}

export type RuleFieldErrors = Partial<Record<keyof CategorizationRuleRequest, string>>

export type SaveRuleResult =
  | { ok: true; rule: CategorizationRule; transactionsChanged: number }
  | { ok: false; fieldErrors: RuleFieldErrors; message: string | null }

// alreadyDeleted: the rule was gone before this delete, so nothing changed.
export type DeleteRuleResult =
  | { ok: true; alreadyDeleted: boolean; transactionsChanged: number }
  | { ok: false; message: string }

export async function fetchRules(): Promise<CategorizationRule[]> {
  const response = await apiFetch('/api/categorization-rules')
  if (!response.ok) throw new Error(`Loading rules failed (${response.status})`)
  return (await response.json()) as CategorizationRule[]
}

export function addRule(request: CategorizationRuleRequest): Promise<SaveRuleResult> {
  return saveRule('/api/categorization-rules', 'POST', request)
}

export function editRule(id: number, request: CategorizationRuleRequest): Promise<SaveRuleResult> {
  return saveRule(`/api/categorization-rules/${id}`, 'PUT', request)
}

export async function deleteRule(id: number): Promise<DeleteRuleResult> {
  let response: Response
  try {
    response = await apiFetch(`/api/categorization-rules/${id}`, { method: 'DELETE' })
  } catch {
    return { ok: false, message: 'Could not reach the server.' }
  }

  if (response.ok) {
    const { transactionsChanged } = (await response.json()) as { transactionsChanged: number }
    return { ok: true, alreadyDeleted: false, transactionsChanged }
  }

  if (response.status === 404) return { ok: true, alreadyDeleted: true, transactionsChanged: 0 }

  return { ok: false, message: `Deleting failed (${response.status}).` }
}

async function saveRule(
  url: string,
  method: 'POST' | 'PUT',
  request: CategorizationRuleRequest,
): Promise<SaveRuleResult> {
  let response: Response
  try {
    response = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch {
    return { ok: false, fieldErrors: {}, message: 'Could not reach the server.' }
  }

  if (response.ok) {
    const { transactionsChanged, ...rule } = (await response.json()) as CategorizationRule & {
      transactionsChanged: number
    }
    return { ok: true, rule, transactionsChanged }
  }

  if (response.status === 400) {
    const { fieldErrors } = await readProblem<CategorizationRuleRequest>(response)
    if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, message: null }
  }

  return { ok: false, fieldErrors: {}, message: `Saving failed (${response.status}).` }
}
