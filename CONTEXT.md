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
A label classifying a Transaction by type of spending (e.g. "Restaurants", "Groceries"), used to group spending on the Dashboard. Has a unique name (ignoring case) and a short description of what belongs in it, which the LLM also reads when creating AI-generated rules. The user manages the list (adding, editing and deleting Categories), which starts from a seeded set. Deleting a Category that is in use means choosing either a replacement Category, which its Transactions and Categorization Rules move to (each Transaction keeping whether it was categorized manually or by a rule), or to delete its Categorization Rules, after which its Transactions are matched against the remaining rules like any rule change, and those left without a Category become Uncategorized. When an AI-generated rule moves to Other this way, it loses its mark and becomes an ordinary rule.
_Avoid_: Tag, type, bucket

**Built-in Category**:
One of the seven Categories the app depends on and the user can never rename or delete, only re-describe: Housing, Groceries, Clothing, Transport, Other, Income and Transfers.
_Avoid_: Fixed, protected, system category

**Uncategorized**:
The state of a Transaction with no Category, awaiting a decision: an imported Transaction no Categorization Rule matches and the LLM could not be asked about, or any Transaction whose Category was deleted without a replacement. The user can never choose it for a manually-entered Transaction. Distinct from the "Other" Category, which is a decision (the user's, or the LLM's when AI-placed in Other) rather than a pending one.
_Avoid_: Unreviewed, pending

**Categorization Rule**:
A keyword paired with a Category: an imported Transaction whose description contains the keyword (ignoring case) is automatically assigned that Category, and reassigned whenever the rules change unless its Category was chosen manually (a Transaction AI-placed in Other was not); when several match, the longest keyword wins. Keywords are unique. Seeded with common merchants and visible to the user; correcting a Transaction's Category by hand never creates one. Never applied to manually-entered Transactions.
_Avoid_: Mapping, pattern

**AI-generated rule**:
A Categorization Rule created by an LLM during import, for an imported Transaction that no existing rule matched. It behaves exactly like any other rule; the mark only lets the user spot and review it among the rules, and is removed once the user edits the rule (even saving it unchanged), after which it is an ordinary rule. It is never given the "Other" Category, and is only created when it categorizes nothing that already has a Category (Transactions AI-placed in Other aside); the LLM sees only the cleaned description and whether the Amount is negative or positive, along with each Category's name and description. It never declines: a Transaction it cannot write a confident rule for is AI-placed in Other instead.
_Avoid_: Suggested rule, suggestion, unconfirmed rule

**AI-placed in Other**:
The state of an imported Transaction the LLM put in the Other Category during import, without creating a rule, because it could not write a confident one. It stays open to Categorization Rules: a matching rule takes it, and if no rule matches any more it returns to Other rather than becoming Uncategorized. It ends once the user changes the Transaction's Category, which then counts as chosen manually. It is not shown to the user.
_Avoid_: AI fallback, auto-Other, AI-categorized

**Locked**:
The state of a Transaction whose Category the Categorization Rules will never change: every manually-entered Transaction (even an Uncategorized one), and every imported Transaction whose Category was chosen manually. It is marked so the user can see which Transactions a rule change won't touch. An imported Transaction stops being Locked if its Category is deleted without a replacement, since it is then matched against the rules again. There is no way to unlock a Transaction.
_Avoid_: Pinned, frozen, edited, manual

**Spending**:
The money that left during a Period: the sum of the negative Amounts, shown as a positive figure and grouped by Category (Uncategorized Transactions count as their own group). Positive Amounts, such as refunds, never reduce it. Transactions in the Transfers Category are left out unless the user chooses to include them, since moving money between the user's own accounts is not spending.
_Avoid_: Outgoing, expenses, costs

**Period**:
A specific calendar year, quarter (Q1–Q4) or month that Spending is summarized over, such as 2026, Q3 2026 or September 2026. Each Period has a Granularity.
_Avoid_: Range, interval, timeframe

**Granularity**:
The length of a Period: Year, Quarter or Month. The Dashboard has one for the Period it summarizes, where changing it keeps the user in the same stretch of time, moving to the Period that contains the current one or to the latest one with Transactions inside it. It has another, chosen separately, for how Spending changed over a Span, shown one Period of that Granularity at a time.
_Avoid_: Resolution, period type, interval

**Span**:
A run of consecutive whole months, from a start month to an end month, both included, such as February 2025 – June 2026. At least two months long. Unlike a Period, it need not line up with a calendar year or quarter.
_Avoid_: Interval, range, Period

**Dashboard**:
The view summarizing Spending by Category over a chosen Period, and how Spending changed over a chosen Span.
_Avoid_: Report, overview
