# PersonligFinans

A personal finance web app for tracking spending from uploaded bank transactions and manual entries, categorized by rule-matching with manual correction. Natural-language querying and AI-generated insights are a future phase, not part of this model yet.

## Language

**User**:
Someone who signs in with an email and password, or the Guest. Each User has their own Transactions, Bank Statements, Uploads, Categories, Categorization Rules, Bookmarks and Folders, and no User ever sees another's. A new User starts with the seeded Categories and Categorization Rules and no Transactions.
_Avoid_: Account, profile, member

**Guest**:
The one User anyone can sign in as without signing up, so everything in it is seen and changed by every visitor who uses it. It is for trying the app, not for real data, and otherwise works like any other User: it starts like a new User, is never reset, and has its own Daily AI limit, shared by everyone using it.
_Avoid_: Demo user, anonymous user, guest account

**Sign up**:
Becoming a new User with an email and a password, which signs you straight in. The Guest is never signed up; the app creates it.
_Avoid_: Register, create an account

**Sign in**:
Getting back into your own User with its email and password. Being signed in is the state of using the app as a User, however you got there: by signing in, signing up or continuing as the Guest. Signing out ends it.
_Avoid_: Log in, log out

**Password reset**:
Choosing a new password for a User through a link sent to its email, for someone who can't sign in. Whoever can read that email can take over the User, since nobody proves they own an email when signing up. A Password reset signs you in, signs the User out everywhere else, and ends any lockout from failed sign-ins. The Guest has no password, so it has no Password reset.
_Avoid_: Forgot password, account recovery, password recovery

**Change password**:
Choosing a new password while signed in, by giving the current one. It keeps you signed in and signs the User out everywhere else. The Guest has no password, so it has no Change password.
_Avoid_: Update password, new password

**Delete your User**:
Removing a signed-in User and everything it owns, for good, after giving its password. Its email can then be used to Sign up again as a new User. The Guest cannot be deleted.
_Avoid_: Delete account, close account, unregister

**AI request**:
One ask of the LLM on a User's behalf, counted whether or not it succeeds: reading one Receipt, or proposing AI-generated rules for one Bank Statement that has rows no Categorization Rule matches. A Bank Statement whose rows all match makes none.
_Avoid_: LLM call, AI usage, token

**Daily AI limit**:
How many AI requests a User may make in a day, counted from midnight Norwegian time, alongside a cap on all Users' AI requests together, which still counts those of Users since deleted. Past either, nothing is refused: an Upload still imports with its unmatched Transactions left Uncategorized, and a Receipt is entered by hand, each saying the limit is reached.
_Avoid_: Quota, rate limit, usage cap

**Transaction**:
A single financial record — either imported from a Bank Statement or entered manually — with a posted date, an Amount, a required description, and a Category (or Uncategorized). An imported Transaction's posted date is the date the bank booked it, and its description is the cleaned merchant or payee name, without any Payment Channel in front of it. A manually-entered Transaction can be deleted on its own, permanently; an imported one only along with its whole Bank Statement, so every Bank Statement stays whole and reconciled.
_Avoid_: Entry, record, purchase

**Bank Statement**:
A bank's periodic account statement (Norwegian: kontoutskrift) for one account and one period, uploaded to import its Transactions. Identified by its account number and period; each imported Transaction remembers which Bank Statement it came from. Every row on it is imported, including transfers between the user's own accounts, and each row's Amount is the booked NOK value even for foreign-currency purchases. A User holds a Bank Statement at most once, and imports it only if its rows reconcile with its opening and closing balances; otherwise nothing from it is imported. Deleting a Bank Statement deletes all its Transactions but keeps the Categorization Rules its import added, and it can then be imported again.
_Avoid_: Kontoutskrift, file, CSV, export

**Upload**:
One pick of one or more Bank Statements to import together. Each Bank Statement in it is imported or rejected on its own.
_Avoid_: Batch, import, file upload

**Receipt**:
A photo of the slip from one purchase, read by the LLM to suggest a manually-entered Transaction that the user confirms or edits before it is saved; it becomes one Transaction with one Category, or is skipped. A saved Receipt is kept with its Transaction unless the user chooses not to keep it, and a skipped one is gone. A Transaction has at most one Receipt, which can never be added afterwards or removed on its own; it goes only when its Transaction is deleted. Meant for purchases that never reach an uploaded Bank Statement, such as cash or another bank's card.
_Avoid_: Kvittering, slip, receipt image

**Receipt scan**:
One pick of one or more Receipts, worked through one at a time. Leaving partway keeps the Transactions already saved and discards the remaining Receipts.
_Avoid_: Receipt upload, receipt import, Upload

**Possible duplicate**:
An existing Transaction, imported or manually-entered, with exactly the same Amount and a posted date within three days of one being entered by hand, shown so the user can avoid recording the same purchase twice. It only warns: saving is never blocked, and nothing is remembered once the Transaction is saved.
_Avoid_: Duplicate, conflict, match

**Amount**:
The signed value of a Transaction in NOK: negative when money is spent, positive when money is received. All Transactions share one currency.
_Avoid_: Balance change, sum, value

**Note**:
An optional, free-form annotation a user attaches to any Transaction — imported or manually-entered — to record anything relevant: a reimbursement, a disputed charge, an external reference number. Distinct from Description, which is the merchant or payee name and cannot be changed.
_Avoid_: Reference, memo, comment

**Bookmark**:
A mark a User puts on a Transaction to find it again, filed in one Folder or in none; those in none are listed as "Bookmarks". A Transaction has at most one Bookmark, which goes when the Transaction is deleted and changes nothing else about it. Distinct from a Note, which records something about a Transaction rather than marking it to come back to.
_Avoid_: Favourite, star, saved transaction

**Folder**:
A named group a User creates to file Bookmarks in, such as "Tax deductible". Has a name unique among the User's Folders (ignoring case) that is never "Bookmarks". Deleting a Folder deletes the Bookmarks in it, but never their Transactions.
_Avoid_: Bookmark folder, list, collection

**Category**:
A label classifying a Transaction by type of spending (e.g. "Restaurants", "Groceries"), used to group spending on the Dashboard. Has a name unique among the User's Categories (ignoring case) and a short description of what belongs in it, which the LLM also reads when creating AI-generated rules. Each User manages their own list (adding, editing and deleting Categories), which starts from a seeded set. Deleting a Category that is in use means choosing either a replacement Category, which its Transactions and Categorization Rules move to (each Transaction keeping whether it was categorized manually or by a rule), or to delete its Categorization Rules, after which its Transactions are matched against the remaining rules like any rule change, and those left without a Category become Uncategorized.
_Avoid_: Tag, type, bucket

**Built-in Category**:
One of the seven Categories the app depends on and the user can never rename or delete, only re-describe: Housing, Groceries, Clothing, Transport, Other, Income and Savings.
_Avoid_: Fixed, protected, system category

**Uncategorized**:
The state of a Transaction with no Category, awaiting a decision: an imported Transaction no Categorization Rule matches (because the LLM could not be asked, or its rule could not be added), or any Transaction whose Category was deleted without a replacement. The user can never choose it for a manually-entered Transaction. Distinct from the "Other" Category, which is a decision rather than a pending one.
_Avoid_: Unreviewed, pending

**Categorization Rule**:
A keyword paired with a Category: an imported Transaction whose description contains the keyword (ignoring case) is automatically assigned that Category, and reassigned whenever the rules change unless its Category was chosen manually; when several match, the longest keyword wins. Keywords are unique among the User's rules. Seeded with common merchants and visible to the user; correcting a Transaction's Category by hand never creates one. Never applied to manually-entered Transactions.
_Avoid_: Mapping, pattern

**AI-generated rule**:
A Categorization Rule created by an LLM during import, for an imported Transaction that no existing rule matched. It behaves exactly like any other rule; the mark only lets the user spot and review it among the rules, and is removed once the user edits the rule (even saving it unchanged), after which it is an ordinary rule. It may have any Category, Other included, and is only created when it categorizes nothing that already has a Category; its keyword is never a Payment Channel. The LLM sees only the cleaned description and whether the Amount is negative or positive, along with each Category's name and description. It never declines: every Transaction it is asked about gets a keyword and a Category, and one whose rule cannot be added stays Uncategorized.
_Avoid_: Suggested rule, suggestion, unconfirmed rule

**New rule**:
A Categorization Rule added by the User's most recent Upload that imported a Bank Statement, marked so the user can review what that Upload brought. Such an Upload replaces the previous one's marks even if it adds no rules; editing the rule does not remove the mark. Since only imports add rules automatically, a New rule always began as an AI-generated rule, though it may no longer be one.
_Avoid_: Recent rule, latest rule, fresh rule

**Payment Channel**:
A service that carries payments for many unrelated merchants or people, such as Vipps, Klarna or PayPal, so its name says nothing about what was bought. It is removed from an imported Transaction's description, leaving the merchant or payee behind it.
_Avoid_: Payment provider, payment method, wallet

**Locked**:
The state of a Transaction whose Category the Categorization Rules will never change: every manually-entered Transaction (even an Uncategorized one), and every imported Transaction whose Category was chosen manually. It is marked so the user can see which Transactions a rule change won't touch. An imported Transaction stops being Locked if its Category is deleted without a replacement, since it is then matched against the rules again. There is no way to unlock a Transaction.
_Avoid_: Pinned, frozen, edited, manual

**Spending**:
What each Category cost during a Period, shown as a positive figure (Uncategorized Transactions count as their own group). Amounts are netted within each month, so a refund reduces the Spending of the Category it lands in only in the month it is posted; a Category whose Amounts in a month net to zero or more has no Spending that month. A longer Period's Spending is the sum of its months', and its total is the sum of its Categories'. The Income Category is never Spending, and the Savings Category is left out unless the user chooses to include it, since moving money between the user's own accounts is not spending.
_Avoid_: Outgoing, expenses, costs

**Period**:
A specific calendar year, quarter (Q1–Q4) or month that Spending is summarized over, such as 2026, Q3 2026 or September 2026. Each Period has a Granularity.
_Avoid_: Range, interval, timeframe

**Granularity**:
The length of a Period: Year, Quarter or Month. The Dashboard has one for the Period it summarizes, where changing it keeps the user in the same stretch of time, moving to the Period that contains the current one or to the latest one with Transactions inside it. It has another, chosen separately, for how Spending, Savings and Income changed over a Span, shown one Period of that Granularity at a time.
_Avoid_: Resolution, period type, interval

**Span**:
A run of consecutive whole months, from a start month to an end month, both included, such as February 2025 – June 2026. At least two months long. Unlike a Period, it need not line up with a calendar year or quarter.
_Avoid_: Interval, range, Period

**Dashboard**:
The view summarizing Spending by Category over a chosen Period, and how Spending, Savings and Income changed over a chosen Span. Savings and Income are shown beside Spending, never as part of it: each is its Category's Amounts netted within each month as a positive figure, what was put aside or received, with nothing for a month that nets the other way. Each Category's Spending in a Period leads to that Category's Transactions in the Period; since Transactions are listed by month or year, a quarter leads to its first month where the Category has Transactions.
_Avoid_: Report, overview
