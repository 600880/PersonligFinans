import { periodQuery, type Period } from './period'
import { spanQuery, type Span } from './span'
import type { CreateTransactionRequest } from './transactionForm'

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
  const response = await fetch('/api/categories')
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
    response = await fetch(`/api/categories/${id}${search}`, { method: 'DELETE' })
  } catch {
    return { ok: false, message: 'Could not reach the server.' }
  }

  if (response.ok) {
    const { transactionsChanged } = (await response.json()) as { transactionsChanged: number }
    return { ok: true, alreadyDeleted: false, transactionsChanged }
  }

  if (response.status === 404) return { ok: true, alreadyDeleted: true, transactionsChanged: 0 }

  if (response.status === 400) {
    const problem = (await response.json().catch(() => null)) as {
      errors?: Record<string, string[]>
    } | null
    const message = Object.values(problem?.errors ?? {})[0]?.[0]
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
    response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch {
    return { ok: false, fieldErrors: {}, message: 'Could not reach the server.' }
  }

  if (response.ok) return { ok: true, category: (await response.json()) as Category }

  if (response.status === 400) {
    const problem = (await response.json().catch(() => null)) as {
      errors?: Record<string, string[]>
    } | null
    const fieldErrors: CategoryFieldErrors = {}
    for (const [field, messages] of Object.entries(problem?.errors ?? {})) {
      fieldErrors[field as keyof CategoryFieldErrors] = messages[0]
    }
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
  reference: string | null
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
  const response = await fetch('/api/transactions/months')
  if (!response.ok) throw new Error(`Loading months failed (${response.status})`)
  return (await response.json()) as TransactionMonth[]
}

// The Transactions endpoint lists a year or a month, not a quarter.
export type YearOrMonth = Exclude<Period, { granularity: 'quarter' }>

export async function fetchTransactions(period: YearOrMonth): Promise<Transaction[]> {
  const response = await fetch(`/api/transactions?${periodQuery(period)}`)
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
  const response = await fetch(`/api/spending?${periodQuery(period)}${transfers}`)
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
  const response = await fetch(`/api/spending/monthly?${spanQuery(span)}${transfers}`)
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
    response = await fetch(`/api/transactions/${id}/category`, {
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

// alreadyDeleted: the Transaction was gone before this delete, so nothing changed.
export type DeleteTransactionResult = { ok: true; alreadyDeleted: boolean } | { ok: false; message: string }

// Deletes a manually-entered Transaction for good; the server refuses an imported one.
export async function deleteTransaction(id: number): Promise<DeleteTransactionResult> {
  let response: Response
  try {
    response = await fetch(`/api/transactions/${id}`, { method: 'DELETE' })
  } catch {
    return { ok: false, message: 'Could not reach the server.' }
  }

  if (response.ok) return { ok: true, alreadyDeleted: false }

  if (response.status === 404) return { ok: true, alreadyDeleted: true }

  // 409 is a problem whose detail says why the Transaction can't be deleted.
  if (response.status === 409) {
    const problem = (await response.json().catch(() => null)) as { detail?: string } | null
    if (problem?.detail) return { ok: false, message: problem.detail }
  }

  return { ok: false, message: `Deleting failed (${response.status}).` }
}

export async function createTransaction(
  request: CreateTransactionRequest,
): Promise<CreateTransactionResult> {
  let response: Response
  try {
    response = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch {
    return { ok: false, fieldErrors: {}, message: 'Could not reach the server.' }
  }

  if (response.ok) return { ok: true }

  if (response.status === 400) {
    const problem = (await response.json().catch(() => null)) as {
      errors?: Record<string, string[]>
    } | null
    const fieldErrors: FieldErrors = {}
    for (const [field, messages] of Object.entries(problem?.errors ?? {})) {
      fieldErrors[field as keyof FieldErrors] = messages[0]
    }
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

export async function uploadBankStatement(file: File): Promise<UploadBankStatementResult> {
  const body = new FormData()
  body.append('file', file)

  let response: Response
  try {
    response = await fetch('/api/bank-statements', { method: 'POST', body })
  } catch {
    return { ok: false, message: 'Could not reach the server.' }
  }

  if (response.ok) return { ok: true, statement: (await response.json()) as ImportedBankStatement }

  // 400 is a validation problem keyed on "file"; 409 is a problem whose detail explains the conflict.
  if (response.status === 400 || response.status === 409) {
    const problem = (await response.json().catch(() => null)) as {
      detail?: string
      errors?: { file?: string[] }
    } | null
    const message = problem?.errors?.file?.[0] ?? problem?.detail
    if (message) return { ok: false, message }
  }

  return { ok: false, message: `Upload failed (${response.status}).` }
}

// aiGenerated: created by an LLM during import rather than by hand. Only records where the rule
// came from; the rule otherwise behaves like any other.
export interface CategorizationRule {
  id: number
  keyword: string
  categoryId: number
  aiGenerated: boolean
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
  const response = await fetch('/api/categorization-rules')
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
    response = await fetch(`/api/categorization-rules/${id}`, { method: 'DELETE' })
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
    response = await fetch(url, {
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
    const problem = (await response.json().catch(() => null)) as {
      errors?: Record<string, string[]>
    } | null
    const fieldErrors: RuleFieldErrors = {}
    for (const [field, messages] of Object.entries(problem?.errors ?? {})) {
      fieldErrors[field as keyof RuleFieldErrors] = messages[0]
    }
    if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, message: null }
  }

  return { ok: false, fieldErrors: {}, message: `Saving failed (${response.status}).` }
}
