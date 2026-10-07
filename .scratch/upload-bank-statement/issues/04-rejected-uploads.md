# 04: Rejected uploads explain why

**What to build:** When an upload can't be imported, nothing is stored and I'm told clearly why: the statement was already imported, or the file isn't a readable Sparebanken Norge Bank Statement, or its totals don't add up. See the parent spec: `.scratch/upload-bank-statement/spec.md`.

**Blocked by:** 01 (Upload a one-page Bank Statement end to end)

**Status:** ready-for-agent

- [ ] Re-uploading a Bank Statement with the same account number and period returns `409 Conflict` with a message like "Statement for <account>, <start>–<end> has already been imported." and adds no rows. The unique constraint backs this up under concurrency.
- [ ] A statement for a different account with the same period is accepted.
- [ ] Each of these returns `400` as a validation problem keyed on `file`, with its own human-readable message: missing file, non-PDF, unreadable PDF, PDF that isn't a Sparebanken Norge Bank Statement, unparseable row, failed reconciliation, and a file over the size cap (~10 MB).
- [ ] On every failure nothing is persisted: no Bank Statement and no Transactions.
- [ ] Client: on 400/409 the status line shows the server's message in an error style; on a network failure it shows a generic error. The button is re-enabled afterwards, and the file input is reset so the same file can be picked again.
- [ ] API integration tests cover each rejection, asserting the status code and that no rows were stored (the reconciliation case uses a generated PDF with a wrong closing balance). Client tests (mocked fetch) cover 400, 409, network failure and re-enabling.
