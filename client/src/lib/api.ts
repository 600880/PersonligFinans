import type { CreateTransactionRequest } from './transactionForm'

export interface Category {
  id: number
  name: string
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

// categoryId is null for an Uncategorized Transaction.
export interface Transaction {
  id: number
  date: string
  description: string
  amount: number
  reference: string | null
  categoryId: number | null
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

export async function fetchTransactionsOfMonth({ year, month }: TransactionMonth): Promise<Transaction[]> {
  const response = await fetch(`/api/transactions?year=${year}&month=${month}`)
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

export async function fetchSpendingOfMonth({ year, month }: TransactionMonth): Promise<Spending> {
  const response = await fetch(`/api/spending?year=${year}&month=${month}`)
  if (!response.ok) throw new Error(`Loading spending failed (${response.status})`)
  return (await response.json()) as Spending
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
