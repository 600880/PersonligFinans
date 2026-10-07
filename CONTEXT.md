# PersonligFinans

A personal finance web app for tracking spending from uploaded bank transactions and manual entries, categorized by rule-matching with manual correction. Natural-language querying and AI-generated insights are a future phase, not part of this model yet.

## Language

**Transaction**:
A single financial record — either imported from a Bank Statement or entered manually — with a posted date, an Amount, a required description, and a Category (or Uncategorized). An imported Transaction's posted date is the date the bank booked it, and its description is the cleaned merchant or payee name.
_Avoid_: Entry, record, purchase

**Bank Statement**:
A bank's periodic account statement (Norwegian: kontoutskrift) for one account and one period, uploaded to import its Transactions. Identified by its account number and period; each imported Transaction remembers which Bank Statement it came from. Every row on it is imported, including transfers between the user's own accounts, and each row's Amount is the booked NOK value even for foreign-currency purchases. A Bank Statement is imported at most once, and only if its rows reconcile with its opening and closing balances; otherwise nothing from it is imported.
_Avoid_: Kontoutskrift, file, CSV, export

**Amount**:
The signed value of a Transaction in NOK: negative when money is spent, positive when money is received. All Transactions share one currency.
_Avoid_: Balance change, sum, value

**Reference**:
An optional, free-text identifier a user attaches to a manually-entered Transaction (the bank's own reference numbers on a Bank Statement are not Reference), pointing to an external document (e.g. an invoice or check number). Distinct from Description, which says what the Transaction was for.
_Avoid_: Note, memo, ID

**Category**:
A label classifying a Transaction by type of spending (e.g. "Restaurants", "Groceries"), used to group spending on the Dashboard. Comes from a fixed system-defined list.
_Avoid_: Tag, type, bucket

**Uncategorized**:
The state of an imported Transaction with no matching Categorization Rule, awaiting manual assignment. A manually-entered Transaction is never Uncategorized. Distinct from the "Other" Category, which is a deliberate choice rather than a pending one.
_Avoid_: Unreviewed, pending

**Categorization Rule**:
A mapping from a merchant name/keyword to a Category, used to automatically assign a Category to new Transactions. Seeded with common merchants at the start, and extended whenever a Transaction is manually corrected.
_Avoid_: Mapping, pattern

**Dashboard**:
The view summarizing spending aggregated by Category and month.
_Avoid_: Report, overview
