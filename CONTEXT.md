# PersonligFinans

A personal finance web app for tracking spending from uploaded bank transactions and manual entries, categorized by rule-matching with manual correction. Natural-language querying and AI-generated insights are a future phase, not part of this model yet.

## Language

**Transaction**:
A single financial record — either imported from a bank CSV or entered manually — with a posted date, a signed amount (negative = spent, positive = received), a description, and a Category.
_Avoid_: Entry, record, purchase

**Reference**:
An optional, free-text identifier a user attaches to a manually-entered Transaction, pointing to an external document (e.g. an invoice or check number). Distinct from Description, which says what the Transaction was for.
_Avoid_: Note, memo, ID

**Category**:
A label classifying a Transaction by type of spending (e.g. "Restaurants", "Groceries"), used to group spending on the Dashboard. Comes from a fixed system-defined list.
_Avoid_: Tag, type, bucket

**Uncategorized**:
The state of a Transaction with no matching Categorization Rule, awaiting manual assignment. Distinct from the "Other" Category, which is a deliberate choice rather than a pending one.
_Avoid_: Unreviewed, pending

**Categorization Rule**:
A mapping from a merchant name/keyword to a Category, used to automatically assign a Category to new Transactions. Seeded with common merchants at the start, and extended whenever a Transaction is manually corrected.
_Avoid_: Mapping, pattern

**Dashboard**:
The view summarizing spending aggregated by Category and month.
_Avoid_: Report, overview
