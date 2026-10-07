# 02: Clean descriptions of imported Transactions

**What to build:** Imported Transactions are described by the merchant or payee instead of the bank's raw text, so they are readable and ready for future Categorization Rules. See the parent spec: `.scratch/upload-bank-statement/spec.md`.

**Blocked by:** 01 (Upload a one-page Bank Statement end to end)

**Status:** ready-for-agent

- [x] Card rows `*NNNN dd.mm <CUR> <amount> <merchant> Kurs: <rate>` become `<merchant>` (e.g. "*1111 31.07 Nok 296.60 Rema 1000 Sentrum Kurs: 1.0000" → "Rema 1000 Sentrum").
- [x] Foreign-currency card rows (e.g. "Eur 25.00 … Kurs: 11.6400") are cleaned the same way; the Amount stays the booked NOK value.
- [x] Payment rows `Til: <payee> Betalt: dd.mm.yy` become `<payee>` (e.g. "Fjordkraft AS"), including account-number payees such as "Til: 9999.88.77777".
- [x] `Varer dd.mm <shop>` rows become `<shop>` (e.g. "Rema Storgata Nedre Torget Oslo").
- [x] Other rows (e.g. "Overføring mellom egne kontoer", "Lønn Fra: Testfirma AS") are kept as-is.
- [x] Descriptions longer than the Description max length (200) are truncated.
- [x] Parser unit tests cover each row shape including foreign currency; the API integration test asserts cleaned descriptions on stored Transactions.
