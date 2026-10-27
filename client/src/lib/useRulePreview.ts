import { useEffect, useState } from 'react'
import type { CategorizationRuleRequest, RulePreview } from './api'

// How long typing in a rule's keyword must pause before the preview of saving it is asked for.
const RULE_PREVIEW_DELAY_MS = 300

type AskForPreview = (request: CategorizationRuleRequest) => Promise<RulePreview>

// The preview of saving a rule change, asked for with ask once typing has paused, such as
// previewAddingRule. request is null while the form holds nothing that could be saved, such as a
// keyword too short or no Category, and there is then no preview. A reply is only shown while the
// form still holds what it was asked, so a reply to a request since replaced is ignored. A change the
// server refuses, as for a keyword another rule has, or a preview that fails, shows none. ask must
// keep its identity between renders unless the change it previews does not, as when another rule is
// edited.
export function useRulePreview(request: CategorizationRuleRequest | null, ask: AskForPreview): RulePreview | null {
  const keyword = request?.keyword ?? null
  const categoryId = request?.categoryId ?? null
  // The reply remembers what it was asked, so that it is only shown while the form still holds it.
  const [reply, setReply] = useState<{
    keyword: string
    categoryId: number
    ask: AskForPreview
    preview: RulePreview | null
  } | null>(null)

  useEffect(() => {
    if (keyword === null || categoryId === null) return
    let ignore = false
    const timer = setTimeout(() => {
      ask({ keyword, categoryId })
        // A failed preview only means none is shown: it never stands in the way of saving.
        .catch(() => null)
        .then((preview) => {
          if (!ignore) setReply({ keyword, categoryId, ask, preview })
        })
    }, RULE_PREVIEW_DELAY_MS)
    return () => {
      ignore = true
      clearTimeout(timer)
    }
  }, [keyword, categoryId, ask])

  return reply !== null && reply.keyword === keyword && reply.categoryId === categoryId && reply.ask === ask
    ? reply.preview
    : null
}
