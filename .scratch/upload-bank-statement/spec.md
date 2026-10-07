# Upload transactions from a Bank Statement

Status: ready-for-agent

## Problem Statement

The only way to get Transactions into PersonligFinans today is to type them in one at a time with "Add transaction". My bank (Sparebanken Norge) gives me a monthly PDF Bank Statement (kontoutskrift) with every Transaction on my account, often 30–40 rows. Retyping them is slow and error-prone, and a single mistyped Amount makes my records wrong without my noticing.

## Solution

An "Upload transactions" button sits to the left of "Add transaction". I pick a Sparebanken Norge PDF Bank Statement, and every row on it is stored as a Transaction: booked date, cleaned merchant/payee description, signed NOK Amount, and Uncategorized. The import is all-or-nothing. It is accepted only if the rows reconcile with the statement's opening and closing balances, and the same Bank Statement can't be imported twice. Afterwards I see a summary such as "Imported 38 transactions from statement 01.08.2026–31.08.2026", or a clear error explaining why nothing was imported.

## User Stories

1. As a user, I want an "Upload transactions" button to the left of "Add transaction", so that I can import a whole month at once instead of typing each Transaction.
2. As a user, I want clicking "Upload transactions" to open a file picker limited to PDF files, so that I don't choose the wrong kind of file by accident.
3. As a user, I want the import to start as soon as I pick a file, so that importing takes a single action.
4. As a user, I want to see that the upload is in progress, so that I don't click again or think nothing happened.
5. As a user, I want the upload button disabled while an upload is in progress, so that I can't start a duplicate import.
6. As a user, I want every row on the Bank Statement stored as a Transaction, so that my records match my bank.
7. As a user, I want transfers between my own accounts ("Overføring mellom egne kontoer") imported too, so that the imported Transactions account for the account's full balance movement.
8. As a user, I want income rows such as "Lønn Fra: Testfirma AS" imported with a positive Amount, so that received money is recorded as received.
9. As a user, I want "Ut av konto" rows imported with a negative Amount, so that spending is recorded as spent.
10. As a user, I want each Transaction's date to be the date the bank booked it ("Bokført"), so that the dates agree with the bank's own records.
11. As a user, I want the year of each date taken from the statement period, so that day-month dates like "0308" become 03.08.2026.
12. As a user, I want card purchases described by the merchant name only (e.g. "Rema 1000 Sentrum" rather than "*1111 31.07 Nok 296.60 Rema 1000 Sentrum Kurs: 1.0000"), so that Transactions are easy to read and later easy to match with Categorization Rules.
13. As a user, I want payments described by the payee only (e.g. "Fjordkraft AS" rather than "Til: Fjordkraft AS Betalt: 17.08.26"), so that descriptions are clean.
14. As a user, I want "Varer" rows described by the shop text without the "Varer dd.mm" prefix (e.g. "Rema Storgata Nedre Torget Oslo"), so that descriptions are clean.
15. As a user, I want descriptions the bank wraps onto a second line (e.g. a lone "1.0000" line) handled as part of the same row, so that no Transaction is split or lost.
16. As a user, I want rows on every page of the statement imported, so that multi-page statements work.
17. As a user, I want page-carry lines ("Overført til neste side", "Overført fra forrige side"), the opening balance, the closing balance and the "Betalte omkostninger" line ignored, so that they don't become fake Transactions.
18. As a user, I want foreign-currency card purchases stored with the booked NOK Amount, so that all Transactions stay in NOK and the balance still reconciles.
19. As a user, I want the currency and exchange-rate details stripped from foreign-currency descriptions, so that only the merchant name remains.
20. As a user, I want imported Transactions to be Uncategorized, so that I can categorize them later without wrong guesses being made for me.
21. As a user, I want the bank's reference numbers left out of Reference, so that Reference keeps meaning what I typed myself.
22. As a user, I want the import rejected if opening balance + money in − money out doesn't equal the closing balance, so that a misread statement never silently corrupts my records.
23. As a user, I want nothing stored if any part of the statement can't be understood, so that I never end up with half a month imported.
24. As a user, I want to be told the Bank Statement was already imported if I upload the same one again, so that I don't get duplicate Transactions.
25. As a user, I want a statement for a different account and the same period accepted, so that I can import statements from several accounts.
26. As a user, I want a clear error when the file isn't a Sparebanken Norge Bank Statement (another PDF, a scanned image, a non-PDF), so that I know why nothing happened.
27. As a user, I want a clear error when the file is too large, so that I'm not left waiting on an obviously wrong file.
28. As a user, I want a success summary showing how many Transactions were imported and the statement's period, so that I can check it against what I expected.
29. As a user, I want the summary and errors shown where "Transaction saved" appears today, so that feedback is in a familiar place.
30. As a user, I want to be able to upload another statement right after one finishes, so that I can import several months in one sitting.
31. As a user, I want each imported Transaction to remember which Bank Statement it came from, so that imported and manual Transactions can be told apart, and a bad import can be undone in the future.
32. As a user, I want my original PDF not stored, so that my bank documents aren't kept anywhere they don't need to be.
33. As a user, I want "Add transaction" to keep working exactly as before, so that manual entry is unaffected.

## Implementation Decisions

- **Domain vocabulary**: uses **Bank Statement**, **Transaction**, **Amount**, **Reference** and **Uncategorized** as defined in `CONTEXT.md`. A Bank Statement is identified by account number + period.
- **Schema**: a new Bank Statement table holding account number, period start, period end, opening balance and closing balance, plus an import timestamp. A unique constraint on (account number, period start, period end) enforces "imported at most once" at the database level as well as in the endpoint. Transaction gains a nullable foreign key to Bank Statement: set for imported Transactions, null for manual ones. Imported Transactions have a null Category (Uncategorized) and a null Reference. One EF Core migration covers both changes.
- **Description length**: cleaned descriptions are truncated to the existing Description max length (200) if needed. In practice they are far shorter.
- **PDF text extraction**: the API extracts text lines from the uploaded PDF with a .NET PDF text library (PdfPig is the expected choice). Extraction is separate from parsing. Extraction turns PDF bytes into the ordered text lines of each page; parsing turns those lines into a Bank Statement.
- **Statement parser (new deep module)**: one pure function from the extracted text lines to either a parsed Bank Statement (account number, period, opening/closing balance, list of rows with booked date, cleaned description and signed Amount) or a parse failure with a user-facing reason. It is responsible for:
  - recognising the header "Kontoutskrift nr. N for konto XXXX.XX.XXXXX i perioden DD.MM.YYYY - DD.MM.YYYY" and failing with "not a Sparebanken Norge Bank Statement" when it's missing;
  - reading the opening balance ("Saldo fra kontoutskrift …") and the closing balance ("Saldo i Deres favør");
  - reading each row's description, interest date, amount, booked date (DDMM) and the two reference columns. Each row has one amount, and whether it is money out or money in comes from the column it sits in (see "Direction of each Amount");
  - joining continuation lines (e.g. a lone "1.0000" following "Kurs:") onto the preceding row;
  - ignoring page-carry, page header/footer, address, "Betalte omkostninger" and legal-notice lines;
  - resolving booked dates to a full date using the statement period's year;
  - cleaning descriptions: card rows `*NNNN dd.mm <CUR> <amount> <merchant> Kurs: <rate>` → `<merchant>`; payment rows `Til: <payee> Betalt: dd.mm.yy` → `<payee>`; `Varer dd.mm <shop>` → `<shop>`; other rows (e.g. "Overføring mellom egne kontoer", "Lønn Fra: Testfirma AS") kept as-is;
  - parsing Norwegian number formats ("1.000,00", "24.500,00");
  - verifying opening + Σ(in) − Σ(out) = closing, and failing with a reconciliation error otherwise.
- **Direction of each Amount**: the extracted text may not preserve which column ("Ut av konto" / "Inn på konto") an amount came from. The implementer should prefer the word positions from PdfPig, using each amount's x-coordinate relative to the column headers, so that extraction yields lines carrying an explicit in/out marker. If that approach is used, the parser's input lines carry that marker, and the parser stays pure. Guessing direction from the description text is not acceptable. Reconciliation is the safety net, not the primary mechanism.
- **API contract**: `POST /api/bank-statements`, `multipart/form-data` with a single file field `file`.
  - `201 Created` → `{ id, accountNumber, periodStart, periodEnd, transactionCount }`.
  - `400` validation problem (same `ValidationProblem` shape as the existing transaction endpoint, keyed on `file`) for a missing file, non-PDF, unreadable PDF, unrecognised statement, unparseable row, or failed reconciliation. Each case gets its own human-readable message.
  - `409 Conflict` (problem details) when a Bank Statement with the same account number and period already exists, with a message such as "Statement for 1234.56.78901, 01.08.2026–31.08.2026 has already been imported."
  - Uploads above a size cap (e.g. 10 MB) are rejected.
  - The Bank Statement and all its Transactions are saved in one database transaction. Nothing is persisted on any failure. The PDF bytes are never stored.
- **Endpoint location**: a new endpoint group alongside the existing transaction endpoints, following the same minimal-API style.
- **Client**:
  - `App` renders "Upload transactions" to the left of "Add transaction" in a horizontal row. The button triggers a hidden `<input type="file" accept="application/pdf">`.
  - On file selection the client posts the file to the endpoint and shows an in-progress state, with the button disabled and labelled e.g. "Uploading…".
  - On success, the existing status line shows "Imported N transactions from statement DD.MM.YYYY–DD.MM.YYYY".
  - On a 400 or 409, the status line shows the server's message in an error style. On a network error it shows a generic failure message.
  - The file input is reset after each attempt so the same file can be chosen again.
  - A new client API function sits next to the existing ones.
- **No new ADR**: choosing PDF over CSV is easy to reverse, since the parser is isolated behind one function.

## Testing Decisions

- **What makes a good test**: assert externally observable behaviour only, meaning HTTP responses, rows in Postgres, and what the user sees in the DOM. Don't assert on private helpers, regexes or intermediate data structures. A test should still pass after any refactor that keeps behaviour the same.
- **Seam 1: API endpoint (primary)**. Integration tests through `PostgresApiFactory`, following the pattern of the existing transaction endpoint tests (real API, throwaway Postgres container). Fixtures are **anonymised PDFs generated at test time** with a test-only PDF-writing library, in the same layout as a real Sparebanken Norge statement: a fake name, address and account number, and two pages with page-carry lines. The user's real statement is never committed. The generated PDFs must go through the real extraction path. Cases:
  - successful import: 201 response, correct count, and the stored Transactions have the expected dates, cleaned descriptions, signed Amounts, null Category, null Reference, and are linked to the stored Bank Statement;
  - multi-page statement imports rows from both pages;
  - re-uploading the same statement → 409, and no new rows;
  - same period but a different account → 201;
  - reconciliation failure (generated with a wrong closing balance) → 400, and nothing stored;
  - a non-statement PDF → 400; a non-PDF file → 400; a missing file → 400;
  - existing manual-transaction tests keep passing, so manual Transactions are unaffected and have no Bank Statement.
- **Seam 2: statement parser (pure function)**. Fast unit tests from hand-written text lines to the parsed result, for cases impractical to produce as PDFs: foreign-currency card rows, wrapped "Kurs: / 1.0000" lines, each description-cleaning pattern, Norwegian number formats, the "Varer"/"Til:"/card/transfer/income row shapes, page-carry and footer lines being ignored, year resolution, and reconciliation pass/fail. Take expected values from the real August 2026 statement's rows, with personal details replaced. There is no prior art for pure-function tests in the API test project; create them in the same project.
- **Seam 3: client**. Extend the existing `App` tests, which use a mocked `fetch` (prior art: the `App` tests and the `transactionForm` tests):
  - "Upload transactions" is rendered before "Add transaction";
  - choosing a file posts multipart form data to the endpoint;
  - an in-progress state is shown, then the success summary with count and period;
  - 400 and 409 messages are shown;
  - a network failure shows a generic error;
  - the button is re-enabled afterwards.

## Out of Scope

- Categorizing imported Transactions, and Categorization Rules.
- Statements from other banks, and CSV or any non-PDF format.
- Scanned (image-only) PDFs and OCR.
- An Account concept (named accounts, per-account views or filters).
- A transaction list or any view of imported Transactions.
- A preview or confirm step before saving.
- Undoing or deleting an imported Bank Statement (the link to its Transactions makes it possible later).
- Uploading several files at once.
- Storing the original PDF.
- Per-row deduplication across overlapping statements.
- Treating transfers between own accounts specially (e.g. excluding them from the Dashboard).

## Further Notes

- Reference statement used during design: Sparebanken Norge "Kontoutskrift nr. 8", account 1234.56.78901, period 01.08.2026–31.08.2026. It has 2 pages, opening balance 1 000,00 and closing balance 1 234,56. It's untracked in the repo root and must not be committed. Copy its layout and representative rows into the anonymised fixtures.
- In that statement, card rows carry the purchase date in the text (e.g. "31.07") but are booked in August. The booked date is the Transaction's date by design.
- Every card row shares the same reference ("21 12345678"), which is why bank reference numbers can't identify rows. Duplicates are prevented at the Bank Statement level instead.
- The page-carry line "Overført til neste side 12.345,67" shows the running balance at the bottom of page 1. A row-by-row running balance could serve as a per-page reconciliation check, but the end-to-end check is enough.
