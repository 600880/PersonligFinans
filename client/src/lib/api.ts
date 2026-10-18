import { periodQuery, type Period } from './period'
import { spanQuery, type Span } from './span'
import type { CreateTransactionRequest, PossibleDuplicateQuery } from './transactionForm'

// Told when any call for the app's data answers 401, which means the sign-in has ended: it expired,
// or the User logged out elsewhere. The app then goes back to its landing page.
let handleSignedOut: (() => void) | null = null

export function setSignedOutHandler(handler: (() => void) | null) {
  handleSignedOut = handler
}

// fetch for the app's data, which needs a signed-in User. The browser sends the sign-in cookie
// itself, since the API has the same origin as the app.
async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init)
  if (response.status === 401) handleSignedOut?.()
  return response
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

// The signed-in User, by the email they registered with.
export interface User {
  email: string
}

// Who is signed in, or null when nobody is.
export async function fetchCurrentUser(): Promise<User | null> {
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

export type SubmitCredentialsResult =
  | { ok: true; user: User }
  | { ok: false; fieldErrors: CredentialsFieldErrors; message: string | null }

// A wrong email or password gets one message that doesn't say which was wrong; a locked email gets
// a message of its own.
export function logIn(request: CredentialsRequest): Promise<SubmitCredentialsResult> {
  return submitCredentials('/api/user/log-in', request, 'Logging in')
}

// Creates a User and signs it in. A registered email, an invalid email or a short password gets a
// field error.
export function register(request: CredentialsRequest): Promise<SubmitCredentialsResult> {
  return submitCredentials('/api/user/register', request, 'Registering')
}

// action names what failed, e.g. "Logging in", for an answer that isn't a problem.
async function submitCredentials(
  url: string,
  request: CredentialsRequest,
  action: string,
): Promise<SubmitCredentialsResult> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch {
    return { ok: false, fieldErrors: {}, message: 'Could not reach the server.' }
  }

  if (response.ok) return { ok: true, user: (await response.json()) as User }

  // 400 is a validation problem keyed on the fields. 401 is a wrong email or password, and 429 a
  // locked email: problems whose detail says which.
  if (response.status === 400 || response.status === 401 || response.status === 429) {
    const { fieldErrors, detail } = await readProblem<CredentialsRequest>(response)
    if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, message: null }
    if (detail) return { ok: false, fieldErrors: {}, message: detail }
  }

  return { ok: false, fieldErrors: {}, message: `${action} failed (${response.status}).` }
}

// Ends the sign-in. Resolves false when the server couldn't be told, so the User is still signed in.
export async function logOut(): Promise<boolean> {
  try {
    const response = await fetch('/api/user/log-out', { method: 'POST' })
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

// categoryId is null for an Uncategorized Transaction. locked is set when the Categorization Rules
// will never change its Category: it was entered manually, or its Category was chosen manually.
// imported is set when it came from a Bank Statement, so it can't be deleted.
export interface Transaction {
  id: number
  date: string
  description: string
  amount: number
  note: string | null
  categoryId: number | null
  locked: boolean
  imported: boolean
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

export interface ImportedBankStatement {
  id: number
  accountNumber: string
  periodStart: string
  periodEnd: string
  transactionCount: number
  uncategorizedCount: number
  aiCategorizationUnavailable: boolean
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
    response = await apiFetch('/api/bank-statements', { method: 'POST', body })
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

// read: the receipt reader read the Receipt. unreadable: it couldn't. unavailable: no receipt reader
// is configured.
export type ReceiptOutcome = 'read' | 'unreadable' | 'unavailable'

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
    const response = await apiFetch('/api/receipts/read', { method: 'POST', body })
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
