# The LLM places Transactions in Other without creating a rule

During import the LLM used to decline any row it couldn't write a confident Categorization Rule for, leaving it Uncategorized. We now have it never decline: such a Transaction is AI-placed in Other, a Transaction-level state with no rule behind it, while AI-generated rules still never get the Other Category. A rule for Other would be a weak catch-all ("VIPPS → Other") that silently swallows every future match, since only a longer keyword beats it; placing the one Transaction keeps Uncategorized meaning "nobody has decided" without letting the AI hide future Transactions.

## Considered Options

- Keep declining (Uncategorized): leaves many Transactions pending that plainly belong nowhere specific.
- Let AI-generated rules use Other: rejected for the catch-all problem above.

## Consequences

An imported Transaction with a Category but no rule is no longer necessarily manually categorized. AI-placed in Other stays open to Categorization Rules and falls back to Other, not Uncategorized, when no rule matches; it only becomes manual when the user changes its Category.
