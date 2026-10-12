---
status: accepted
---

# AI-generated rules may use Other; Payment Channels are stripped from descriptions

Supersedes ADR 0002. The LLM now gets Other like any other Category and always answers with a keyword, so a Transaction it puts in Other is backed by a rule the user can see and review, and the same merchant is not sent to the LLM on every import. ADR 0002 feared catch-all rules such as "vipps → Other"; the real source of those was the Payment Channel in front of the merchant, so the import strips Payment Channels (Vipps, Klarna, PayPal…) from the cleaned description instead of forbidding Other, which protects rules for every Category. "AI-placed in Other" is removed: a row whose proposed rule the import drops stays Uncategorized, since no rule could be made and nobody has decided.

## Considered Options

- Keep AI-placed in Other without a rule (ADR 0002): hides the AI's decisions from the Rules page and re-asks about the same merchant every import.
- Guard only rules for Other: the Payment Channel problem affects every Category ("vipps → Groceries" is just as wrong).
- Place a row whose rule was dropped in the LLM's chosen Category without a rule: keeps a Transaction-level AI state alive for a rare case.
