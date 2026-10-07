# 01: Upload a one-page Bank Statement end to end

**What to build:** I click "Upload transactions" (to the left of "Add transaction"), pick a one-page Sparebanken Norge PDF Bank Statement, and every row on it is stored as an Uncategorized Transaction linked to a newly recorded Bank Statement. I then see "Imported N transactions from statement DD.MM.YYYY–DD.MM.YYYY". This is the tracer bullet through schema, PDF reading, parsing, the API and the UI. Descriptions are stored as the raw "Forklaring" text for now; cleaning them is ticket 02. See the parent spec: `.scratch/upload-bank-statement/spec.md`.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] A Bank Statement is persisted with account number, period start/end, opening and closing balance and import timestamp, unique on (account number, period start, period end); Transaction gains a nullable link to its Bank Statement. All of this ships in one migration.
- [x] The API reads the uploaded PDF's text with a .NET PDF text library (PdfPig expected). It uses word positions to mark each amount as money out ("Ut av konto") or money in ("Inn på konto"). Direction is never guessed from description text.
- [x] A pure statement parser turns extracted lines into a Bank Statement (or a failure with a user-facing reason). It reads the "Kontoutskrift nr. N for konto … i perioden … - …" header, the opening balance ("Saldo fra kontoutskrift") and the closing balance ("Saldo i Deres favør"), and single-line rows: booked date (DDMM, year from the statement period), Norwegian-formatted amount ("1.000,00") and direction.
- [x] Amounts are signed: negative for money out, positive for money in. Transfers between own accounts and income rows are imported like any other row.
- [x] Import is accepted only if opening + Σ(in) − Σ(out) = closing.
- [x] `POST /api/bank-statements` (multipart, field `file`) saves the Bank Statement and all its Transactions in one database transaction and returns `201` with `{ id, accountNumber, periodStart, periodEnd, transactionCount }`. Imported Transactions have no Category (Uncategorized) and no Reference. The PDF bytes are not stored.
- [x] Client: "Upload transactions" is rendered before "Add transaction" in a horizontal row and opens a PDF-only file picker. Picking a file uploads it immediately; the button shows an in-progress label and is disabled during upload. On success the existing status line shows the summary with count and period.
- [x] Tests: a test-only generator builds an anonymised one-page statement PDF (fake name, address, account) in the real layout at test time, and it goes through the real extraction path in an API integration test against the Postgres test container. That test asserts the 201 body and the stored rows (dates, signed Amounts, null Category/Reference, linked to the Bank Statement). Parser unit tests cover header, balances, number formats, year resolution and reconciliation pass. Client tests (mocked fetch) cover button order, multipart POST, in-progress state and success summary.
- [x] Existing "Add transaction" behaviour and tests are unchanged; manual Transactions have no Bank Statement.
