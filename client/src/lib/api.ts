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

export interface CategorizationRule {
  id: number
  keyword: string
  categoryId: number
}

export interface CategorizationRuleRequest {
  keyword: string
  categoryId: number | null
}

export type RuleFieldErrors = Partial<Record<keyof CategorizationRuleRequest, string>>

export type AddRuleResult =
  | { ok: true; rule: CategorizationRule; transactionsChanged: number }
  | { ok: false; fieldErrors: RuleFieldErrors; message: string | null }

export async function fetchRules(): Promise<CategorizationRule[]> {
  const response = await fetch('/api/categorization-rules')
  if (!response.ok) throw new Error(`Loading rules failed (${response.status})`)
  return (await response.json()) as CategorizationRule[]
}

export async function addRule(request: CategorizationRuleRequest): Promise<AddRuleResult> {
  let response: Response
  try {
    response = await fetch('/api/categorization-rules', {
      method: 'POST',
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
